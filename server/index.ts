import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { settingsRouter } from "./routes/settings.js";
import { syncRouter, runRescheduleSweep } from "./routes/sync.js";
import { ticketsRouter } from "./routes/tickets.js";
import { readSettings } from "./settings.js";
import { db } from "./db.js";
import { isSignedIn } from "./auth/msal.js";

const app = express();
const port = Number(process.env.PORT) || 4000;
const webOrigin = process.env.WEB_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: webOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    signedIn: isSignedIn(),
    settingsConfigured: readSettings().selectedProjectKeys.length > 0,
    jiraConfigured: !!(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_TOKEN),
    msConfigured: !!(process.env.MS_CLIENT_ID && process.env.MS_TENANT_ID),
  });
});

app.use("/auth", authRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/sync", syncRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[server]", err);
  res.status(500).json({ error: err.message ?? "Internal error" });
});

const settings = readSettings();
if (cron.validate(settings.cronSchedule)) {
  cron.schedule(
    settings.cronSchedule,
    async () => {
      if (!isSignedIn()) return;
      try {
        const result = await runRescheduleSweep();
        console.log("[cron] reschedule sweep", result);
      } catch (err) {
        console.error("[cron] reschedule sweep failed", err);
      }
    },
    { timezone: settings.timezone },
  );
  console.log(
    `[server] cron registered: "${settings.cronSchedule}" (${settings.timezone})`,
  );
} else {
  console.warn(`[server] invalid cronSchedule "${settings.cronSchedule}"`);
}

app.listen(port, () => {
  console.log(`[server] http://localhost:${port}`);
  console.log(`[server] sqlite: ${db.name}`);
});
