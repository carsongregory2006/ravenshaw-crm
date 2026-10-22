/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase join rows and recharts render props are untyped */
import { format } from "date-fns";
import { Wallet } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { integrations } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/metrics/range";
import { RangePicker } from "@/components/analytics/range-picker";
import { SyncMercuryButton } from "@/components/analytics/sync-mercury";
import { ExpensesView, type ExpenseItem, type TxnItem } from "@/components/analytics/expenses-view";
import { contactLabel } from "@/lib/utils";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireStaff();
  const range = resolveRange({ range: sp.range ?? "this_month", from: sp.from, to: sp.to });
  const sb = await createClient();
  const d = (x: Date) => format(x, "yyyy-MM-dd");

  const [{ data: expenses }, { data: rules }, { data: txns }, { data: clients }] = await Promise.all([
    sb.from("expenses").select("*, client:clients(contact:contacts(first_name,last_name,email), company:companies(name))")
      .gte("date", d(range.from)).lte("date", d(range.to)).order("date", { ascending: false }).limit(5000),
    sb.from("expense_rules").select("id, match, pl_class, category").order("match"),
    sb.from("mercury_transactions").select("id, amount, counterparty_name, bank_description, posted_at, created_at, pl_class, category, matched_invoice_id, ignored, kind, status")
      .gte("created_at", range.from.toISOString()).lte("created_at", range.to.toISOString()).order("created_at", { ascending: false }).limit(5000),
    sb.from("clients").select("id, contact:contacts(first_name,last_name,email), company:companies(name)").neq("status", "churned"),
  ]);

  const clientName = (c: any) => c?.company?.name || (c?.contact ? contactLabel(c.contact) : null);
  return (
    <Page>
      <PageHeader icon={Wallet} title="Expenses" actions={<>
        <SyncMercuryButton configured={integrations.mercury()} />
        <RangePicker value={range.key} label={range.label} from={d(range.from)} to={d(range.to)} />
      </>} />
      <ExpensesView
        expenses={(expenses ?? []).map((e: any): ExpenseItem => ({ ...e, amount: Number(e.amount), client_name: clientName(e.client) }))}
        rules={rules ?? []}
        txns={(txns ?? []).map((t: any): TxnItem => ({ ...t, amount: Number(t.amount) }))}
        clients={(clients ?? []).map((c: any) => ({ id: c.id, name: clientName(c) ?? "Client" }))}
      />
    </Page>
  );
}
