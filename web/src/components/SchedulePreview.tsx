import { useMemo } from "react";
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
  onError,
  onDeleteExisting,
  onConfirmBlock,
  confirmingKeys,
}: {
  blocks: ProposedBlock[];
  existing: ExistingEvent[];
  tickets: Ticket[];
  onChangeShowAs: (jiraKey: string, showAs: "free" | "busy") => void;
  onSetAllShowAs: (showAs: "free" | "busy") => void;
  onChangeStatus: (jiraKey: string, status: string) => void;
  onError: (msg: string) => void;
  onDeleteExisting: (jiraKey: string) => void;
  onConfirmBlock: (block: ProposedBlock) => void;
  confirmingKeys: Set<string>;
}) {
  const ticketByKey = useMemo(() => {
    const m = new Map<string, Ticket>();
    for (const t of tickets) m.set(t.key, t);
    return m;
  }, [tickets]);

  const grouped = useMemo(() => {
    const rows: Row[] = [
      ...existing
        .filter((e) => e.status === "scheduled")
        .map<Row>((e) => ({ kind: "existing", event: e, ticket: ticketByKey.get(e.jiraKey) })),
      ...blocks.map<Row>((b) => ({ kind: "proposed", block: b, ticket: ticketByKey.get(b.jiraKey) })),
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
  }, [blocks, existing, ticketByKey]);

  if (grouped.length === 0) {
    return (
      <div className="border rounded-lg p-6 text-sm text-slate-500 bg-white">
        Nothing to schedule. You're either caught up or nothing matches the filters.
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-white">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold text-slate-700">Schedule</h3>
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
        {grouped.map(([day, rows]) => (
          <div key={day} className="px-4 py-3">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              {day}
            </h4>
            <ul className="space-y-1.5">
              {rows.map((r, idx) =>
                r.kind === "proposed" ? (
                  <ProposedRow
                    key={`p-${idx}-${r.block.jiraKey}`}
                    row={r}
                    onChangeShowAs={onChangeShowAs}
                    onChangeStatus={onChangeStatus}
                    onError={onError}
                    onConfirm={onConfirmBlock}
                    isConfirming={confirmingKeys.has(r.block.jiraKey)}
                  />
                ) : (
                  <ExistingRow
                    key={`e-${idx}-${r.event.jiraKey}`}
                    row={r}
                    onChangeStatus={onChangeStatus}
                    onError={onError}
                    onDelete={onDeleteExisting}
                  />
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProposedRow({
  row,
  onChangeShowAs,
  onChangeStatus,
  onError,
  onConfirm,
  isConfirming,
}: {
  row: Extract<Row, { kind: "proposed" }>;
  onChangeShowAs: (key: string, showAs: "free" | "busy") => void;
  onChangeStatus: (key: string, status: string) => void;
  onError: (msg: string) => void;
  onConfirm: (block: ProposedBlock) => void;
  isConfirming: boolean;
}) {
  const { block, ticket } = row;
  const start = new Date(block.startUtcIso);
  const end = new Date(block.endUtcIso);
  return (
    <li className="flex items-start gap-3 py-1.5">
      <div className="w-32 shrink-0 text-xs font-mono text-slate-500 pt-0.5">
        {timeFmt.format(start)} – {timeFmt.format(end)}
      </div>
      <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-sky-100 text-sky-800 border border-sky-200">
        NEW
      </span>
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
      <span className="shrink-0 mt-0.5 text-xs text-slate-500">{block.durationMin}m</span>
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
        disabled={isConfirming}
        title="Schedule just this ticket"
        className="shrink-0 text-xs px-2 py-1 rounded bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {isConfirming ? "Scheduling…" : "Schedule"}
      </button>
    </li>
  );
}

function ExistingRow({
  row,
  onChangeStatus,
  onError,
  onDelete,
}: {
  row: Extract<Row, { kind: "existing" }>;
  onChangeStatus: (key: string, status: string) => void;
  onError: (msg: string) => void;
  onDelete: (key: string) => void;
}) {
  const { event, ticket } = row;
  const start = new Date(event.startUtcIso);
  const end = new Date(event.endUtcIso);
  return (
    <li className="flex items-start gap-3 py-1.5">
      <div className="w-32 shrink-0 text-xs font-mono text-slate-500 pt-0.5">
        {timeFmt.format(start)} – {timeFmt.format(end)}
      </div>
      <span className="shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
        ON CAL
      </span>
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
