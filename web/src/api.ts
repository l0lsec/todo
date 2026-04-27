import type {
  Health,
  Preview,
  Project,
  ProposedBlock,
  Settings,
  Transition,
} from "./types";

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.error ?? msg;
    } catch {
    }
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const api = {
  health: () => jfetch<Health>("/api/health"),
  me: () => jfetch<{ signedIn: boolean; username?: string; name?: string | null }>("/auth/me"),
  logout: () => jfetch<{ ok: true }>("/auth/logout", { method: "POST" }),

  getSettings: () => jfetch<Settings>("/api/settings"),
  saveSettings: (patch: Partial<Settings>) =>
    jfetch<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),

  listProjects: () => jfetch<{ projects: Project[] }>("/api/projects"),
  refreshProjects: () =>
    jfetch<{ projects: Project[]; count: number }>("/api/projects/refresh", { method: "POST" }),

  preview: () => jfetch<Preview>("/api/sync/preview"),
  confirm: (blocks: ProposedBlock[]) =>
    jfetch<{ ok: true; created: { jiraKey: string; graphEventId: string; webLink: string | null }[] }>(
      "/api/sync/confirm",
      { method: "POST", body: JSON.stringify({ blocks }) },
    ),
  reschedule: () =>
    jfetch<{
      rescheduled: { jiraKey: string; from: string; to: string }[];
      completed: string[];
      errors: { jiraKey: string; error: string }[];
    }>("/api/sync/reschedule", { method: "POST" }),
  deleteScheduled: (jiraKey: string) =>
    jfetch<{ ok: true }>(`/api/sync/event/${encodeURIComponent(jiraKey)}`, { method: "DELETE" }),

  transitions: (jiraKey: string) =>
    jfetch<{ transitions: Transition[] }>(`/api/tickets/${encodeURIComponent(jiraKey)}/transitions`),
  transition: (jiraKey: string, transitionId: string) =>
    jfetch<{ ok: true; ticket: { key: string; status: string } | null }>(
      `/api/tickets/${encodeURIComponent(jiraKey)}/transition`,
      { method: "POST", body: JSON.stringify({ transitionId }) },
    ),
};
