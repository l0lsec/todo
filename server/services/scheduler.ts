import { DateTime, Interval } from "luxon";
import type { Settings } from "../settings.js";
import type { BusyInterval } from "./graph.js";

export type TicketForScheduling = {
  key: string;
  projectKey: string;
  summary: string;
  estimateSeconds: number | null;
};

export type ProposedBlock = {
  jiraKey: string;
  projectKey: string;
  summary: string;
  startUtcIso: string;
  endUtcIso: string;
  durationMin: number;
  showAs: "free" | "busy";
};

export type ScheduleResult = {
  blocks: ProposedBlock[];
  unscheduled: { jiraKey: string; reason: string }[];
  windowStartIso: string;
  windowEndIso: string;
};

function parseHHMM(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return { h: h ?? 9, m: m ?? 0 };
}

function ceilTo(dt: DateTime, minutes: number): DateTime {
  const total = dt.hour * 60 + dt.minute;
  const rem = total % minutes;
  if (rem === 0 && dt.second === 0 && dt.millisecond === 0) return dt;
  return dt.plus({ minutes: minutes - rem }).set({ second: 0, millisecond: 0 });
}

function durationFor(t: TicketForScheduling, settings: Settings): number {
  const baseSec = t.estimateSeconds && t.estimateSeconds > 0
    ? t.estimateSeconds
    : settings.defaultEstimateMinutes * 60;
  const min = Math.ceil(baseSec / 60);
  return Math.max(settings.minSlotMinutes, Math.ceil(min / 30) * 30);
}

export function buildWorkingWindows(settings: Settings, fromUtc: DateTime): Interval[] {
  const tz = settings.timezone;
  const start = parseHHMM(settings.workdayStart);
  const end = parseHHMM(settings.workdayEnd);
  const windows: Interval[] = [];
  let day = fromUtc.setZone(tz).startOf("day");
  let added = 0;
  for (let i = 0; i < 30 && added < settings.lookaheadBusinessDays; i++) {
    const dow = day.weekday;
    if (dow >= 1 && dow <= 5) {
      const ws = day.set({ hour: start.h, minute: start.m, second: 0, millisecond: 0 });
      const we = day.set({ hour: end.h, minute: end.m, second: 0, millisecond: 0 });
      let effectiveStart = ws;
      const nowInTz = fromUtc.setZone(tz);
      if (nowInTz > ws && nowInTz < we && day.hasSame(nowInTz, "day")) {
        effectiveStart = ceilTo(nowInTz, settings.minSlotMinutes);
      } else if (day < nowInTz.startOf("day")) {
        day = day.plus({ days: 1 });
        continue;
      }
      if (effectiveStart < we) {
        windows.push(Interval.fromDateTimes(effectiveStart.toUTC(), we.toUTC()));
      }
      added++;
    }
    day = day.plus({ days: 1 });
  }
  return windows;
}

function busyToIntervals(busy: BusyInterval[], settings: Settings): Interval[] {
  const out: Interval[] = [];
  for (const b of busy) {
    const s = DateTime.fromISO(b.startUtc, { zone: "utc" }).minus({
      minutes: settings.bufferMinutes,
    });
    const e = DateTime.fromISO(b.endUtc, { zone: "utc" }).plus({
      minutes: settings.bufferMinutes,
    });
    if (s.isValid && e.isValid && s < e) out.push(Interval.fromDateTimes(s, e));
  }
  return mergeIntervals(out);
}

function mergeIntervals(arr: Interval[]): Interval[] {
  if (!arr.length) return [];
  const sorted = [...arr].sort((a, b) => a.start!.toMillis() - b.start!.toMillis());
  const merged: Interval[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]!;
    const cur = sorted[i]!;
    if (cur.start! <= last.end!) {
      merged[merged.length - 1] = Interval.fromDateTimes(
        last.start!,
        cur.end! > last.end! ? cur.end! : last.end!,
      );
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

function subtractIntervals(base: Interval[], subs: Interval[]): Interval[] {
  let out: Interval[] = [...base];
  for (const sub of subs) {
    const next: Interval[] = [];
    for (const b of out) {
      if (!b.overlaps(sub)) {
        next.push(b);
        continue;
      }
      if (sub.start! <= b.start! && sub.end! >= b.end!) continue;
      if (sub.start! > b.start!) {
        next.push(Interval.fromDateTimes(b.start!, sub.start!));
      }
      if (sub.end! < b.end!) {
        next.push(Interval.fromDateTimes(sub.end!, b.end!));
      }
    }
    out = next;
  }
  return out.filter((i) => i.length("minutes") > 0);
}

export function planSchedule(opts: {
  tickets: TicketForScheduling[];
  busy: BusyInterval[];
  settings: Settings;
  now?: DateTime;
  reservedKeys?: Set<string>;
}): ScheduleResult {
  const { tickets, busy, settings } = opts;
  const now = (opts.now ?? DateTime.utc()).toUTC();
  const reservedKeys = opts.reservedKeys ?? new Set<string>();

  const windows = buildWorkingWindows(settings, now);
  const busyIntervals = busyToIntervals(busy, settings);
  let free = subtractIntervals(windows, busyIntervals).filter(
    (i) => i.length("minutes") >= settings.minSlotMinutes,
  );

  const blocks: ProposedBlock[] = [];
  const unscheduled: { jiraKey: string; reason: string }[] = [];

  for (const t of tickets) {
    if (reservedKeys.has(t.key)) continue;
    const durMin = durationFor(t, settings);
    let placed = false;
    for (let idx = 0; idx < free.length; idx++) {
      const slot = free[idx]!;
      if (slot.length("minutes") < durMin) continue;
      const start = slot.start!;
      const end = start.plus({ minutes: durMin });
      blocks.push({
        jiraKey: t.key,
        projectKey: t.projectKey,
        summary: t.summary,
        startUtcIso: start.toUTC().toISO()!,
        endUtcIso: end.toUTC().toISO()!,
        durationMin: durMin,
        showAs: settings.defaultShowAs,
      });
      const remaining: Interval[] = [];
      if (end < slot.end!) {
        remaining.push(Interval.fromDateTimes(end, slot.end!));
      }
      free = [
        ...free.slice(0, idx),
        ...remaining,
        ...free.slice(idx + 1),
      ].filter((i) => i.length("minutes") >= settings.minSlotMinutes);
      placed = true;
      break;
    }
    if (!placed) {
      unscheduled.push({
        jiraKey: t.key,
        reason: `No free ${durMin}-min slot in next ${settings.lookaheadBusinessDays} business days`,
      });
    }
  }

  const windowStart = windows.length ? windows[0]!.start! : now;
  const windowEnd = windows.length ? windows[windows.length - 1]!.end! : now;

  return {
    blocks,
    unscheduled,
    windowStartIso: windowStart.toUTC().toISO()!,
    windowEndIso: windowEnd.toUTC().toISO()!,
  };
}
