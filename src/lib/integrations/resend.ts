import "server-only";
import crypto from "node:crypto";
import { need } from "@/lib/env";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;          // "Name <addr@domain>"
  replyTo?: string;
  cc?: string[];
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const key = need("RESEND_API_KEY", "Resend");
  const from = input.from || process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("No sender address. Set RESEND_FROM_EMAIL or Settings → Email from address.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      cc: input.cc,
      reply_to: input.replyTo || process.env.RESEND_REPLY_TO || undefined,
      headers: input.headers,
      tags: input.tags,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data?.message ?? JSON.stringify(data)}`);
  return { id: data.id };
}

/** Fetch a received (inbound) email's full content. */
export async function getReceivedEmail(id: string) {
  const key = need("RESEND_API_KEY", "Resend");
  const res = await fetch(`https://api.resend.com/emails/receiving/${id}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  return res.json();
}

/** Verify a Resend (Svix) webhook signature. */
export function verifyResendWebhook(rawBody: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true; // not configured: accept (documented in Settings)
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 10) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return sigHeader.split(" ").some((part) => {
    const sig = part.split(",")[1];
    return sig && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}

/** Minimal branded HTML wrapper for plain-text bodies. */
export function emailHtml(body: string, opts: { brand?: string } = {}) {
  const escaped = body
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1961ED">$1</a>')
    .replace(/\n/g, "<br/>");
  return `<!doctype html><html><body style="margin:0;background:#f6f6f6;font-family:Inter,Arial,sans-serif;color:#333">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;font-size:15px;line-height:1.6">${escaped}
<p style="margin-top:32px;font-size:12px;color:#999">${opts.brand ?? "Ravenshaw AI"}</p></div></body></html>`;
}
