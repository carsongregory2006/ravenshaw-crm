import "server-only";
import { subDays } from "date-fns";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInvoice, listAccounts, listTransactions, mapInvoiceStatus, type MercuryTxn } from "@/lib/integrations/mercury";
import { integrations } from "@/lib/env";
import { recordPayment } from "./payments";
import type { ExpenseRule, PlClass } from "@/lib/types";

export interface MercurySyncSummary {
  transactions: number;
  paymentsMatched: number;
  invoicesPaid: number;
  expensesCreated: number;
  errors: string[];
}

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const DEAD = ["failed", "cancelled", "canceled", "reversed"];

function looksLikeTransfer(t: MercuryTxn) {
  const k = (t.kind ?? "").toLowerCase();
  return k.includes("internaltransfer") || k === "internal_transfer" || k.includes("treasury");
}

/** Fuzzy: any 3+ letter token of the counterparty appears in the contact/company names or email. */
function fuzzyMatch(counterparty: string, candidates: string[]) {
  const cp = norm(counterparty);
  if (!cp) return false;
  const tokens = cp.split(" ").filter((t) => t.length >= 3 && !["inc", "llc", "ltd", "corp", "the", "co"].includes(t));
  return candidates.map(norm).filter(Boolean).some((c) => tokens.some((t) => c.includes(t)) || c.includes(cp));
}

export async function syncMercury(): Promise<MercurySyncSummary> {
  const summary: MercurySyncSummary = { transactions: 0, paymentsMatched: 0, invoicesPaid: 0, expensesCreated: 0, errors: [] };
  if (!integrations.mercury()) {
    summary.errors.push("Mercury is not configured");
    return summary;
  }
  const db = createAdminClient();

  // 1) Pull transactions
  const accountIds = process.env.MERCURY_ACCOUNT_ID ? [process.env.MERCURY_ACCOUNT_ID] : (await listAccounts()).filter((a) => a.status !== "archived").map((a) => a.id);
  const start = subDays(new Date(), 45).toISOString().slice(0, 10);
  const txns: (MercuryTxn & { accountId: string })[] = [];
  for (const acct of accountIds) {
    try {
      (await listTransactions(acct, { start })).forEach((t) => txns.push({ ...t, accountId: acct }));
    } catch (e) {
      summary.errors.push(`Account ${acct}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (txns.length) {
    const rows = txns.map((t) => ({
      id: t.id, account_id: t.accountId, amount: t.amount, status: t.status, kind: t.kind,
      counterparty_name: t.counterpartyName ?? null, bank_description: t.bankDescription ?? null,
      note: t.note ?? t.externalMemo ?? null, posted_at: t.postedAt ?? null, created_at: t.createdAt, raw: t,
      synced_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from("mercury_transactions").upsert(rows.slice(i, i + 200), { onConflict: "id" });
      if (error) summary.errors.push(error.message);
    }
    summary.transactions = rows.length;
  }

  // 2) Match incoming money to open invoices
  const { data: openInvoices } = await db.from("invoices")
    .select("id, amount, created_at, contact:contacts(first_name,last_name,email,company:companies(name))")
    .in("status", ["sent", "overdue", "error"]);
  const { data: incoming } = await db.from("mercury_transactions").select("*")
    .gt("amount", 0).is("matched_invoice_id", null).eq("ignored", false).gte("created_at", subDays(new Date(), 45).toISOString());
  const { data: alreadyPaid } = await db.from("payments").select("mercury_transaction_id").not("mercury_transaction_id", "is", null);
  const usedTxn = new Set((alreadyPaid ?? []).map((p) => p.mercury_transaction_id));
  const claimed = new Set<string>();
  for (const t of incoming ?? []) {
    if (usedTxn.has(t.id) || DEAD.includes((t.status ?? "").toLowerCase())) continue;
    const when = new Date(t.posted_at ?? t.created_at ?? Date.now());
    const candidates = (openInvoices ?? []).filter((inv) => !claimed.has(inv.id)
      && Math.abs(Number(inv.amount) - Number(t.amount)) < 0.01
      && new Date(inv.created_at) <= when && new Date(inv.created_at) >= subDays(when, 30));
    const text = `${t.counterparty_name ?? ""} ${t.bank_description ?? ""} ${t.note ?? ""}`;
    const match = candidates.find((inv) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = Array.isArray(inv.contact) ? inv.contact[0] : inv.contact;
      const company = Array.isArray(c?.company) ? c.company[0]?.name : c?.company?.name;
      return fuzzyMatch(text, [c?.first_name, c?.last_name, `${c?.first_name ?? ""} ${c?.last_name ?? ""}`, company, c?.email?.split("@")[0], c?.email?.split("@")[1]?.split(".")[0]]);
    }) ?? (candidates.length === 1 && /invoice|inv-/i.test(text) ? candidates[0] : undefined);
    if (!match) continue;
    try {
      await recordPayment({ invoiceId: match.id, amount: Number(t.amount), receivedAt: t.posted_at ?? t.created_at ?? undefined, mercuryTransactionId: t.id, method: "mercury" });
      claimed.add(match.id);
      summary.paymentsMatched++;
    } catch (e) {
      summary.errors.push(`Match ${t.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 3) Poll Mercury AR status for invoices still open
  const { data: stillOpen } = await db.from("invoices").select("id, mercury_invoice_id, status").in("status", ["sent", "overdue"]).not("mercury_invoice_id", "is", null);
  for (const inv of stillOpen ?? []) {
    if (claimed.has(inv.id)) continue;
    try {
      const m = await getInvoice(inv.mercury_invoice_id!);
      const st = mapInvoiceStatus(m.status);
      if (st === "paid") {
        await recordPayment({ invoiceId: inv.id, method: "mercury" });
        summary.invoicesPaid++;
      } else if (st === "void") {
        await db.from("invoices").update({ status: "void" }).eq("id", inv.id);
      }
    } catch (e) {
      summary.errors.push(`Invoice ${inv.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 4) Outgoing money → expenses (auto-categorized by rules)
  const { data: rules } = await db.from("expense_rules").select("*");
  const { data: outgoing } = await db.from("mercury_transactions").select("*").lt("amount", 0).eq("ignored", false);
  const { data: existing } = await db.from("expenses").select("mercury_transaction_id").not("mercury_transaction_id", "is", null);
  const have = new Set((existing ?? []).map((e) => e.mercury_transaction_id));
  const newExpenses: Record<string, unknown>[] = [];
  for (const t of outgoing ?? []) {
    if (have.has(t.id) || DEAD.includes((t.status ?? "").toLowerCase())) continue;
    if (t.pl_class === "transfer" || looksLikeTransfer(t.raw as MercuryTxn)) {
      if (t.pl_class !== "transfer") await db.from("mercury_transactions").update({ pl_class: "transfer" }).eq("id", t.id);
      continue;
    }
    const hay = `${t.counterparty_name ?? ""} ${t.bank_description ?? ""}`.toLowerCase();
    const rule = ((rules ?? []) as ExpenseRule[]).find((r) => hay.includes(r.match.toLowerCase()));
    const pl: PlClass = (t.pl_class as PlClass) ?? rule?.pl_class ?? "opex";
    newExpenses.push({
      date: (t.posted_at ?? t.created_at ?? new Date().toISOString()).slice(0, 10),
      amount: Math.abs(Number(t.amount)), vendor: t.counterparty_name, description: t.bank_description ?? t.note,
      pl_class: pl, category: t.category ?? rule?.category ?? null, mercury_transaction_id: t.id,
    });
  }
  if (newExpenses.length) {
    const { error } = await db.from("expenses").insert(newExpenses);
    if (error) summary.errors.push(error.message); else summary.expensesCreated = newExpenses.length;
  }

  await db.from("app_kv").upsert({ key: "mercury_sync_last", value: { at: new Date().toISOString(), summary }, updated_at: new Date().toISOString() });
  return summary;
}

export async function lastMercurySync(): Promise<{ at: string; summary: MercurySyncSummary } | null> {
  const { data } = await createAdminClient().from("app_kv").select("value").eq("key", "mercury_sync_last").maybeSingle();
  return (data?.value as { at: string; summary: MercurySyncSummary }) ?? null;
}
