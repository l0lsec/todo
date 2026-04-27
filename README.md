# ToDo

A small local app that pulls your Jira tickets in **Selected for Development** (assigned to you, in projects you choose) and auto-creates time blocks on your Outlook calendar in the open slots between your meetings. Past blocks for tickets that aren't Done get moved to the next free slot.

- Default events are marked **Free** so people can still book over you. You can flip individual blocks to **Busy** before confirming.
- Change Jira ticket status (Done, In Progress, Blocked, …) right from the dashboard. Marking a ticket Done deletes its future calendar block.
- Working hours, buffer, lookahead, default estimate, and more are all configurable in the Settings drawer.

## Quick start

```bash
npm install
cp .env.example .env
# fill in the .env values (see "Configure" below)
npm run dev
# open http://localhost:5173
```

The first time you open the dashboard:

1. Click **Sign in with Microsoft**, complete the consent screen.
2. Open **Settings**, click **Refresh from Jira**, tick the projects you want scheduled.
3. Hit **Confirm & schedule**.

## Configure

### `.env`

| Var               | What                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `PORT`            | Server port (default `4000`)                                        |
| `WEB_ORIGIN`      | UI origin for CORS (default `http://localhost:5173`)                |
| `MS_TENANT_ID`    | Your Azure AD tenant ID (or `common`)                               |
| `MS_CLIENT_ID`    | Application (client) ID from your Azure AD app registration          |
| `MS_CLIENT_SECRET`| Optional client secret if you registered a confidential client       |
| `JIRA_BASE_URL`   | e.g. `https://yourcompany.atlassian.net`                             |
| `JIRA_EMAIL`      | Your Atlassian login email                                          |
| `JIRA_TOKEN`      | API token from `id.atlassian.com/manage-profile/security/api-tokens` |

### Azure AD app registration (5 minutes)

1. Sign in to <https://entra.microsoft.com> as a directory admin.
2. **App registrations** → **New registration**.
3. Name: `Jira Outlook Scheduler`. Supported account types: **single tenant**. Redirect URI: **Web** → `http://localhost:4000/auth/callback`. Register.
4. Copy **Application (client) ID** → `MS_CLIENT_ID`. Copy **Directory (tenant) ID** → `MS_TENANT_ID`.
5. **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated** → add `Calendars.ReadWrite`, `User.Read`, `offline_access`. Click **Grant admin consent**.
6. (Optional) **Certificates & secrets** → **New client secret** → copy value into `MS_CLIENT_SECRET`. If you skip this, leave the env var blank — the app falls back to a public client.

### Jira API token

1. Go to <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. **Create API token**, copy the value into `JIRA_TOKEN`.
3. Set `JIRA_EMAIL` to the email associated with your Atlassian account, and `JIRA_BASE_URL` to your tenant root.

## How it schedules

- Reads `assignee = currentUser() AND status = "Selected for Development" AND project in (KEY1, KEY2, …)` from Jira.
- Reads your busy events from Microsoft Graph for the next `lookaheadBusinessDays` (default 5).
- Subtracts a `bufferMinutes` margin around every meeting, then greedily fits each ticket (sorted by priority then created date) into the first free slot of at least the ticket's duration.
- Duration = Jira `Original Estimate`, rounded up to 30 minutes; falls back to `defaultEstimateMinutes` (default 60) if missing.
- Events have `showAs: "free"` by default and `Categories: ["Jira"]`. Each event has a custom MAPI property `JiraKey` plus the key in the subject `[ABC-123]`.

## Auto-reschedule

Triggered manually with **Run reschedule sweep**, and automatically every weekday at 07:00 in your configured timezone (`cronSchedule` in settings).

For every scheduled event whose end time has already passed:

1. Look up the ticket in Jira.
2. If status is in `completedStatuses` (default `Done, In Review, Closed, Resolved`) → mark complete, leave the past event in place.
3. Otherwise → patch the same Graph event to the next free slot, preserving its original Free/Busy choice. Body gets a "Rescheduled from …" note.

## Project layout

```
server/
  index.ts                # Express + cron
  db.ts                   # SQLite schema
  settings.ts             # config/settings.json read/write (zod-validated)
  auth/msal.ts            # MSAL Node + token cache
  services/
    jira.ts               # JQL search, projects, transitions
    graph.ts              # calendarView, create/patch/delete events
    scheduler.ts          # slot finding + greedy fit
  routes/
    auth.ts               # /auth/login, /auth/callback, /auth/me, /auth/logout
    sync.ts               # /api/sync/preview, /confirm, /reschedule, /event/:key
    projects.ts           # /api/projects, /api/projects/refresh
    settings.ts           # /api/settings GET/PUT
    tickets.ts            # /api/tickets/:key/transitions, /transition

web/
  src/App.tsx             # dashboard
  src/components/
    SettingsDrawer.tsx    # project picker + working hours
    SchedulePreview.tsx   # day-grouped list with Free/Busy toggle
    StatusPill.tsx        # in-line Jira status changer
    Toast.tsx
config/
  settings.default.json   # defaults seeded into config/settings.json on first run
data/                     # SQLite database lives here (gitignored)
```

## Scripts

| Command           | What                                       |
| ----------------- | ------------------------------------------ |
| `npm run dev`     | Run server on `:4000` and Vite UI on `:5173` |
| `npm run build`   | Type-check the server and build the web bundle |
| `npm run typecheck` | Type-check both halves without emitting    |

## Notes & limits

- This app only writes to **your** primary calendar. It does not invite anyone else.
- Past calendar events that have already happened are left in place when a ticket is marked Done — only future blocks are removed.
- If a Jira transition needs a field (e.g. `resolution`), the API will reject it and the dashboard surfaces the verbatim Jira error in a toast.
