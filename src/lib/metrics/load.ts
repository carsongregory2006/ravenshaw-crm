/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase join rows and recharts render props are untyped */
import "server-only";
import { startOfMonth, subMonths } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import type { Dataset } from "./compute";

type Sb = Awaited<ReturnType<typeof createClient>>;

/** Fetch every row of a query (PostgREST caps responses at 1000 rows). */
async function all<T>(make: (sb: Sb) => any, sb: Sb, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await make(sb).range(i * page, i * page + page - 1);
    if (error) {
      // tables hidden by RLS for this role simply return nothing
      console.error("metrics load:", error.message);
      break;
    }
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
  }
  return out;
}

/**
 * Loads everything metrics need, scoped by the signed-in user's RLS.
 * Time-heavy tables load from `since` (default: 13 months before `from`, enough for 12-month trends + comparison).
 */
export async function loadDataset(opts: { from: Date; to: Date; prevFrom?: Date }): Promise<Dataset> {
  const sb = await createClient();
  const earliest = [opts.prevFrom ?? opts.from, startOfMonth(subMonths(opts.to, 12))].reduce((a, b) => (a < b ? a : b));
  const since = earliest.toISOString();
  const sinceDate = since.slice(0, 10);
  const until = opts.to.toISOString();

  const [
    payments, invoices, expenses, commissions, spend, deals, stages, contacts, clients, calls, messages, txns, lpEvents, stageChanges, profiles, pages, variants,
  ] = await Promise.all([
    all<Dataset["payments"][number]>((s) => s.from("payments").select("id, amount, kind, received_at, client_id, deal_id, contact_id").lte("received_at", until).order("received_at"), sb),
    all<Dataset["invoices"][number]>((s) => s.from("invoices").select("id, invoice_number, amount, status, due_date, issued_at, paid_at, client_id, contact_id, created_at").order("created_at"), sb),
    all<Dataset["expenses"][number]>((s) => s.from("expenses").select("id, date, amount, pl_class, category, vendor").gte("date", sinceDate).order("date"), sb),
    all<Dataset["commissions"][number]>((s) => s.from("commissions").select("id, rep_id, amount, status, created_at, basis, deal_id, base_amount").order("created_at"), sb),
    all<Dataset["spend"][number]>((s) => s.from("marketing_spend").select("id, date, channel, campaign, landing_page_id, amount, impressions, clicks").gte("date", sinceDate).order("date"), sb),
    all<Dataset["deals"][number]>((s) => s.from("deals").select("id, name, owner_id, stage_id, amount_one_time, amount_recurring, term_months, created_at, closed_at, source, contact_id").order("created_at"), sb),
    all<Dataset["stages"][number]>((s) => s.from("pipeline_stages").select("id, key, name, position, probability, is_won, is_lost, color").order("position"), sb),
    all<Dataset["contacts"][number]>((s) => s.from("contacts").select("id, created_at, source, utm_source, utm_campaign, landing_page_id, variant_id, owner_id, status").gte("created_at", since).lte("created_at", until).order("created_at"), sb),
    all<Dataset["clients"][number]>((s) => s.from("clients").select("id, status, mrr, start_date, churned_at, created_at, contact_id, health_score").order("created_at"), sb),
    all<Dataset["calls"][number]>((s) => s.from("calls").select("id, started_at, user_id, contact_id, direction, status, duration_sec").gte("started_at", since).order("started_at"), sb),
    all<Dataset["messages"][number]>((s) => s.from("messages").select("id, created_at, channel, direction, sent_by, contact_id, automation_run_id").gte("created_at", since).order("created_at"), sb),
    all<Dataset["txns"][number]>((s) => s.from("mercury_transactions").select("id, amount, posted_at, created_at, pl_class, ignored, kind").gte("created_at", since).order("created_at"), sb),
    all<Dataset["lpEvents"][number]>((s) => s.from("landing_page_events").select("page_id, variant_id, type, created_at").eq("type", "view").gte("created_at", since).order("created_at"), sb),
    all<Dataset["stageChanges"][number]>((s) => s.from("activities").select("deal_id, metadata").eq("type", "stage_change").order("created_at"), sb),
    all<Dataset["profiles"][number]>((s) => s.from("profiles").select("id, full_name, email, role, is_active").order("full_name"), sb),
    all<Dataset["pages"][number]>((s) => s.from("landing_pages").select("id, name").order("name"), sb),
    all<Dataset["variants"][number]>((s) => s.from("landing_page_variants").select("id, name, page_id").order("name"), sb),
  ]);

  const num = <T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[]) =>
    rows.map((r) => { const c = { ...r }; for (const k of keys) (c as Record<string, unknown>)[k as string] = Number(r[k] ?? 0); return c; });

  return {
    payments: num(payments as any[], ["amount"]),
    invoices: num(invoices as any[], ["amount"]),
    expenses: num(expenses as any[], ["amount"]),
    commissions: num(commissions as any[], ["amount", "base_amount"]),
    spend: num(spend as any[], ["amount"]),
    deals: num(deals as any[], ["amount_one_time", "amount_recurring"]),
    stages, contacts,
    clients: num(clients as any[], ["mrr"]),
    calls, messages,
    txns: num(txns as any[], ["amount"]),
    lpEvents, stageChanges, profiles, pages, variants,
  } as Dataset;
}
