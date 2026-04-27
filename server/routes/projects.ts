import { Router } from "express";
import { db } from "../db.js";
import { listProjects } from "../services/jira.js";

export const projectsRouter = Router();

projectsRouter.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT key, name, avatar_url AS avatarUrl, refreshed_at AS refreshedAt FROM projects ORDER BY name")
    .all();
  res.json({ projects: rows });
});

projectsRouter.post("/refresh", async (_req, res) => {
  try {
    const projects = await listProjects();
    const tx = db.transaction((items: typeof projects) => {
      db.prepare("DELETE FROM projects").run();
      const stmt = db.prepare(
        `INSERT INTO projects (key, name, avatar_url) VALUES (@key, @name, @avatarUrl)`,
      );
      for (const p of items) stmt.run(p);
    });
    tx(projects);
    res.json({ projects, count: projects.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
