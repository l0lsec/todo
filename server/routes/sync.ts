import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { readSettings, priorityRank, type Settings } from "../settings.js";
import { db, type EventRow } from "../db.js";
import { searchTickets, buildJql, getTicket, type JiraTicket } from "../services/jira.js";
import {
  listBusyIntervals,
  createEvent,
  patchEvent,
  deleteEvent,
  type BusyInterval,
} from "../services/graph.js";
import { planSchedule, type ProposedBlock, type TicketForScheduling } from "../services/scheduler.js";
import { resolveExistingEventForKey } from "../services/eventResolver.js";
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
    return { settings, tickets: [] as JiraTicket[], busy: [] as BusyInterval[], reason: "no_projects_selected" as const };
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

function buildSchedulingInput(
  tickets: JiraTicket[],
  existing: EventRow[],
  settings: Settings,
): TicketForScheduling[] {
  const eventByKey = new Map<string, EventRow>();
  for (const e of existing) eventByKey.set(e.jira_key, e);
  return tickets.map((t) => {
    const ev = eventByKey.get(t.key);
    return {
      key: t.key,
      projectKey: t.projectKey,
      summary: t.summary,
      estimateSeconds: t.estimateSeconds,
      priorityRank: priorityRank(t.priority, settings.priorityRanks),
      createdIso: t.created,
      existingGraphEventId: ev?.graph_event_id ?? null,
      existingShowAs: ev?.show_as ?? null,
    };
  });
}

function filterOutOwnEvents(busy: BusyInterval[], ownEventIds: Set<string>): BusyInterval[] {
  if (ownEventIds.size === 0) return busy;
  return busy.filter((b) => !(b.graphEventId && ownEventIds.has(b.graphEventId)));
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
        moves: [],
      });
      return;
    }

    const existing = db
      .prepare("SELECT * FROM events WHERE status != 'completed' AND end_utc > datetime('now')")
      .all() as EventRow[];
    const ownEventIds = new Set(existing.map((e) => e.graph_event_id));
    const replannableBusy = filterOutOwnEvents(busy, ownEventIds);

    const ticketsForScheduling = buildSchedulingInput(tickets, existing, settings);
    const ticketKeys = new Set(tickets.map((t) => t.key));

    const result = planSchedule({
      tickets: ticketsForScheduling,
      busy: replannableBusy,
      settings,
    });

    const startByKey = new Map<string, string>();
    for (const e of existing) startByKey.set(e.jira_key, e.start_utc);
    const moves: { jiraKey: string; fromIso: string; toIso: string }[] = [];
    for (const block of result.blocks) {
      const prev = startByKey.get(block.jiraKey);
      if (prev && prev !== block.startUtcIso) {
        moves.push({ jiraKey: block.jiraKey, fromIso: prev, toIso: block.startUtcIso });
      }
    }

    res.json({
      reason: null,
      tickets: tickets.map((t) => ({
        ...t,
        priorityRank: priorityRank(t.priority, settings.priorityRanks),
        alreadyScheduled: ownEventIds.size > 0 && existing.some((e) => e.jira_key === t.key),
      })),
      blocks: result.blocks,
      unscheduled: result.unscheduled,
      existing: existing
        .filter((e) => ticketKeys.has(e.jira_key))
        .map((e) => ({
          jiraKey: e.jira_key,
          projectKey: e.project_key,
          summary: e.summary,
          startUtcIso: e.start_utc,
          endUtcIso: e.end_utc,
          showAs: e.show_as,
          status: e.status,
          graphEventId: e.graph_event_id,
        })),
      moves,
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
      existingGraphEventId: z.string().nullable().optional(),
      existingShowAs: z.enum(["free", "busy"]).nullable().optional(),
    }),
  ),
});

type ConfirmAction = "created" | "patched" | "noop" | "adopted";

syncRouter.post("/confirm", async (req, res) => {
  try {
    if (!isSignedIn()) {
      res.status(401).json({ error: "Not signed in to Microsoft" });
      return;
    }
    const { blocks } = ConfirmSchema.parse(req.body);

    const created: { jiraKey: string; graphEventId: string; webLink: string | null; action: ConfirmAction }[] = [];

    for (const b of blocks) {
      const url = `${(process.env.JIRA_BASE_URL || "").replace(/\/+$/, "")}/browse/${b.jiraKey}`;
      const subject = `[${b.jiraKey}] ${b.summary}`;
      const bodyHtml = buildBody({ key: b.jiraKey, url, estimateSeconds: b.durationMin * 60 });

      const resolved = await resolveExistingEventForKey(b.jiraKey);
      const existingGraphEventId = b.existingGraphEventId ?? resolved?.graphEventId ?? null;

      if (existingGraphEventId) {
        const compareStart = resolved?.startUtcIso;
        const compareEnd = resolved?.endUtcIso;
        const compareShowAs = resolved?.showAs;
        const sameTime = compareStart === b.startUtcIso && compareEnd === b.endUtcIso;
        const sameShowAs = compareShowAs === b.showAs;

        if (resolved && sameTime && sameShowAs) {
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
            graph_event_id: existingGraphEventId,
            start_utc: b.startUtcIso,
            end_utc: b.endUtcIso,
            show_as: b.showAs,
          });
          const action: ConfirmAction = resolved.source === "graph" && !b.existingGraphEventId ? "adopted" : "noop";
          created.push({ jiraKey: b.jiraKey, graphEventId: existingGraphEventId, webLink: resolved.webLink, action });
          continue;
        }

        try {
          await patchEvent(existingGraphEventId, {
            startUtcIso: b.startUtcIso,
            endUtcIso: b.endUtcIso,
            showAs: b.showAs,
            subject,
            bodyHtml,
          });
        } catch (err: any) {
          if (/Graph 404/.test(String(err?.message ?? ""))) {
            db.prepare("DELETE FROM events WHERE graph_event_id = ?").run(existingGraphEventId);
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
            created.push({ jiraKey: b.jiraKey, graphEventId: ev.id, webLink: ev.webLink, action: "created" });
            continue;
          }
          throw err;
        }

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
          graph_event_id: existingGraphEventId,
          start_utc: b.startUtcIso,
          end_utc: b.endUtcIso,
          show_as: b.showAs,
        });
        created.push({ jiraKey: b.jiraKey, graphEventId: existingGraphEventId, webLink: resolved?.webLink ?? null, action: "patched" });
        continue;
      }

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
      created.push({ jiraKey: b.jiraKey, graphEventId: ev.id, webLink: ev.webLink, action: "created" });
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

  if (settings.selectedProjectKeys.length === 0) {
    return { rescheduled, completed, errors };
  }

  let openTickets: JiraTicket[] = [];
  try {
    const jql = buildJql({
      status: settings.ticketStatus,
      projectKeys: settings.selectedProjectKeys,
    });
    openTickets = await searchTickets(jql);
  } catch (err: any) {
    return { rescheduled, completed, errors: [{ jiraKey: "*", error: err.message }] };
  }
  const openByKey = new Map<string, JiraTicket>();
  for (const t of openTickets) openByKey.set(t.key, t);

  const past = db
    .prepare("SELECT * FROM events WHERE status = 'scheduled' AND end_utc < datetime('now')")
    .all() as EventRow[];

  const dropFromPlan = new Set<string>();
  for (const row of past) {
    try {
      const live = openByKey.get(row.jira_key) ?? (await getTicket(row.jira_key));
      if (!live) {
        db.prepare(
          "UPDATE events SET status = 'stale', updated_at = datetime('now') WHERE jira_key = ?",
        ).run(row.jira_key);
        dropFromPlan.add(row.jira_key);
        continue;
      }
      if (settings.completedStatuses.includes(live.status)) {
        db.prepare(
          "UPDATE events SET status = 'completed', last_jira_status = ?, updated_at = datetime('now') WHERE jira_key = ?",
        ).run(live.status, row.jira_key);
        completed.push(row.jira_key);
        dropFromPlan.add(row.jira_key);
        continue;
      }
    } catch (err: any) {
      errors.push({ jiraKey: row.jira_key, error: err.message });
      dropFromPlan.add(row.jira_key);
    }
  }

  const ticketsToPlan = openTickets.filter((t) => !dropFromPlan.has(t.key));
  if (ticketsToPlan.length === 0) {
    return { rescheduled, completed, errors };
  }

  const startUtc = DateTime.utc().toISO()!;
  const endUtc = DateTime.utc()
    .plus({ days: settings.lookaheadBusinessDays + 7 })
    .toISO()!;
  let busy: BusyInterval[] = [];
  try {
    busy = await listBusyIntervals(startUtc, endUtc);
  } catch (err: any) {
    return { rescheduled, completed, errors: [...errors, { jiraKey: "*", error: err.message }] };
  }

  const futureRows = db
    .prepare("SELECT * FROM events WHERE status = 'scheduled' AND end_utc >= datetime('now')")
    .all() as EventRow[];
  const ownEventIds = new Set(futureRows.map((e) => e.graph_event_id));
  const replannableBusy = filterOutOwnEvents(busy, ownEventIds);

  const ticketsForScheduling = buildSchedulingInput(ticketsToPlan, futureRows, settings);
  const result = planSchedule({
    tickets: ticketsForScheduling,
    busy: replannableBusy,
    settings,
  });

  const previousByKey = new Map<string, EventRow>();
  for (const r of futureRows) previousByKey.set(r.jira_key, r);
  for (const r of past) if (!previousByKey.has(r.jira_key)) previousByKey.set(r.jira_key, r);

  for (const block of result.blocks) {
    try {
      const prev = previousByKey.get(block.jiraKey);
      const url = `${(process.env.JIRA_BASE_URL || "").replace(/\/+$/, "")}/browse/${block.jiraKey}`;
      const subject = `[${block.jiraKey}] ${block.summary}`;
      const live = openByKey.get(block.jiraKey);
      const baseBody = buildBody({
        key: block.jiraKey,
        url,
        estimateSeconds: live?.estimateSeconds ?? block.durationMin * 60,
      });

      if (block.existingGraphEventId && prev) {
        const sameTime = prev.start_utc === block.startUtcIso && prev.end_utc === block.endUtcIso;
        const sameShowAs = prev.show_as === block.showAs;
        if (sameTime && sameShowAs) continue;
        const oldRange = `${prev.start_utc} → ${prev.end_utc}`;
        const noteHtml = `<p><strong>Rescheduled</strong> from ${escapeHtml(oldRange)} on ${new Date().toISOString()}${live ? ` — ticket still <em>${escapeHtml(live.status)}</em>.` : "."}</p>`;
        await patchEvent(block.existingGraphEventId, {
          startUtcIso: block.startUtcIso,
          endUtcIso: block.endUtcIso,
          subject,
          bodyHtml: noteHtml + baseBody,
          showAs: block.showAs,
        });
        db.prepare(
          `UPDATE events SET start_utc = @start, end_utc = @end, last_jira_status = @status, summary = @summary, project_key = @project, show_as = @show_as, status = 'scheduled', updated_at = datetime('now') WHERE jira_key = @key`,
        ).run({
          start: block.startUtcIso,
          end: block.endUtcIso,
          status: live?.status ?? null,
          summary: block.summary,
          project: block.projectKey,
          show_as: block.showAs,
          key: block.jiraKey,
        });
        rescheduled.push({
          jiraKey: block.jiraKey,
          from: oldRange,
          to: `${block.startUtcIso} → ${block.endUtcIso}`,
        });
      } else {
        const resolved = await resolveExistingEventForKey(block.jiraKey);
        if (resolved) {
          const sameTime =
            resolved.startUtcIso === block.startUtcIso && resolved.endUtcIso === block.endUtcIso;
          const sameShowAs = resolved.showAs === block.showAs;
          if (sameTime && sameShowAs) {
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
              jira_key: block.jiraKey,
              project_key: block.projectKey,
              summary: block.summary,
              graph_event_id: resolved.graphEventId,
              start_utc: block.startUtcIso,
              end_utc: block.endUtcIso,
              show_as: block.showAs,
            });
            continue;
          }
          const oldRange = `${resolved.startUtcIso} → ${resolved.endUtcIso}`;
          const noteHtml = `<p><strong>Rescheduled</strong> from ${escapeHtml(oldRange)} on ${new Date().toISOString()}${live ? ` — ticket still <em>${escapeHtml(live.status)}</em>.` : "."}</p>`;
          await patchEvent(resolved.graphEventId, {
            startUtcIso: block.startUtcIso,
            endUtcIso: block.endUtcIso,
            subject,
            bodyHtml: noteHtml + baseBody,
            showAs: block.showAs,
          });
          db.prepare(
            `INSERT INTO events (jira_key, project_key, summary, graph_event_id, start_utc, end_utc, show_as, status, last_jira_status, updated_at)
             VALUES (@jira_key, @project_key, @summary, @graph_event_id, @start_utc, @end_utc, @show_as, 'scheduled', @last_status, datetime('now'))
             ON CONFLICT(jira_key) DO UPDATE SET
               project_key = excluded.project_key,
               summary = excluded.summary,
               graph_event_id = excluded.graph_event_id,
               start_utc = excluded.start_utc,
               end_utc = excluded.end_utc,
               show_as = excluded.show_as,
               status = 'scheduled',
               last_jira_status = excluded.last_jira_status,
               updated_at = datetime('now')`,
          ).run({
            jira_key: block.jiraKey,
            project_key: block.projectKey,
            summary: block.summary,
            graph_event_id: resolved.graphEventId,
            start_utc: block.startUtcIso,
            end_utc: block.endUtcIso,
            show_as: block.showAs,
            last_status: live?.status ?? null,
          });
          rescheduled.push({
            jiraKey: block.jiraKey,
            from: oldRange,
            to: `${block.startUtcIso} → ${block.endUtcIso}`,
          });
          continue;
        }

        const created = await createEvent({
          jiraKey: block.jiraKey,
          subject,
          bodyHtml: baseBody,
          startUtcIso: block.startUtcIso,
          endUtcIso: block.endUtcIso,
          showAs: block.showAs,
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
          jira_key: block.jiraKey,
          project_key: block.projectKey,
          summary: block.summary,
          graph_event_id: created.id,
          start_utc: block.startUtcIso,
          end_utc: block.endUtcIso,
          show_as: block.showAs,
        });
        rescheduled.push({
          jiraKey: block.jiraKey,
          from: prev ? `${prev.start_utc} → ${prev.end_utc}` : "(none)",
          to: `${block.startUtcIso} → ${block.endUtcIso}`,
        });
      }
    } catch (err: any) {
      errors.push({ jiraKey: block.jiraKey, error: err.message });
    }
  }

  for (const u of result.unscheduled) {
    errors.push({ jiraKey: u.jiraKey, error: u.reason });
  }

  return { rescheduled, completed, errors };
}

const ScheduleOneSchema = z.object({
  jiraKey: z.string().min(1),
  lookaheadBusinessDays: z.number().int().min(1).max(120).optional(),
});

const FORCE_SCHEDULE_DEFAULT_LOOKAHEAD = 60;

syncRouter.post("/schedule-one", async (req, res) => {
  try {
    if (!isSignedIn()) {
      res.status(401).json({ error: "Not signed in to Microsoft" });
      return;
    }
    const { jiraKey, lookaheadBusinessDays } = ScheduleOneSchema.parse(req.body);
    const settings = readSettings();
    const ticket = await getTicket(jiraKey);
    if (!ticket) {
      res.status(404).json({ error: `Jira ticket ${jiraKey} not found` });
      return;
    }

    const extendedLookahead = Math.max(
      settings.lookaheadBusinessDays,
      lookaheadBusinessDays ?? FORCE_SCHEDULE_DEFAULT_LOOKAHEAD,
    );
    const extendedSettings: Settings = { ...settings, lookaheadBusinessDays: extendedLookahead };

    const startUtc = DateTime.utc().toISO()!;
    const endUtc = DateTime.utc()
      .plus({ days: extendedLookahead + 14 })
      .toISO()!;
    const busy = await listBusyIntervals(startUtc, endUtc);

    const resolved = await resolveExistingEventForKey(jiraKey);

    const single: TicketForScheduling = {
      key: ticket.key,
      projectKey: ticket.projectKey,
      summary: ticket.summary,
      estimateSeconds: ticket.estimateSeconds,
      priorityRank: priorityRank(ticket.priority, settings.priorityRanks),
      createdIso: ticket.created,
      existingGraphEventId: resolved?.graphEventId ?? null,
      existingShowAs: resolved?.showAs ?? null,
    };

    const ownEventIds = new Set<string>();
    if (single.existingGraphEventId) ownEventIds.add(single.existingGraphEventId);
    const replannableBusy = filterOutOwnEvents(busy, ownEventIds);

    const result = planSchedule({
      tickets: [single],
      busy: replannableBusy,
      settings: extendedSettings,
    });
    const block = result.blocks[0];
    if (!block) {
      res.status(409).json({
        error: `No free slot found for ${jiraKey} in the next ${extendedLookahead} business days`,
      });
      return;
    }

    const url = `${(process.env.JIRA_BASE_URL || "").replace(/\/+$/, "")}/browse/${ticket.key}`;
    const subject = `[${ticket.key}] ${ticket.summary}`;
    const bodyHtml = buildBody({
      key: ticket.key,
      url,
      estimateSeconds: ticket.estimateSeconds ?? block.durationMin * 60,
    });

    if (block.existingGraphEventId && resolved) {
      const sameTime =
        resolved.startUtcIso === block.startUtcIso && resolved.endUtcIso === block.endUtcIso;
      const sameShowAs = resolved.showAs === block.showAs;
      if (sameTime && sameShowAs) {
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
          jira_key: block.jiraKey,
          project_key: block.projectKey,
          summary: block.summary,
          graph_event_id: block.existingGraphEventId,
          start_utc: block.startUtcIso,
          end_utc: block.endUtcIso,
          show_as: block.showAs,
        });
        const action = resolved.source === "graph" ? "adopted" : "noop";
        res.json({ ok: true, block, action, webLink: resolved.webLink });
        return;
      }

      try {
        await patchEvent(block.existingGraphEventId, {
          startUtcIso: block.startUtcIso,
          endUtcIso: block.endUtcIso,
          showAs: block.showAs,
          subject,
          bodyHtml,
        });
      } catch (err: any) {
        if (/Graph 404/.test(String(err?.message ?? ""))) {
          db.prepare("DELETE FROM events WHERE graph_event_id = ?").run(block.existingGraphEventId);
          const ev = await createEvent({
            jiraKey: block.jiraKey,
            subject,
            bodyHtml,
            startUtcIso: block.startUtcIso,
            endUtcIso: block.endUtcIso,
            showAs: block.showAs,
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
            jira_key: block.jiraKey,
            project_key: block.projectKey,
            summary: block.summary,
            graph_event_id: ev.id,
            start_utc: block.startUtcIso,
            end_utc: block.endUtcIso,
            show_as: block.showAs,
          });
          res.json({ ok: true, block, action: "created", webLink: ev.webLink });
          return;
        }
        throw err;
      }

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
        jira_key: block.jiraKey,
        project_key: block.projectKey,
        summary: block.summary,
        graph_event_id: block.existingGraphEventId,
        start_utc: block.startUtcIso,
        end_utc: block.endUtcIso,
        show_as: block.showAs,
      });
      res.json({ ok: true, block, action: "patched", webLink: resolved.webLink });
      return;
    }

    const ev = await createEvent({
      jiraKey: block.jiraKey,
      subject,
      bodyHtml,
      startUtcIso: block.startUtcIso,
      endUtcIso: block.endUtcIso,
      showAs: block.showAs,
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
      jira_key: block.jiraKey,
      project_key: block.projectKey,
      summary: block.summary,
      graph_event_id: ev.id,
      start_utc: block.startUtcIso,
      end_utc: block.endUtcIso,
      show_as: block.showAs,
    });
    res.json({ ok: true, block, action: "created", webLink: ev.webLink });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
