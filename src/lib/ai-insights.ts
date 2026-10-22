"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safe } from "@/lib/actions/util";
import { getProfile } from "@/lib/auth";
import { chat, chatJson } from "@/lib/integrations/openrouter";
import { sendEmailToContact, sendSmsToContact } from "@/lib/comms";
import { contactLabel, money } from "@/lib/utils";

interface Insights {
  summary: string;
  sentiment: "positive" | "neutral" | "negative" | string;
  buying_signals: string[];
  risks: string[];
  next_best_actions: string[];
  suggested_message: string;
}

/** Collect everything we know about a contact as compact text for the model. Uses RLS: user must be able to see the contact. */
async function gatherContext(contactId: string) {
  const supabase = await createClient();
  const { data: contact } = await supabase.from("contacts")
    .select("*, company:companies(*), owner:profiles!contacts_owner_id_fkey(full_name)").eq("id", contactId).single();
  if (!contact) throw new Error("Contact not found or not accessible");
  const admin = createAdminClient();
  const [deals, messages, calls, activities, invoices, payments, client] = await Promise.all([
    admin.from("deals").select("deal_number, name, amount_one_time, amount_recurring, term_months, closed_at, lost_reason, created_at, stage:pipeline_stages(name), line_items:deal_line_items(name, type, unit_price, quantity)").eq("contact_id", contactId),
    admin.from("messages").select("channel, direction, subject, body, status, created_at").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(50),
    admin.from("calls").select("direction, status, duration_sec, disposition, notes, ai_summary, started_at").eq("contact_id", contactId).order("started_at", { ascending: false }).limit(20),
    admin.from("activities").select("type, title, body, created_at").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(40),
    admin.from("invoices").select("invoice_number, amount, status, due_date, paid_at").eq("contact_id", contactId),
    admin.from("payments").select("amount, received_at").eq("contact_id", contactId),
    admin.from("clients").select("status, mrr, start_date, health_score").eq("contact_id", contactId).maybeSingle(),
  ]);

  const clip = (s: string | null | undefined, n = 400) => (s ? (s.length > n ? s.slice(0, n) + "…" : s) : "");
  const lines: string[] = [];
  lines.push(`CONTACT: ${contactLabel(contact)} | ${contact.title ?? ""} | status=${contact.status} | source=${contact.source ?? "?"} | tags=${(contact.tags ?? []).join(",")} | created=${contact.created_at} | last_contacted=${contact.last_contacted_at ?? "never"} | owner=${contact.owner?.full_name ?? "unassigned"}`);
  if (contact.company) lines.push(`COMPANY: ${contact.company.name} | ${contact.company.industry ?? ""} | employees=${contact.company.employees ?? "?"} | website=${contact.company.website ?? contact.company.domain ?? ""}`);
  if (client.data) lines.push(`CLIENT ACCOUNT: status=${client.data.status} mrr=${money(client.data.mrr)} since=${client.data.start_date} health=${client.data.health_score}`);
  type DealCtx = { deal_number: string; name: string; amount_one_time: number; amount_recurring: number; term_months: number | null; lost_reason: string | null;
    stage: { name: string } | null; line_items: { name: string; type: string; unit_price: number; quantity: number }[] | null };
  for (const d of (deals.data ?? []) as unknown as DealCtx[]) {
    lines.push(`DEAL ${d.deal_number} "${d.name}" stage=${d.stage?.name} one_time=${money(d.amount_one_time)} mrr=${money(d.amount_recurring)} term=${d.term_months}mo ${d.lost_reason ? "lost_reason=" + d.lost_reason : ""} items=${(d.line_items ?? []).map((l) => `${l.name}(${l.type} ${money(l.unit_price)}x${l.quantity})`).join("; ")}`);
  }
  for (const i of invoices.data ?? []) lines.push(`INVOICE ${i.invoice_number} ${money(i.amount)} ${i.status} due=${i.due_date ?? ""} paid=${i.paid_at ?? ""}`);
  const paid = (payments.data ?? []).reduce((a, p) => a + Number(p.amount), 0);
  if (paid) lines.push(`TOTAL PAID TO DATE: ${money(paid)}`);
  lines.push("--- MESSAGES (newest first) ---");
  for (const m of messages.data ?? []) lines.push(`[${m.created_at}] ${m.channel.toUpperCase()} ${m.direction}${m.subject ? ` "${m.subject}"` : ""}: ${clip(m.body)}`);
  lines.push("--- CALLS ---");
  for (const c of calls.data ?? []) lines.push(`[${c.started_at}] ${c.direction} ${c.status} ${c.duration_sec ?? 0}s disposition=${c.disposition ?? ""} notes=${clip(c.notes, 300)} summary=${clip(c.ai_summary, 300)}`);
  lines.push("--- ACTIVITY ---");
  for (const a of activities.data ?? []) lines.push(`[${a.created_at}] ${a.type}: ${a.title} ${clip(a.body, 200)}`);
  return { contact, text: lines.join("\n").slice(0, 24000) };
}

const SYSTEM = `You are the revenue analyst for Ravenshaw AI, an AI automation agency. You review CRM records and give sales reps and account managers a crisp, honest read on a contact. Be specific and reference real facts from the record (dates, amounts, what they said). Never invent facts. If data is thin, say so.`;

export async function generateContactInsights(contactId: string) {
  return safe(async () => {
    const profile = await getProfile();
    if (!profile) throw new Error("Not signed in");
    const { text } = await gatherContext(contactId);
    const out = await chatJson<Insights>([
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nCRM RECORD:\n${text}\n\nReturn JSON with keys: summary (3-5 sentence overview: who they are, where they are in the relationship, what they care about), sentiment (positive|neutral|negative), buying_signals (string[]), risks (string[]), next_best_actions (string[], concrete, max 4), suggested_message (a short SMS-length follow-up the rep could send now, first-person, no placeholders).`,
      },
    ], { maxTokens: 1400 });

    const list = (xs: string[] | undefined) => (xs?.length ? xs.map((x) => `- ${x}`).join("\n") : "- None identified");
    const md = [
      out.summary,
      `**Sentiment:** ${out.sentiment}`,
      `### Buying signals\n${list(out.buying_signals)}`,
      `### Risks\n${list(out.risks)}`,
      `### Next best actions\n${list(out.next_best_actions)}`,
      out.suggested_message ? `### Suggested message\n> ${out.suggested_message}` : "",
    ].filter(Boolean).join("\n\n");

    const admin = createAdminClient();
    const now = new Date().toISOString();
    await admin.from("contacts").update({ ai_summary: md, ai_summary_at: now }).eq("id", contactId);
    await admin.from("activities").insert({ type: "ai", contact_id: contactId, title: "AI overview generated", body: out.summary, actor_id: profile.id });
    revalidatePath(`/contacts/${contactId}`);
    return { markdown: md, generatedAt: now };
  });
}

export async function draftFollowUp(contactId: string, channel: "sms" | "email", goal?: string) {
  return safe(async () => {
    const profile = await getProfile();
    if (!profile) throw new Error("Not signed in");
    const { text } = await gatherContext(contactId);
    if (channel === "sms") {
      const body = await chat([
        { role: "system", content: SYSTEM + " You write short, natural, human SMS messages (under 300 characters), no emojis unless they used them, no links unless asked." },
        { role: "user", content: `CRM RECORD:\n${text}\n\nWrite the next SMS from ${profile.full_name ?? "me"} to this contact.${goal ? ` Goal: ${goal}.` : ""} Return only the message text.` },
      ], { maxTokens: 300 });
      return { subject: "", body: body.trim().replace(/^"|"$/g, "") };
    }
    const out = await chatJson<{ subject: string; body: string }>([
      { role: "system", content: SYSTEM + " You write concise, warm, professional plain-text emails." },
      { role: "user", content: `CRM RECORD:\n${text}\n\nWrite the next follow-up email from ${profile.full_name ?? "me"} to this contact.${goal ? ` Goal: ${goal}.` : ""} Return JSON {subject, body}. Body is plain text with line breaks, signed with my first name.` },
    ], { maxTokens: 800 });
    return { subject: out.subject ?? "", body: out.body ?? "" };
  });
}

/** Send a (possibly AI-drafted) message to the contact through Telnyx / Resend. */
export async function sendDraft(contactId: string, channel: "sms" | "email", body: string, subject?: string) {
  return safe(async () => {
    const profile = await getProfile();
    if (!profile) throw new Error("Not signed in");
    const supabase = await createClient();
    const { data: visible } = await supabase.from("contacts").select("id").eq("id", contactId).maybeSingle();
    if (!visible) throw new Error("Contact not accessible");
    const r = channel === "sms"
      ? await sendSmsToContact(contactId, body, { userId: profile.id })
      : await sendEmailToContact(contactId, subject || "Following up", body, { userId: profile.id });
    if (!r.ok) throw new Error(r.error ?? "Send failed");
    revalidatePath(`/contacts/${contactId}`);
    return null;
  });
}
