import {
  ConfidentialClientApplication,
  PublicClientApplication,
  type AuthenticationResult,
  type ICachePlugin,
  type TokenCacheContext,
} from "@azure/msal-node";
import "isomorphic-fetch";
import { db, type AccountRow } from "../db.js";

const SCOPES = ["Calendars.ReadWrite", "User.Read", "offline_access"];

const tenantId = process.env.MS_TENANT_ID || "common";
const clientId = process.env.MS_CLIENT_ID || "";
const clientSecret = process.env.MS_CLIENT_SECRET || "";

if (!clientId) {
  console.warn(
    "[msal] MS_CLIENT_ID is not set; Microsoft sign-in will fail until you configure .env",
  );
}

const cachePlugin: ICachePlugin = {
  async beforeCacheAccess(ctx: TokenCacheContext) {
    const row = db
      .prepare("SELECT serialized FROM msal_cache WHERE id = 1")
      .get() as { serialized: string } | undefined;
    if (row?.serialized) ctx.tokenCache.deserialize(row.serialized);
  },
  async afterCacheAccess(ctx: TokenCacheContext) {
    if (ctx.cacheHasChanged) {
      const serialized = ctx.tokenCache.serialize();
      db.prepare(
        `INSERT INTO msal_cache (id, serialized, updated_at)
         VALUES (1, @serialized, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET serialized = excluded.serialized, updated_at = excluded.updated_at`,
      ).run({ serialized });
    }
  },
};

const baseAuthority = `https://login.microsoftonline.com/${tenantId}`;

export const msalApp = clientSecret
  ? new ConfidentialClientApplication({
      auth: { clientId, authority: baseAuthority, clientSecret },
      cache: { cachePlugin },
    })
  : new PublicClientApplication({
      auth: { clientId, authority: baseAuthority },
      cache: { cachePlugin },
    });

export const msalScopes = SCOPES;

export function redirectUri(): string {
  const port = process.env.PORT || "4000";
  return `http://localhost:${port}/auth/callback`;
}

export function saveAccount(result: AuthenticationResult): void {
  if (!result.account) return;
  db.prepare(
    `INSERT INTO account (id, home_account_id, username, name)
     VALUES (1, @home, @user, @name)
     ON CONFLICT(id) DO UPDATE SET home_account_id=excluded.home_account_id, username=excluded.username, name=excluded.name`,
  ).run({
    home: result.account.homeAccountId,
    user: result.account.username,
    name: result.account.name ?? null,
  });
}

export function getAccountRow(): AccountRow | undefined {
  return db
    .prepare("SELECT home_account_id, username, name FROM account WHERE id = 1")
    .get() as AccountRow | undefined;
}

export async function acquireAccessToken(): Promise<string> {
  const row = getAccountRow();
  if (!row) {
    throw new Error("Not signed in to Microsoft. Visit /auth/login first.");
  }
  const cache = msalApp.getTokenCache();
  const account = await cache.getAccountByHomeId(row.home_account_id);
  if (!account) {
    throw new Error("Microsoft account session expired. Please sign in again.");
  }
  const result = await msalApp.acquireTokenSilent({ account, scopes: SCOPES });
  if (!result?.accessToken) {
    throw new Error("Could not acquire Microsoft access token.");
  }
  return result.accessToken;
}

export function isSignedIn(): boolean {
  return !!getAccountRow();
}
