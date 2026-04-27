import { useEffect, useState } from "react";
import { api } from "../api";
import type { Project, Settings } from "../types";

export function SettingsDrawer({
  open,
  onClose,
  onSaved,
  pushToast,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  pushToast: (kind: "success" | "error" | "info", msg: string) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [s, p] = await Promise.all([api.getSettings(), api.listProjects()]);
        setSettings(s);
        setProjects(p.projects);
      } catch (err: any) {
        pushToast("error", err.message);
      }
    })();
  }, [open]);

  if (!open) return null;

  async function refreshProjects() {
    setRefreshing(true);
    try {
      const res = await api.refreshProjects();
      setProjects(res.projects);
      pushToast("success", `Loaded ${res.count} projects from Jira`);
    } catch (err: any) {
      pushToast("error", err.message);
    } finally {
      setRefreshing(false);
    }
  }

  function toggleProject(key: string) {
    if (!settings) return;
    const set = new Set(settings.selectedProjectKeys);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    setSettings({ ...settings, selectedProjectKeys: [...set] });
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      await api.saveSettings(settings);
      pushToast("success", "Settings saved");
      onSaved();
      onClose();
    } catch (err: any) {
      pushToast("error", err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
      <div className="w-full max-w-lg h-full bg-white shadow-xl flex flex-col">
        <header className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">
            ✕
          </button>
        </header>
        {!settings ? (
          <div className="p-6 text-sm text-slate-500">Loading…</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700">Jira projects</h3>
                <button
                  onClick={refreshProjects}
                  disabled={refreshing}
                  className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
                >
                  {refreshing ? "Loading…" : "Refresh from Jira"}
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-2">
                Only tickets in selected projects (assigned to you, in <em>{settings.ticketStatus}</em>) are scheduled.
              </p>
              {projects.length === 0 ? (
                <div className="text-xs text-slate-500 border border-dashed rounded p-3">
                  No projects loaded yet. Click <strong>Refresh from Jira</strong>.
                </div>
              ) : (
                <ul className="border rounded divide-y max-h-72 overflow-y-auto">
                  {projects.map((p) => {
                    const checked = settings.selectedProjectKeys.includes(p.key);
                    return (
                      <li key={p.key}>
                        <label className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProject(p.key)}
                            className="h-4 w-4"
                          />
                          {p.avatarUrl && (
                            <img src={p.avatarUrl} alt="" className="h-5 w-5 rounded" />
                          )}
                          <span className="text-sm flex-1">{p.name}</span>
                          <span className="text-xs text-slate-400 font-mono">{p.key}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="grid grid-cols-2 gap-4">
              <Field label="Working hours start">
                <input
                  type="time"
                  value={settings.workdayStart}
                  onChange={(e) => setSettings({ ...settings, workdayStart: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Working hours end">
                <input
                  type="time"
                  value={settings.workdayEnd}
                  onChange={(e) => setSettings({ ...settings, workdayEnd: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Timezone (IANA)">
                <input
                  type="text"
                  value={settings.timezone}
                  onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm font-mono"
                />
              </Field>
              <Field label="Buffer (min) before/after meetings">
                <input
                  type="number"
                  min={0}
                  value={settings.bufferMinutes}
                  onChange={(e) =>
                    setSettings({ ...settings, bufferMinutes: parseInt(e.target.value || "0", 10) })
                  }
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Min slot (min)">
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={settings.minSlotMinutes}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      minSlotMinutes: parseInt(e.target.value || "30", 10),
                    })
                  }
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Lookahead (business days)">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.lookaheadBusinessDays}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      lookaheadBusinessDays: parseInt(e.target.value || "5", 10),
                    })
                  }
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Default estimate (min) when Jira has none">
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={settings.defaultEstimateMinutes}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      defaultEstimateMinutes: parseInt(e.target.value || "60", 10),
                    })
                  }
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Default Show As">
                <select
                  value={settings.defaultShowAs}
                  onChange={(e) =>
                    setSettings({ ...settings, defaultShowAs: e.target.value as "free" | "busy" })
                  }
                  className="w-full border rounded px-2 py-1 text-sm"
                >
                  <option value="free">Free (others can book over me)</option>
                  <option value="busy">Busy (block others)</option>
                </select>
              </Field>
              <Field label="Jira ticket status">
                <input
                  type="text"
                  value={settings.ticketStatus}
                  onChange={(e) => setSettings({ ...settings, ticketStatus: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Cron schedule (server TZ)">
                <input
                  type="text"
                  value={settings.cronSchedule}
                  onChange={(e) => setSettings({ ...settings, cronSchedule: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm font-mono"
                />
              </Field>
            </section>

            <section>
              <Field label="Completed statuses (comma-separated)">
                <input
                  type="text"
                  value={settings.completedStatuses.join(", ")}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      completedStatuses: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </Field>
              <p className="text-xs text-slate-500 mt-1">
                When a scheduled ticket reaches one of these, the future block is removed and past blocks aren't rescheduled.
              </p>
            </section>
          </div>
        )}
        <footer className="px-5 py-3 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-slate-300 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !settings}
            className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
