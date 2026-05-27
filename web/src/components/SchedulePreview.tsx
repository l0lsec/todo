import { useEffect, useMemo, useRef, useState } from "react";
import type { ExistingEvent, ProposedBlock, Ticket } from "../types";
import { StatusPill } from "./StatusPill";

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

type Row =
  | {
      kind: "proposed";
      block: ProposedBlock;
      ticket: Ticket | undefined;
      previousStartIso?: string;
    }
  | {
      kind: "existing";
      event: ExistingEvent;
      ticket: Ticket | undefined;
    };

export function SchedulePreview({
  blocks,
  existing,
  tickets,
  onChangeShowAs,
  onSetAllShowAs,
  onChangeStatus,
  onChangeDuration,
  onError,
  onDeleteExisting,
  onConfirmBlock,
  onPickTime,
  confirmingKeys,
  savingDurationKeys,
  selectedKeys,
  onToggleKey,
  onToggleKeys,
}: {
  blocks: ProposedBlock[];
  existing: ExistingEvent[];
  tickets: Ticket[];
  onChangeShowAs: (jiraKey: string, showAs: "free" | "busy") => void;
  onSetAllShowAs: (showAs: "free" | "busy") => void;
  onChangeStatus: (jiraKey: string, status: string) => void;
  onChangeDuration: (jiraKey: string, minutes: number) => void;
  onError: (msg: string) => void;
  onDeleteExisting: (jiraKey: string) => void;
  onConfirmBlock: (block: ProposedBlock) => void;
  onPickTime: (jiraKey: string) => void;
  confirmingKeys: Set<string>;
  savingDurationKeys: Set<string>;
  selectedKeys: Set<string>;
  onToggleKey: (jiraKey: string, selected: boolean) => void;
  onToggleKeys: (jiraKeys: string[], selected: boolean) => void;
}) {
  const ticketByKey = useMemo(() => {
    const m = new Map<string, Ticket>();
    for (const t of tickets) m.set(t.key, t);
    return m;
  }, [tickets]);

  const existingByKey = useMemo(() => {
    const m = new Map<string, ExistingEvent>();
    for (const e of existing) m.set(e.jiraKey, e);
    return m;
  }, [existing]);

  const proposedKeys = useMemo(() => new Set(blocks.map((b) => b.jiraKey)), [blocks]);

  const grouped = useMemo(() => {
    const rows: Row[] = [
      ...blocks.map<Row>((b) => ({
        kind: "proposed",
        block: b,
        ticket: ticketByKey.get(b.jiraKey),
        previousStartIso: existingByKey.get(b.jiraKey)?.startUtcIso,
      })),
      ...existing
        .filter((e) => e.status === "scheduled" && !proposedKeys.has(e.jiraKey))
        .map<Row>((e) => ({ kind: "existing", event: e, ticket: ticketByKey.get(e.jiraKey) })),
    ];
    rows.sort((a, b) => {
      const sa = a.kind === "proposed" ? a.block.startUtcIso : a.event.startUtcIso;
      const sb = b.kind === "proposed" ? b.block.startUtcIso : b.event.startUtcIso;
      return sa.localeCompare(sb);
    });
    const byDay = new Map<string, Row[]>();
    for (const r of rows) {
      const start = r.kind === "proposed" ? r.block.startUtcIso : r.event.startUtcIso;
      const day = dayFmt.format(new Date(start));
      const list = byDay.get(day) ?? [];
      list.push(r);
      byDay.set(day, list);
    }
    return [...byDay.entries()];
  }, [blocks, existing, existingByKey, proposedKeys, ticketByKey]);

  if (grouped.length === 0) {
    return (
      <div className="border rounded-lg p-6 text-sm text-slate-500 bg-white">
        Nothing to schedule. You're either caught up or nothing matches the filters.
      </div>
    );
  }

  const allKeys = grouped.flatMap(([, rows]) =>
    rows.map((r) => (r.kind === "proposed" ? r.block.jiraKey : r.event.jiraKey)),
  );
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedKeys.has(k));
  const someSelected = !allSelected && allKeys.some((k) => selectedKeys.has(k));

  return (
    <div className="border rounded-lg bg-white">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-3">
          <TriCheckbox
            checked={allSelected}
            indeterminate={someSelected}
            onChange={(checked) => onToggleKeys(allKeys, checked)}
            title={allSelected ? "Clear selection" : "Select all"}
          />
          <h3 className="text-sm font-semibold text-slate-700">Schedule</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 mr-2">Mark all proposed:</span>
          <button
            onClick={() => onSetAllShowAs("free")}
            className="text-xs px-2 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          >
            Free
          </button>
          <button
            onClick={() => onSetAllShowAs("busy")}
            className="text-xs px-2 py-1 rounded border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
          >
            Busy
          </button>
        </div>
      </header>
      <div className="divide-y">
        {grouped.map(([day, rows]) => {
          const dayKeys = rows.map((r) =>
            r.kind === "proposed" ? r.block.jiraKey : r.event.jiraKey,
          );
          const dayAll = dayKeys.length > 0 && dayKeys.every((k) => selectedKeys.has(k));
          const daySome = !dayAll && dayKeys.some((k) => selectedKeys.has(k));
          return (
            <div key={day} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <TriCheckbox
                  checked={dayAll}
                  indeterminate={daySome}
                  onChange={(checked) => onToggleKeys(dayKeys, checked)}
                  title={dayAll ? "Clear day" : "Select day"}
                />
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {day}
                </h4>
              </div>
              <ul className="space-y-1.5">
                {rows.map((r, idx) =>
                  r.kind === "proposed" ? (
                    <ProposedRow
                      key={`p-${idx}-${r.block.jiraKey}`}
                      row={r}
                      onChangeShowAs={onChangeShowAs}
                      onChangeStatus={onChangeStatus}
                      onChangeDuration={onChangeDuration}
                      onError={onError}
                      onConfirm={onConfirmBlock}
                      onDelete={onDeleteExisting}
                      onPickTime={onPickTime}
                      isConfirming={confirmingKeys.has(r.block.jiraKey)}
                      isSavingDuration={savingDurationKeys.has(r.block.jiraKey)}
                      isSelected={selectedKeys.has(r.block.jiraKey)}
                      onToggleSelected={(s) => onToggleKey(r.block.jiraKey, s)}
                    />
                  ) : (
                    <ExistingRow
                      key={`e-${idx}-${r.event.jiraKey}`}
                      row={r}
                      onChangeStatus={onChangeStatus}
                      onError={onError}
                      onDelete={onDeleteExisting}
                      onPickTime={onPickTime}
                      isSelected={selectedKeys.has(r.event.jiraKey)}
                      onToggleSelected={(s) => onToggleKey(r.event.jiraKey, s)}
                    />
                  ),
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  title,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
      title={title}
      className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400 cursor-pointer"
    />
  );
}

function PriorityPill({ priority }: { priority: string | null | undefined }) {
  const label = priority ?? "None";
  const key = (priority ?? "").trim().toLowerCase();
  const styles = priorityStyles(key);
  return (
    <span
      className={`shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded border ${styles}`}
      title={`Priority: ${label}`}
    >
      {label}
    </span>
  );
}

function priorityStyles(key: string): string {
  switch (key) {
    case "highest":
    case "critical":
    case "blocker":
      return "bg-rose-100 text-rose-800 border-rose-200";
    case "high":
    case "major":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "medium":
    case "normal":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "low":
    case "minor":
      return "bg-sky-100 text-sky-800 border-sky-200";
    case "lowest":
    case "trivial":
      return "bg-zinc-100 text-zinc-600 border-zinc-200";
    default:
      return "bg-slate-50 text-slate-500 border-slate-200";
  }
}

function ProposedRow({
  row,
  onChangeShowAs,
  onChangeStatus,
  onChangeDuration,
  onError,
  onConfirm,
  onDelete,
  onPickTime,
  isConfirming,
  isSavingDuration,
  isSelected,
  onToggleSelected,
}: {
  row: Extract<Row, { kind: "proposed" }>;
  onChangeShowAs: (key: string, showAs: "free" | "busy") => void;
  onChangeStatus: (key: string, status: string) => void;
  onChangeDuration: (key: string, minutes: number) => void;
  onError: (msg: string) => void;
  onConfirm: (block: ProposedBlock) => void;
  onDelete: (key: string) => void;
  onPickTime: (key: string) => void;
  isConfirming: boolean;
  isSavingDuration: boolean;
  isSelected: boolean;
  onToggleSelected: (selected: boolean) => void;
}) {
  const { block, ticket, previousStartIso } = row;
  const start = new Date(block.startUtcIso);
  const end = new Date(block.endUtcIso);
  const hasExisting = !!block.existingGraphEventId;
  const moved = hasExisting && previousStartIso && previousStartIso !== block.startUtcIso;
  const unchanged = hasExisting && previousStartIso === block.startUtcIso && (block.existingShowAs ?? null) === block.showAs;
  const tagLabel = !hasExisting ? "NEW" : moved ? "MOVED" : "ON CAL";
  const tagClass = !hasExisting
    ? "bg-sky-100 text-sky-800 border-sky-200"
    : moved
      ? "bg-amber-100 text-amber-900 border-amber-200"
      : "bg-emerald-100 text-emerald-800 border-emerald-200";
  const movedTitle = moved && previousStartIso
    ? `Moved from ${timeFmt.format(new Date(previousStartIso))} on ${dayFmtShort(previousStartIso)}`
    : undefined;
  return (
    <li className={`flex items-start gap-3 py-1.5 -mx-2 px-2 rounded ${isSelected ? "bg-sky-50" : ""}`}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => onToggleSelected(e.currentTarget.checked)}
        className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400 cursor-pointer shrink-0"
        title={isSelected ? "Deselect" : "Select"}
      />
      <button
        type="button"
        onClick={() => onPickTime(block.jiraKey)}
        title="Click to pick a different time"
        className="w-32 shrink-0 text-left text-xs font-mono text-slate-500 pt-0.5 hover:text-sky-700 hover:underline cursor-pointer"
      >
        {timeFmt.format(start)} – {timeFmt.format(end)}
      </button>
      <span
        className={`shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded border ${tagClass}`}
        title={movedTitle}
      >
        {tagLabel}
      </span>
      <PriorityPill priority={ticket?.priority ?? null} />
      <span className="shrink-0 mt-0.5 font-mono text-xs text-slate-500">{block.projectKey}</span>
      <a
        href={ticket?.url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 mt-0.5 font-mono text-xs text-sky-700 hover:underline"
      >
        {block.jiraKey}
      </a>
      <span className="flex-1 min-w-0 break-words text-sm">{block.summary}</span>
      <DurationInput
        value={block.durationMin}
        disabled={isSavingDuration}
        onCommit={(m) => onChangeDuration(block.jiraKey, m)}
      />
      <div className="shrink-0">
        <FreeBusyToggle
          value={block.showAs}
          onChange={(v) => onChangeShowAs(block.jiraKey, v)}
        />
      </div>
      {ticket && (
        <div className="shrink-0">
          <StatusPill
            jiraKey={block.jiraKey}
            status={ticket.status}
            onChange={(s) => onChangeStatus(block.jiraKey, s)}
            onError={onError}
          />
        </div>
      )}
      <button
        onClick={() => onConfirm(block)}
        disabled={isConfirming || unchanged}
        title={unchanged ? "Already on calendar at this time" : "Schedule just this ticket"}
        className="shrink-0 text-xs px-2 py-1 rounded bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {isConfirming ? "Scheduling…" : hasExisting ? "Update" : "Schedule"}
      </button>
      {hasExisting && (
        <button
          onClick={() => onDelete(block.jiraKey)}
          title="Remove this scheduled block from your calendar"
          className="shrink-0 mt-0.5 text-xs text-rose-600 hover:text-rose-800"
        >
          Cancel
        </button>
      )}
    </li>
  );
}

function dayFmtShort(iso: string): string {
  return dayFmt.format(new Date(iso));
}

function ExistingRow({
  row,
  onChangeStatus,
  onError,
  onDelete,
  onPickTime,
  isSelected,
  onToggleSelected,
}: {
  row: Extract<Row, { kind: "existing" }>;
  onChangeStatus: (key: string, status: string) => void;
  onError: (msg: string) => void;
  onDelete: (key: string) => void;
  onPickTime: (key: string) => void;
  isSelected: boolean;
  onToggleSelected: (selected: boolean) => void;
}) {
  const { event, ticket } = row;
  const start = new Date(event.startUtcIso);
  const end = new Date(event.endUtcIso);
  return (
    <li className={`flex items-start gap-3 py-1.5 -mx-2 px-2 rounded ${isSelected ? "bg-sky-50" : ""}`}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => onToggleSelected(e.currentTarget.checked)}
        className="mt-1 h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400 cursor-pointer shrink-0"
        title={isSelected ? "Deselect" : "Select"}
      />
      <button
        type="button"
        onClick={() => onPickTime(event.jiraKey)}
        title="Click to pick a different time"
        className="w-32 shrink-0 text-left text-xs font-mono text-slate-500 pt-0.5 hover:text-sky-700 hover:underline cursor-pointer"
      >
        {timeFmt.format(start)} – {timeFmt.format(end)}
      </button>
      <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
        ON CAL
      </span>
      <PriorityPill priority={ticket?.priority ?? null} />
      <span className="shrink-0 mt-0.5 font-mono text-xs text-slate-500">{event.projectKey ?? ""}</span>
      <a
        href={ticket?.url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 mt-0.5 font-mono text-xs text-sky-700 hover:underline"
      >
        {event.jiraKey}
      </a>
      <span className="flex-1 min-w-0 break-words text-sm">
        {event.summary ?? ticket?.summary ?? ""}
      </span>
      <span
        className={`shrink-0 mt-0.5 text-xs px-1.5 py-0.5 rounded border ${event.showAs === "busy" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"}`}
      >
        {event.showAs}
      </span>
      {ticket && (
        <div className="shrink-0">
          <StatusPill
            jiraKey={event.jiraKey}
            status={ticket.status}
            onChange={(s) => onChangeStatus(event.jiraKey, s)}
            onError={onError}
          />
        </div>
      )}
      <button
        onClick={() => onDelete(event.jiraKey)}
        title="Remove this scheduled block"
        className="shrink-0 mt-0.5 text-xs text-rose-600 hover:text-rose-800"
      >
        Remove
      </button>
    </li>
  );
}

function DurationInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (minutes: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(480, Math.max(15, Math.round(n / 15) * 15));
    if (clamped === value) {
      setDraft(String(value));
      return;
    }
    setDraft(String(clamped));
    onCommit(clamped);
  }

  return (
    <span className="shrink-0 mt-0.5 inline-flex items-center text-xs text-slate-500 tabular-nums">
      <input
        type="number"
        min={15}
        max={480}
        step={15}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(String(value));
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        title="Duration in minutes (rounded to 15)"
        className="w-12 text-right px-1 py-0.5 border border-slate-200 rounded bg-white focus:outline-none focus:border-slate-400 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="ml-0.5">m</span>
    </span>
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
        onClick={() => onChange("free")}
        className={`px-2 py-0.5 ${value === "free" ? "bg-emerald-100 text-emerald-900" : "bg-white text-slate-600 hover:bg-slate-50"}`}
      >
        Free
      </button>
      <button
        onClick={() => onChange("busy")}
        className={`px-2 py-0.5 border-l border-slate-300 ${value === "busy" ? "bg-amber-100 text-amber-900" : "bg-white text-slate-600 hover:bg-slate-50"}`}
      >
        Busy
      </button>
    </div>
  );
}
