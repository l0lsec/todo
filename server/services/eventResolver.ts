import { db, type EventRow } from "../db.js";
import {
  findEventByJiraKey,
  getEventById,
  type GraphEventLite,
} from "./graph.js";

export type ResolvedEvent = {
  graphEventId: string;
  startUtcIso: string;
  endUtcIso: string;
  showAs: "free" | "busy";
  webLink: string | null;
  source: "db" | "graph";
};

export async function resolveExistingEventForKey(
  jiraKey: string,
): Promise<ResolvedEvent | null> {
  const row = db
    .prepare("SELECT * FROM events WHERE jira_key = ?")
    .get(jiraKey) as EventRow | undefined;

  if (row?.graph_event_id) {
    let lite: GraphEventLite | null = null;
    try {
      lite = await getEventById(row.graph_event_id);
    } catch {
      lite = null;
    }
    if (lite && !lite.isCancelled) {
      return {
        graphEventId: lite.id,
        startUtcIso: lite.startUtcIso,
        endUtcIso: lite.endUtcIso,
        showAs: lite.showAs,
        webLink: lite.webLink,
        source: "db",
      };
    }
    if (lite === null) {
      db.prepare("DELETE FROM events WHERE jira_key = ? AND graph_event_id = ?")
        .run(jiraKey, row.graph_event_id);
    }
  }

  let viaGraph: GraphEventLite | null = null;
  try {
    viaGraph = await findEventByJiraKey(jiraKey);
  } catch {
    viaGraph = null;
  }
  if (viaGraph && !viaGraph.isCancelled) {
    return {
      graphEventId: viaGraph.id,
      startUtcIso: viaGraph.startUtcIso,
      endUtcIso: viaGraph.endUtcIso,
      showAs: viaGraph.showAs,
      webLink: viaGraph.webLink,
      source: "graph",
    };
  }
  return null;
}
