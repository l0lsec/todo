import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS msal_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    serialized TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS auth_state (
    state TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    home_account_id TEXT NOT NULL,
    username TEXT NOT NULL,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar_url TEXT,
    refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    jira_key TEXT PRIMARY KEY,
    project_key TEXT,
    summary TEXT,
    graph_event_id TEXT NOT NULL,
    start_utc TEXT NOT NULL,
    end_utc TEXT NOT NULL,
    show_as TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'scheduled',
    last_jira_status TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export type AccountRow = {
  home_account_id: string;
  username: string;
  name: string | null;
};

export type EventRow = {
  jira_key: string;
  project_key: string | null;
  summary: string | null;
  graph_event_id: string;
  start_utc: string;
  end_utc: string;
  show_as: "free" | "busy";
  status: "scheduled" | "completed" | "stale";
  last_jira_status: string | null;
  updated_at: string;
};
