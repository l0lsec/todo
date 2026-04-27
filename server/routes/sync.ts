import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { readSettings } from "../settings.js";
import { db, type EventRow } from "../db.js";
import { searchTickets, buildJql, getTicket, type JiraTicket } from "../services/jira.js";
import { listBusyIntervals, createEvent, patchEvent, deleteEvent } from "../services/graph.js";
import { planSchedule, type ProposedBlock } from "../services/scheduler.js";
import { isSignedIn } from "../auth/msal.js";

export const syncRouter = Router();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function buildBody(ticket: { key: string; url: string; estimateSeconds: number | null }): string {
  const est = ticket.estimateSeconds
    ? `${Math.round(ticket.estimateSeconds / 60)} min (Jira estimate)`
    : "default 60 min (no Jira estimate set)";
  return `<p><a href="${escapeHtml(ticket.url)}">${escapeHtml(ticket.key)}</a> — auto-blocked by Jira&nbsp;Scheduler.</p>
<p>Estimate: ${escapeHtml(est)}<br/>Last synced: ${new Date().toISOString()}</p>`;
}

async function gatherTicketsAndBusy() {
  const settings = readSettings();
  if (settings.selectedProjectKeys.length === 0) {
    return { settings, tickets: [] as JiraTicket[], busy: [], reason: "no_projects_selected" as const };
  }
  const jql = buildJql({
    status: settings.ticketStatus,
    projectKeys: settings.selectedProjectKeys,
  });
  const tickets = await searchTickets(jql);

  const startUtc = DateTime.utc().toISO()!;
  const endUtc = DateTime.utc()
    .plus({ days: settings.lookaheadBusinessDays + 7 })
    .toISO()!;
  const busy = await listBusyIntervals(startUtc, endUtc);

  return { settings, tickets, busy, reason: null };
}

syncRouter.get("/preview", async (_req, res) => {
  try {
    if (!isSignedIn()) {
      res.status(401).json({ error: "Not signed in to Microsoft" });
      return;
    }
    const { settings, tickets, busy, reason } = await gatherTicketsAndBusy();
    if (reason === "no_projects_selected") {
      res.json({
        reason,
        message: "Pick projects in Settings to start scheduling.",
        tickets: [],
        blocks: [],
        unscheduled: [],
        existing: [],
      });
      return;
    }

    const existing = db
      .prepare("SELECT * FROM events WHERE status = 'scheduled' AND end_utc > datetime('now')")
      .all() as EventRow[];
    const reservedKeys = new Set(existing.map((e) => e.jira_key));

    const ticketsForScheduling = tickets
      .filter((t) => !reservedKeys.has(t.key))
      .map((t) => ({
        key: t.key,
        projectKey: t.projectKey,
        summary: t.summary,
        estimateSeconds: t.estimateSeconds,
      }));

    const result = planSchedule({
      tickets: ticketsForScheduling,
      busy,
      settings,
    });

    res.json({
      reason: null,
      tickets: tickets.map((t) => ({
        ...t,
        alreadyScheduled: reservedKeys.has(t.key),
      })),
      blocks: result.blocks,
      unscheduled: result.unscheduled,
      existing: existing.map((e) => ({
        jiraKey: e.jira_key,
        projectKey: e.project_key,
        summary: e.summary,
        startUtcIso: e.start_utc,
        endUtcIso: e.end_utc,
        showAs: e.show_as,
        status: e.status,
        graphEventId: e.graph_event_id,
      })),
      windowStartIso: result.windowStartIso,
      windowEndIso: result.windowEndIso,
      settings,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const ConfirmSchema = z.object({
  blocks: z.array(
    z.object({
      jiraKey: z.string(),
      projectKey: z.string(),
      summary: z.string(),
      startUtcIso: z.string(),
      endUtcIso: z.string(),
      durationMin: z.number(),
      showAs: z.enum(["free", "busy"]),
    }),
  ),
});

syncRouter.post("/confirm", async (req, res) => {
  try {
    if (!isSignedIn()) {
      res.status(401).json({ error: "Not signed in to Microsoft" });
      return;
    }
    const { blocks } = ConfirmSchema.parse(req.body);

    const created: { jiraKey: string; graphEventId: string; webLink: string | null }[] = [];

    for (const b of blocks as ProposedBlock[]) {
      const url = `${(process.env.JIRA_BASE_URL || "").replace(/\/+$/, "")}/browse/${b.jiraKey}`;
      const subject = `[${b.jiraKey}] ${b.summary}`;
      const bodyHtml = buildBody({ key: b.jiraKey, url, estimateSeconds: b.durationMin * 60 });
      const ev = await createEvent({
        jiraKey: b.jiraKey,
        subject,
        bodyHtml,
        startUtcIso: b.startUtcIso,
        endUtcIso: b.endUtcIso,
        showAs: b.showAs,
      });
      db.prepare(
        `INSERT INTO events (jira_key, project_key, summary, graph_event_id, start_utc, end_utc, show_as, status, updated_at)
         VALUES (@jira_key, @project_key, @summary, @graph_event_id, @start_utc, @end_utc, @show_as, 'scheduled', datetime('now'))
         ON CONFLICT(jira_key) DO UPDATE SET
           project_key = excluded.project_key,
           summary = excluded.summary,
           graph_event_id = excluded.graph_event_id,
           start_utc = excluded.start_utc,
           end_utc = excluded.end_utc,
           show_as = excluded.show_as,
           status = 'scheduled',
           updated_at = datetime('now')`,
      ).run({
        jira_key: b.jiraKey,
        project_key: b.projectKey,
        summary: b.summary,
        graph_event_id: ev.id,
        start_utc: b.startUtcIso,
        end_utc: b.endUtcIso,
        show_as: b.showAs,
      });
      created.push({ jiraKey: b.jiraKey, graphEventId: ev.id, webLink: ev.webLink });
    }

    res.json({ ok: true, created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export async function runRescheduleSweep(): Promise<{
  rescheduled: { jiraKey: string; from: string; to: string }[];
  completed: string[];
  errors: { jiraKey: string; error: string }[];
}> {
  const settings = readSettings();
  const errors: { jiraKey: string; error: string }[] = [];
  const rescheduled: { jiraKey: string; from: string; to: string }[] = [];
  const completed: string[] = [];

  const past = db
    .prepare("SELECT * FROM events WHERE status = 'scheduled' AND end_utc < datetime('now')")
    .all() as EventRow[];

  if (past.length === 0) return { rescheduled, completed, errors };

  const startUtc = DateTime.utc().toISO()!;
  const endUtc = DateTime.utc()
    .plus({ days: settings.lookaheadBusinessDays + 7 })
    .toISO()!;
  let busy: { startUtc: string; endUtc: string }[] = [];
  try {
    busy = await listBusyIntervals(startUtc, endUtc);
  } catch (err: any) {
    return { rescheduled, completed, errors: [{ jiraKey: "*", error: err.message }] };
  }

  const futureRows = db
    .prepare("SELECT * FROM events WHERE status = 'scheduled' AND end_utc >= datetime('now')")
    .all() as EventRow[];
  const futureBusy = futureRows.map((r) => ({ startUtc: r.start_utc, endUtc: r.end_utc }));
  const allBusy = [...busy, ...futureBusy];

  for (const row of past) {
    try {
      const ticket = await getTicket(row.jira_key);
      if (!ticket) {
        db.prepare(
          "UPDATE events SET status = 'stale', updated_at = datetime('now') WHERE jira_key = ?",
        ).run(row.jira_key);
        continue;
      }
      if (settings.completedStatuses.includes(ticket.status)) {
        db.prepare(
          "UPDATE events SET status = 'completed', last_jira_status = ?, updated_at = datetime('now') WHERE jira_key = ?",
        ).run(ticket.status, row.jira_key);
        completed.push(row.jira_key);
        continue;
      }

      const result = planSchedule({
        tickets: [
          {
            key: ticket.key,
            projectKey: ticket.projectKey,
            summary: ticket.summary,
            estimateSeconds: ticket.estimateSeconds,
          },
        ],
        busy: allBusy,
        settings,
      });
      const next = result.blocks[0];
      if (!next) {
        errors.push({ jiraKey: row.jira_key, error: "no_free_slot_in_window" });
        continue;
      }
      const oldRange = `${row.start_utc} → ${row.end_utc}`;
      const noteHtml = `<p><strong>Rescheduled</strong> from ${escapeHtml(oldRange)} on ${new Date().toISOString()} — ticket still <em>${escapeHtml(ticket.status)}</em>.</p>`;
      const url = `${(process.env.JIRA_BASE_URL || "").replace(/\/+$/, "")}/browse/${ticket.key}`;
      const bodyHtml = noteHtml + buildBody({ key: ticket.key, url, estimateSeconds: ticket.estimateSeconds });
      await patchEvent(row.graph_event_id, {
        startUtcIso: next.startUtcIso,
        endUtcIso: next.endUtcIso,
        bodyHtml,
        subject: `[${ticket.key}] ${ticket.summary}`,
        showAs: row.show_as,
      });
      db.prepare(
        `UPDATE events SET start_utc = @start, end_utc = @end, last_jira_status = @status, summary = @summary, updated_at = datetime('now') WHERE jira_key = @key`,
      ).run({
        start: next.startUtcIso,
        end: next.endUtcIso,
        status: ticket.status,
        summary: ticket.summary,
        key: row.jira_key,
      });
      allBusy.push({ startUtc: next.startUtcIso, endUtc: next.endUtcIso });
      rescheduled.push({ jiraKey: row.jira_key, from: oldRange, to: `${next.startUtcIso} → ${next.endUtcIso}` });
    } catch (err: any) {
      errors.push({ jiraKey: row.jira_key, error: err.message });
    }
  }

  return { rescheduled, completed, errors };
}

syncRouter.post("/reschedule", async (_req, res) => {
  try {
    if (!isSignedIn()) {
      res.status(401).json({ error: "Not signed in to Microsoft" });
      return;
    }
    const result = await runRescheduleSweep();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

syncRouter.delete("/event/:jiraKey", async (req, res) => {
  try {
    const row = db
      .prepare("SELECT graph_event_id FROM events WHERE jira_key = ?")
      .get(req.params.jiraKey) as { graph_event_id: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    try {
      await deleteEvent(row.graph_event_id);
    } catch {
    }
    db.prepare("DELETE FROM events WHERE jira_key = ?").run(req.params.jiraKey);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
