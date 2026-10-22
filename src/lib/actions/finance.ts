"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { integrations } from "@/lib/env";
import { safe } from "./util";
import { chat } from "@/lib/integrations/openrouter";
import { loadDataset } from "@/lib/metrics/load";
import { resolveRange } from "@/lib/metrics/range";
import { businessSnapshot } from "@/lib/metrics/snapshot";
import type { PlClass } from "@/lib/types";

async function staff() {
  const p = await getProfile();
  if (!p) throw new Error("Not signed in");
  if (p.role !== "admin" && p.role !== "ops") throw new Error("Only admins and ops can do this");
  return p;
}
async function admin() {
  const p = await getProfile();
  if (!p || p.role !== "admin") throw new Error("Only admins can do this");
  return p;
}
const check = <T,>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const PL: PlClass[] = ["cogs", "payroll", "marketing", "software", "opex", "tax", "interest", "depreciation", "amortization", "owner_draw", "transfer", "other"];
const plClass = (v: string): PlClass => {
  if (!PL.includes(v as PlClass)) throw new Error(`Unknown P&L class "${v}"`);
  return v as PlClass;
};

// ───────── AI ─────────
const SYSTEM = `You are the CFO/COO advisor for Ravenshaw AI, an AI automation agency. You get a JSON snapshot of CRM + finance metrics.
Be specific and numeric, cite the figures you use, compare to the previous period, flag risks (cash, AR, churn, rep performance, lead quality),
and end with 3 concrete, prioritized actions. Use short markdown sections and bullets. Never invent numbers that are not in the data; if data is missing, say what to track.`;

async function snapshotFor(rangeParams: { range?: string; from?: string; to?: string }) {
  const p = await getProfile();
  if (!p) throw new Error("Not signed in");
  const range = resolveRange(rangeParams);
  const ds = await loadDataset(range);
  const isStaff = p.role === "admin" || p.role === "ops";
  return { p, snap: businessSnapshot(ds, range, { staff: isStaff, repId: p.id, repName: p.full_name ?? p.email }) };
}

export async function askAi(question: string, rangeParams: { range?: string; from?: string; to?: string }) {
  return safe(async () => {
    if (!integrations.openrouter()) throw new Error("OpenRouter is not configured. Add OPENROUTER_API_KEY in Vercel.");
    if (!question.trim()) throw new Error("Ask a question first");
    const { p, snap } = await snapshotFor(rangeParams);
    const answer = await chat([
      { role: "system", content: SYSTEM },
      { role: "user", content: `DATA:\n${JSON.stringify(snap)}\n\nQUESTION: ${question.trim()}` },
    ], { maxTokens: 1400 });
    const sb = await createClient();
    await sb.from("ai_briefings").insert({ user_id: p.id, kind: "answer", question: question.trim(), content: answer });
    return answer;
  });
}

export async function refreshBriefing() {
  return safe(async () => {
    if (!integrations.openrouter()) throw new Error("OpenRouter is not configured. Add OPENROUTER_API_KEY in Vercel.");
    const { p, snap } = await snapshotFor({ range: "30d" });
    const content = await chat([
      { role: "system", content: SYSTEM },
      { role: "user", content: `DATA (last 30 days vs prior 30):\n${JSON.stringify(snap)}\n\nWrite this week's briefing: "Headline" (1 sentence), "What's working", "What needs attention", "Do this week" (3 actions). Max ~250 words.` },
    ], { maxTokens: 900 });
    const sb = await createClient();
    const row = check(await sb.from("ai_briefings").insert({ user_id: p.id, kind: "weekly", content }).select("id, content, created_at").single());
    revalidatePath("/dashboard");
    return row as { id: string; content: string; created_at: string };
  });
}

// ───────── Mercury ─────────
export async function getMercuryBalance() {
  return safe(async () => {
    await staff();
    if (!integrations.mercury()) return null;
    const { listAccounts } = await import("@/lib/integrations/mercury");
    const accounts = await listAccounts();
    const open = accounts.filter((a) => (a.status ?? "active").toLowerCase() !== "archived");
    return {
      balance: open.reduce((s, a) => s + Number(a.currentBalance ?? a.availableBalance ?? 0), 0),
      available: open.reduce((s, a) => s + Number(a.availableBalance ?? 0), 0),
      accounts: open.map((a) => ({ id: a.id, name: a.name, balance: Number(a.currentBalance ?? 0), kind: a.kind })),
    };
  });
}

export async function syncMercuryNow() {
  return safe(async () => {
    await staff();
    if (!integrations.mercury()) throw new Error("Mercury is not configured. Add MERCURY_API_KEY in Vercel.");
    const { syncMercury } = await import("@/lib/billing/mercury-sync");
    const res = await syncMercury();
    revalidatePath("/finance", "layout");
    return res;
  });
}

// ───────── Expenses ─────────
export interface ExpenseInput { date: string; amount: number; vendor?: string | null; description?: string | null; pl_class: string; category?: string | null; recurring?: boolean; client_id?: string | null }

function cleanExpense(e: ExpenseInput) {
  const amount = Math.abs(Number(e.amount));
  if (!e.date) throw new Error("Date is required");
  if (!isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than 0");
  return {
    date: e.date, amount, vendor: e.vendor?.trim() || null, description: e.description?.trim() || null,
    pl_class: plClass(e.pl_class), category: e.category?.trim() || null, recurring: !!e.recurring, client_id: e.client_id || null,
  };
}

export async function createExpense(e: ExpenseInput) {
  return safe(async () => {
    const p = await staff();
    const sb = await createClient();
    check(await sb.from("expenses").insert({ ...cleanExpense(e), created_by: p.id }));
    revalidatePath("/finance", "layout");
  });
}

export async function updateExpense(id: string, e: ExpenseInput) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    check(await sb.from("expenses").update(cleanExpense(e)).eq("id", id));
    revalidatePath("/finance", "layout");
  });
}

export async function deleteExpenses(ids: string[]) {
  return safe(async () => {
    await staff();
    if (!ids.length) return;
    const sb = await createClient();
    check(await sb.from("expenses").delete().in("id", ids));
    revalidatePath("/finance", "layout");
  });
}

export async function recategorizeExpenses(ids: string[], pl: string, category: string | null) {
  return safe(async () => {
    await staff();
    if (!ids.length) throw new Error("Select expenses first");
    const sb = await createClient();
    check(await sb.from("expenses").update({ pl_class: plClass(pl), category: category?.trim() || null }).in("id", ids));
    revalidatePath("/finance", "layout");
    return ids.length;
  });
}

// ───────── Expense rules ─────────
export async function saveRule(rule: { id?: string; match: string; pl_class: string; category?: string | null }) {
  return safe(async () => {
    await staff();
    const match = rule.match.trim();
    if (!match) throw new Error("Vendor match text is required");
    const row = { match, pl_class: plClass(rule.pl_class), category: rule.category?.trim() || null };
    const sb = await createClient();
    if (rule.id) check(await sb.from("expense_rules").update(row).eq("id", rule.id));
    else check(await sb.from("expense_rules").insert(row));
    revalidatePath("/finance/expenses");
  });
}

export async function deleteRule(id: string) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    check(await sb.from("expense_rules").delete().eq("id", id));
    revalidatePath("/finance/expenses");
  });
}

/** Re-applies every rule to existing expenses and uncategorized Mercury outflows. Returns counts. */
export async function applyRulesToPast() {
  return safe(async () => {
    const p = await staff();
    const sb = await createClient();
    const rules = check(await sb.from("expense_rules").select("*").order("created_at")) as { match: string; pl_class: PlClass; category: string | null }[];
    let expenses = 0, transactions = 0;
    for (const r of rules) {
      const pattern = `%${r.match.replace(/[%_]/g, (m) => "\\" + m)}%`;
      const upd = check(await sb.from("expenses").update({ pl_class: r.pl_class, category: r.category }).ilike("vendor", pattern).select("id")) as { id: string }[];
      expenses += upd.length;
      const txns = check(await sb.from("mercury_transactions").select("id, amount, counterparty_name, bank_description, posted_at, created_at")
        .lt("amount", 0).eq("ignored", false).is("pl_class", null).ilike("counterparty_name", pattern)) as TxnLite[];
      for (const t of txns) { await categorizeTxnInternal(sb, t, r.pl_class, r.category, p.id); transactions++; }
    }
    revalidatePath("/finance", "layout");
    return { expenses, transactions };
  });
}

// ───────── Mercury transaction review ─────────
type TxnLite = { id: string; amount: number; counterparty_name: string | null; bank_description: string | null; posted_at: string | null; created_at: string | null };

async function categorizeTxnInternal(sb: Awaited<ReturnType<typeof createClient>>, t: TxnLite, pl: PlClass, category: string | null, userId: string) {
  check(await sb.from("mercury_transactions").update({ pl_class: pl, category }).eq("id", t.id));
  if (Number(t.amount) >= 0) return; // inflows are revenue/transfers, not expenses
  const row = {
    date: (t.posted_at ?? t.created_at ?? new Date().toISOString()).slice(0, 10),
    amount: Math.abs(Number(t.amount)),
    vendor: t.counterparty_name,
    description: t.bank_description,
    pl_class: pl,
    category,
    mercury_transaction_id: t.id,
    created_by: userId,
  };
  check(await sb.from("expenses").upsert(row, { onConflict: "mercury_transaction_id" }));
}

export async function categorizeTransactions(ids: string[], pl: string, category: string | null) {
  return safe(async () => {
    const p = await staff();
    if (!ids.length) throw new Error("Select transactions first");
    const sb = await createClient();
    const txns = check(await sb.from("mercury_transactions").select("id, amount, counterparty_name, bank_description, posted_at, created_at").in("id", ids)) as TxnLite[];
    for (const t of txns) await categorizeTxnInternal(sb, t, plClass(pl), category?.trim() || null, p.id);
    revalidatePath("/finance", "layout");
    return txns.length;
  });
}

export async function setTransactionsIgnored(ids: string[], ignored: boolean) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    check(await sb.from("mercury_transactions").update({ ignored }).in("id", ids));
    if (ignored) check(await sb.from("expenses").delete().in("mercury_transaction_id", ids));
    revalidatePath("/finance", "layout");
  });
}

// ───────── Marketing spend ─────────
export interface SpendInput { date: string; channel: string; campaign?: string | null; landing_page_id?: string | null; amount: number; impressions?: number | null; clicks?: number | null }

function cleanSpend(s: SpendInput) {
  const amount = Number(s.amount);
  if (!s.date || isNaN(+new Date(s.date))) throw new Error(`Invalid date "${s.date}"`);
  if (!s.channel?.trim()) throw new Error("Channel is required");
  if (!isFinite(amount) || amount < 0) throw new Error(`Invalid amount "${s.amount}"`);
  const int = (v: unknown) => (v === "" || v == null || isNaN(Number(v)) ? null : Math.round(Number(v)));
  return {
    date: s.date.slice(0, 10), channel: s.channel.trim().toLowerCase(), campaign: s.campaign?.trim() || null,
    landing_page_id: s.landing_page_id || null, amount, impressions: int(s.impressions), clicks: int(s.clicks),
  };
}

export async function saveSpend(s: SpendInput & { id?: string }) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    if (s.id) check(await sb.from("marketing_spend").update(cleanSpend(s)).eq("id", s.id));
    else check(await sb.from("marketing_spend").insert(cleanSpend(s)));
    revalidatePath("/analytics");
  });
}

export async function deleteSpend(id: string) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    check(await sb.from("marketing_spend").delete().eq("id", id));
    revalidatePath("/analytics");
  });
}

/** CSV rows: date, channel, campaign, amount, impressions, clicks, landing_page (slug or name, optional). */
export async function importSpend(rows: Record<string, string>[]) {
  return safe(async () => {
    await staff();
    const sb = await createClient();
    const pages = check(await sb.from("landing_pages").select("id, slug, name")) as { id: string; slug: string; name: string }[];
    const findPage = (v?: string) => {
      if (!v) return null;
      const k = v.trim().toLowerCase();
      return pages.find((p) => p.slug.toLowerCase() === k || p.name.toLowerCase() === k)?.id ?? null;
    };
    const clean = rows.map((r, i) => {
      try {
        return cleanSpend({
          date: r.date, channel: r.channel ?? r.source ?? "", campaign: r.campaign,
          amount: Number(String(r.amount ?? r.spend ?? "").replace(/[$,]/g, "")), impressions: r.impressions as unknown as number, clicks: r.clicks as unknown as number,
          landing_page_id: findPage(r.landing_page ?? r.page),
        });
      } catch (e) {
        throw new Error(`Row ${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    });
    if (!clean.length) throw new Error("No rows found. Expected headers: date, channel, campaign, amount, impressions, clicks, landing_page");
    check(await sb.from("marketing_spend").insert(clean));
    revalidatePath("/analytics");
    return clean.length;
  });
}

// ───────── Commissions ─────────
export async function approveCommissions(ids: string[]) {
  return safe(async () => {
    await admin();
    if (!ids.length) throw new Error("Select commissions first");
    const sb = await createClient();
    const rows = check(await sb.from("commissions").update({ status: "approved" }).in("id", ids).eq("status", "pending").select("id")) as { id: string }[];
    revalidatePath("/finance/commissions");
    return rows.length;
  });
}

export async function createPayout(input: { repId: string; commissionIds: string[]; method?: string; note?: string; paidAt?: string }) {
  return safe(async () => {
    const p = await admin();
    const sb = await createClient();
    const rows = check(await sb.from("commissions").select("id, amount, status, rep_id").in("id", input.commissionIds)) as { id: string; amount: number; status: string; rep_id: string }[];
    const eligible = rows.filter((r) => r.rep_id === input.repId && r.status === "approved");
    if (!eligible.length) throw new Error("No approved commissions for this rep in the selection");
    const amount = eligible.reduce((s, r) => s + Number(r.amount), 0);
    const payout = check(await sb.from("commission_payouts").insert({
      rep_id: input.repId, amount: Math.round(amount * 100) / 100, method: input.method || null, note: input.note || null,
      paid_at: input.paidAt ? new Date(input.paidAt + "T12:00:00").toISOString() : new Date().toISOString(), created_by: p.id,
    }).select("id").single()) as { id: string };
    check(await sb.from("commissions").update({ status: "paid", payout_id: payout.id }).in("id", eligible.map((r) => r.id)));
    await sb.from("notifications").insert({ user_id: input.repId, title: "Commission payout recorded", body: `$${amount.toFixed(2)} for ${eligible.length} commission(s)`, link: "/finance/commissions" });
    revalidatePath("/finance/commissions");
    return { amount, count: eligible.length };
  });
}

export async function clawbackCommission(id: string, note: string) {
  return safe(async () => {
    await admin();
    if (!note.trim()) throw new Error("Add a reason for the clawback");
    const sb = await createClient();
    check(await sb.from("commissions").update({ status: "clawed_back", note: note.trim() }).eq("id", id));
    revalidatePath("/finance/commissions");
  });
}

export async function setCommissionStatus(ids: string[], status: "pending" | "approved") {
  return safe(async () => {
    await admin();
    const sb = await createClient();
    check(await sb.from("commissions").update({ status }).in("id", ids).neq("status", "paid"));
    revalidatePath("/finance/commissions");
  });
}

/** Manual adjustment (bonus, spiff, or negative correction). */
export async function addCommissionAdjustment(input: { repId: string; amount: number; note: string; dealId?: string | null }) {
  return safe(async () => {
    await admin();
    const amount = Number(input.amount);
    if (!input.repId) throw new Error("Pick a rep");
    if (!isFinite(amount) || amount === 0) throw new Error("Amount must be non-zero");
    if (!input.note.trim()) throw new Error("Add a note");
    const sb = await createClient();
    check(await sb.from("commissions").insert({
      rep_id: input.repId, deal_id: input.dealId || null, basis: "one_time", base_amount: amount, rate: 1, amount,
      status: "approved", note: `Adjustment: ${input.note.trim()}`,
    }));
    revalidatePath("/finance/commissions");
  });
}

export async function deletePayout(id: string) {
  return safe(async () => {
    await admin();
    const sb = await createClient();
    check(await sb.from("commissions").update({ status: "approved", payout_id: null }).eq("payout_id", id));
    check(await sb.from("commission_payouts").delete().eq("id", id));
    revalidatePath("/finance/commissions");
  });
}
