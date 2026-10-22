import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyResendWebhook, getReceivedEmail } from "@/lib/integrations/resend";
import { findContact } from "@/lib/comms";
import { logActivity, notify, notifyAdmins } from "@/lib/activity";
import { emitEvent } from "@/lib/events";
import { contactLabel } from "@/lib/utils";
import type { Contact } from "@/lib/types";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Higher rank wins; terminal failure states always win.
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, opened: 3, clicked: 4 };
const STATUS_FOR: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "bounced",
  "email.failed": "failed",
  "email.delivery_delayed": "",
};

function parseAddress(v: unknown): { email: string | null; name: string | null } {
  const s = Array.isArray(v) ? String(v[0] ?? "") : typeof v === "object" && v ? String((v as any).email ?? "") : String(v ?? "");
  const m = s.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: s.trim().toLowerCase() || null };
}

/** Drop quoted reply history so the inbox shows just the new text. */
function stripQuoted(text: string) {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^On .+wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From: /.test(l.trim()));
  return (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith(">")).join("\n").trim();
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyResendWebhook(raw, req.headers)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  const type: string = body?.type ?? "unknown";
  const d = body?.data ?? {};
  const db = createAdminClient();

  const { data: evRow, error: dupErr } = await db.from("webhook_events")
    .insert({ provider: "resend", event_type: type, external_id: req.headers.get("svix-id"), payload: body })
    .select("id").single();
  if (dupErr && dupErr.code === "23505") return NextResponse.json({ ok: true, duplicate: true });

  try {
    if (type === "email.received") await handleInbound(db, d);
    else if (type in STATUS_FOR) await handleStatus(db, type, d);
    if (evRow) await db.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", evRow.id);
  } catch (e) {
    console.error("resend webhook", type, e);
    if (evRow) await db.from("webhook_events").update({ error: e instanceof Error ? e.message : String(e) }).eq("id", evRow.id);
  }
  return NextResponse.json({ ok: true });
}

async function handleStatus(db: ReturnType<typeof createAdminClient>, type: string, d: any) {
  const status = STATUS_FOR[type];
  const id = d.email_id;
  if (!status || !id) return;
  const { data: msg } = await db.from("messages").select("id, status, contact_id").eq("provider_id", id).maybeSingle();
  if (!msg) return;
  const terminal = status === "bounced" || status === "failed";
  if (!terminal && (RANK[status] ?? 0) <= (RANK[msg.status] ?? -1)) return;
  if (!terminal && (msg.status === "bounced" || msg.status === "failed")) return;
  await db.from("messages").update({
    status,
    ...(terminal ? { error: d.bounce?.message ?? (type === "email.complained" ? "Marked as spam" : d.failed?.reason ?? null) } : {}),
  }).eq("id", msg.id);

  if (msg.contact_id) {
    if (type === "email.complained") {
      await db.from("contacts").update({ email_opt_out: true }).eq("id", msg.contact_id);
      await logActivity({ type: "system", contact_id: msg.contact_id, title: "Marked email as spam — unsubscribed from email" });
    } else if (type === "email.bounced") {
      await logActivity({ type: "email", contact_id: msg.contact_id, title: "Email bounced", body: d.bounce?.message ?? null });
    } else if (type === "email.opened" && msg.status !== "opened") {
      await logActivity({ type: "email", contact_id: msg.contact_id, title: `Email opened: ${d.subject ?? ""}`.trim() });
    }
  }
}

async function handleInbound(db: ReturnType<typeof createAdminClient>, d: any) {
  const from = parseAddress(d.from);
  if (!from.email) return;
  const to = parseAddress(d.to).email;
  let text: string = d.text ?? "";
  let html: string | null = d.html ?? null;
  if (!text && !html && d.email_id) {
    const full = await getReceivedEmail(d.email_id);
    text = full?.text ?? "";
    html = full?.html ?? null;
  }
  if (!text && html) text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  const clean = stripQuoted(text) || text;

  let contact = await findContact({ email: from.email });
  let created = false;
  if (!contact) {
    const [first, ...rest] = (from.name ?? "").split(" ");
    const { data: rep } = await db.rpc("rr_next_rep", { p_page_id: null });
    const { data, error } = await db.from("contacts").insert({
      email: from.email, first_name: first || null, last_name: rest.join(" ") || null,
      status: "lead", source: "inbound_email", owner_id: (rep as string | null) ?? null, tags: ["inbound"],
    }).select("*").single();
    if (error) throw new Error(error.message);
    contact = data as Contact;
    created = true;
    await logActivity({ type: "system", contact_id: contact.id, title: "Lead created from inbound email" });
  }

  await db.from("messages").insert({
    contact_id: contact.id, channel: "email", direction: "inbound", from_addr: from.email, to_addr: to,
    subject: d.subject ?? "(no subject)", body: clean, html, status: "received", provider_id: d.email_id ?? null,
  });
  await logActivity({ type: "email", contact_id: contact.id, title: `Email received: ${d.subject ?? "(no subject)"}`, body: clean.slice(0, 2000) });
  const n = { title: `New email from ${contactLabel(contact)}`, body: d.subject ?? clean.slice(0, 120), link: `/inbox?c=${contact.id}` };
  if (contact.owner_id) await notify([contact.owner_id], n); else await notifyAdmins(n);

  await emitEvent({ type: "inbound_email", contactId: contact.id, data: { message: `${d.subject ?? ""}\n${clean}`, new_contact: created } });
  if (created) await emitEvent({ type: "lead_created", contactId: contact.id, data: { source: "inbound_email" } });
}
