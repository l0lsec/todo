import { useEffect, useMemo, useState } from "react";
import type { BusyInterval, ExistingEvent, Settings } from "../types";

export type ManualScheduleSubmit = {
  startUtcIso: string;
  durationMin: number;
  showAs: "free" | "busy";
};

const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function ManualScheduleDialog({
  open,
  ticket,
  durationMin,
  defaultShowAs,
  initialStartUtcIso,
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
  initialStartUtcIso?: string;
  busy: BusyInterval[];
  existing: ExistingEvent[];
  settings?: Settings;
  submitting: boolean;
  onSubmit: (payload: ManualScheduleSubmit) => void;
  onClose: () => void;
}) {
  const tz = settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [viewMonth, setViewMonth] = useState<{ year: number; month: number }>(
    () => currentMonthInTz(tz),
  );
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedSlotMs, setSelectedSlotMs] = useState<number | null>(null);
  const [showAs, setShowAs] = useState<"free" | "busy">(defaultShowAs);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    setShowAs(defaultShowAs);
    setSelectedSlotMs(null);
  }, [open, defaultShowAs, ticket?.key]);

  const lookaheadCapMs = useMemo(() => {
    if (!settings) return Number.POSITIVE_INFINITY;
    return computeLookaheadCapMs(settings, tz, nowMs);
  }, [settings, tz, nowMs]);

  const monthDays = useMemo(
    () => buildMonthGrid(viewMonth.year, viewMonth.month),
    [viewMonth.year, viewMonth.month],
  );

  const slotsByDay = useMemo<Map<string, number[]>>(() => {
    const map = new Map<string, number[]>();
    if (!settings || !ticket) return map;
    for (const cell of monthDays) {
      const slots = computeSlotsForDay({
        year: cell.year,
        month: cell.month,
        day: cell.day,
        settings,
        durationMin,
        busy,
        existing,
        currentTicketKey: ticket.key,
        nowMs,
        lookaheadCapMs,
        tz,
      });
      if (slots.length) {
        map.set(dayKey(cell.year, cell.month, cell.day), slots);
      }
    }
    return map;
  }, [monthDays, settings, ticket?.key, durationMin, busy, existing, nowMs, lookaheadCapMs, tz]);

  useEffect(() => {
    if (!open || !settings || !ticket) return;
    if (initialStartUtcIso) {
      const ms = Date.parse(initialStartUtcIso);
      if (Number.isFinite(ms)) {
        const monthInfo = getMonthInTz(ms, tz);
        const key = getDayKeyInTz(ms, tz);
        const [yy, mm, dd] = key.split("-").map((s) => parseInt(s, 10));
        const slots = computeSlotsForDay({
          year: yy!,
          month: mm!,
          day: dd!,
          settings,
          durationMin,
          busy,
          existing,
          currentTicketKey: ticket.key,
          nowMs,
          lookaheadCapMs,
          tz,
        });
        if (slots.includes(ms)) {
          setViewMonth(monthInfo);
          setSelectedDayKey(key);
          setSelectedSlotMs(ms);
          return;
        }
        if (slots.length > 0) {
          setViewMonth(monthInfo);
          setSelectedDayKey(key);
          setSelectedSlotMs(null);
          return;
        }
      }
    }
    const first = findFirstAvailableDay({
      settings,
      durationMin,
      busy,
      existing,
      currentTicketKey: ticket.key,
      nowMs,
      lookaheadCapMs,
      tz,
    });
    if (first) {
      setViewMonth({ year: first.year, month: first.month });
      setSelectedDayKey(dayKey(first.year, first.month, first.day));
    } else {
      setSelectedDayKey(null);
    }
  }, [open, ticket?.key, settings, durationMin, initialStartUtcIso]);

  const slotsForSelected = selectedDayKey ? slotsByDay.get(selectedDayKey) ?? [] : [];

  const slotTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
      }),
    [tz],
  );

  const selectedDayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [tz],
  );

  const todayKey = useMemo(() => getDayKeyInTz(nowMs, tz), [nowMs, tz]);

  const currentMonth = currentMonthInTz(tz);
  const isAtCurrentMonth =
    viewMonth.year < currentMonth.year ||
    (viewMonth.year === currentMonth.year && viewMonth.month <= currentMonth.month);

  const lastAllowedMonth = useMemo(() => {
    if (!Number.isFinite(lookaheadCapMs)) return null;
    return getMonthInTz(lookaheadCapMs, tz);
  }, [lookaheadCapMs, tz]);
  const isAtLastAllowedMonth =
    !lastAllowedMonth ||
    viewMonth.year > lastAllowedMonth.year ||
    (viewMonth.year === lastAllowedMonth.year && viewMonth.month >= lastAllowedMonth.month);

  if (!open || !ticket) return null;

  const selectedDateLabel = selectedDayKey
    ? selectedDayFmt.format(new Date(parseDayKeyToNoonUtc(selectedDayKey)))
    : null;

  function prevMonth() {
    setViewMonth((m) => addMonths(m, -1));
  }
  function nextMonth() {
    setViewMonth((m) => addMonths(m, 1));
  }
  function goToday() {
    const c = currentMonthInTz(tz);
    setViewMonth(c);
  }

  function submit() {
    if (!selectedSlotMs) return;
    onSubmit({
      startUtcIso: new Date(selectedSlotMs).toISOString(),
      durationMin,
      showAs,
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl border">
        <header className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-slate-700">
            Schedule {ticket.key}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 truncate">{ticket.summary}</p>
        </header>

        <div className="px-4 py-4 space-y-4 text-sm">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Duration</span>
            <span className="font-mono text-slate-700">{durationMin} min</span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={prevMonth}
                disabled={isAtCurrentMonth}
                className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Previous month"
              >
                ‹
              </button>
              <div className="text-sm font-medium text-slate-700">
                {MONTH_NAMES[viewMonth.month - 1]} {viewMonth.year}
              </div>
              <button
                type="button"
                onClick={nextMonth}
                disabled={isAtLastAllowedMonth}
                className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wide text-slate-400 mb-1">
              {WEEKDAY_HEADERS.map((d, i) => (
                <div key={i} className="text-center py-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {monthDays.map((cell) => {
                const key = dayKey(cell.year, cell.month, cell.day);
                const hasSlots = slotsByDay.has(key);
                const isSelected = key === selectedDayKey;
                const isToday = key === todayKey;
                const isOtherMonth = !cell.inMonth;
                const disabled = !hasSlots;
                return (
                  <button
                    key={key + (isOtherMonth ? "o" : "")}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setSelectedDayKey(key);
                      setSelectedSlotMs(null);
                    }}
                    className={[
                      "h-9 rounded text-sm flex items-center justify-center",
                      isSelected
                        ? "bg-sky-600 text-white font-semibold"
                        : disabled
                          ? isOtherMonth
                            ? "text-slate-300"
                            : "text-slate-300"
                          : isOtherMonth
                            ? "text-slate-400 hover:bg-slate-100"
                            : "text-slate-700 hover:bg-slate-100",
                      !isSelected && isToday && hasSlots ? "ring-1 ring-sky-400" : "",
                    ].join(" ")}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={goToday}
                className="text-sky-700 hover:underline"
              >
                Today
              </button>
              <span className="text-slate-400">{tz}</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-600">
                {selectedDateLabel ?? "Available times"}
              </span>
              {selectedDayKey && (
                <span className="text-xs text-slate-400">
                  {slotsForSelected.length} slot
                  {slotsForSelected.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {!selectedDayKey ? (
              <div className="text-xs text-slate-500 px-2 py-6 text-center border border-dashed rounded">
                No available days in the lookahead window. Try increasing the
                lookahead in Settings.
              </div>
            ) : slotsForSelected.length === 0 ? (
              <div className="text-xs text-slate-500 px-2 py-6 text-center border border-dashed rounded">
                No available times on this day.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto pr-1">
                <div className="grid grid-cols-3 gap-1.5">
                  {slotsForSelected.map((ms) => {
                    const isSelected = selectedSlotMs === ms;
                    return (
                      <button
                        key={ms}
                        type="button"
                        onClick={() => setSelectedSlotMs(ms)}
                        className={[
                          "px-2 py-1.5 rounded text-xs border",
                          isSelected
                            ? "bg-sky-600 text-white border-sky-600"
                            : "border-slate-300 text-slate-700 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        {slotTimeFmt.format(new Date(ms))}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Show as</span>
            <FreeBusyToggle value={showAs} onChange={setShowAs} />
          </div>
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
            disabled={submitting || selectedSlotMs == null}
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

function dayKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseHHMM(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return { h: h ?? 9, m: m ?? 0 };
}

function addMonths(
  m: { year: number; month: number },
  delta: number,
): { year: number; month: number } {
  const total = m.year * 12 + (m.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function buildMonthGrid(
  year: number,
  month: number,
): { year: number; month: number; day: number; inMonth: boolean }[] {
  // Sunday-first 6-week grid covering the given month plus surrounding padding.
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const startMs = Date.UTC(year, month - 1, 1 - firstWeekday);
  const cells: { year: number; month: number; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(startMs + i * 24 * 60 * 60 * 1000);
    cells.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() + 1 === month,
    });
  }
  return cells;
}

function currentMonthInTz(tz: string): { year: number; month: number } {
  return getMonthInTz(Date.now(), tz);
}

function getMonthInTz(ms: number, tz: string): { year: number; month: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const num = (t: string) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return { year: num("year"), month: num("month") };
}

function getDayKeyInTz(ms: number, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseDayKeyToNoonUtc(key: string): number {
  const [y, m, d] = key.split("-").map((s) => parseInt(s, 10));
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12, 0);
}

function zonedToUtcMs(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): number {
  const utcGuess = Date.UTC(y, m - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(utcGuess));
  const num = (t: string) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  let hh = num("hour");
  if (hh === 24) hh = 0;
  const asUtc = Date.UTC(num("year"), num("month") - 1, num("day"), hh, num("minute"), num("second"));
  const offset = asUtc - utcGuess;
  return utcGuess - offset;
}

function getWeekdayInTz(y: number, m: number, d: number, tz: string): number {
  const ms = zonedToUtcMs(y, m, d, 12, 0, tz);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  });
  const w = fmt.format(new Date(ms));
  return (
    ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[
      w
    ] ?? 0
  );
}

function computeLookaheadCapMs(settings: Settings, tz: string, nowMs: number): number {
  const startKey = getDayKeyInTz(nowMs, tz);
  const [yy, mm, dd] = startKey.split("-").map((s) => parseInt(s, 10));
  const we = parseHHMM(settings.workdayEnd);
  let cur = new Date(Date.UTC(yy!, (mm ?? 1) - 1, dd ?? 1));
  let counted = 0;
  let lastEndMs: number | null = null;
  for (let i = 0; i < 90 && counted < settings.lookaheadBusinessDays; i++) {
    const cy = cur.getUTCFullYear();
    const cm = cur.getUTCMonth() + 1;
    const cd = cur.getUTCDate();
    const wd = getWeekdayInTz(cy, cm, cd, tz);
    if (wd >= 1 && wd <= 5) {
      counted++;
      lastEndMs = zonedToUtcMs(cy, cm, cd, we.h, we.m, tz);
    }
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return lastEndMs ?? Number.POSITIVE_INFINITY;
}

function computeSlotsForDay(opts: {
  year: number;
  month: number;
  day: number;
  settings: Settings;
  durationMin: number;
  busy: BusyInterval[];
  existing: ExistingEvent[];
  currentTicketKey: string;
  nowMs: number;
  lookaheadCapMs: number;
  tz: string;
}): number[] {
  const {
    year,
    month,
    day,
    settings,
    durationMin,
    busy,
    existing,
    currentTicketKey,
    nowMs,
    lookaheadCapMs,
    tz,
  } = opts;
  const wd = getWeekdayInTz(year, month, day, tz);
  if (wd === 0 || wd === 6) return [];

  const ws = parseHHMM(settings.workdayStart);
  const we = parseHHMM(settings.workdayEnd);
  const dayStartMs = zonedToUtcMs(year, month, day, ws.h, ws.m, tz);
  const dayEndMs = zonedToUtcMs(year, month, day, we.h, we.m, tz);
  if (dayEndMs <= dayStartMs) return [];
  if (dayEndMs <= nowMs) return [];
  if (dayStartMs >= lookaheadCapMs) return [];

  const stepMs = Math.max(1, settings.minSlotMinutes) * 60_000;
  const durMs = durationMin * 60_000;
  const effEnd = Math.min(dayEndMs, lookaheadCapMs);

  let effStart = Math.max(dayStartMs, nowMs);
  if (effStart > dayStartMs) {
    const offset = effStart - dayStartMs;
    effStart = dayStartMs + Math.ceil(offset / stepMs) * stepMs;
  }
  if (effStart + durMs > effEnd) return [];

  const blocked: [number, number][] = [];
  const bufferMs = settings.bufferMinutes * 60_000;
  for (const b of busy) {
    const s = Date.parse(b.startUtcIso) - bufferMs;
    const e = Date.parse(b.endUtcIso) + bufferMs;
    if (Number.isFinite(s) && Number.isFinite(e) && e > effStart && s < effEnd) {
      blocked.push([Math.max(s, effStart), Math.min(e, effEnd)]);
    }
  }
  for (const ev of existing) {
    if (ev.jiraKey === currentTicketKey) continue;
    const s = Date.parse(ev.startUtcIso);
    const e = Date.parse(ev.endUtcIso);
    if (Number.isFinite(s) && Number.isFinite(e) && e > effStart && s < effEnd) {
      blocked.push([Math.max(s, effStart), Math.min(e, effEnd)]);
    }
  }
  blocked.sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const iv of blocked) {
    const last = merged[merged.length - 1];
    if (!last || iv[0] > last[1]) {
      merged.push([iv[0], iv[1]]);
    } else {
      last[1] = Math.max(last[1], iv[1]);
    }
  }

  const free: [number, number][] = [];
  let cursor = effStart;
  for (const [s, e] of merged) {
    if (s > cursor) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < effEnd) free.push([cursor, effEnd]);

  const slots: number[] = [];
  for (const [s, e] of free) {
    const offset = s - dayStartMs;
    const snapped = dayStartMs + Math.ceil(offset / stepMs) * stepMs;
    for (let t = snapped; t + durMs <= e; t += stepMs) {
      if (t >= nowMs) slots.push(t);
    }
  }
  return slots;
}

function findFirstAvailableDay(opts: {
  settings: Settings;
  durationMin: number;
  busy: BusyInterval[];
  existing: ExistingEvent[];
  currentTicketKey: string;
  nowMs: number;
  lookaheadCapMs: number;
  tz: string;
}): { year: number; month: number; day: number } | null {
  const startKey = getDayKeyInTz(opts.nowMs, opts.tz);
  const [yy, mm, dd] = startKey.split("-").map((s) => parseInt(s, 10));
  let cur = new Date(Date.UTC(yy!, (mm ?? 1) - 1, dd ?? 1));
  for (let i = 0; i < 90; i++) {
    const cy = cur.getUTCFullYear();
    const cm = cur.getUTCMonth() + 1;
    const cd = cur.getUTCDate();
    const slots = computeSlotsForDay({
      year: cy,
      month: cm,
      day: cd,
      settings: opts.settings,
      durationMin: opts.durationMin,
      busy: opts.busy,
      existing: opts.existing,
      currentTicketKey: opts.currentTicketKey,
      nowMs: opts.nowMs,
      lookaheadCapMs: opts.lookaheadCapMs,
      tz: opts.tz,
    });
    if (slots.length) return { year: cy, month: cm, day: cd };
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return null;
}
