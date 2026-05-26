import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const CONFIG_DIR = path.resolve(process.cwd(), "config");
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");
const DEFAULTS_PATH = path.join(CONFIG_DIR, "settings.default.json");

export const DEFAULT_PRIORITY_RANK: Record<string, number> = {
  highest: 1,
  critical: 1,
  blocker: 1,
  high: 2,
  major: 2,
  medium: 3,
  normal: 3,
  low: 4,
  minor: 4,
  lowest: 5,
  trivial: 5,
};

export const UNRANKED_PRIORITY_VALUE = 6;

const HHMM = z.string().regex(/^\d{2}:\d{2}$/);

export const DayHoursSchema = z.object({
  enabled: z.boolean(),
  start: HHMM,
  end: HHMM,
});

export type DayHours = z.infer<typeof DayHoursSchema>;

export const WorkingHoursSchema = z.object({
  "0": DayHoursSchema,
  "1": DayHoursSchema,
  "2": DayHoursSchema,
  "3": DayHoursSchema,
  "4": DayHoursSchema,
  "5": DayHoursSchema,
  "6": DayHoursSchema,
});

export type WorkingHours = z.infer<typeof WorkingHoursSchema>;

const DEFAULT_WORKING_HOURS: WorkingHours = {
  "0": { enabled: false, start: "09:00", end: "18:00" },
  "1": { enabled: true, start: "09:00", end: "18:00" },
  "2": { enabled: true, start: "09:00", end: "18:00" },
  "3": { enabled: true, start: "09:00", end: "18:00" },
  "4": { enabled: true, start: "09:00", end: "18:00" },
  "5": { enabled: true, start: "09:00", end: "18:00" },
  "6": { enabled: false, start: "09:00", end: "18:00" },
};

export const SettingsSchema = z.object({
  timezone: z.string().default("America/New_York"),
  workdayStart: HHMM.default("09:00"),
  workdayEnd: HHMM.default("18:00"),
  workingHours: WorkingHoursSchema.default({ ...DEFAULT_WORKING_HOURS }),
  bufferMinutes: z.number().int().min(0).default(15),
  minSlotMinutes: z.number().int().min(15).default(30),
  lookaheadBusinessDays: z.number().int().min(1).max(20).default(5),
  defaultEstimateMinutes: z.number().int().min(15).default(60),
  defaultShowAs: z.enum(["free", "busy"]).default("free"),
  selectedProjectKeys: z.array(z.string()).default([]),
  ticketStatuses: z
    .array(z.string())
    .default(["Selected for Development", "In Progress"]),
  completedStatuses: z
    .array(z.string())
    .default(["Done", "In Review", "Closed", "Resolved"]),
  cronSchedule: z.string().default("0 7 * * 1-5"),
  priorityRanks: z
    .record(z.string(), z.number().int().min(1).max(99))
    .default({ ...DEFAULT_PRIORITY_RANK }),
});

function migrateLegacyKeys(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  let out: Record<string, unknown> = obj;
  if (!("ticketStatuses" in out) && typeof out.ticketStatus === "string") {
    const { ticketStatus, ...rest } = out;
    out = { ...rest, ticketStatuses: [ticketStatus] };
  }
  if (!("workingHours" in out)) {
    const start =
      typeof out.workdayStart === "string" && /^\d{2}:\d{2}$/.test(out.workdayStart)
        ? (out.workdayStart as string)
        : "09:00";
    const end =
      typeof out.workdayEnd === "string" && /^\d{2}:\d{2}$/.test(out.workdayEnd)
        ? (out.workdayEnd as string)
        : "18:00";
    const wh: WorkingHours = {
      "0": { enabled: false, start, end },
      "1": { enabled: true, start, end },
      "2": { enabled: true, start, end },
      "3": { enabled: true, start, end },
      "4": { enabled: true, start, end },
      "5": { enabled: true, start, end },
      "6": { enabled: false, start, end },
    };
    out = { ...out, workingHours: wh };
  }
  return out;
}

export type Settings = z.infer<typeof SettingsSchema>;

export function priorityRank(name: string | null, ranks: Record<string, number>): number {
  if (!name) return UNRANKED_PRIORITY_VALUE;
  const key = name.trim().toLowerCase();
  if (key in ranks) return ranks[key]!;
  if (key in DEFAULT_PRIORITY_RANK) return DEFAULT_PRIORITY_RANK[key]!;
  return UNRANKED_PRIORITY_VALUE;
}

function ensureFile(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(SETTINGS_PATH)) {
    const defaults = existsSync(DEFAULTS_PATH)
      ? readFileSync(DEFAULTS_PATH, "utf8")
      : JSON.stringify(SettingsSchema.parse({}), null, 2);
    writeFileSync(SETTINGS_PATH, defaults, "utf8");
  }
}

export function readSettings(): Settings {
  ensureFile();
  const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  return SettingsSchema.parse(migrateLegacyKeys(raw));
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const current = readSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}
