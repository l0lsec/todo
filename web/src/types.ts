export type Health = {
  ok: boolean;
  signedIn: boolean;
  settingsConfigured: boolean;
  jiraConfigured: boolean;
  msConfigured: boolean;
};

export type Settings = {
  timezone: string;
  workdayStart: string;
  workdayEnd: string;
  bufferMinutes: number;
  minSlotMinutes: number;
  lookaheadBusinessDays: number;
  defaultEstimateMinutes: number;
  defaultShowAs: "free" | "busy";
  selectedProjectKeys: string[];
  ticketStatus: string;
  completedStatuses: string[];
  cronSchedule: string;
  priorityRanks: Record<string, number>;
};

export type Project = {
  key: string;
  name: string;
  avatarUrl: string | null;
  refreshedAt?: string;
};

export type Ticket = {
  key: string;
  projectKey: string;
  summary: string;
  status: string;
  priority: string | null;
  priorityRank?: number;
  estimateSeconds: number | null;
  created?: string;
  url: string;
  alreadyScheduled?: boolean;
};

export type ProposedBlock = {
  jiraKey: string;
  projectKey: string;
  summary: string;
  startUtcIso: string;
  endUtcIso: string;
  durationMin: number;
  showAs: "free" | "busy";
  priorityRank?: number;
  existingGraphEventId?: string | null;
  existingShowAs?: "free" | "busy" | null;
};

export type ExistingEvent = {
  jiraKey: string;
  projectKey: string | null;
  summary: string | null;
  startUtcIso: string;
  endUtcIso: string;
  showAs: "free" | "busy";
  status: "scheduled" | "completed" | "stale";
  graphEventId: string;
};

export type Move = {
  jiraKey: string;
  fromIso: string;
  toIso: string;
};

export type Preview = {
  reason: null | "no_projects_selected";
  message?: string;
  tickets: Ticket[];
  blocks: ProposedBlock[];
  unscheduled: { jiraKey: string; reason: string }[];
  existing: ExistingEvent[];
  moves?: Move[];
  windowStartIso?: string;
  windowEndIso?: string;
  settings?: Settings;
};

export type Transition = {
  id: string;
  name: string;
  toStatus: string;
};
