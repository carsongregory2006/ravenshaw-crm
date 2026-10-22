/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase join rows and recharts render props are untyped */
import Link from "next/link";
import { format, startOfMonth, subMonths, subYears, endOfMonth } from "date-fns";
import { Landmark, Banknote, Percent, Activity, TrendingUp, Wallet, Hourglass, Calculator, Receipt } from "lucide-react";
import { Page, PageHeader, PageBody } from "@/components/ui/page";
import { Card } from "@/components/ui/misc";
import { requireStaff } from "@/lib/auth";
import { integrations } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { loadDataset } from "@/lib/metrics/load";
import { resolveRange, monthsBetween, monthLabel } from "@/lib/metrics/range";
import { pnl, arAging, cashflow, runway, expenseBreakdown, OPEX_CLASSES, PL_LABELS, type Pnl } from "@/lib/metrics/compute";
import { getMercuryBalance } from "@/lib/actions/finance";
import { RangePicker } from "@/components/analytics/range-picker";
import { Kpi } from "@/components/analytics/kpi";
import { BarList, ColumnChart, Donut } from "@/components/analytics/viz";
import { PnlTable, type PnlLine } from "@/components/analytics/pnl-table";
import { SyncMercuryButton } from "@/components/analytics/sync-mercury";
import { fmtDate, money } from "@/lib/utils";

export const metadata = { title: "P&L Overview" };

const LINES: PnlLine[] = [
  { key: "revenue", label: "Revenue (cash collected)", bold: true },
  { key: "revenueRecurring", label: "Recurring", indent: true },
  { key: "revenueOneTime", label: "One-time & milestones", indent: true },
  { key: "cogs", label: "Cost of goods sold", negative: true, separator: true },
  { key: "commissions", label: "Sales commissions", negative: true },
  { key: "grossProfit", label: "Gross profit", bold: true, separator: true },
  { key: "grossMargin", label: "Gross margin", kind: "pct" },
  ...OPEX_CLASSES.map((c) => ({ key: `opex_${c}`, label: PL_LABELS[c], negative: true, indent: true })),
  { key: "opex", label: "Total operating expenses", negative: true },
  { key: "ebitda", label: "EBITDA", bold: true, separator: true },
  { key: "ebitdaMargin", label: "EBITDA margin", kind: "pct" },
  { key: "interest", label: "Interest", negative: true, separator: true },
  { key: "tax", label: "Taxes", negative: true },
  { key: "da", label: "Depreciation & amortization", negative: true },
  { key: "netProfit", label: "Net profit", bold: true, separator: true },
  { key: "netMargin", label: "Net margin", kind: "pct" },
  { key: "ownerDraw", label: "Owner draws (below the line)", negative: true, separator: true },
];

const flat = (p: Pnl): Record<string, number | null> => ({
  ...Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === "number" || v === null)) as Record<string, number | null>,
  ...Object.fromEntries(Object.entries(p.opexByClass).map(([k, v]) => [`opex_${k}`, v])),
});

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireStaff();
  const range = resolveRange({ range: sp.range ?? "ytd", from: sp.from, to: sp.to });
  const { from, to, prevFrom, prevTo } = range;
  const yoyFrom = subYears(from, 1), yoyTo = subYears(to, 1);
  const ds = await loadDataset({ from, to, prevFrom: yoyFrom < prevFrom ? yoyFrom : prevFrom });
  const sb = await createClient();
  const [{ data: ws }, bal, { data: overdue }] = await Promise.all([
    sb.from("workspace_settings").select("tax_rate_estimate").eq("id", 1).single(),
    getMercuryBalance(),
    sb.from("invoices").select("id, invoice_number, amount, due_date, status, contact:contacts(first_name,last_name,email)").in("status", ["sent", "overdue"]).lt("due_date", format(new Date(), "yyyy-MM-dd")).order("due_date").limit(8),
  ]);

  const cur = pnl(ds, from, to), prev = pnl(ds, prevFrom, prevTo), yoy = pnl(ds, yoyFrom, yoyTo);
  const months = monthsBetween(from, to, 12);
  const columns = [
    ...(months.length > 1 ? months.map((m) => ({ label: format(m, "MMM yyyy"), values: flat(pnl(ds, m < from ? from : m, endOfMonth(m) > to ? to : endOfMonth(m))) })) : []),
    { label: `Total · ${range.label}`, values: flat(cur), emphasis: true },
    { label: "Previous period", values: flat(prev) },
    { label: "Same period last year", values: flat(yoy) },
  ];

  const cfMonths = monthsBetween(startOfMonth(subMonths(new Date(), 11)), new Date(), 12);
  const flows = cashflow(ds.txns, cfMonths);
  const balance = bal.ok && bal.data ? bal.data.balance : null;
  const rw = runway(balance, flows);
  const ar = arAging(ds.invoices);
  const taxRate = Number(ws?.tax_rate_estimate ?? 0.25);
  const estTax = Math.max(0, cur.netProfit) * taxRate;
  const breakdown = expenseBreakdown(ds.expenses, from, to);
  const donut = breakdown.length > 6 ? [...breakdown.slice(0, 5), { cls: "rest", label: "Other", amount: breakdown.slice(5).reduce((s, b) => s + b.amount, 0) }] : breakdown;
  if (cur.commissions) donut.push({ cls: "commissions", label: "Commissions", amount: cur.commissions });
  const donutData = donut.sort((a, b) => b.amount - a.amount).slice(0, 6);

  return (
    <Page>
      <PageHeader icon={Landmark} title="P&L Overview" actions={<>
        <SyncMercuryButton configured={integrations.mercury()} />
        <RangePicker value={range.key} label={range.label} from={format(from, "yyyy-MM-dd")} to={format(to, "yyyy-MM-dd")} />
      </>} />
      <PageBody className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Revenue (cash)" icon={Banknote} value={cur.revenue} prev={prev.revenue} />
          <Kpi label="Gross margin" icon={Percent} f="pct" value={cur.grossMargin} prev={prev.grossMargin} />
          <Kpi label="EBITDA" icon={Activity} value={cur.ebitda} prev={prev.ebitda} hint={cur.ebitdaMargin != null ? `${(cur.ebitdaMargin * 100).toFixed(1)}% margin` : undefined} />
          <Kpi label="Net profit" icon={TrendingUp} value={cur.netProfit} prev={prev.netProfit} />
          <Kpi label="Cash balance (Mercury)" icon={Wallet} value={balance} hint={bal.ok && bal.data ? bal.data.accounts.map((a) => `${a.name}: ${money(a.balance)}`).join(" · ") : integrations.mercury() ? (bal.ok ? "" : bal.error) : "Connect Mercury to see live balance"} />
          <Kpi label="Runway" icon={Hourglass} f="text" value={rw.months == null ? null : (rw.months === Infinity ? "Cash-flow positive" : `${rw.months.toFixed(1)} months`)}
            hint={rw.netBurn != null ? `Avg net burn ${money(rw.netBurn)}/mo · gross burn ${money(rw.grossBurn)}/mo (last 3 months)` : "Needs Mercury balance + transactions"} />
          <Kpi label={`Est. tax set-aside (${Math.round(taxRate * 100)}%)`} icon={Calculator} value={estTax} hint="Net profit in period × tax rate from Settings. Not tax advice." />
          <Kpi label="Outstanding AR" icon={Receipt} value={ar.outstanding} upIsGood={false} hint={`${money(ar.overdue)} overdue`} />
        </div>

        <Card title="Profit & loss statement" padded={false} className="p-2">
          <PnlTable lines={LINES} columns={columns} filename={`pnl-${format(from, "yyyy-MM-dd")}-${format(to, "yyyy-MM-dd")}`} />
          <p className="px-1 pt-2 text-xs text-fg-3">Cash-basis: revenue = payments received; expenses by P&L class from Expenses (incl. categorized Mercury transactions); commissions accrue when cash is collected. EBITDA excludes interest, taxes, D&A, owner draws and transfers.</p>
        </Card>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Cash flow — last 12 months (Mercury)">
            {flows.some((f) => f.inflow || f.outflow)
              ? <ColumnChart data={flows.map((f) => ({ ...f, label: monthLabel(f.month + "-01") }))} x="month" series={[{ key: "inflow", label: "Money in", slot: 1 }, { key: "outflow", label: "Money out", slot: 2 }]} />
              : <p className="text-[13px] text-fg-3">No Mercury transactions synced yet. {integrations.mercury() ? "Click Sync Mercury." : "Add MERCURY_API_KEY to connect your bank."}</p>}
          </Card>
          <Card title="Where the money goes" actions={<Link href="/finance/expenses" className="text-xs text-fg-3 hover:text-fg">Expenses →</Link>}>
            {donutData.length ? <Donut data={donutData} label="label" value="amount" /> : <p className="text-[13px] text-fg-3">No expenses recorded in this period.</p>}
          </Card>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Accounts receivable aging" actions={<Link href="/finance/invoices" className="text-xs text-fg-3 hover:text-fg">Invoices →</Link>}>
            <BarList data={ar.buckets} label="bucket" value="amount" f="money" />
          </Card>
          <Card title="Overdue invoices" padded={false}>
            {!overdue?.length ? <p className="p-3 text-[13px] text-fg-3">Nothing overdue.</p> : (
              <ul className="divide-y divide-border-light">
                {overdue.map((i: any) => (
                  <li key={i.id}>
                    <Link href={`/finance/invoices?q=${encodeURIComponent(i.invoice_number)}`} className="flex items-center gap-2 px-3 py-2 hover:bg-hover">
                      <span className="font-mono text-xs text-fg-3">{i.invoice_number}</span>
                      <span className="truncate text-[13px]">{[i.contact?.first_name, i.contact?.last_name].filter(Boolean).join(" ") || i.contact?.email || "—"}</span>
                      <span className="ml-auto text-xs text-danger">due {fmtDate(i.due_date)}</span>
                      <span className="w-20 text-right text-[13px] font-medium tabular-nums">{money(i.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageBody>
    </Page>
  );
}
