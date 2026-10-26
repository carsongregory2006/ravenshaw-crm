import "server-only";
import crypto from "node:crypto";
import { need } from "@/lib/env";

const API = "https://api.telnyx.com/v2";

async function telnyx<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const key = need("TELNYX_API_KEY", "Telnyx");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Telnyx ${res.status}: ${text}`);
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

export async function sendSms(input: { to: string; text: string; from?: string; mediaUrls?: string[] }) {
  need("TELNYX_API_KEY", "Telnyx");
  const from = input.from || process.env.TELNYX_FROM_NUMBER;
  if (!from) throw new Error("No SMS from-number. Set TELNYX_FROM_NUMBER or Settings → SMS from number.");
  const data = await telnyx<{ data: { id: string } }>("/messages", {
    method: "POST",
    body: JSON.stringify({
      from,
      to: input.to,
      text: input.text,
      media_urls: input.mediaUrls,
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID || undefined,
      webhook_url: process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/telnyx` : undefined,
    }),
  });
  return { id: data.data.id };
}

/** Active phone numbers on the Telnyx account (E.164). */
export async function listTelnyxNumbers(): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await telnyx<{ data: { phone_number: string; status: string }[]; meta?: { total_pages?: number } }>(
      `/phone_numbers?page[number]=${page}&page[size]=250&filter[status]=active`,
    );
    out.push(...r.data.map((n) => n.phone_number));
    if (!r.meta?.total_pages || page >= r.meta.total_pages) break;
  }
  return out;
}

const CREDENTIAL_KV_KEY = "telnyx_telephony_credential";

/**
 * Telephony credential used to mint browser dialer tokens. Uses TELNYX_CREDENTIAL_ID if set; otherwise
 * creates one on the TELNYX_CONNECTION_ID connection the first time it's needed and stores its id in app_kv.
 */
async function telephonyCredentialId(opts: { forceNew?: boolean } = {}): Promise<string> {
  if (process.env.TELNYX_CREDENTIAL_ID && !opts.forceNew) return process.env.TELNYX_CREDENTIAL_ID;
  const connectionId = need("TELNYX_CONNECTION_ID", "Telnyx Voice");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  if (!opts.forceNew) {
    const { data } = await db.from("app_kv").select("value").eq("key", CREDENTIAL_KV_KEY).maybeSingle();
    const stored = data?.value as { id?: string; connection_id?: string } | undefined;
    if (stored?.id && stored.connection_id === connectionId) return stored.id;
  }

  const created = await telnyx<{ data: { id: string } }>("/telephony_credentials", {
    method: "POST",
    body: JSON.stringify({ connection_id: connectionId, name: "ravenshaw-crm-dialer" }),
  });
  await db.from("app_kv").upsert({
    key: CREDENTIAL_KV_KEY,
    value: { id: created.data.id, connection_id: connectionId },
    updated_at: new Date().toISOString(),
  });
  return created.data.id;
}

/** Short-lived JWT for the browser WebRTC client (@telnyx/webrtc login_token). */
export async function createWebRtcToken(): Promise<string> {
  const credId = await telephonyCredentialId();
  try {
    return await telnyx<string>(`/telephony_credentials/${credId}/token`, { method: "POST" });
  } catch (e) {
    // A stored credential that was deleted/expired in Telnyx: mint a fresh one once.
    if (process.env.TELNYX_CREDENTIAL_ID || !/Telnyx (404|410|422)/.test(String(e))) throw e;
    const fresh = await telephonyCredentialId({ forceNew: true });
    return telnyx<string>(`/telephony_credentials/${fresh}/token`, { method: "POST" });
  }
}

// ───────────── Call Control (inbound routing + voicemail) ─────────────

/** Run a Call Control command on a live call leg. */
export async function callAction(callControlId: string, action: string, body: Record<string, unknown> = {}) {
  return telnyx(`/calls/${encodeURIComponent(callControlId)}/actions/${action}`, { method: "POST", body: JSON.stringify(body) });
}

/** Place a new call leg from a Call Control application. */
export async function dialCall(body: Record<string, unknown>) {
  return telnyx<{ data: { call_control_id: string; call_session_id: string } }>("/calls", { method: "POST", body: JSON.stringify(body) });
}

export const encodeState = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o)).toString("base64");
export function decodeState(s?: string | null): Record<string, string> | null {
  if (!s) return null;
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); } catch { return null; }
}

/** SIP address that rings the browser dialer (our telephony credential). */
export async function browserSipUri() {
  const id = await telephonyCredentialId();
  const r = await telnyx<{ data: { sip_username: string } }>(`/telephony_credentials/${id}`);
  return `sip:${r.data.sip_username}@sip.telnyx.com`;
}

export async function getCredentialConnection(id: string) {
  return telnyx<{ data: { id: string; outbound?: { outbound_voice_profile_id?: string | null } } }>(`/credential_connections/${id}`);
}

export async function createCallControlApp(input: { name: string; webhookUrl: string; outboundVoiceProfileId?: string | null }) {
  return telnyx<{ data: { id: string } }>("/call_control_applications", {
    method: "POST",
    body: JSON.stringify({
      application_name: input.name, webhook_event_url: input.webhookUrl, webhook_api_version: "2", active: true,
      anchorsite_override: "Latency", ...(input.outboundVoiceProfileId ? { outbound: { outbound_voice_profile_id: input.outboundVoiceProfileId } } : {}),
    }),
  });
}

export async function listNumberRouting() {
  const r = await telnyx<{ data: { id: string; phone_number: string; connection_id: string | null }[] }>("/phone_numbers?page[size]=250&filter[status]=active");
  return r.data;
}

export async function setNumberConnection(numberId: string, connectionId: string) {
  return telnyx(`/phone_numbers/${numberId}`, { method: "PATCH", body: JSON.stringify({ connection_id: connectionId }) });
}

/** Verify Telnyx webhook (ed25519). Public key from Telnyx portal → Keys & Credentials → Public Key. */
export function verifyTelnyxWebhook(rawBody: string, headers: Headers): boolean {
  const pub = process.env.TELNYX_PUBLIC_KEY;
  if (!pub) return true;
  const sig = headers.get("telnyx-signature-ed25519");
  const ts = headers.get("telnyx-timestamp");
  if (!sig || !ts) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(`${ts}|${rawBody}`), key, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}
