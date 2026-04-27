import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Transition } from "../types";

export function StatusPill({
  jiraKey,
  status,
  onChange,
  onError,
}: {
  jiraKey: string;
  status: string;
  onChange: (newStatus: string) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transitions, setTransitions] = useState<Transition[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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
    if (transitions === null) {
      setLoading(true);
      try {
        const res = await api.transitions(jiraKey);
        setTransitions(res.transitions);
      } catch (err: any) {
        onError(err.message);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }
  }

  async function pick(t: Transition) {
    setOpen(false);
    const prev = status;
    onChange(t.toStatus || t.name);
    try {
      const res = await api.transition(jiraKey, t.id);
      if (res.ticket) onChange(res.ticket.status);
    } catch (err: any) {
      onChange(prev);
      onError(`Could not move ${jiraKey}: ${err.message}`);
    }
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300"
        title="Click to change status"
      >
        {status}
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 right-0 w-56 rounded-md border border-slate-200 bg-white shadow-lg p-1">
          {loading && <div className="px-2 py-1 text-xs text-slate-500">Loading…</div>}
          {!loading && transitions && transitions.length === 0 && (
            <div className="px-2 py-1 text-xs text-slate-500">No transitions available</div>
          )}
          {!loading &&
            transitions?.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t)}
                className="w-full text-left px-2 py-1 rounded hover:bg-slate-100 text-sm"
              >
                <span className="font-medium">{t.name}</span>
                {t.toStatus && t.toStatus !== t.name && (
                  <span className="text-slate-400"> → {t.toStatus}</span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
