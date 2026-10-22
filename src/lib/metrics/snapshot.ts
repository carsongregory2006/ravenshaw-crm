// Compact JSON summary of the business for the AI ("Ask AI" + weekly briefing).
import { subMonths, startOfMonth } from "date-fns";
import type { Dataset } from "./compute";
import {
  pnl, clientMetrics, salesMetrics, funnel, repLeaderboard, arAging, expenseBreakdown, leadSources, commissionSummary,
  pipelineByStage, monthlyPnl, responseTimes,
} from "./compute";
import type { DateRange } from "./range";

const r2 = (v: number | null | undefined) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const roundAll = (o: unknown): unknown => {
  if (typeof o === "number") return r2(o);
  if (Array.isArray(o)) return o.map(roundAll);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, roundAll(v)]));
  return o;
};

export function businessSnapshot(ds: Dataset, range: DateRange, opts: { staff: boolean; repId?: string; repName?: string }) {
  const { from, to, prevFrom, prevTo } = range;
  const owner = opts.staff ? null : opts.repId ?? null;
  const base = {
    period: { label: range.label, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    scope: opts.staff ? "whole company" : `sales rep ${opts.repName ?? ""} (own book only)`,
    sales: { current: salesMetrics(ds, from, to, owner), previous: salesMetrics(ds, prevFrom, prevTo, owner) },
    pipelineByStage: pipelineByStage(ds, owner),
    leadSources: leadSources(owner ? ds.contacts.filter((c) => c.owner_id === owner) : ds.contacts, from, to, 8),
    commissions: commissionSummary(ds.commissions, owner ?? undefined),
  };
  if (!opts.staff) return roundAll(base);
  const trailing = monthlyPnl(ds, startOfMonth(subMonths(to, 5)), to, 6).map((m) => ({
    month: m.month.toISOString().slice(0, 7), revenue: m.revenue, grossProfit: m.grossProfit, ebitda: m.ebitda, netProfit: m.netProfit,
  }));
  return roundAll({
    ...base,
    pnl: { current: pnl(ds, from, to), previous: pnl(ds, prevFrom, prevTo) },
    trailing6Months: trailing,
    clients: clientMetrics(ds, from, to),
    receivables: arAging(ds.invoices),
    expenses: expenseBreakdown(ds.expenses, from, to),
    funnelBySource: funnel(ds, from, to, "source").slice(0, 8).map(({ label, leads, booked, won, revenue, spend, cpl, roas }) => ({ label, leads, booked, won, revenue, spend, cpl, roas })),
    funnelByLandingPage: funnel(ds, from, to, "landing_page").slice(0, 8).map(({ label, views, leads, booked, won, revenue, conversionRate }) => ({ label, views, leads, booked, won, revenue, conversionRate })),
    reps: repLeaderboard(ds, from, to).map(({ name, leads, booked, won, bookedRevenue, collected, commissions, calls, sms, emails, speedToLeadMin }) => ({ name, leads, booked, won, bookedRevenue, collected, commissions, calls, sms, emails, speedToLeadMin })),
    responsiveness: responseTimes(ds, from, to),
  });
}
