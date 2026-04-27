import { useEffect, useMemo, useState } from "react";
import type { BusyInterval, ExistingEvent, Settings } from "../types";

const dayTimeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

type ConflictItem = {
  startUtcIso: string;
  endUtcIso: string;
  label: string;
};

export type ManualScheduleSubmit = {
  startUtcIso: string;
  durationMin: number;
  showAs: "free" | "busy";
};

export function ManualScheduleDialog({
  open,
  ticket,
  durationMin,
  defaultShowAs,
  busy,
  existing,
  settings,
  submitting,
  onSubmit,
  onClose,
}: {
  open: boolean;
  ticket: { key: string; summary: string } | null;
  durationMin: number;
  defaultShowAs: "free" | "busy";
  busy: BusyInterval[];
  existing: ExistingEvent[];
  settings?: Settings;
  submitting: boolean;
  onSubmit: (payload: ManualScheduleSubmit) => void;
  onClose: () => void;
}) {
  const [localStart, setLocalStart] = useState<string>("");
  const [showAs, setShowAs] = useState<"free" | "busy">(defaultShowAs);

  useEffect(() => {
    if (!open) return;
    setLocalStart(defaultLocalDateTime());
    setShowAs(defaultShowAs);
  }, [open, defaultShowAs, ticket?.key]);

  const startDate = useMemo(() => parseLocalDateTime(localStart), [localStart]);
  const endDate = useMemo(
    () => (startDate ? new Date(startDate.getTime() + durationMin * 60_000) : null),
    [startDate, durationMin],
  );

  const isPast = !!startDate && startDate.getTime() < Date.now();
  const isInvalid = !startDate;

  const conflicts = useMemo<ConflictItem[]>(() => {
    if (!startDate || !endDate || !ticket) return [];
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    const items: ConflictItem[] = [];
    for (const e of existing) {
      if (e.jiraKey === ticket.key) continue;
      const s = Date.parse(e.startUtcIso);
      const en = Date.parse(e.endUtcIso);
      if (Number.isFinite(s) && Number.isFinite(en) && startMs < en && endMs > s) {
        items.push({
          startUtcIso: e.startUtcIso,
          endUtcIso: e.endUtcIso,
          label: `${e.jiraKey}${e.summary ? ` · ${e.summary}` : ""}`,
        });
      }
    }
    for (const b of busy) {
      const s = Date.parse(b.startUtcIso);
      const en = Date.parse(b.endUtcIso);
      if (Number.isFinite(s) && Number.isFinite(en) && startMs < en && endMs > s) {
        items.push({
          startUtcIso: b.startUtcIso,
          endUtcIso: b.endUtcIso,
          label: "Busy on calendar",
        });
      }
    }
    return items;
  }, [startDate, endDate, busy, existing, ticket?.key]);

  const outsideHours = useMemo(() => {
    if (!startDate || !endDate || !settings) return false;
    return !withinWorkingHours(startDate, endDate, settings);
  }, [startDate, endDate, settings]);

  if (!open || !ticket) return null;

  function submit() {
    if (!startDate || isPast) return;
    onSubmit({
      startUtcIso: new Date(startDate).toISOString(),
      durationMin,
      showAs,
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl border">
        <header className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-slate-700">
            Schedule {ticket.key} at a specific time
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 truncate">{ticket.summary}</p>
        </header>

        <div className="px-4 py-4 space-y-4 text-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Duration</span>
            <span className="font-mono text-slate-700">{durationMin} min</span>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">
              Start time
            </span>
            <input
              type="datetime-local"
              value={localStart}
              onChange={(e) => setLocalStart(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          </label>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Ends at</span>
            <span className="font-mono text-slate-700">
              {endDate ? dayTimeFmt.format(endDate) : "—"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Show as</span>
            <FreeBusyToggle value={showAs} onChange={setShowAs} />
          </div>

          {isInvalid && (
            <p className="text-xs text-rose-600">Pick a valid date and time.</p>
          )}
          {!isInvalid && isPast && (
            <p className="text-xs text-rose-600">Pick a time in the future.</p>
          )}
          {!isInvalid && !isPast && outsideHours && (
            <p className="text-xs text-slate-500">
              Note: this is outside your working hours
              {settings ? ` (${settings.workdayStart}–${settings.workdayEnd} ${settings.timezone})` : ""}.
            </p>
          )}
          {!isInvalid && conflicts.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="font-semibold mb-1">
                Overlaps {conflicts.length} event{conflicts.length === 1 ? "" : "s"} on
                your calendar — you can still schedule.
              </div>
              <ul className="space-y-0.5">
                {conflicts.slice(0, 2).map((c, i) => (
                  <li key={i} className="truncate">
                    {timeFmt.format(new Date(c.startUtcIso))}–
                    {timeFmt.format(new Date(c.endUtcIso))} · {c.label}
                  </li>
                ))}
                {conflicts.length > 2 && (
                  <li className="text-amber-700">
                    + {conflicts.length - 2} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <footer className="px-4 py-3 border-t flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || isInvalid || isPast}
            className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? "Scheduling…" : "Schedule at this time"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function FreeBusyToggle({
  value,
  onChange,
}: {
  value: "free" | "busy";
  onChange: (v: "free" | "busy") => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-300 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => onChange("free")}
        className={`px-2 py-0.5 ${value === "free" ? "bg-emerald-100 text-emerald-900" : "bg-white text-slate-600 hover:bg-slate-50"}`}
      >
        Free
      </button>
      <button
        type="button"
        onClick={() => onChange("busy")}
        className={`px-2 py-0.5 border-l border-slate-300 ${value === "busy" ? "bg-amber-100 text-amber-900" : "bg-white text-slate-600 hover:bg-slate-50"}`}
      >
        Busy
      </button>
    </div>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function defaultLocalDateTime(): string {
  const ms = 30 * 60 * 1000;
  const next = new Date(Math.ceil((Date.now() + 60_000) / ms) * ms);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
}

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function withinWorkingHours(start: Date, end: Date, settings: Settings): boolean {
  const tz = settings.timezone;
  const startMin = minutesOfDayInTz(start, tz);
  const endMin = minutesOfDayInTz(end, tz);
  const startBound = parseHHMM(settings.workdayStart);
  const endBound = parseHHMM(settings.workdayEnd);
  if (!startMin || !endMin) return true;
  const sameDay = startMin.dateKey === endMin.dateKey;
  if (!sameDay) return false;
  const dow = startMin.weekday;
  if (dow === 0 || dow === 6) return false;
  return startMin.minutes >= startBound && endMin.minutes <= endBound;
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesOfDayInTz(
  date: Date,
  tz: string,
): { minutes: number; dateKey: string; weekday: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = parseInt(get("hour"), 10);
    const minute = parseInt(get("minute"), 10);
    const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
    const wdMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekday = wdMap[get("weekday")] ?? 0;
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return { minutes: hour * 60 + minute, dateKey, weekday };
  } catch {
    return null;
  }
}
