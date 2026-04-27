import { acquireAccessToken } from "../auth/msal.js";

const GRAPH = "https://graph.microsoft.com/v1.0";

const JIRA_KEY_PROP_ID =
  "String {00020329-0000-0000-C000-000000000046} Name JiraKey";

async function gfetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await acquireAccessToken();
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: 'outlook.timezone="UTC"',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Graph ${res.status} ${res.statusText} for ${path}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

export type BusyInterval = { startUtc: string; endUtc: string };

export async function listBusyIntervals(
  startIso: string,
  endIso: string,
): Promise<BusyInterval[]> {
  const out: BusyInterval[] = [];
  let url:
    | string
    | undefined = `/me/calendarView?startDateTime=${encodeURIComponent(
    startIso,
  )}&endDateTime=${encodeURIComponent(
    endIso,
  )}&$select=subject,start,end,showAs,isCancelled,type&$top=200`;
  while (url) {
    const page: any = await gfetch(url);
    for (const ev of page.value ?? []) {
      if (ev.isCancelled) continue;
      if (ev.showAs && ev.showAs !== "busy" && ev.showAs !== "tentative" && ev.showAs !== "oof") continue;
      out.push({
        startUtc: ev.start?.dateTime ? `${ev.start.dateTime}Z` : ev.start?.dateTime,
        endUtc: ev.end?.dateTime ? `${ev.end.dateTime}Z` : ev.end?.dateTime,
      });
    }
    const next = page["@odata.nextLink"] as string | undefined;
    url = next ? next.replace(GRAPH, "") : undefined;
  }
  return out;
}

export type CreateEventInput = {
  jiraKey: string;
  subject: string;
  bodyHtml: string;
  startUtcIso: string;
  endUtcIso: string;
  showAs: "free" | "busy";
};

export async function createEvent(input: CreateEventInput): Promise<{ id: string; webLink: string | null }> {
  const body = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.bodyHtml },
    start: { dateTime: input.startUtcIso.replace(/Z$/, ""), timeZone: "UTC" },
    end: { dateTime: input.endUtcIso.replace(/Z$/, ""), timeZone: "UTC" },
    showAs: input.showAs,
    isReminderOn: false,
    categories: ["Jira"],
    singleValueExtendedProperties: [
      { id: JIRA_KEY_PROP_ID, value: input.jiraKey },
    ],
  };
  const created = await gfetch(`/me/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { id: created.id, webLink: created.webLink ?? null };
}

export async function patchEvent(
  eventId: string,
  patch: Partial<{
    startUtcIso: string;
    endUtcIso: string;
    showAs: "free" | "busy";
    bodyHtml: string;
    subject: string;
  }>,
): Promise<void> {
  const body: any = {};
  if (patch.startUtcIso) {
    body.start = { dateTime: patch.startUtcIso.replace(/Z$/, ""), timeZone: "UTC" };
  }
  if (patch.endUtcIso) {
    body.end = { dateTime: patch.endUtcIso.replace(/Z$/, ""), timeZone: "UTC" };
  }
  if (patch.showAs) body.showAs = patch.showAs;
  if (patch.bodyHtml) body.body = { contentType: "HTML", content: patch.bodyHtml };
  if (patch.subject) body.subject = patch.subject;
  await gfetch(`/me/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteEvent(eventId: string): Promise<void> {
  await gfetch(`/me/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}

export async function getMe(): Promise<{ displayName: string; mail: string }> {
  const me = await gfetch(`/me?$select=displayName,mail,userPrincipalName`);
  return { displayName: me.displayName, mail: me.mail || me.userPrincipalName };
}
