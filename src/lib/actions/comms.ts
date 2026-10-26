"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safe } from "@/lib/actions/util";
import { sendEmailToContact, sendSmsToContact, findContact } from "@/lib/comms";
import { chat, chatJson } from "@/lib/integrations/openrouter";
import { logActivity } from "@/lib/activity";
import { lastUsedLine, ourLines, resolveLine } from "@/lib/phone-lines";
import { DISPOSITION_VALUES, dispositionLabel } from "@/lib/dispositions";
import { fileContact, fileContactForOutcome } from "@/lib/folders";
import { recycleForOutcome } from "@/lib/recycle";
import { contactLabel, toE164 } from "@/lib/utils";
import type { Channel, Contact, Direction } from "@/lib/types";

async function userId() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

/** Ensures the signed-in user can see this contact (RLS) and returns it. */
async function visibleContact(contactId: string) {
  const sb = await createClient();
  const { data } = await sb.from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!data) throw new Error("Contact not found or not accessible");
  return data as Contact;
}

/** Our phone lines, the default, and (for a contact) the line we'd reply on. */
export async function phoneLinesAction(contactId?: string | null) {
  return safe(async () => {
    await userId();
    const { lines, defaultLine } = await ourLines();
    let suggested = defaultLine;
    if (contactId) {
      await visibleContact(contactId);
      suggested = (await lastUsedLine(contactId, lines)) ?? defaultLine;
    }
    return { lines, defaultLine, suggested };
  });
}

export async function sendSmsAction(contactId: string, text: string, from?: string | null) {
  return safe(async () => {
    const uid = await userId();
    await visibleContact(contactId);
    if (!text.trim()) throw new Error("Message is empty");
    const r = await sendSmsToContact(contactId, text, { userId: uid, from });
    if (!r.ok) throw new Error(r.error || "SMS failed");
    revalidatePath(`/contacts/${contactId}`);
    return { messageId: r.messageId };
  });
}

export async function sendEmailAction(contactId: string, subject: string, body: string) {
  return safe(async () => {
    const uid = await userId();
    await visibleContact(contactId);
    if (!subject.trim()) throw new Error("Subject is required");
    if (!body.trim()) throw new Error("Email body is empty");
    const r = await sendEmailToContact(contactId, subject, body, { userId: uid });
    if (!r.ok) throw new Error(r.error || "Email failed");
    revalidatePath(`/contacts/${contactId}`);
    return { messageId: r.messageId };
  });
}

async function conversationContext(contactId: string) {
  const sb = await createClient();
  const contact = await visibleContact(contactId);
  const [{ data: msgs }, { data: company }, { data: settings }, { data: me }] = await Promise.all([
    sb.from("messages").select("channel, direction, subject, body, created_at").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(12),
    contact.company_id ? sb.from("companies").select("name, industry, website").eq("id", contact.company_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("workspace_settings").select("name, default_calendly_url").eq("id", 1).single(),
    sb.from("profiles").select("full_name").eq("id", await userId()).single(),
  ]);
  const history = (msgs ?? []).reverse().map((m) =>
    `[${m.created_at.slice(0, 16)}] ${m.direction === "inbound" ? "THEM" : "US"} via ${m.channel}${m.subject ? ` (subject: ${m.subject})` : ""}: ${(m.body ?? "").slice(0, 600)}`,
  ).join("\n");
  return `Agency: ${settings?.name ?? "Ravenshaw AI"} (AI automation agency). Sender: ${me?.full_name ?? "the team"}. Booking link: ${settings?.default_calendly_url ?? "n/a"}.
Contact: ${contactLabel(contact)}, title: ${contact.title ?? "n/a"}, status: ${contact.status}, company: ${company?.name ?? "n/a"} ${company?.industry ? `(${company.industry})` : ""}, tags: ${contact.tags.join(", ") || "none"}.
AI notes on contact: ${contact.ai_summary ?? "none"}
Recent conversation:
${history || "(no prior messages)"}`;
}

/** Draft or improve an email with AI. */
export async function aiDraftEmailAction(input: { contactId: string; subject: string; body: string; instruction?: string }) {
  return safe(async () => {
    const ctx = await conversationContext(input.contactId);
    const task = input.body.trim()
      ? `Improve this draft email. Keep the intent, make it concise, warm and professional. ${input.instruction ?? ""}\nSubject: ${input.subject}\nBody:\n${input.body}`
      : `Write a new email to this contact. ${input.instruction || "Write a helpful follow-up that moves the conversation toward a booked call."}`;
    return chatJson<{ subject: string; body: string }>([
      { role: "system", content: "You write sales and client emails for an AI agency. Plain text body (no markdown), short paragraphs, sign off with the sender's first name. You may use merge tags like {{first_name}}. Respond with JSON: {\"subject\": string, \"body\": string}." },
      { role: "user", content: `${ctx}\n\nTask: ${task}` },
    ], { maxTokens: 900 });
  });
}

/** Draft or improve an SMS with AI. */
export async function aiDraftSmsAction(input: { contactId: string; text: string; instruction?: string }) {
  return safe(async () => {
    const ctx = await conversationContext(input.contactId);
    const task = input.text.trim()
      ? `Improve this SMS, keep it under 300 characters and conversational: ${input.text}`
      : `Write an SMS (under 300 characters, conversational, no emojis overload). ${input.instruction || "Reply appropriately to the latest message or follow up."}`;
    const text = await chat([
      { role: "system", content: "You write SMS messages for an AI agency's sales team. Output ONLY the message text, no quotes." },
      { role: "user", content: `${ctx}\n\nTask: ${task}` },
    ], { maxTokens: 200 });
    return { text: text.trim().replace(/^"|"$/g, "") };
  });
}

export async function saveTemplateAction(input: { channel: Channel; name: string; subject?: string | null; body: string }) {
  return safe(async () => {
    const uid = await userId();
    if (!input.name.trim() || !input.body.trim()) throw new Error("Name and body are required");
    const sb = await createClient();
    const { data, error } = await sb.from("templates").insert({
      channel: input.channel, name: input.name.trim(), subject: input.subject ?? null, body: input.body, created_by: uid,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return data;
  });
}

export async function markConversationReadAction(contactId: string) {
  return safe(async () => {
    const sb = await createClient();
    await sb.from("messages").update({ read_at: new Date().toISOString() })
      .eq("contact_id", contactId).eq("direction", "inbound").is("read_at", null);
    return null;
  });
}

// ───────────── Calls ─────────────

export async function lookupContactByPhoneAction(phone: string) {
  return safe(async () => {
    await userId();
    const c = await findContact({ phone });
    return c ? { id: c.id, name: contactLabel(c) } : null;
  });
}

/** Which of our lines a ringing inbound call from this number came in on (from the webhook's call row). */
export async function incomingLineAction(phone: string) {
  return safe(async () => {
    await userId();
    const from = toE164(phone);
    if (!from) return null;
    const { data } = await createAdminClient().from("calls").select("to_number").eq("direction", "inbound").eq("from_number", from)
      .gte("started_at", new Date(Date.now() - 2 * 60_000).toISOString()).order("started_at", { ascending: false }).limit(1).maybeSingle();
    return (data?.to_number as string | null) ?? null;
  });
}

/**
 * Logs a call. Outbound: `ourNumber` is an explicit line pick; without one we call from the line this contact
 * last used, else the default. Inbound: `ourNumber` is the line it rang on. Returns the line used.
 */
export async function logCallStartAction(input: { contactId?: string | null; phone: string; direction: Direction; telnyxCallId?: string | null; ourNumber?: string | null; dialSessionId?: string | null }) {
  return safe(async () => {
    const uid = await userId();
    const admin = createAdminClient();
    const number = toE164(input.phone) ?? input.phone;
    let contactId = input.contactId ?? null;
    if (!contactId) contactId = (await findContact({ phone: number }))?.id ?? null;

    // A webhook may already have created this call (inbound): claim it instead of duplicating.
    if (input.telnyxCallId) {
      const { data: existing } = await admin.from("calls").select("id, to_number").eq("telnyx_call_id", input.telnyxCallId).maybeSingle();
      if (existing) {
        await admin.from("calls").update({ user_id: uid, contact_id: contactId }).eq("id", existing.id);
        return { id: existing.id as string, contactId, ourNumber: (existing.to_number as string | null) ?? null };
      }
    }
    if (input.dialSessionId) {
      const { data: own } = await (await createClient()).from("dial_sessions").select("id").eq("id", input.dialSessionId).maybeSingle();
      if (!own) throw new Error("Dialing session not found");
    }
    const ours = input.direction === "outbound"
      ? await resolveLine({ requested: input.ourNumber, contactId })
      : toE164(input.ourNumber ?? null) ?? (await ourLines()).defaultLine;
    const { data, error } = await admin.from("calls").insert({
      contact_id: contactId, user_id: uid, direction: input.direction,
      from_number: input.direction === "outbound" ? ours : number,
      to_number: input.direction === "outbound" ? number : ours,
      status: input.direction === "outbound" ? "initiated" : "answered",
      telnyx_call_id: input.telnyxCallId ?? null,
      dial_session_id: input.dialSessionId ?? null,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: data.id as string, contactId, ourNumber: ours };
  });
}

export async function updateCallAction(id: string, patch: {
  status?: string; durationSec?: number; disposition?: string | null; notes?: string | null; telnyxCallId?: string | null; ended?: boolean;
  voicemailDropId?: string | null;
}) {
  return safe(async () => {
    const uid = await userId();
    const sb = await createClient();
    const { data: call } = await sb.from("calls").select("*").eq("id", id).maybeSingle();
    if (!call) throw new Error("Call not found");
    const upd: Record<string, unknown> = {};
    if (patch.status) upd.status = patch.status;
    if (patch.durationSec != null) upd.duration_sec = patch.durationSec;
    if (patch.disposition !== undefined) upd.disposition = patch.disposition;
    if (patch.notes !== undefined) upd.notes = patch.notes;
    if (patch.voicemailDropId) upd.voicemail_drop_id = patch.voicemailDropId;
    if (patch.telnyxCallId && !call.telnyx_call_id) upd.telnyx_call_id = patch.telnyxCallId;
    if (patch.ended && !call.ended_at) upd.ended_at = new Date().toISOString();
    if (patch.disposition && !DISPOSITION_VALUES.includes(patch.disposition)) throw new Error("Unknown call outcome");
    const admin = createAdminClient();
    await admin.from("calls").update(upd).eq("id", id);

    if (patch.ended && !call.ended_at && call.contact_id) {
      const mins = patch.durationSec ? `${Math.floor(patch.durationSec / 60)}m ${patch.durationSec % 60}s` : "not connected";
      await logActivity({
        type: "call", contact_id: call.contact_id, actor_id: uid,
        title: `${call.direction === "inbound" ? "Inbound" : "Outbound"} call · ${mins}`,
        metadata: { call_id: id, status: patch.status ?? call.status },
      });
      await admin.from("contacts").update({ last_contacted_at: new Date().toISOString() }).eq("id", call.contact_id);
      // A real conversation files them under Contacted (outcomes below can move them further).
      if ((patch.durationSec ?? 0) >= 15) await fileContact(call.contact_id, "contacted");
    }
    const outcomeChanged = !!patch.disposition && patch.disposition !== call.disposition;
    if ((outcomeChanged || patch.notes) && call.contact_id && !patch.ended) {
      await logActivity({
        type: "call", contact_id: call.contact_id, actor_id: uid,
        title: outcomeChanged ? `Call outcome: ${dispositionLabel(patch.disposition)}` : "Call notes",
        body: patch.notes ?? null, metadata: { call_id: id, disposition: patch.disposition ?? call.disposition },
      });
    }
    if (outcomeChanged && call.contact_id) await fileContactForOutcome(call.contact_id, patch.disposition!);
    // Power dialer: keep the lead list in step with the outcome.
    if (outcomeChanged && call.dial_session_id && call.contact_id) {
      const { data: sess } = await admin.from("dial_sessions").select("list_id").eq("id", call.dial_session_id).maybeSingle();
      if (sess?.list_id) {
        await admin.from("lead_list_items").update({ status: "called", last_outcome: patch.disposition, last_called_at: call.started_at })
          .eq("list_id", sess.list_id).eq("contact_id", call.contact_id);
      }
    }
    // After the session-list update above, so a Recycled-list session re-queues the lead.
    if (outcomeChanged && call.contact_id && call.direction === "outbound") await recycleForOutcome(call.contact_id, patch.disposition!, call.user_id ?? uid);
    if (outcomeChanged && patch.disposition === "bad_number" && call.contact_id) {
      await admin.from("contacts").update({ phone_bad: true, phone_bad_at: new Date().toISOString() }).eq("id", call.contact_id);
      await logActivity({ type: "system", contact_id: call.contact_id, actor_id: uid, title: "Phone number flagged as bad", metadata: { call_id: id } });
    }
    if (call.contact_id) revalidatePath(`/contacts/${call.contact_id}`);
    return null;
  });
}

export async function summarizeCallAction(id: string) {
  return safe(async () => {
    await userId();
    const sb = await createClient();
    const { data: call } = await sb.from("calls").select("*, contact:contacts(first_name,last_name,email)").eq("id", id).maybeSingle();
    if (!call) throw new Error("Call not found");
    const material = [call.transcript && `Transcript:\n${call.transcript}`, call.notes && `Rep notes:\n${call.notes}`].filter(Boolean).join("\n\n");
    if (!material) throw new Error("Add call notes (or a transcript) before summarizing");
    const summary = await chat([
      { role: "system", content: "Summarize this sales/client call for a CRM in 3-5 bullet points, then a line 'Next step: …'. Be specific and concise." },
      { role: "user", content: `Call with ${contactLabel(call.contact)} (${call.direction}, ${call.duration_sec ?? 0}s, disposition: ${call.disposition ?? "n/a"}).\n\n${material}` },
    ], { maxTokens: 400 });
    await createAdminClient().from("calls").update({ ai_summary: summary }).eq("id", id);
    return { summary };
  });
}
