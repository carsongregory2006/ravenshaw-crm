import "server-only";
import { format } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAndSend, createSessionLink, documentAppUrl, getDocumentStatus, sendDocument } from "@/lib/integrations/pandadoc";
import { integrations } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { emitEvent } from "@/lib/events";
import { sendEmailToContact } from "@/lib/comms";
import { contactLabel, money } from "@/lib/utils";
import type { Contract, DealLineItem } from "@/lib/types";

function lineLabel(li: DealLineItem) {
  if (li.type === "recurring") return `${li.name} (${li.interval_months === 1 ? "monthly" : `every ${li.interval_months} months`})`;
  if (li.type === "milestone") return `${li.name} (milestone${li.due_on ? ` · due ${li.due_on}` : ""})`;
  return li.name;
}

export async function moveDealToStage(dealId: string, stageKey: string) {
  const db = createAdminClient();
  const { data: stage } = await db.from("pipeline_stages").select("id").eq("key", stageKey).single();
  const { data: deal } = await db.from("deals").select("stage_id, contact_id").eq("id", dealId).single();
  if (!stage || !deal || deal.stage_id === stage.id) return false;
  await db.from("deals").update({ stage_id: stage.id }).eq("id", dealId);
  await emitEvent({ type: "stage_changed", contactId: deal.contact_id, dealId, data: { stage_key: stageKey } });
  return true;
}

/** 1-click contract: build a PandaDoc document from the template with the deal's numbers and send it for signature. */
export async function sendContractForDeal(dealId: string, userId: string | null): Promise<Contract> {
  const db = createAdminClient();
  if (!integrations.pandadoc()) throw new Error("PandaDoc is not configured. Add PANDADOC_API_KEY in Vercel environment variables.");
  const [{ data: deal }, { data: items }, { data: settings }] = await Promise.all([
    db.from("deals").select("*, contact:contacts(*), company:companies(name)").eq("id", dealId).single(),
    db.from("deal_line_items").select("*").eq("deal_id", dealId).order("position"),
    db.from("workspace_settings").select("*").eq("id", 1).single(),
  ]);
  if (!deal) throw new Error("Deal not found");
  const contact = deal.contact;
  if (!contact) throw new Error("Link a contact to this deal before sending a contract");
  if (!contact.email) throw new Error(`${contactLabel(contact)} has no email address — add one to send the contract`);
  const templateId = settings?.pandadoc_template_id || process.env.PANDADOC_TEMPLATE_ID;
  if (!templateId) throw new Error("No PandaDoc template selected. Choose one in Settings → Integrations → PandaDoc.");

  const lines = (items ?? []) as DealLineItem[];
  const pricingRows = lines.length
    ? lines.map((li) => ({ name: lineLabel(li), description: li.description ?? "", price: Number(li.unit_price), qty: li.quantity }))
    : [
        ...(Number(deal.amount_one_time) > 0 ? [{ name: "Setup", price: Number(deal.amount_one_time), qty: 1 }] : []),
        ...(Number(deal.amount_recurring) > 0 ? [{ name: "Monthly retainer", price: Number(deal.amount_recurring), qty: 1 }] : []),
      ];

  const name = `${settings?.name ?? "Ravenshaw AI"} × ${deal.company?.name || contactLabel(contact)} — ${deal.deal_number}`;
  const { data: row } = await db.from("contracts").insert({
    deal_id: dealId, contact_id: contact.id, name, pandadoc_template_id: templateId, status: "draft", created_by: userId,
  }).select("*").single();

  try {
    const res = await createAndSend({
      name,
      templateId,
      recipient: { email: contact.email, first_name: contact.first_name ?? "", last_name: contact.last_name ?? "", role: "Client" },
      tokens: {
        "Client.FirstName": contact.first_name ?? "",
        "Client.LastName": contact.last_name ?? "",
        "Client.Email": contact.email,
        "Client.Company": deal.company?.name ?? "",
        "Deal.Number": deal.deal_number,
        "Deal.Name": deal.name,
        "Deal.SetupTotal": money(deal.amount_one_time, { cents: true }),
        "Deal.MonthlyTotal": money(deal.amount_recurring, { cents: true }),
        "Deal.Term": `${deal.term_months ?? 12} months`,
        "Agency.Name": settings?.name ?? "Ravenshaw AI",
        Date: format(new Date(), "MMMM d, yyyy"),
      },
      pricingRows,
      metadata: { deal_id: dealId, contract_id: row!.id },
    }, { subject: `Your agreement with ${settings?.name ?? "Ravenshaw AI"}`, message: `Hi ${contact.first_name ?? ""}, here is your agreement for review and signature.` });

    const { data: updated } = await db.from("contracts").update({
      pandadoc_document_id: res.id, status: res.sent ? "sent" : "draft", sent_at: res.sent ? new Date().toISOString() : null,
      document_url: documentAppUrl(res.id), error: null,
    }).eq("id", row!.id).select("*").single();
    await moveDealToStage(dealId, "contract_sent");
    await logActivity({ type: "contract", title: res.sent ? `Contract sent to ${contact.email}` : "Contract created (sending shortly)", contact_id: contact.id, deal_id: dealId, actor_id: userId, metadata: { contract_id: row!.id } });
    return updated as Contract;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.from("contracts").update({ status: "error", error }).eq("id", row!.id);
    throw new Error(`PandaDoc: ${error}`);
  }
}

/** Re-send: drafts get sent; already-sent docs get a fresh signing link emailed to the client. */
export async function resendContract(contractId: string, userId: string | null) {
  const db = createAdminClient();
  const { data: c } = await db.from("contracts").select("*, contact:contacts(email)").eq("id", contractId).single();
  if (!c?.pandadoc_document_id) throw new Error("This contract has no PandaDoc document — send a new one");
  const status = await getDocumentStatus(c.pandadoc_document_id);
  if (status.status === "document.draft") {
    await sendDocument(c.pandadoc_document_id);
    await db.from("contracts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", contractId);
  } else {
    if (!c.contact?.email || !c.contact_id) throw new Error("Contact has no email");
    const link = await createSessionLink(c.pandadoc_document_id, c.contact.email);
    const r = await sendEmailToContact(c.contact_id, "Reminder: your agreement is ready to sign",
      `Hi {{first_name}},\n\nJust a reminder that your agreement with {{agency_name}} is waiting for your signature:\n${link}\n\nLet me know if you have any questions.\n{{rep_name}}`, { userId });
    if (!r.ok) throw new Error(r.error);
  }
  await logActivity({ type: "contract", title: "Contract reminder sent", contact_id: c.contact_id, deal_id: c.deal_id, actor_id: userId });
}

const STATUS_MAP: Record<string, Contract["status"]> = {
  "document.draft": "draft", "document.sent": "sent", "document.viewed": "viewed", "document.waiting_approval": "sent",
  "document.completed": "completed", "document.declined": "declined", "document.voided": "voided", "document.rejected": "declined",
};
export const mapPandaDocStatus = (s: string) => STATUS_MAP[s] ?? null;

/** Pull latest status from PandaDoc (used by the "Refresh" button and the cron). */
export async function refreshContractStatus(contractId: string) {
  const db = createAdminClient();
  const { data: c } = await db.from("contracts").select("*").eq("id", contractId).single();
  if (!c?.pandadoc_document_id) return c as Contract | null;
  const s = await getDocumentStatus(c.pandadoc_document_id);
  const status = mapPandaDocStatus(s.status);
  if (status && status !== c.status) {
    await applyContractStatus(c as Contract, status);
  }
  const { data } = await db.from("contracts").select("*").eq("id", contractId).single();
  return data as Contract;
}

export async function applyContractStatus(c: Contract, status: Contract["status"]) {
  const db = createAdminClient();
  const now = new Date().toISOString();
  await db.from("contracts").update({
    status,
    ...(status === "sent" && !c.sent_at ? { sent_at: now } : {}),
    ...(status === "viewed" ? { viewed_at: c.viewed_at ?? now } : {}),
    ...(status === "completed" ? { completed_at: c.completed_at ?? now } : {}),
  }).eq("id", c.id);
  if (status === "viewed") await logActivity({ type: "contract", title: "Contract viewed by client", contact_id: c.contact_id, deal_id: c.deal_id });
  if (status === "declined") await logActivity({ type: "contract", title: "Contract declined", contact_id: c.contact_id, deal_id: c.deal_id });
  if (status === "completed") {
    const { onContractSigned } = await import("./onboarding");
    await onContractSigned(c.id);
  }
}
