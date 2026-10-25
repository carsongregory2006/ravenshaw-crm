import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTelnyxWebhook } from "@/lib/integrations/telnyx";
import { findContact } from "@/lib/comms";
import { logActivity, notify, notifyAdmins } from "@/lib/activity";
import { emitEvent } from "@/lib/events";
import { chat } from "@/lib/integrations/openrouter";
import { contactLabel, fmtPhone, lineLabel, toE164 } from "@/lib/utils";
import type { Contact } from "@/lib/types";

export const dynamic = "force-dynamic";

type Db = ReturnType<typeof createAdminClient>;
/* eslint-disable @typescript-eslint/no-explicit-any */

const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"];
const START_WORDS = ["start", "unstop", "yes"];

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyTelnyxWebhook(raw, req.headers)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  const data = body?.data ?? {};
  const type: string = data.event_type ?? "unknown";
  const p = data.payload ?? {};
  const db = createAdminClient();

  // Idempotency: Telnyx retries deliveries.
  const { data: evRow, error: dupErr } = await db.from("webhook_events")
    .insert({ provider: "telnyx", event_type: type, external_id: data.id ?? null, payload: body })
    .select("id").single();
  if (dupErr && dupErr.code === "23505") return NextResponse.json({ ok: true, duplicate: true });

  try {
    if (type === "message.received") await handleInboundSms(db, p);
    else if (type === "message.sent" || type === "message.finalized") await handleSmsStatus(db, p);
    else if (type.startsWith("call.")) await handleCallEvent(db, type, p);
    if (evRow) await db.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", evRow.id);
  } catch (e) {
    console.error("telnyx webhook", type, e);
    if (evRow) await db.from("webhook_events").update({ error: e instanceof Error ? e.message : String(e) }).eq("id", evRow.id);
  }
  return NextResponse.json({ ok: true });
}

async function findOrCreateContactByPhone(db: Db, phone: string, source: string): Promise<{ contact: Contact; created: boolean }> {
  const existing = await findContact({ phone });
  if (existing) return { contact: existing, created: false };
  const { data: rep } = await db.rpc("rr_next_rep", { p_page_id: null });
  const { data, error } = await db.from("contacts").insert({
    phone: toE164(phone), status: "lead", source, owner_id: (rep as string | null) ?? null, tags: ["inbound"],
  }).select("*").single();
  if (error) throw new Error(error.message);
  await logActivity({ type: "system", contact_id: data.id, title: `Lead created from ${source.replace("_", " ")}` });
  return { contact: data as Contact, created: true };
}

async function handleInboundSms(db: Db, p: any) {
  const from: string = p.from?.phone_number;
  const to: string = p.to?.[0]?.phone_number ?? null;
  const text: string = p.text ?? "";
  if (!from) return;
  const { contact, created } = await findOrCreateContactByPhone(db, from, "inbound_sms");

  const media = (p.media ?? []).map((m: any) => m.url).filter(Boolean);
  const bodyText = media.length ? `${text}${text ? "\n" : ""}${media.map((u: string) => `[media] ${u}`).join("\n")}` : text;

  await db.from("messages").insert({
    contact_id: contact.id, channel: "sms", direction: "inbound", from_addr: from, to_addr: to,
    body: bodyText, status: "received", provider_id: p.id ?? null,
  });

  const word = text.trim().toLowerCase();
  if (STOP_WORDS.includes(word)) {
    await db.from("contacts").update({ sms_opt_out: true }).eq("id", contact.id);
    await logActivity({ type: "system", contact_id: contact.id, title: "Opted out of SMS (STOP)" });
  } else if (START_WORDS.includes(word) && contact.sms_opt_out) {
    await db.from("contacts").update({ sms_opt_out: false }).eq("id", contact.id);
    await logActivity({ type: "system", contact_id: contact.id, title: "Re-subscribed to SMS (START)" });
  }

  await logActivity({ type: "sms", contact_id: contact.id, title: "SMS received", body: bodyText });
  const n = { title: `New text from ${contactLabel(contact) || fmtPhone(from)}${to ? ` to ${lineLabel(to)}` : ""}`, body: text.slice(0, 140), link: `/inbox?c=${contact.id}` };
  if (contact.owner_id) await notify([contact.owner_id], n); else await notifyAdmins(n);
  // inbound_sms first (it cancels stop-on-reply runs), then lead_created so a new texter's welcome flow isn't cancelled.
  await emitEvent({ type: "inbound_sms", contactId: contact.id, data: { message: text, new_contact: created } });
  if (created) await emitEvent({ type: "lead_created", contactId: contact.id, data: { source: "inbound_sms" } });
}

async function handleSmsStatus(db: Db, p: any) {
  if (!p.id) return;
  const recipient = p.to?.[0] ?? {};
  const s: string = recipient.status ?? p.status ?? "";
  let status: string | null = null;
  if (s === "delivered") status = "delivered";
  else if (s === "sent") status = "sent";
  else if (s.includes("failed")) status = "failed";
  if (!status) return;
  const err = (p.errors ?? []).map((e: any) => e.detail || e.title).filter(Boolean).join("; ") || null;
  const q = db.from("messages").update({ status, ...(status === "failed" ? { error: err } : {}) }).eq("provider_id", p.id);
  // never downgrade delivered → sent
  await (status === "sent" ? q.eq("status", "queued") : q);
}

function callIds(p: any): string[] {
  return [p.call_session_id, p.call_control_id, p.call_leg_id].filter(Boolean);
}

async function findCall(db: Db, p: any) {
  const ids = callIds(p);
  if (ids.length) {
    const { data } = await db.from("calls").select("*").in("telnyx_call_id", ids).limit(1).maybeSingle();
    if (data) return data;
  }
  // Fallback: a browser-dialed call logged without a Telnyx id in the last few minutes to the same number.
  const to = toE164(p.to);
  if (to) {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data } = await db.from("calls").select("*").is("telnyx_call_id", null).eq("to_number", to)
      .gte("started_at", since).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (data) {
      await db.from("calls").update({ telnyx_call_id: ids[0] ?? null }).eq("id", data.id);
      return data;
    }
  }
  return null;
}

async function handleCallEvent(db: Db, type: string, p: any) {
  const direction = p.direction === "incoming" ? "inbound" : "outbound";
  const call = await findCall(db, p);

  if (!call && (type === "call.initiated" || type === "call.answered")) {
    const other = direction === "inbound" ? p.from : p.to;
    const contact = other ? await findContact({ phone: other }) : null;
    const row = {
      contact_id: contact?.id ?? null, direction, from_number: toE164(p.from) ?? p.from ?? null, to_number: toE164(p.to) ?? p.to ?? null,
      status: type === "call.answered" ? "answered" : "ringing", telnyx_call_id: p.call_session_id ?? p.call_control_id ?? null,
      started_at: p.start_time ?? p.occurred_at ?? new Date().toISOString(), user_id: contact?.owner_id ?? null,
    };
    // Telnyx fires call.initiated for each leg of the same session at the same moment; the unique
    // telnyx_call_id index makes the losing insert a no-op instead of a second row stuck on "ringing".
    const { error } = await db.from("calls").upsert(row, { onConflict: "telnyx_call_id", ignoreDuplicates: true });
    if (error?.code === "42P10") await db.from("calls").insert(row); // unique index not migrated yet
    return;
  }
  if (!call) return;

  if (type === "call.answered") {
    await db.from("calls").update({ status: "answered" }).eq("id", call.id);
  } else if (type === "call.hangup") {
    if (call.ended_at && ["completed", "missed", "no_answer"].includes(call.status)) return; // browser already finalized
    const answered = call.status === "answered" || call.status === "completed";
    const status = answered ? "completed" : direction === "inbound" ? "missed" : "no_answer";
    const start = p.start_time ? new Date(p.start_time).getTime() : new Date(call.started_at).getTime();
    const end = p.end_time ? new Date(p.end_time).getTime() : Date.now();
    await db.from("calls").update({
      status, ended_at: new Date(end).toISOString(),
      duration_sec: answered ? Math.max(0, Math.round((end - start) / 1000)) : 0,
    }).eq("id", call.id);

    if (status === "missed") {
      const contact = call.contact_id ? (await db.from("contacts").select("*").eq("id", call.contact_id).maybeSingle()).data as Contact | null : null;
      const who = contact ? contactLabel(contact) : fmtPhone(call.from_number);
      const n = { title: `Missed call from ${who}`, body: `${fmtPhone(call.from_number)}${call.to_number ? ` · on ${lineLabel(call.to_number)}` : ""}`, link: contact ? `/contacts/${contact.id}` : "/inbox" };
      if (contact?.owner_id) await notify([contact.owner_id], n); else await notifyAdmins(n);
      await db.from("tasks").insert({
        title: `Return missed call from ${who}`, priority: "high", due_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        assignee_id: contact?.owner_id ?? null, contact_id: contact?.id ?? null,
      });
      if (contact) await logActivity({ type: "call", contact_id: contact.id, title: "Missed inbound call", metadata: { call_id: call.id } });
    }
  } else if (type === "call.recording.saved") {
    const url = p.public_recording_urls?.mp3 || p.recording_urls?.mp3 || p.public_recording_urls?.wav || p.recording_urls?.wav;
    if (url) await db.from("calls").update({ recording_url: url }).eq("id", call.id);
  } else if (type === "call.transcription") {
    const t = p.transcription_data?.transcript;
    if (t) {
      const transcript = `${call.transcript ? call.transcript + "\n" : ""}${t}`;
      await db.from("calls").update({ transcript }).eq("id", call.id);
    }
  }

  // Summarize once a transcript exists and the call is over.
  if ((type === "call.hangup" || type === "call.recording.saved") && process.env.OPENROUTER_API_KEY) {
    const { data: fresh } = await db.from("calls").select("transcript, ai_summary, ended_at").eq("id", call.id).single();
    if (fresh?.transcript && !fresh.ai_summary && fresh.ended_at) {
      try {
        const summary = await chat([
          { role: "system", content: "Summarize this sales/client call for a CRM in 3-5 bullet points, then 'Next step: …'." },
          { role: "user", content: fresh.transcript.slice(0, 20000) },
        ], { maxTokens: 400 });
        await db.from("calls").update({ ai_summary: summary }).eq("id", call.id);
      } catch (e) {
        console.error("call summary failed", e);
      }
    }
  }
}
