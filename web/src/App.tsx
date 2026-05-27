import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Health, Move, Preview, ProposedBlock, Settings, Ticket } from "./types";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SchedulePreview } from "./components/SchedulePreview";
import { ToastTray, useToasts } from "./components/Toast";
import {
  ManualScheduleDialog,
  type ManualScheduleSubmit,
} from "./components/ManualScheduleDialog";
import { BulkActionBar } from "./components/BulkActionBar";

function confirmButtonLabel(blocks: ProposedBlock[], moves: Move[]): string {
  const total = blocks.length;
  const movedKeys = new Set(moves.map((m) => m.jiraKey));
  const moved = blocks.filter((b) => movedKeys.has(b.jiraKey)).length;
  const newCount = blocks.filter((b) => !b.existingGraphEventId).length;
  const unchanged = total - moved - newCount;
  const parts = [
    newCount ? `${newCount} new` : null,
    moved ? `${moved} moved` : null,
    unchanged ? `${unchanged} unchanged` : null,
  ].filter(Boolean);
  return `Confirm · ${parts.join(" · ") || total}`;
}

export function App() {
  const toasts = useToasts();
  const [health, setHealth] = useState<Health | null>(null);
  const [me, setMe] = useState<{ signedIn: boolean; username?: string; name?: string | null } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingKeys, setConfirmingKeys] = useState<Set<string>>(new Set());
  const [forcingKeys, setForcingKeys] = useState<Set<string>>(new Set());
  const [pickingKeys, setPickingKeys] = useState<Set<string>>(new Set());
  const [savingDurationKeys, setSavingDurationKeys] = useState<Set<string>>(new Set());
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const refreshHealth = useCallback(async () => {
    try {
      const [h, m] = await Promise.all([api.health(), api.me()]);
      setHealth(h);
      setMe(m);
    } catch (err: any) {
      toasts.push("error", err.message);
    }
  }, []);

  const refreshPreview = useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.preview();
      setPreview(p);
    } catch (err: any) {
      toasts.push("error", `Preview failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    if (location.search.includes("signed_in=1")) {
      history.replaceState(null, "", location.pathname);
      toasts.push("success", "Signed in to Microsoft");
    }
  }, []);

  useEffect(() => {
    if (health?.signedIn) refreshPreview();
  }, [health?.signedIn]);

  function setBlockShowAs(jiraKey: string, showAs: "free" | "busy") {
    setPreview((p) =>
      p
        ? {
            ...p,
            blocks: p.blocks.map((b) => (b.jiraKey === jiraKey ? { ...b, showAs } : b)),
          }
        : p,
    );
  }

  function setAllShowAs(showAs: "free" | "busy") {
    setPreview((p) =>
      p ? { ...p, blocks: p.blocks.map((b) => ({ ...b, showAs })) } : p,
    );
  }

  function setTicketStatus(jiraKey: string, status: string) {
    setPreview((p) =>
      p
        ? {
            ...p,
            tickets: p.tickets.map((t) => (t.key === jiraKey ? { ...t, status } : t)),
          }
        : p,
    );
  }

  async function confirm() {
    if (!preview || preview.blocks.length === 0) return;
    setConfirming(true);
    try {
      const res = await api.confirm(preview.blocks as ProposedBlock[]);
      const created = res.created.filter((c) => c.action === "created").length;
      const patched = res.created.filter((c) => c.action === "patched").length;
      const noop = res.created.filter((c) => c.action === "noop").length;
      const parts = [
        created ? `${created} created` : null,
        patched ? `${patched} moved` : null,
        noop ? `${noop} unchanged` : null,
      ].filter(Boolean);
      toasts.push("success", parts.length ? parts.join(" · ") : "No changes");
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", `Confirm failed: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  }

  async function confirmOne(block: ProposedBlock) {
    if (confirmingKeys.has(block.jiraKey)) return;
    setConfirmingKeys((s) => new Set(s).add(block.jiraKey));
    try {
      const res = await api.confirm([block]);
      const action = res.created[0]?.action ?? "created";
      const verb = action === "patched" ? "Moved" : action === "noop" ? "Unchanged" : "Scheduled";
      toasts.push("success", `${verb} ${block.jiraKey}`);
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", `Schedule failed: ${err.message}`);
    } finally {
      setConfirmingKeys((s) => {
        const n = new Set(s);
        n.delete(block.jiraKey);
        return n;
      });
    }
  }

  async function scheduleOne(jiraKey: string) {
    if (forcingKeys.has(jiraKey)) return;
    setForcingKeys((s) => new Set(s).add(jiraKey));
    try {
      const res = await api.scheduleOne(jiraKey);
      const when = new Date(res.block.startUtcIso).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      toasts.push("success", `Scheduled ${jiraKey} for ${when}`);
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", `Schedule failed: ${err.message}`);
    } finally {
      setForcingKeys((s) => {
        const n = new Set(s);
        n.delete(jiraKey);
        return n;
      });
    }
  }

  async function scheduleAt(jiraKey: string, payload: ManualScheduleSubmit) {
    if (pickingKeys.has(jiraKey)) return;
    setPickingKeys((s) => new Set(s).add(jiraKey));
    try {
      const res = await api.scheduleAt(jiraKey, payload.startUtcIso, {
        durationMin: payload.durationMin,
        showAs: payload.showAs,
      });
      const when = new Date(res.block.startUtcIso).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const verb = res.action === "patched" ? "Moved" : "Scheduled";
      toasts.push("success", `${verb} ${jiraKey} for ${when}`);
      setPickingFor(null);
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", `Schedule failed: ${err.message}`);
    } finally {
      setPickingKeys((s) => {
        const n = new Set(s);
        n.delete(jiraKey);
        return n;
      });
    }
  }

  async function changeDuration(jiraKey: string, minutes: number) {
    if (savingDurationKeys.has(jiraKey)) return;
    const current = preview?.blocks.find((b) => b.jiraKey === jiraKey);
    if (!current || current.durationMin === minutes) return;
    const newEndIso = new Date(
      new Date(current.startUtcIso).getTime() + minutes * 60_000,
    ).toISOString();
    setPreview((p) =>
      p
        ? {
            ...p,
            blocks: p.blocks.map((b) =>
              b.jiraKey === jiraKey
                ? { ...b, durationMin: minutes, endUtcIso: newEndIso }
                : b,
            ),
          }
        : p,
    );
    setSavingDurationKeys((s) => new Set(s).add(jiraKey));
    try {
      await api.setEstimate(jiraKey, minutes);
      if (current.existingGraphEventId) {
        await api.scheduleAt(jiraKey, current.startUtcIso, {
          durationMin: minutes,
          showAs: current.showAs,
        });
      }
      toasts.push("success", `Updated duration for ${jiraKey} to ${minutes}m`);
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", `Duration update failed: ${err.message}`);
      await refreshPreview();
    } finally {
      setSavingDurationKeys((s) => {
        const n = new Set(s);
        n.delete(jiraKey);
        return n;
      });
    }
  }

  async function reschedule() {
    setRescheduling(true);
    try {
      const res = await api.reschedule();
      const summary = `Rescheduled ${res.rescheduled.length} · Completed ${res.completed.length}${res.errors.length ? ` · Errors ${res.errors.length}` : ""}`;
      toasts.push(res.errors.length ? "info" : "success", summary);
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", `Reschedule failed: ${err.message}`);
    } finally {
      setRescheduling(false);
    }
  }

  async function cleanupOrphans() {
    setCleaningOrphans(true);
    try {
      const { orphans } = await api.listOrphans();
      if (orphans.length === 0) {
        toasts.push("info", "No orphan Jira blocks found on your calendar");
        return;
      }
      const sample = orphans
        .slice(0, 5)
        .map((o) => `${o.jiraKey} @ ${new Date(o.startUtcIso).toLocaleString()}`)
        .join("\n");
      const more = orphans.length > 5 ? `\n…and ${orphans.length - 5} more` : "";
      const ok = window.confirm(
        `Found ${orphans.length} Jira-tagged event(s) on your calendar that this app no longer tracks.\n\n${sample}${more}\n\nRemove all from Outlook?`,
      );
      if (!ok) return;
      const res = await api.deleteOrphans(orphans.map((o) => o.graphEventId));
      if (res.removed) toasts.push("success", `Removed ${res.removed} orphan block(s)`);
      if (res.failed.length) {
        toasts.push(
          "error",
          `${res.failed.length} failed: ${res.failed.map((f) => f.error).join("; ")}`,
        );
      }
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", `Cleanup failed: ${err.message}`);
    } finally {
      setCleaningOrphans(false);
    }
  }

  async function deleteScheduled(jiraKey: string) {
    try {
      await api.deleteScheduled(jiraKey);
      toasts.push("success", `Removed block for ${jiraKey}`);
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", err.message);
    }
  }

  const availableKeys = useMemo(() => {
    if (!preview) return new Set<string>();
    const keys = new Set<string>();
    for (const b of preview.blocks) keys.add(b.jiraKey);
    for (const e of preview.existing) {
      if (e.status === "scheduled") keys.add(e.jiraKey);
    }
    return keys;
  }, [preview]);

  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (availableKeys.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [availableKeys]);

  const toggleKey = useCallback((jiraKey: string, selected: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (selected) next.add(jiraKey);
      else next.delete(jiraKey);
      return next;
    });
  }, []);

  const toggleKeys = useCallback((keys: string[], selected: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (selected) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), []);

  const selectedArr = useMemo(() => [...selectedKeys], [selectedKeys]);

  const { proposedSelectedKeys, existingSelectedKeys } = useMemo(() => {
    const proposed: string[] = [];
    const existingOnly: string[] = [];
    if (!preview) return { proposedSelectedKeys: proposed, existingSelectedKeys: existingOnly };
    const proposedSet = new Set(preview.blocks.map((b) => b.jiraKey));
    const existingSet = new Set(
      preview.existing.filter((e) => e.status === "scheduled").map((e) => e.jiraKey),
    );
    for (const k of selectedArr) {
      if (proposedSet.has(k)) proposed.push(k);
      if (existingSet.has(k) || preview.blocks.find((b) => b.jiraKey === k && b.existingGraphEventId)) {
        existingOnly.push(k);
      }
    }
    return { proposedSelectedKeys: proposed, existingSelectedKeys: existingOnly };
  }, [selectedArr, preview]);

  async function bulkSetShowAs(showAs: "free" | "busy") {
    if (!preview || selectedKeys.size === 0) return;
    setBulkBusy(true);
    try {
      const proposedSet = new Set(preview.blocks.map((b) => b.jiraKey));
      const existingByKey = new Map(preview.existing.map((e) => [e.jiraKey, e] as const));
      // Update local state for any proposed rows
      setPreview((p) =>
        p
          ? {
              ...p,
              blocks: p.blocks.map((b) =>
                selectedKeys.has(b.jiraKey) ? { ...b, showAs } : b,
              ),
            }
          : p,
      );
      const existingOnly = selectedArr.filter(
        (k) => !proposedSet.has(k) && existingByKey.has(k),
      );
      let patched = 0;
      const errors: string[] = [];
      await Promise.all(
        existingOnly.map(async (k) => {
          const ev = existingByKey.get(k)!;
          try {
            const durationMin = Math.max(
              15,
              Math.round(
                (new Date(ev.endUtcIso).getTime() - new Date(ev.startUtcIso).getTime()) / 60000,
              ),
            );
            await api.scheduleAt(k, ev.startUtcIso, { showAs, durationMin });
            patched += 1;
          } catch (err: any) {
            errors.push(`${k}: ${err.message}`);
          }
        }),
      );
      const proposedTouched = selectedArr.filter((k) => proposedSet.has(k)).length;
      const parts = [
        proposedTouched ? `${proposedTouched} proposed marked ${showAs}` : null,
        patched ? `${patched} existing patched ${showAs}` : null,
      ].filter(Boolean);
      if (parts.length) toasts.push("success", parts.join(" · "));
      if (errors.length) toasts.push("error", `Free/Busy errors: ${errors.join("; ")}`);
      if (patched) await refreshPreview();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkSetStatus(statusName: string) {
    if (!preview || selectedKeys.size === 0) return;
    setBulkBusy(true);
    try {
      let moved = 0;
      const errors: string[] = [];
      for (const k of selectedArr) {
        try {
          const { transitions } = await api.transitions(k);
          const t = transitions.find((tr) => (tr.toStatus || tr.name) === statusName);
          if (!t) {
            errors.push(`${k}: no transition to "${statusName}"`);
            continue;
          }
          const res = await api.transition(k, t.id);
          const newStatus = res.ticket?.status ?? statusName;
          setPreview((p) =>
            p
              ? {
                  ...p,
                  tickets: p.tickets.map((tk) =>
                    tk.key === k ? { ...tk, status: newStatus } : tk,
                  ),
                }
              : p,
          );
          moved += 1;
        } catch (err: any) {
          errors.push(`${k}: ${err.message}`);
        }
      }
      if (moved) toasts.push("success", `Moved ${moved} ticket(s) to ${statusName}`);
      if (errors.length) toasts.push("error", `Status errors: ${errors.join("; ")}`);
      await refreshPreview();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkSetDuration(minutes: number) {
    if (!preview || proposedSelectedKeys.length === 0) return;
    setBulkBusy(true);
    try {
      let updated = 0;
      const errors: string[] = [];
      for (const k of proposedSelectedKeys) {
        const current = preview.blocks.find((b) => b.jiraKey === k);
        if (!current || current.durationMin === minutes) continue;
        try {
          await api.setEstimate(k, minutes);
          if (current.existingGraphEventId) {
            await api.scheduleAt(k, current.startUtcIso, {
              durationMin: minutes,
              showAs: current.showAs,
            });
          }
          updated += 1;
        } catch (err: any) {
          errors.push(`${k}: ${err.message}`);
        }
      }
      if (updated) toasts.push("success", `Updated duration to ${minutes}m for ${updated} ticket(s)`);
      if (errors.length) toasts.push("error", `Duration errors: ${errors.join("; ")}`);
      await refreshPreview();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkConfirm() {
    if (!preview || proposedSelectedKeys.length === 0) return;
    const subset = preview.blocks.filter((b) => selectedKeys.has(b.jiraKey));
    if (subset.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await api.confirm(subset as ProposedBlock[]);
      const created = res.created.filter((c) => c.action === "created").length;
      const patched = res.created.filter((c) => c.action === "patched").length;
      const noop = res.created.filter((c) => c.action === "noop").length;
      const parts = [
        created ? `${created} created` : null,
        patched ? `${patched} moved` : null,
        noop ? `${noop} unchanged` : null,
      ].filter(Boolean);
      toasts.push("success", parts.length ? parts.join(" · ") : "No changes");
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", `Bulk confirm failed: ${err.message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkCancel() {
    if (existingSelectedKeys.length === 0) return;
    const ok = window.confirm(
      `Cancel ${existingSelectedKeys.length} scheduled block(s)? This removes them from your Outlook calendar.`,
    );
    if (!ok) return;
    setBulkBusy(true);
    try {
      // Sequential to avoid Graph throttling; one failure shouldn't stop the rest.
      let removed = 0;
      const failed: string[] = [];
      for (const k of existingSelectedKeys) {
        try {
          await api.deleteScheduled(k);
          removed += 1;
        } catch (err: any) {
          failed.push(`${k}: ${err.message}`);
        }
      }
      if (removed) toasts.push("success", `Removed ${removed} block(s)`);
      if (failed.length) {
        toasts.push(
          "error",
          `${failed.length} cancellation(s) failed: ${failed.join("; ")}`,
        );
      }
      await refreshPreview();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkReschedule() {
    if (selectedKeys.size === 0) return;
    setBulkBusy(true);
    try {
      let moved = 0;
      const errors: string[] = [];
      for (const k of selectedArr) {
        try {
          await api.scheduleOne(k);
          moved += 1;
        } catch (err: any) {
          errors.push(`${k}: ${err.message}`);
        }
      }
      if (moved) toasts.push("success", `Rescheduled ${moved} ticket(s)`);
      if (errors.length) toasts.push("error", `Reschedule errors: ${errors.join("; ")}`);
      await refreshPreview();
    } finally {
      setBulkBusy(false);
    }
  }

  async function logout() {
    await api.logout();
    setMe({ signedIn: false });
    setHealth((h) => (h ? { ...h, signedIn: false } : h));
    toasts.push("info", "Signed out of Microsoft");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
          <h1 className="text-base font-semibold tracking-tight">
            ToDo <span className="text-slate-400 font-normal">· Jira → Outlook</span>
          </h1>
          <div className="flex-1" />
          {me?.signedIn ? (
            <>
              <span className="text-xs text-slate-500">
                {me.name ?? me.username}
              </span>
              <button
                onClick={logout}
                className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
              >
                Sign out
              </button>
            </>
          ) : (
            <a
              href="/auth/login"
              className="text-xs px-2 py-1 rounded bg-slate-900 text-white hover:bg-slate-700"
            >
              Sign in with Microsoft
            </a>
          )}
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
          >
            Settings
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full px-6 py-6 flex-1 space-y-6">
        <ConfigBanner health={health} onOpenSettings={() => setDrawerOpen(true)} />

        {!me?.signedIn && (
          <div className="border rounded-lg p-6 bg-white text-sm text-slate-600">
            Sign in with Microsoft to read your calendar and create time blocks.
          </div>
        )}

        {me?.signedIn && (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={refreshPreview}
                disabled={loading}
                className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                {loading ? "Loading…" : "Refresh"}
              </button>
              <button
                onClick={confirm}
                disabled={confirming || !preview || preview.blocks.length === 0}
                className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {confirming
                  ? "Saving…"
                  : preview && preview.blocks.length > 0
                    ? confirmButtonLabel(preview.blocks, preview.moves ?? [])
                    : "Confirm"}
              </button>
              <button
                onClick={reschedule}
                disabled={rescheduling}
                className="text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                title="Move past blocks for tickets that aren't Done to the next free slot"
              >
                {rescheduling ? "Rescheduling…" : "Run reschedule sweep"}
              </button>
              <button
                onClick={cleanupOrphans}
                disabled={cleaningOrphans}
                className="text-sm px-3 py-1.5 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                title="Find Jira-tagged Outlook events not tracked here and remove them"
              >
                {cleaningOrphans ? "Scanning…" : "Cleanup calendar"}
              </button>
              <div className="flex-1" />
              {preview?.windowStartIso && (
                <span className="text-xs text-slate-500">
                  Window: {new Date(preview.windowStartIso).toLocaleDateString()} –{" "}
                  {new Date(preview.windowEndIso!).toLocaleDateString()}
                </span>
              )}
            </div>

            {preview?.reason === "no_projects_selected" ? (
              <div className="border rounded-lg p-6 bg-white text-sm text-slate-600">
                <p className="mb-2">No Jira projects are selected yet.</p>
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700"
                >
                  Open Settings
                </button>
              </div>
            ) : (
              preview && (
                <>
                  {selectedKeys.size > 0 && (
                    <BulkActionBar
                      selectedCount={selectedKeys.size}
                      proposedSelectedCount={proposedSelectedKeys.length}
                      existingSelectedCount={existingSelectedKeys.length}
                      selectedKeys={selectedArr}
                      busy={bulkBusy}
                      onClear={clearSelection}
                      onSetShowAs={bulkSetShowAs}
                      onSetStatus={bulkSetStatus}
                      onSetDuration={bulkSetDuration}
                      onConfirm={bulkConfirm}
                      onCancel={bulkCancel}
                      onReschedule={bulkReschedule}
                    />
                  )}
                  <SchedulePreview
                    blocks={preview.blocks}
                    existing={preview.existing}
                    tickets={preview.tickets}
                    onChangeShowAs={setBlockShowAs}
                    onSetAllShowAs={setAllShowAs}
                    onChangeStatus={setTicketStatus}
                    onChangeDuration={changeDuration}
                    onError={(m) => toasts.push("error", m)}
                    onDeleteExisting={deleteScheduled}
                    onConfirmBlock={confirmOne}
                    onPickTime={(key) => setPickingFor(key)}
                    confirmingKeys={confirmingKeys}
                    savingDurationKeys={savingDurationKeys}
                    selectedKeys={selectedKeys}
                    onToggleKey={toggleKey}
                    onToggleKeys={toggleKeys}
                  />

                  {preview.unscheduled.length > 0 && (
                    <div className="border rounded-lg bg-white">
                      <header className="px-4 py-3 border-b flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-700">
                          Couldn't fit {preview.unscheduled.length} ticket(s)
                        </h3>
                        <span className="text-xs text-slate-500">
                          Click Schedule to slot one in beyond the lookahead window
                        </span>
                      </header>
                      <ul className="divide-y">
                        {[...preview.unscheduled]
                          .sort((a, b) => {
                            const ta = preview.tickets.find((x) => x.key === a.jiraKey);
                            const tb = preview.tickets.find((x) => x.key === b.jiraKey);
                            const ia = ta?.status === "In Progress" ? 0 : 1;
                            const ib = tb?.status === "In Progress" ? 0 : 1;
                            return ia - ib;
                          })
                          .map((u) => {
                          const t = preview.tickets.find((x) => x.key === u.jiraKey);
                          const isForcing = forcingKeys.has(u.jiraKey);
                          const isPicking = pickingKeys.has(u.jiraKey);
                          return (
                            <li
                              key={u.jiraKey}
                              className="px-4 py-2 flex items-center gap-3 text-sm"
                            >
                              <a
                                href={t?.url ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-xs text-sky-700 hover:underline shrink-0"
                              >
                                {u.jiraKey}
                              </a>
                              <span className="flex-1 truncate">{t?.summary ?? ""}</span>
                              <span className="text-xs text-slate-500 shrink-0">{u.reason}</span>
                              <button
                                onClick={() => setPickingFor(u.jiraKey)}
                                disabled={isPicking || isForcing}
                                className="shrink-0 text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                                title="Pick a specific date and time for this ticket"
                              >
                                {isPicking ? "Scheduling…" : "Pick time…"}
                              </button>
                              <button
                                onClick={() => scheduleOne(u.jiraKey)}
                                disabled={isForcing || isPicking}
                                className="shrink-0 text-xs px-2 py-1 rounded bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
                                title="Find the next free slot beyond the lookahead window and schedule this ticket"
                              >
                                {isForcing ? "Scheduling…" : "Schedule"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </>
              )
            )}
          </>
        )}
      </main>

      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={refreshPreview}
        pushToast={toasts.push}
      />
      <ManualScheduleDialogContainer
        pickingFor={pickingFor}
        preview={preview}
        submitting={pickingFor ? pickingKeys.has(pickingFor) : false}
        onSubmit={scheduleAt}
        onClose={() => setPickingFor(null)}
      />
      <ToastTray items={toasts.items} onDismiss={toasts.dismiss} />
    </div>
  );
}

function computeDurationMin(
  estimateSeconds: number | null | undefined,
  settings?: Settings,
): number {
  const minSlot = settings?.minSlotMinutes ?? 30;
  const defaultEst = settings?.defaultEstimateMinutes ?? 60;
  const baseSec = estimateSeconds && estimateSeconds > 0
    ? estimateSeconds
    : defaultEst * 60;
  const min = Math.ceil(baseSec / 60);
  return Math.max(minSlot, Math.ceil(min / 30) * 30);
}

function ManualScheduleDialogContainer({
  pickingFor,
  preview,
  submitting,
  onSubmit,
  onClose,
}: {
  pickingFor: string | null;
  preview: Preview | null;
  submitting: boolean;
  onSubmit: (jiraKey: string, payload: ManualScheduleSubmit) => void;
  onClose: () => void;
}) {
  const ticket: Ticket | null = useMemo(() => {
    if (!pickingFor || !preview) return null;
    return preview.tickets.find((t) => t.key === pickingFor) ?? null;
  }, [pickingFor, preview]);

  const initialStartUtcIso = useMemo(() => {
    if (!pickingFor || !preview) return undefined;
    const block = preview.blocks.find((b) => b.jiraKey === pickingFor);
    if (block) return block.startUtcIso;
    const ev = preview.existing.find((e) => e.jiraKey === pickingFor);
    return ev?.startUtcIso;
  }, [pickingFor, preview]);

  const durationMin = useMemo(
    () => computeDurationMin(ticket?.estimateSeconds, preview?.settings),
    [ticket?.estimateSeconds, preview?.settings],
  );

  const defaultShowAs = useMemo<"free" | "busy">(() => {
    if (!pickingFor || !preview) return preview?.settings?.defaultShowAs ?? "free";
    const block = preview.blocks.find((b) => b.jiraKey === pickingFor);
    if (block) return block.showAs;
    const ev = preview.existing.find((e) => e.jiraKey === pickingFor);
    return ev?.showAs ?? preview.settings?.defaultShowAs ?? "free";
  }, [pickingFor, preview]);

  return (
    <ManualScheduleDialog
      open={!!pickingFor && !!ticket}
      ticket={ticket ? { key: ticket.key, summary: ticket.summary } : null}
      durationMin={durationMin}
      defaultShowAs={defaultShowAs}
      initialStartUtcIso={initialStartUtcIso}
      busy={preview?.busy ?? []}
      existing={preview?.existing ?? []}
      settings={preview?.settings}
      submitting={submitting}
      onSubmit={(payload) => {
        if (!pickingFor) return;
        onSubmit(pickingFor, payload);
      }}
      onClose={onClose}
    />
  );
}

function ConfigBanner({
  health,
  onOpenSettings,
}: {
  health: Health | null;
  onOpenSettings: () => void;
}) {
  if (!health) return null;
  const issues: string[] = [];
  if (!health.msConfigured) issues.push("Microsoft (.env) not configured");
  if (!health.jiraConfigured) issues.push("Jira (.env) not configured");
  if (!health.settingsConfigured) issues.push("No Jira projects selected");
  if (issues.length === 0) return null;
  return (
    <div className="border border-amber-300 bg-amber-50 text-amber-900 rounded-lg px-4 py-3 text-sm flex items-start gap-3">
      <div className="flex-1">
        <strong>Setup needed:</strong> {issues.join(" · ")}
      </div>
      {!health.settingsConfigured && health.jiraConfigured && (
        <button
          onClick={onOpenSettings}
          className="text-xs px-2 py-1 rounded border border-amber-300 bg-white hover:bg-amber-100"
        >
          Open Settings
        </button>
      )}
    </div>
  );
}
