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

/** Short-lived JWT for the browser WebRTC client (@telnyx/webrtc login_token). */
export async function createWebRtcToken(): Promise<string> {
  const credId = need("TELNYX_CREDENTIAL_ID", "Telnyx Voice");
  return telnyx<string>(`/telephony_credentials/${credId}/token`, { method: "POST" });
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
