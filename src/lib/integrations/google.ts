import "server-only";
import { need } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/utils";

const SCOPES = ["https://www.googleapis.com/auth/calendar", "openid", "email"];
export const googleRedirectUri = () => appUrl("/api/integrations/google/callback");

export function googleAuthUrl(state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", need("GOOGLE_CLIENT_ID", "Google Calendar"));
  u.searchParams.set("redirect_uri", googleRedirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeCode(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: need("GOOGLE_CLIENT_ID", "Google Calendar"),
      client_secret: need("GOOGLE_CLIENT_SECRET", "Google Calendar"),
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }>;
}

/** Returns a valid access token for the user, refreshing if needed. */
export async function getAccessToken(userId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data: acct } = await db.from("google_accounts").select("*").eq("user_id", userId).maybeSingle();
  if (!acct?.refresh_token) return null;
  if (acct.access_token && acct.expires_at && new Date(acct.expires_at).getTime() > Date.now() + 60_000) return acct.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: need("GOOGLE_CLIENT_ID", "Google Calendar"),
      client_secret: need("GOOGLE_CLIENT_SECRET", "Google Calendar"),
      refresh_token: acct.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const tok = await res.json();
  await db.from("google_accounts").update({
    access_token: tok.access_token,
    expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
  }).eq("user_id", userId);
  return tok.access_token;
}

export async function gcal<T = any>(userId: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken(userId);
  if (!token) throw new Error("Google Calendar not connected");
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (res.status === 204) return {} as T;
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Google Calendar ${res.status}: ${text}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : ({} as T);
}

export interface GEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  recurrence?: string[];
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  colorId?: string;
}

export const listCalendarList = (userId: string) =>
  gcal<{ items: { id: string; summary: string; backgroundColor?: string; primary?: boolean }[] }>(userId, "/users/me/calendarList");

/** Incremental sync. Pass syncToken from the last call; on 410 the caller should do a full sync. */
export async function listEvents(userId: string, calendarId: string, opts: { syncToken?: string | null; timeMin?: string }) {
  const items: GEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const qs = new URLSearchParams({ maxResults: "250", singleEvents: "true" });
    if (opts.syncToken) qs.set("syncToken", opts.syncToken);
    else if (opts.timeMin) qs.set("timeMin", opts.timeMin);
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await gcal<{ items: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
      userId, `/calendars/${encodeURIComponent(calendarId)}/events?${qs}`);
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    nextSyncToken = data.nextSyncToken ?? nextSyncToken;
  } while (pageToken);
  return { items, nextSyncToken };
}

export const insertEvent = (userId: string, calendarId: string, ev: Partial<GEvent>) =>
  gcal<GEvent>(userId, `/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", body: JSON.stringify(ev) });
export const patchEvent = (userId: string, calendarId: string, id: string, ev: Partial<GEvent>) =>
  gcal<GEvent>(userId, `/calendars/${encodeURIComponent(calendarId)}/events/${id}`, { method: "PATCH", body: JSON.stringify(ev) });
export const deleteEvent = (userId: string, calendarId: string, id: string) =>
  gcal(userId, `/calendars/${encodeURIComponent(calendarId)}/events/${id}`, { method: "DELETE" });
