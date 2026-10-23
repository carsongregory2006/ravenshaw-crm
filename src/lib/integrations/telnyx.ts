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
