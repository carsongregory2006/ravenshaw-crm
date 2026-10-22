/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase join rows and recharts render props are untyped */
import { format } from "date-fns";
import { Coins } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveRange } from "@/lib/metrics/range";
import { within } from "@/lib/metrics/compute";
import { RangePicker } from "@/components/analytics/range-picker";
import { CommissionsView, type LedgerRow, type PayoutRow, type RepRow } from "@/components/analytics/commissions-view";
import { contactLabel } from "@/lib/utils";

export const metadata = { title: "Commissions" };

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";
  const isStaff = isAdmin || profile.role === "ops";
  const range = resolveRange({ range: sp.range ?? "ytd", from: sp.from, to: sp.to });
  const sb = await createClient();

  const [{ data: comms }, { data: payouts }, { data: profiles }] = await Promise.all([
    sb.from("commissions").select("*, rep:profiles(full_name,email), deal:deals(deal_number), client:clients(contact:contacts(first_name,last_name,email), company:companies(name))")
      .order("created_at", { ascending: false }).limit(10000),
    sb.from("commission_payouts").select("*, rep:profiles!commission_payouts_rep_id_fkey(full_name,email)").order("paid_at", { ascending: false }).limit(1000),
    sb.from("profiles").select("id, full_name, email, role, is_active, commission_rate_setup, commission_rate_recurring, commission_recurring_months").order("full_name"),
  ]);

  const rows: LedgerRow[] = (comms ?? []).map((c: any) => ({
    id: c.id, created_at: c.created_at, rep_id: c.rep_id, rep_name: c.rep?.full_name || c.rep?.email || "Rep",
    client_name: c.client?.company?.name || (c.client?.contact ? contactLabel(c.client.contact) : null),
    deal_id: c.deal_id, deal_number: c.deal?.deal_number ?? null, basis: c.basis, base_amount: Number(c.base_amount), rate: Number(c.rate),
    amount: Number(c.amount), status: c.status, note: c.note, payout_id: c.payout_id, in_period: within(c.created_at, range.from, range.to),
  }));
  const countByPayout = new Map<string, number>();
  for (const r of rows) if (r.payout_id) countByPayout.set(r.payout_id, (countByPayout.get(r.payout_id) ?? 0) + 1);
  const payoutRows: PayoutRow[] = (payouts ?? []).map((p: any) => ({
    id: p.id, rep_id: p.rep_id, rep_name: p.rep?.full_name || p.rep?.email || "Rep", amount: Number(p.amount), paid_at: p.paid_at, method: p.method, note: p.note,
    count: countByPayout.get(p.id) ?? 0,
  }));
  const reps: RepRow[] = (profiles ?? [])
    .filter((p: any) => (isStaff ? p.is_active && (p.role === "sales_rep" || rows.some((r) => r.rep_id === p.id)) : p.id === profile.id))
    .map((p: any) => ({ id: p.id, name: p.full_name || p.email, rate_setup: Number(p.commission_rate_setup), rate_recurring: Number(p.commission_rate_recurring), recurring_months: p.commission_recurring_months }));

  return (
    <Page>
      <PageHeader icon={Coins} title={isStaff ? "Commissions" : "My commissions"}
        actions={<RangePicker value={range.key} label={range.label} from={format(range.from, "yyyy-MM-dd")} to={format(range.to, "yyyy-MM-dd")} />} />
      <CommissionsView rows={rows} payouts={payoutRows} reps={reps} isAdmin={isAdmin} isStaff={isStaff} />
    </Page>
  );
}
