import "server-only";
import { addMonths, format } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity, notifyAdmins } from "@/lib/activity";
import { emitEvent } from "@/lib/events";
import { contactLabel, money } from "@/lib/utils";
import { issueInvoice, type InvoiceItem } from "./invoices";
import { moveDealToStage } from "./contracts";
import type { DealLineItem } from "@/lib/types";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Everything that happens when a client signs: deal → Won, contact → client, client record + onboarding
 * checklist, billing schedules, first invoice via Mercury, team notification and the contract_signed automation trigger.
 * Idempotent per contract.
 */
export async function onContractSigned(contractId: string) {
  const db = createAdminClient();
  const { error: lockErr } = await db.from("app_kv").insert({ key: `contract_signed:${contractId}`, value: { at: new Date().toISOString() } });
  if (lockErr) return { skipped: true as const }; // already processed
  try {
    return await processSigned(contractId);
  } catch (e) {
    await db.from("app_kv").delete().eq("key", `contract_signed:${contractId}`); // allow retry
    throw e;
  }
}

async function processSigned(contractId: string) {
  const db = createAdminClient();
  const { data: contract } = await db.from("contracts").select("*").eq("id", contractId).single();
  if (!contract) throw new Error("Contract not found");
  if (contract.status !== "completed") {
    await db.from("contracts").update({ status: "completed", completed_at: contract.completed_at ?? new Date().toISOString() }).eq("id", contractId);
  }
  if (!contract.deal_id) return { skipped: true as const };

  const [{ data: deal }, { data: items }, { data: settings }] = await Promise.all([
    db.from("deals").select("*, contact:contacts(*)").eq("id", contract.deal_id).single(),
    db.from("deal_line_items").select("*").eq("deal_id", contract.deal_id).order("position"),
    db.from("workspace_settings").select("*").eq("id", 1).single(),
  ]);
  if (!deal) throw new Error("Deal not found");
  const contactId = deal.contact_id ?? contract.contact_id;

  await moveDealToStage(deal.id, "won");
  if (contactId) await db.from("contacts").update({ status: "client" }).eq("id", contactId);

  // Client record
  let { data: client } = await db.from("clients").select("*").eq("deal_id", deal.id).maybeSingle();
  if (!client && contactId) {
    const { data: created } = await db.from("clients").insert({
      contact_id: contactId, company_id: deal.company_id, deal_id: deal.id, account_manager_id: deal.owner_id,
      status: "onboarding", mrr: deal.amount_recurring ?? 0,
    }).select("*").single();
    client = created;
    const checklist: string[] = Array.isArray(settings?.onboarding_checklist) ? settings.onboarding_checklist : [];
    if (client && checklist.length) {
      await db.from("onboarding_steps").insert(checklist.map((title, i) => ({ client_id: client!.id, title, position: i, assignee_id: deal.owner_id })));
    }
  }

  // Billing: first invoice + schedules
  const lines = (items ?? []) as DealLineItem[];
  const today = new Date();
  const first: InvoiceItem[] = [];
  const schedules: Record<string, unknown>[] = [];
  if (lines.length) {
    for (const li of lines) {
      const amount = Number(li.unit_price);
      if (li.type === "one_time") first.push({ name: li.name, amount, qty: li.quantity, kind: "one_time", line_item_id: li.id });
      else if (li.type === "milestone") {
        if (!li.due_on || new Date(li.due_on) <= today) first.push({ name: li.name, amount, qty: li.quantity, kind: "milestone", line_item_id: li.id });
        else schedules.push({ client_id: client?.id ?? null, deal_id: deal.id, line_item_id: li.id, description: `Milestone: ${li.name}`, amount: amount * li.quantity, interval_months: 1, next_invoice_date: li.due_on, cycles_remaining: 1 });
      } else {
        first.push({ name: `${li.name} — first ${li.interval_months === 1 ? "month" : `${li.interval_months} months`}`, amount, qty: li.quantity, kind: "recurring", line_item_id: li.id });
        const remaining = li.billing_cycles == null ? null : li.billing_cycles - 1;
        if (remaining == null || remaining > 0) {
          schedules.push({ client_id: client?.id ?? null, deal_id: deal.id, line_item_id: li.id, description: li.name, amount: amount * li.quantity, interval_months: li.interval_months, next_invoice_date: ymd(addMonths(today, li.interval_months)), cycles_remaining: remaining });
        }
      }
    }
  } else {
    if (Number(deal.amount_one_time) > 0) first.push({ name: "Setup", amount: Number(deal.amount_one_time), kind: "one_time" });
    if (Number(deal.amount_recurring) > 0) {
      first.push({ name: "Monthly retainer — first month", amount: Number(deal.amount_recurring), kind: "recurring" });
      schedules.push({ client_id: client?.id ?? null, deal_id: deal.id, description: "Monthly retainer", amount: Number(deal.amount_recurring), interval_months: 1, next_invoice_date: ymd(addMonths(today, 1)), cycles_remaining: deal.term_months ? deal.term_months - 1 : null });
    }
  }
  if (schedules.length) await db.from("billing_schedules").insert(schedules);

  let invoiceNote = "No invoice needed";
  if (first.length && contactId) {
    try {
      const inv = await issueInvoice({ dealId: deal.id, clientId: client?.id, contactId, items: first, description: `${deal.deal_number} — initial invoice` });
      invoiceNote = inv.status === "error" ? `First invoice failed: ${inv.error}` : `First invoice ${inv.invoice_number} sent (${money(inv.amount, { cents: true })})`;
    } catch (e) {
      invoiceNote = `First invoice failed: ${e instanceof Error ? e.message : e}`;
    }
  }

  const who = deal.contact ? contactLabel(deal.contact) : deal.name;
  await logActivity({ type: "contract", title: `Contract signed — ${deal.deal_number} won`, body: invoiceNote, contact_id: contactId, deal_id: deal.id, client_id: client?.id ?? null, metadata: { contract_id: contractId } });
  await notifyAdmins({ title: `🎉 ${who} signed! ${deal.deal_number}`, body: `${money(deal.amount_one_time)} setup · ${money(deal.amount_recurring)}/mo. ${invoiceNote}`, link: client ? `/clients/${client.id}` : `/deals/${deal.id}` }, [deal.owner_id]);
  await emitEvent({ type: "contract_signed", contactId, dealId: deal.id, data: { client_id: client?.id, contract_id: contractId } });
  return { clientId: client?.id ?? null, invoiceNote };
}
