import "server-only";
import crypto from "node:crypto";
import { need } from "@/lib/env";

const API = "https://api.calendly.com";

async function calendly<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = need("CALENDLY_API_TOKEN", "Calendly");
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Calendly ${res.status}: ${text}`);
  return text ? JSON.parse(text) : ({} as T);
}

export async function getMe() {
  const data = await calendly<{ resource: { uri: string; name: string; email: string; current_organization: string; scheduling_url: string } }>("/users/me");
  return data.resource;
}

export async function listEventTypes() {
  const me = await getMe();
  const data = await calendly<{ collection: { uri: string; name: string; scheduling_url: string; duration: number; active: boolean }[] }>(
    `/event_types?user=${encodeURIComponent(me.uri)}&count=100`,
  );
  return data.collection;
}

export async function listScheduledEvents(params: { minStart?: string; maxStart?: string } = {}) {
  const me = await getMe();
  const qs = new URLSearchParams({ user: me.uri, count: "100", status: "active" });
  if (params.minStart) qs.set("min_start_time", params.minStart);
  if (params.maxStart) qs.set("max_start_time", params.maxStart);
  const data = await calendly<{ collection: any[] }>(`/scheduled_events?${qs}`);
  return data.collection;
}

export async function listInvitees(eventUri: string) {
  const data = await calendly<{ collection: any[] }>(`${eventUri}/invitees?count=100`);
  return data.collection;
}

export async function getResource(uri: string) {
  return (await calendly<{ resource: any }>(uri)).resource;
}

/** Subscribe the org to booking webhooks pointing at our app. */
export async function createWebhookSubscription(callbackUrl: string) {
  const me = await getMe();
  return calendly("/webhook_subscriptions", {
    method: "POST",
    body: JSON.stringify({
      url: callbackUrl,
      events: ["invitee.created", "invitee.canceled", "invitee_no_show.created"],
      organization: me.current_organization,
      user: me.uri,
      scope: "user",
      signing_key: process.env.CALENDLY_WEBHOOK_SIGNING_KEY || undefined,
    }),
  });
}

export async function listWebhookSubscriptions() {
  const me = await getMe();
  const data = await calendly<{ collection: any[] }>(
    `/webhook_subscriptions?organization=${encodeURIComponent(me.current_organization)}&user=${encodeURIComponent(me.uri)}&scope=user`,
  );
  return data.collection;
}

/** Calendly-Webhook-Signature: t=<ts>,v1=<hmac_sha256(t.body)> */
export function verifyCalendlyWebhook(rawBody: string, headers: Headers): boolean {
  const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!key) return true;
  const header = headers.get("calendly-webhook-signature");
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac("sha256", key).update(`${parts.t}.${rawBody}`).digest("hex");
  return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

/** Build a prefilled Calendly link for a contact. */
export function prefilledLink(baseUrl: string, c: { name?: string; email?: string | null; phone?: string | null }, utm: Record<string, string> = {}) {
  const u = new URL(baseUrl);
  if (c.name) u.searchParams.set("name", c.name);
  if (c.email) u.searchParams.set("email", c.email);
  if (c.phone) u.searchParams.set("a1", c.phone);
  for (const [k, v] of Object.entries(utm)) u.searchParams.set(k, v);
  return u.toString();
}
