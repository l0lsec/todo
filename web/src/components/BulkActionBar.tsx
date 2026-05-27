import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export function BulkActionBar({
  selectedCount,
  proposedSelectedCount,
  existingSelectedCount,
  selectedKeys,
  busy,
  onClear,
  onSetShowAs,
  onSetStatus,
  onSetDuration,
  onConfirm,
  onCancel,
  onReschedule,
}: {
  selectedCount: number;
  proposedSelectedCount: number;
  existingSelectedCount: number;
  selectedKeys: string[];
  busy: boolean;
  onClear: () => void;
  onSetShowAs: (showAs: "free" | "busy") => void;
  onSetStatus: (statusName: string) => void;
  onSetDuration: (minutes: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onReschedule: () => void;
}) {
  return (
    <div className="sticky top-[57px] z-10 border border-slate-300 bg-slate-900 text-white rounded-lg px-3 py-2 flex flex-wrap items-center gap-2 shadow-md">
      <span className="text-sm font-medium">
        {selectedCount} selected
      </span>
      <button
        onClick={onClear}
        disabled={busy}
        className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-800 disabled:opacity-50"
      >
        Clear
      </button>
      <div className="h-5 w-px bg-slate-700 mx-1" />

      <span className="text-xs text-slate-300">Show as:</span>
      <button
        onClick={() => onSetShowAs("free")}
        disabled={busy || selectedCount === 0}
        className="text-xs px-2 py-1 rounded border border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
      >
        Free
      </button>
      <button
        onClick={() => onSetShowAs("busy")}
        disabled={busy || selectedCount === 0}
        className="text-xs px-2 py-1 rounded border border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
      >
        Busy
      </button>

      <div className="h-5 w-px bg-slate-700 mx-1" />

      <StatusMenu
        selectedKeys={selectedKeys}
        disabled={busy || selectedCount === 0}
        onPick={onSetStatus}
      />

      <div className="h-5 w-px bg-slate-700 mx-1" />

      <DurationApply
        disabled={busy || proposedSelectedCount === 0}
        onApply={onSetDuration}
        hint={proposedSelectedCount === 0 ? "No proposed rows selected" : `Apply to ${proposedSelectedCount} proposed`}
      />

      <div className="flex-1" />

      <button
        onClick={onConfirm}
        disabled={busy || proposedSelectedCount === 0}
        title={proposedSelectedCount === 0 ? "Select at least one proposed/new row" : `Schedule ${proposedSelectedCount} block(s) to Outlook`}
        className="text-xs px-2 py-1 rounded bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-50"
      >
        Confirm · {proposedSelectedCount}
      </button>
      <button
        onClick={onReschedule}
        disabled={busy || selectedCount === 0}
        title="Find new slots for selected tickets"
        className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-800 disabled:opacity-50"
      >
        Reschedule
      </button>
      <button
        onClick={onCancel}
        disabled={busy || existingSelectedCount === 0}
        title={existingSelectedCount === 0 ? "Selection has no scheduled blocks to remove" : `Remove ${existingSelectedCount} scheduled block(s)`}
        className="text-xs px-2 py-1 rounded border border-rose-400 bg-rose-50 text-rose-800 hover:bg-rose-100 disabled:opacity-50"
      >
        Cancel · {existingSelectedCount}
      </button>
    </div>
  );
}

function StatusMenu({
  selectedKeys,
  disabled,
  onPick,
}: {
  selectedKeys: string[];
  disabled: boolean;
  onPick: (statusName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [common, setCommon] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Reset cache whenever selection changes so we recompute on next open
  const keyId = selectedKeys.slice().sort().join(",");
  useEffect(() => {
    setCommon(null);
    setError(null);
    setOpen(false);
  }, [keyId]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (common === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.all(
          selectedKeys.map((k) =>
            api.transitions(k).then((r) => r.transitions).catch(() => null),
          ),
        );
        if (results.some((r) => r === null)) {
          setError("Couldn't load transitions for some tickets");
        }
        const lists = results.filter((r): r is NonNullable<typeof r> => !!r);
        if (lists.length === 0) {
          setCommon([]);
        } else {
          const namesPerTicket = lists.map(
            (transitions) =>
              new Set(transitions.map((t) => t.toStatus || t.name)),
          );
          const [first, ...rest] = namesPerTicket;
          const intersection = [...first].filter((name) =>
            rest.every((s) => s.has(name)),
          );
          intersection.sort((a, b) => a.localeCompare(b));
          setCommon(intersection);
        }
      } catch (err: any) {
        setError(err?.message ?? "Failed to load transitions");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={toggle}
        disabled={disabled}
        className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-800 disabled:opacity-50"
      >
        Status… <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 w-64 rounded-md border border-slate-200 bg-white shadow-lg p-1 text-slate-800">
          {loading && (
            <div className="px-2 py-1 text-xs text-slate-500">Loading transitions…</div>
          )}
          {!loading && error && (
            <div className="px-2 py-1 text-xs text-rose-600">{error}</div>
          )}
          {!loading && common && common.length === 0 && (
            <div className="px-2 py-1 text-xs text-slate-500">
              No status is available across all selected tickets.
            </div>
          )}
          {!loading &&
            common?.map((name) => (
              <button
                key={name}
                onClick={() => {
                  setOpen(false);
                  onPick(name);
                }}
                className="w-full text-left px-2 py-1 rounded hover:bg-slate-100 text-sm"
              >
                {name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function DurationApply({
  disabled,
  onApply,
  hint,
}: {
  disabled: boolean;
  onApply: (minutes: number) => void;
  hint: string;
}) {
  const [value, setValue] = useState<string>("60");

  function apply() {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(480, Math.max(15, Math.round(n / 15) * 15));
    setValue(String(clamped));
    onApply(clamped);
  }

  return (
    <span className="inline-flex items-center gap-1" title={hint}>
      <span className="text-xs text-slate-300">Duration:</span>
      <input
        type="number"
        min={15}
        max={480}
        step={15}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        className="w-14 text-right text-xs px-1 py-0.5 rounded border border-slate-600 bg-slate-800 text-white disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="text-xs text-slate-400">m</span>
      <button
        onClick={apply}
        disabled={disabled}
        className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-slate-800 disabled:opacity-50"
      >
        Apply
      </button>
    </span>
  );
}
