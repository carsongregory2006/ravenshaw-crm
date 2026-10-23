import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInvoice, invoiceFee, type StripeInvoice } from "@/lib/integrations/stripe";
import { integrations } from "@/lib/env";
import { recordPayment } from "./payments";

export interface StripeSyncSummary {
  checked: number;
  invoicesPaid: number;
  voided: number;
  errors: string[];
}

/**
 * Apply a Stripe invoice's state to the matching CRM invoice: paid → payment (+ commissions) and a fee expense;
 * void → void. Safe to call repeatedly (webhook retries and the polling backup both land here).
 */
export async function applyStripeInvoice(s: StripeInvoice): Promise<"paid" | "void" | null> {
  const db = createAdminClient();
  let { data: inv } = await db.from("invoices").select("id, status").eq("stripe_invoice_id", s.id).maybeSingle();
  if (!inv && s.metadata?.crm_invoice_id) {
    ({ data: inv } = await db.from("invoices").select("id, status").eq("id", s.metadata.crm_invoice_id).maybeSingle());
    if (inv) await db.from("invoices").update({ stripe_invoice_id: s.id }).eq("id", inv.id);
  }
  if (!inv) return null;

  if (s.status === "paid") {
    const paidAt = s.status_transitions?.paid_at ? new Date(s.status_transitions.paid_at * 1000).toISOString() : undefined;
    if (s.amount_paid > 0) {
      await recordPayment({ invoiceId: inv.id, amount: s.amount_paid / 100, receivedAt: paidAt, stripePaymentRef: s.id, method: "stripe" });
    } else if (inv.status !== "paid") {
      // Paid out of band in Stripe (marked paid / credit balance): no cash moved, just close it.
      await db.from("invoices").update({ status: "paid", paid_at: paidAt ?? new Date().toISOString() }).eq("id", inv.id);
    }
    const fee = invoiceFee(s);
    if (fee) {
      await db.from("expenses").upsert({
        date: (paidAt ?? new Date().toISOString()).slice(0, 10), amount: fee.fee, vendor: "Stripe",
        description: `Processing fee · ${s.metadata?.crm_invoice_number ?? s.id}`, pl_class: "cogs", category: "Payment processing", stripe_ref: fee.ref,
      }, { onConflict: "stripe_ref", ignoreDuplicates: true });
    }
    return "paid";
  }
  if (s.status === "void" && inv.status !== "void" && inv.status !== "paid") {
    await db.from("invoices").update({ status: "void" }).eq("id", inv.id);
    return "void";
  }
  return null;
}

/** Polling backup for missed webhooks: re-check every open Stripe invoice. */
export async function syncStripe(): Promise<StripeSyncSummary> {
  const summary: StripeSyncSummary = { checked: 0, invoicesPaid: 0, voided: 0, errors: [] };
  if (!integrations.stripe()) {
    summary.errors.push("Stripe is not configured");
    return summary;
  }
  const db = createAdminClient();
  const { data: open } = await db.from("invoices").select("id, stripe_invoice_id").in("status", ["sent", "overdue"]).not("stripe_invoice_id", "is", null).limit(100);
  for (const inv of open ?? []) {
    try {
      const r = await applyStripeInvoice(await getInvoice(inv.stripe_invoice_id!));
      summary.checked++;
      if (r === "paid") summary.invoicesPaid++;
      if (r === "void") summary.voided++;
    } catch (e) {
      summary.errors.push(`Invoice ${inv.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await db.from("app_kv").upsert({ key: "stripe_sync_last", value: { at: new Date().toISOString(), summary }, updated_at: new Date().toISOString() });
  return summary;
}

export async function lastStripeSync(): Promise<{ at: string; summary: StripeSyncSummary } | null> {
  const { data } = await createAdminClient().from("app_kv").select("value").eq("key", "stripe_sync_last").maybeSingle();
  return (data?.value as { at: string; summary: StripeSyncSummary }) ?? null;
}
