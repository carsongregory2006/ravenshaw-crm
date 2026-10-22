import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity, notify, notifyAdmins } from "@/lib/activity";
import { emitEvent } from "@/lib/events";
import { money } from "@/lib/utils";
import { getInvoiceLines } from "./invoices";
import type { Invoice, LineItemType, Payment, Profile } from "@/lib/types";

export interface RecordPaymentInput {
  invoiceId: string;
  amount?: number;                 // defaults to remaining balance
  receivedAt?: string;
  mercuryTransactionId?: string | null;
  method?: string;
  note?: string | null;
  actorId?: string | null;
}

/**
 * Records cash received against an invoice. Idempotent per Mercury transaction, and won't double-pay an
 * invoice that's already fully paid. Creates commissions for the deal owner on the cash collected.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<Payment | null> {
  const db = createAdminClient();
  if (input.mercuryTransactionId) {
    const { data: existing } = await db.from("payments").select("*").eq("mercury_transaction_id", input.mercuryTransactionId).maybeSingle();
    if (existing) return existing as Payment;
  }
  const { data: inv } = await db.from("invoices").select("*").eq("id", input.invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  const invoice = inv as Invoice;
  if (invoice.status === "void") throw new Error("Invoice is void");

  const { data: prior } = await db.from("payments").select("amount").eq("invoice_id", invoice.id);
  const paidSoFar = (prior ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const remaining = Math.round((Number(invoice.amount) - paidSoFar) * 100) / 100;
  if (remaining <= 0) {
    if (invoice.status !== "paid") await db.from("invoices").update({ status: "paid", paid_at: invoice.paid_at ?? new Date().toISOString() }).eq("id", invoice.id);
    return null;
  }
  const amount = Math.round(Number(input.amount ?? remaining) * 100) / 100;
  if (!(amount > 0)) throw new Error("Payment amount must be positive");

  let dealId = invoice.deal_id;
  let clientId = invoice.client_id;
  if (!dealId && clientId) {
    const { data: c } = await db.from("clients").select("deal_id").eq("id", clientId).single();
    dealId = c?.deal_id ?? null;
  }
  if (!clientId && dealId) {
    const { data: c } = await db.from("clients").select("id").eq("deal_id", dealId).maybeSingle();
    clientId = c?.id ?? null;
  }

  const receivedAt = input.receivedAt ?? new Date().toISOString();
  const { data: payment, error } = await db.from("payments").insert({
    invoice_id: invoice.id, client_id: clientId, contact_id: invoice.contact_id, deal_id: dealId,
    amount, kind: invoice.kind, received_at: receivedAt, method: input.method ?? "mercury",
    mercury_transaction_id: input.mercuryTransactionId ?? null, note: input.note ?? null,
  }).select("*").single();
  if (error || !payment) throw new Error(error?.message ?? "Could not record payment");

  const fullyPaid = paidSoFar + amount >= Number(invoice.amount) - 0.005;
  if (fullyPaid) await db.from("invoices").update({ status: "paid", paid_at: receivedAt }).eq("id", invoice.id);
  if (input.mercuryTransactionId) {
    await db.from("mercury_transactions").update({ matched_invoice_id: invoice.id }).eq("id", input.mercuryTransactionId);
  }

  // Client lifecycle: a paying client finishes onboarding automatically once their checklist is done.
  if (clientId) {
    const { data: client } = await db.from("clients").select("status").eq("id", clientId).single();
    if (client?.status === "onboarding") {
      const { count } = await db.from("onboarding_steps").select("id", { count: "exact", head: true }).eq("client_id", clientId).is("completed_at", null);
      if (!count) await db.from("clients").update({ status: "active" }).eq("id", clientId);
    }
  }

  await logActivity({
    type: "payment", title: `Payment received: ${money(amount, { cents: true })} for ${invoice.invoice_number}`,
    contact_id: invoice.contact_id, deal_id: dealId, client_id: clientId, actor_id: input.actorId ?? null,
    metadata: { payment_id: payment.id, invoice_id: invoice.id, method: input.method ?? "mercury" },
  });

  const commissionTotal = await createCommissions(payment as Payment, invoice, dealId, clientId);

  await notifyAdmins({ title: `💰 ${money(amount, { cents: true })} received`, body: `${invoice.invoice_number}${fullyPaid ? " paid in full" : " partial payment"}`, link: clientId ? `/clients/${clientId}` : "/finance/invoices" });

  if (fullyPaid) await emitEvent({ type: "invoice_paid", contactId: invoice.contact_id, dealId, data: { invoice_id: invoice.id, amount, commission: commissionTotal } });
  return payment as Payment;
}

/** Split the cash between setup (one-time/milestone) and recurring portions using the invoice's line items. */
async function splitByBasis(invoice: Invoice, amount: number): Promise<{ basis: LineItemType; base: number }[]> {
  const lines = await getInvoiceLines(invoice.id);
  const total = Number(invoice.amount) || 1;
  if (!lines.length) return [{ basis: invoice.kind, base: amount }];
  const byBasis = new Map<LineItemType, number>();
  for (const l of lines) byBasis.set(l.kind, (byBasis.get(l.kind) ?? 0) + Number(l.amount) * (l.qty ?? 1));
  return [...byBasis.entries()].map(([basis, v]) => ({ basis, base: Math.round((amount * v) / total * 100) / 100 })).filter((x) => x.base > 0);
}

async function createCommissions(payment: Payment, invoice: Invoice, dealId: string | null, clientId: string | null) {
  const db = createAdminClient();
  if (!dealId) return 0;
  const { data: deal } = await db.from("deals").select("owner_id, deal_number").eq("id", dealId).single();
  if (!deal?.owner_id) return 0;
  const { data: rep } = await db.from("profiles").select("*").eq("id", deal.owner_id).single();
  if (!rep) return 0;
  const r = rep as Profile;

  let total = 0;
  for (const part of await splitByBasis(invoice, Number(payment.amount))) {
    const recurring = part.basis === "recurring";
    const rate = Number(recurring ? r.commission_rate_recurring : r.commission_rate_setup);
    if (!(rate > 0)) continue;
    if (recurring && r.commission_recurring_months != null && clientId) {
      const { count } = await db.from("commissions").select("id", { count: "exact", head: true })
        .eq("rep_id", r.id).eq("client_id", clientId).eq("basis", "recurring").neq("status", "clawed_back");
      if ((count ?? 0) >= r.commission_recurring_months) continue;
    }
    const amount = Math.round(part.base * rate * 100) / 100;
    const { error } = await db.from("commissions").insert({
      rep_id: r.id, payment_id: payment.id, deal_id: dealId, client_id: clientId, basis: part.basis,
      base_amount: part.base, rate, amount, status: "pending",
      note: `${deal.deal_number} · ${invoice.invoice_number}`,
    });
    if (!error) total += amount;
  }
  if (total > 0) {
    await notify([r.id], { title: `You earned ${money(total, { cents: true })} commission`, body: `${deal.deal_number} · ${invoice.invoice_number}`, link: "/finance/commissions" });
  }
  return total;
}

export async function markInvoicePaidManually(invoiceId: string, opts: { amount?: number; date?: string; note?: string; method?: string; actorId?: string | null }) {
  return recordPayment({
    invoiceId, amount: opts.amount, receivedAt: opts.date ? new Date(opts.date).toISOString() : undefined,
    method: opts.method ?? "manual", note: opts.note ?? null, actorId: opts.actorId,
  });
}
