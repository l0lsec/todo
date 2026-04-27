import { z } from "zod";

const baseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");
const email = process.env.JIRA_EMAIL || "";
const token = process.env.JIRA_TOKEN || "";

function authHeader(): string {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function jiraFetch(pathname: string, init: RequestInit = {}): Promise<any> {
  if (!baseUrl) throw new Error("JIRA_BASE_URL not configured in .env");
  if (!email || !token) throw new Error("JIRA_EMAIL or JIRA_TOKEN not configured in .env");
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader(),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jira ${res.status} ${res.statusText} for ${pathname}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

export type JiraProject = {
  key: string;
  name: string;
  avatarUrl: string | null;
};

export async function listProjects(): Promise<JiraProject[]> {
  const out: JiraProject[] = [];
  let startAt = 0;
  const maxResults = 50;
  for (;;) {
    const data = await jiraFetch(
      `/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}&orderBy=name`,
    );
    for (const p of data.values ?? []) {
      out.push({
        key: p.key,
        name: p.name,
        avatarUrl: p.avatarUrls?.["32x32"] ?? null,
      });
    }
    if (data.isLast || (data.values?.length ?? 0) < maxResults) break;
    startAt += maxResults;
    if (startAt > 1000) break;
  }
  return out;
}

export type JiraTicket = {
  key: string;
  projectKey: string;
  summary: string;
  status: string;
  priority: string | null;
  estimateSeconds: number | null;
  created: string;
  url: string;
};

const TicketsResponse = z.object({
  issues: z.array(
    z.object({
      key: z.string(),
      fields: z.object({
        summary: z.string(),
        status: z.object({ name: z.string() }),
        priority: z.object({ name: z.string() }).nullable().optional(),
        project: z.object({ key: z.string() }),
        created: z.string().optional(),
        timetracking: z
          .object({
            originalEstimateSeconds: z.number().optional(),
          })
          .optional(),
      }),
    }),
  ),
});

export async function searchTickets(jql: string): Promise<JiraTicket[]> {
  const fields = ["summary", "status", "priority", "timetracking", "project", "created"];
  const out: JiraTicket[] = [];
  let nextPageToken: string | undefined = undefined;
  const HARD_CAP = 500;

  do {
    const body: Record<string, unknown> = {
      jql,
      fields,
      maxResults: 100,
      fieldsByKeys: false,
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const data = await jiraFetch(`/rest/api/3/search/jql`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const parsed = TicketsResponse.parse(data);
    for (const i of parsed.issues) {
      out.push({
        key: i.key,
        projectKey: i.fields.project.key,
        summary: i.fields.summary,
        status: i.fields.status.name,
        priority: i.fields.priority?.name ?? null,
        estimateSeconds: i.fields.timetracking?.originalEstimateSeconds ?? null,
        created: i.fields.created ?? new Date(0).toISOString(),
        url: `${baseUrl}/browse/${i.key}`,
      });
    }
    nextPageToken = data.isLast ? undefined : (data.nextPageToken as string | undefined);
    if (out.length >= HARD_CAP) break;
  } while (nextPageToken);

  return out;
}

export async function getTicket(key: string): Promise<JiraTicket | null> {
  try {
    const data = await jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,priority,timetracking,project,created`,
    );
    return {
      key: data.key,
      projectKey: data.fields.project.key,
      summary: data.fields.summary,
      status: data.fields.status.name,
      priority: data.fields.priority?.name ?? null,
      estimateSeconds: data.fields.timetracking?.originalEstimateSeconds ?? null,
      created: data.fields.created ?? new Date(0).toISOString(),
      url: `${baseUrl}/browse/${data.key}`,
    };
  } catch {
    return null;
  }
}

export type JiraTransition = {
  id: string;
  name: string;
  toStatus: string;
};

export async function getTransitions(key: string): Promise<JiraTransition[]> {
  const data = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
  return (data.transitions ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    toStatus: t.to?.name ?? "",
  }));
}

export async function transitionTicket(key: string, transitionId: string): Promise<void> {
  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
}

export function buildJql(opts: {
  status: string;
  projectKeys: string[];
}): string {
  const escaped = opts.status.replace(/"/g, '\\"');
  const parts = [
    "assignee = currentUser()",
    `status = "${escaped}"`,
  ];
  if (opts.projectKeys.length > 0) {
    parts.push(`project in (${opts.projectKeys.join(",")})`);
  }
  return parts.join(" AND ");
}
