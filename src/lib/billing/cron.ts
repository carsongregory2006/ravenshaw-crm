import "server-only";
import { addMonths, format, subMinutes } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";
import { integrations } from "@/lib/env";
import { notifyAdmins } from "@/lib/activity";
import { getDocumentStatus, sendDocument } from "@/lib/integrations/pandadoc";
import { issueInvoice } from "./invoices";
import { syncMercury, lastMercurySync } from "./mercury-sync";
import { applyContractStatus, mapPandaDocStatus } from "./contracts";
import type { BillingSchedule, Contract } from "@/lib/types";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const MERCURY_EVERY_MIN = 15;

/** Billing heartbeat, called every minute by /api/cron/tick. Each step is isolated so one failure doesn't block the rest. */
export async function runBillingCron() {
  const out = { invoicesIssued: 0, overdue: 0, contractsSent: 0, contractsUpdated: 0, mercury: null as unknown, errors: [] as string[] };
  const db = createAdminClient();
  const today = ymd(new Date());

  // 1) Recurring + scheduled milestone invoices
  try {
    const { data: due } = await db.from("billing_schedules").select("*, client:clients(id, status, contact_id), deal:deals(contact_id, deal_number), line_item:deal_line_items(type)")
      .eq("active", true).lte("next_invoice_date", today).limit(50);
    for (const s of (due ?? []) as (BillingSchedule & { client: { id: string; status: string; contact_id: string } | null; deal: { contact_id: string | null; deal_number: string } | null; line_item: { type: string } | null })[]) {
      if (s.client && (s.client.status === "paused" || s.client.status === "churned")) continue;
      const contactId = s.client?.contact_id ?? s.deal?.contact_id;
      if (!contactId) continue;
      const kind = s.line_item?.type === "milestone" || s.description.startsWith("Milestone:") ? "milestone" : "recurring";
      const periodStart = s.next_invoice_date;
      const periodEnd = ymd(addMonths(new Date(s.next_invoice_date), s.interval_months));
      try {
        await issueInvoice({
          dealId: s.deal_id, clientId: s.client_id, contactId,
          items: [{ name: kind === "recurring" ? `${s.description} (${periodStart} – ${periodEnd})` : s.description.replace(/^Milestone: /, ""), amount: Number(s.amount), qty: 1, kind, line_item_id: s.line_item_id }],
          description: `${s.deal?.deal_number ?? ""} ${s.description}`.trim(),
          periodStart: kind === "recurring" ? periodStart : null, periodEnd: kind === "recurring" ? periodEnd : null,
        });
        const cycles = s.cycles_remaining == null ? null : s.cycles_remaining - 1;
        await db.from("billing_schedules").update({
          next_invoice_date: ymd(addMonths(new Date(s.next_invoice_date), Math.max(1, s.interval_months))),
          cycles_remaining: cycles, active: cycles == null || cycles > 0,
        }).eq("id", s.id);
        out.invoicesIssued++;
      } catch (e) {
        out.errors.push(`schedule ${s.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  } catch (e) { out.errors.push(`schedules: ${e instanceof Error ? e.message : e}`); }

  // 2) Overdue
  try {
    const { data: late } = await db.from("invoices").update({ status: "overdue" }).eq("status", "sent").lt("due_date", today).select("invoice_number, amount");
    out.overdue = late?.length ?? 0;
    if (out.overdue) await notifyAdmins({ title: `${out.overdue} invoice${out.overdue > 1 ? "s" : ""} now overdue`, body: late!.map((i) => i.invoice_number).join(", "), link: "/finance/invoices?status=overdue" });
  } catch (e) { out.errors.push(`overdue: ${e instanceof Error ? e.message : e}`); }

  // 3) PandaDoc: send drafts that finished processing
  if (integrations.pandadoc()) {
    try {
      const { data: drafts } = await db.from("contracts").select("*").eq("status", "draft").not("pandadoc_document_id", "is", null)
        .lt("created_at", subMinutes(new Date(), 1).toISOString()).limit(10);
      for (const c of (drafts ?? []) as Contract[]) {
        try {
          const s = await getDocumentStatus(c.pandadoc_document_id!);
          if (s.status === "document.draft") {
            await sendDocument(c.pandadoc_document_id!);
            await db.from("contracts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", c.id);
            out.contractsSent++;
          } else {
            const st = mapPandaDocStatus(s.status);
            if (st && st !== "draft") { await applyContractStatus(c, st); out.contractsUpdated++; }
          }
        } catch (e) { out.errors.push(`contract ${c.id}: ${e instanceof Error ? e.message : e}`); }
      }
    } catch (e) { out.errors.push(`pandadoc: ${e instanceof Error ? e.message : e}`); }
  }

  // 4) Every 15 min: Mercury sync + PandaDoc status poll (backup for missed webhooks)
  const last = await lastMercurySync();
  if (!last || new Date(last.at) < subMinutes(new Date(), MERCURY_EVERY_MIN)) {
    if (integrations.mercury()) {
      try { out.mercury = await syncMercury(); } catch (e) { out.errors.push(`mercury: ${e instanceof Error ? e.message : e}`); }
    }
    if (integrations.pandadoc()) {
      const { data: open } = await db.from("contracts").select("*").in("status", ["sent", "viewed"]).not("pandadoc_document_id", "is", null).limit(25);
      for (const c of (open ?? []) as Contract[]) {
        try {
          const st = mapPandaDocStatus((await getDocumentStatus(c.pandadoc_document_id!)).status);
          if (st && st !== c.status) { await applyContractStatus(c, st); out.contractsUpdated++; }
        } catch { /* transient */ }
      }
    }
  }
  return out;
}
