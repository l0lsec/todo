import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const CONFIG_DIR = path.resolve(process.cwd(), "config");
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");
const DEFAULTS_PATH = path.join(CONFIG_DIR, "settings.default.json");

export const SettingsSchema = z.object({
  timezone: z.string().default("America/New_York"),
  workdayStart: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  workdayEnd: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  bufferMinutes: z.number().int().min(0).default(15),
  minSlotMinutes: z.number().int().min(15).default(30),
  lookaheadBusinessDays: z.number().int().min(1).max(20).default(5),
  defaultEstimateMinutes: z.number().int().min(15).default(60),
  defaultShowAs: z.enum(["free", "busy"]).default("free"),
  selectedProjectKeys: z.array(z.string()).default([]),
  ticketStatus: z.string().default("Selected for Development"),
  completedStatuses: z
    .array(z.string())
    .default(["Done", "In Review", "Closed", "Resolved"]),
  cronSchedule: z.string().default("0 7 * * 1-5"),
});

export type Settings = z.infer<typeof SettingsSchema>;

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
  return SettingsSchema.parse(raw);
}

export function writeSettings(patch: Partial<Settings>): Settings {
  const current = readSettings();
  const next = SettingsSchema.parse({ ...current, ...patch });
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}
