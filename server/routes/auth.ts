import { Router } from "express";
import { randomBytes } from "node:crypto";
import { msalApp, msalScopes, redirectUri, saveAccount, getAccountRow } from "../auth/msal.js";
import { db } from "../db.js";

export const authRouter = Router();

authRouter.get("/login", async (_req, res) => {
  try {
    const state = randomBytes(16).toString("hex");
    db.prepare("INSERT INTO auth_state (state) VALUES (?)").run(state);
    const url = await msalApp.getAuthCodeUrl({
      scopes: msalScopes,
      redirectUri: redirectUri(),
      state,
      prompt: "select_account",
    });
    res.redirect(url);
  } catch (err: any) {
    res.status(500).send(`Auth init failed: ${err.message}`);
  }
});

authRouter.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query as Record<string, string | undefined>;
    if (!code || !state) {
      res.status(400).send("Missing code or state");
      return;
    }
    const row = db
      .prepare("DELETE FROM auth_state WHERE state = ? RETURNING state")
      .get(state) as { state: string } | undefined;
    if (!row) {
      res.status(400).send("Invalid state");
      return;
    }
    const result = await msalApp.acquireTokenByCode({
      code,
      scopes: msalScopes,
      redirectUri: redirectUri(),
    });
    saveAccount(result);
    const origin = process.env.WEB_ORIGIN || "http://localhost:5173";
    res.redirect(`${origin}/?signed_in=1`);
  } catch (err: any) {
    res.status(500).send(`Auth callback failed: ${err.message}`);
  }
});

authRouter.post("/logout", (_req, res) => {
  db.prepare("DELETE FROM account WHERE id = 1").run();
  db.prepare("DELETE FROM msal_cache WHERE id = 1").run();
  res.json({ ok: true });
});

authRouter.get("/me", (_req, res) => {
  const row = getAccountRow();
  if (!row) {
    res.json({ signedIn: false });
    return;
  }
  res.json({ signedIn: true, username: row.username, name: row.name });
});
