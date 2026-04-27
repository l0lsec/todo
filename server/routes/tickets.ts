import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { getTransitions, transitionTicket, getTicket } from "../services/jira.js";
import { deleteEvent } from "../services/graph.js";
import { readSettings } from "../settings.js";

export const ticketsRouter = Router();

ticketsRouter.get("/:key/transitions", async (req, res) => {
  try {
    const transitions = await getTransitions(req.params.key);
    res.json({ transitions });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

const TransitionBody = z.object({ transitionId: z.string().min(1) });

ticketsRouter.post("/:key/transition", async (req, res) => {
  try {
    const { transitionId } = TransitionBody.parse(req.body);
    await transitionTicket(req.params.key, transitionId);
    const ticket = await getTicket(req.params.key);

    if (ticket) {
      const settings = readSettings();
      const completed = settings.completedStatuses.includes(ticket.status);
      const row = db
        .prepare(
          "SELECT graph_event_id, end_utc FROM events WHERE jira_key = ?",
        )
        .get(req.params.key) as { graph_event_id: string; end_utc: string } | undefined;

      if (completed) {
        if (row && new Date(row.end_utc) > new Date()) {
          try {
            await deleteEvent(row.graph_event_id);
          } catch {
          }
          db.prepare("DELETE FROM events WHERE jira_key = ?").run(req.params.key);
        } else if (row) {
          db.prepare(
            "UPDATE events SET status = 'completed', last_jira_status = ?, updated_at = datetime('now') WHERE jira_key = ?",
          ).run(ticket.status, req.params.key);
        }
      } else if (row) {
        db.prepare(
          "UPDATE events SET last_jira_status = ?, status = CASE WHEN ? != 'Selected for Development' THEN 'stale' ELSE status END, updated_at = datetime('now') WHERE jira_key = ?",
        ).run(ticket.status, ticket.status, req.params.key);
      }
    }

    res.json({ ok: true, ticket });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});
