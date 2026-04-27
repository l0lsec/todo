import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Health, Preview, ProposedBlock } from "./types";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SchedulePreview } from "./components/SchedulePreview";
import { ToastTray, useToasts } from "./components/Toast";

export function App() {
  const toasts = useToasts();
  const [health, setHealth] = useState<Health | null>(null);
  const [me, setMe] = useState<{ signedIn: boolean; username?: string; name?: string | null } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingKeys, setConfirmingKeys] = useState<Set<string>>(new Set());
  const [rescheduling, setRescheduling] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
      toasts.push("success", `Created ${res.created.length} calendar block(s)`);
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
      await api.confirm([block]);
      toasts.push("success", `Scheduled ${block.jiraKey}`);
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

  async function deleteScheduled(jiraKey: string) {
    try {
      await api.deleteScheduled(jiraKey);
      toasts.push("success", `Removed block for ${jiraKey}`);
      await refreshPreview();
    } catch (err: any) {
      toasts.push("error", err.message);
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
                  ? "Creating…"
                  : preview && preview.blocks.length > 0
                    ? `Confirm & schedule ${preview.blocks.length}`
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
                  <SchedulePreview
                    blocks={preview.blocks}
                    existing={preview.existing}
                    tickets={preview.tickets}
                    onChangeShowAs={setBlockShowAs}
                    onSetAllShowAs={setAllShowAs}
                    onChangeStatus={setTicketStatus}
                    onError={(m) => toasts.push("error", m)}
                    onDeleteExisting={deleteScheduled}
                    onConfirmBlock={confirmOne}
                    confirmingKeys={confirmingKeys}
                  />

                  {preview.unscheduled.length > 0 && (
                    <div className="border rounded-lg bg-white">
                      <header className="px-4 py-3 border-b">
                        <h3 className="text-sm font-semibold text-slate-700">
                          Couldn't fit {preview.unscheduled.length} ticket(s)
                        </h3>
                      </header>
                      <ul className="divide-y">
                        {preview.unscheduled.map((u) => {
                          const t = preview.tickets.find((x) => x.key === u.jiraKey);
                          return (
                            <li
                              key={u.jiraKey}
                              className="px-4 py-2 flex items-center gap-3 text-sm"
                            >
                              <span className="font-mono text-xs text-slate-500">{u.jiraKey}</span>
                              <span className="flex-1 truncate">{t?.summary ?? ""}</span>
                              <span className="text-xs text-slate-500">{u.reason}</span>
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
      <ToastTray items={toasts.items} onDismiss={toasts.dismiss} />
    </div>
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
