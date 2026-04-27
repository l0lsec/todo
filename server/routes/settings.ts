import { Router } from "express";
import { readSettings, writeSettings, SettingsSchema } from "../settings.js";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(readSettings());
});

settingsRouter.put("/", (req, res) => {
  try {
    const partial = SettingsSchema.partial().parse(req.body ?? {});
    const next = writeSettings(partial);
    res.json(next);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
