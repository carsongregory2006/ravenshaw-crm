import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/integrations/telnyx";
import { sendEmail, emailHtml } from "@/lib/integrations/resend";
import { resolveLine } from "@/lib/phone-lines";
import { contactLabel, renderTemplate, toE164 } from "@/lib/utils";
import type { Contact, WorkspaceSettings } from "@/lib/types";

async function loadContext(contactId: string) {
  const db = createAdminClient();
  const [{ data: contact }, { data: settings }] = await Promise.all([
    db.from("contacts").select("*, company:companies(name), owner:profiles!contacts_owner_id_fkey(full_name,email,phone)").eq("id", contactId).single(),
    db.from("workspace_settings").select("*").eq("id", 1).single(),
  ]);
  if (!contact) throw new Error("Contact not found");
  return { db, contact: contact as Contact & { company?: { name: string } | null; owner?: { full_name: string; email: string; phone: string } | null }, settings: settings as WorkspaceSettings };
}

/** Merge vars available to every SMS/email template. */
export function mergeVars(contact: Contact & { company?: { name: string } | null; owner?: { full_name: string; email: string } | null }, settings?: Partial<WorkspaceSettings> | null, extra: Record<string, unknown> = {}) {
  return {
    first_name: contact.first_name ?? "",
    last_name: contact.last_name ?? "",
    full_name: contactLabel(contact),
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    company: contact.company?.name ?? "",
    rep_name: contact.owner?.full_name ?? settings?.email_from_name ?? "",
    rep_email: contact.owner?.email ?? "",
    agency_name: settings?.name ?? "Ravenshaw AI",
    booking_link: settings?.default_calendly_url ?? "",
    ...extra,
  };
}

export interface SendResult { ok: boolean; messageId?: string; error?: string }

export async function sendSmsToContact(contactId: string, text: string, opts: { userId?: string | null; automationRunId?: string | null; vars?: Record<string, unknown>; from?: string | null } = {}): Promise<SendResult> {
  const { db, contact, settings } = await loadContext(contactId);
  const to = toE164(contact.phone);
  if (!to) return { ok: false, error: "Contact has no phone number" };
  if (contact.do_not_contact || contact.sms_opt_out) return { ok: false, error: "Contact opted out of SMS" };
  const body = renderTemplate(text, mergeVars(contact, settings, opts.vars));
  // Explicit pick, else the number this contact last used, else the default line.
  const from = await resolveLine({ requested: opts.from, contactId });
  const { data: msg } = await db.from("messages").insert({
    contact_id: contactId, channel: "sms", direction: "outbound", from_addr: from, to_addr: to, body,
    status: "queued", sent_by: opts.userId ?? null, automation_run_id: opts.automationRunId ?? null,
  }).select("id").single();
  try {
    const r = await sendSms({ to, text: body, from: from ?? undefined });
    await db.from("messages").update({ status: "sent", provider_id: r.id }).eq("id", msg!.id);
    await db.from("contacts").update({ last_contacted_at: new Date().toISOString() }).eq("id", contactId);
    await db.from("activities").insert({ type: "sms", contact_id: contactId, title: "SMS sent", body, actor_id: opts.userId ?? null, metadata: { message_id: msg!.id, automation_run_id: opts.automationRunId } });
    return { ok: true, messageId: msg!.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.from("messages").update({ status: "failed", error }).eq("id", msg!.id);
    return { ok: false, messageId: msg!.id, error };
  }
}

export async function sendEmailToContact(contactId: string, subject: string, body: string, opts: { userId?: string | null; automationRunId?: string | null; html?: string; vars?: Record<string, unknown> } = {}): Promise<SendResult> {
  const { db, contact, settings } = await loadContext(contactId);
  if (!contact.email) return { ok: false, error: "Contact has no email" };
  if (contact.do_not_contact || contact.email_opt_out) return { ok: false, error: "Contact opted out of email" };
  const vars = mergeVars(contact, settings, opts.vars);
  const subj = renderTemplate(subject, vars);
  const text = renderTemplate(body, vars);
  const html = opts.html ? renderTemplate(opts.html, vars) : emailHtml(text, { brand: settings?.name });
  const fromAddr = settings?.email_from_address || process.env.RESEND_FROM_EMAIL;
  const from = fromAddr ? (fromAddr.includes("<") ? fromAddr : `${settings?.email_from_name || settings?.name || "Ravenshaw AI"} <${fromAddr}>`) : undefined;
  const { data: msg } = await db.from("messages").insert({
    contact_id: contactId, channel: "email", direction: "outbound", from_addr: from ?? null, to_addr: contact.email,
    subject: subj, body: text, html, status: "queued", sent_by: opts.userId ?? null, automation_run_id: opts.automationRunId ?? null,
  }).select("id").single();
  try {
    const r = await sendEmail({ to: contact.email, subject: subj, html, text, from, replyTo: contact.owner?.email || undefined, tags: [{ name: "message_id", value: msg!.id }] });
    await db.from("messages").update({ status: "sent", provider_id: r.id }).eq("id", msg!.id);
    await db.from("contacts").update({ last_contacted_at: new Date().toISOString() }).eq("id", contactId);
    await db.from("activities").insert({ type: "email", contact_id: contactId, title: `Email sent: ${subj}`, body: text, actor_id: opts.userId ?? null, metadata: { message_id: msg!.id, automation_run_id: opts.automationRunId } });
    return { ok: true, messageId: msg!.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.from("messages").update({ status: "failed", error }).eq("id", msg!.id);
    return { ok: false, messageId: msg!.id, error };
  }
}

/** Find a contact by phone (E.164 or loose digits) or email. */
export async function findContact(by: { phone?: string | null; email?: string | null }) {
  const db = createAdminClient();
  if (by.email) {
    const { data } = await db.from("contacts").select("*").ilike("email", by.email.trim()).limit(1).maybeSingle();
    if (data) return data as Contact;
  }
  if (by.phone) {
    const e164 = toE164(by.phone);
    const last10 = by.phone.replace(/\D/g, "").slice(-10);
    const { data } = await db.from("contacts").select("*").or(`phone.eq.${e164},phone.ilike.%${last10}`).limit(1).maybeSingle();
    if (data) return data as Contact;
  }
  return null;
}
