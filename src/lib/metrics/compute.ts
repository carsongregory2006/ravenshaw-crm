// Pure business-metric computation. No I/O — feed it a Dataset (see load.ts).
import { addMonths, differenceInMinutes, differenceInCalendarDays, startOfMonth, endOfMonth, isAfter, isBefore } from "date-fns";
import type { PlClass } from "@/lib/types";
import { monthKey, monthsBetween } from "./range";

// ───────── Row shapes (subset of columns we load) ─────────
export interface PaymentRow { id: string; amount: number; kind: string; received_at: string; client_id: string | null; deal_id: string | null; contact_id: string | null }
export interface InvoiceRow { id: string; invoice_number: string; amount: number; status: string; due_date: string | null; issued_at: string | null; paid_at: string | null; client_id: string | null; contact_id: string | null; created_at: string }
export interface ExpenseRow { id: string; date: string; amount: number; pl_class: PlClass; category: string | null; vendor: string | null }
export interface CommissionRow { id: string; rep_id: string; amount: number; status: string; created_at: string; basis: string; deal_id: string | null; base_amount: number }
export interface SpendRow { id: string; date: string; channel: string; campaign: string | null; landing_page_id: string | null; amount: number; impressions: number | null; clicks: number | null }
export interface DealRow { id: string; name: string; owner_id: string | null; stage_id: string; amount_one_time: number; amount_recurring: number; term_months: number | null; created_at: string; closed_at: string | null; source: string | null; contact_id: string | null }
export interface StageRow { id: string; key: string; name: string; position: number; probability: number; is_won: boolean; is_lost: boolean; color: string }
export interface ContactRow { id: string; created_at: string; source: string | null; utm_source: string | null; utm_campaign: string | null; landing_page_id: string | null; variant_id: string | null; owner_id: string | null; status: string }
export interface ClientRow { id: string; status: string; mrr: number; start_date: string; churned_at: string | null; created_at: string; contact_id: string; health_score: number | null }
export interface CallRow { id: string; started_at: string; user_id: string | null; contact_id: string | null; direction: string; status: string; duration_sec: number | null }
export interface MessageRow { id: string; created_at: string; channel: string; direction: string; sent_by: string | null; contact_id: string | null; automation_run_id: string | null }
export interface TxnRow { id: string; amount: number; posted_at: string | null; created_at: string | null; pl_class: string | null; ignored: boolean; kind: string | null }
export interface LpEventRow { page_id: string; variant_id: string | null; type: string; created_at: string }
export interface StageChangeRow { deal_id: string | null; metadata: { from?: string; to?: string } }
export interface ProfileRow { id: string; full_name: string | null; email: string; role: string; is_active: boolean }
export interface NamedRow { id: string; name: string }

export interface Dataset {
  payments: PaymentRow[];
  invoices: InvoiceRow[];
  expenses: ExpenseRow[];
  commissions: CommissionRow[];
  spend: SpendRow[];
  deals: DealRow[];
  stages: StageRow[];
  contacts: ContactRow[];
  clients: ClientRow[];
  calls: CallRow[];
  messages: MessageRow[];
  txns: TxnRow[];
  lpEvents: LpEventRow[];
  stageChanges: StageChangeRow[];
  profiles: ProfileRow[];
  pages: NamedRow[];
  variants: (NamedRow & { page_id: string })[];
}

// ───────── helpers ─────────
const n = (v: unknown) => Number(v ?? 0) || 0;
export const within = (d: string | null | undefined, from: Date, to: Date) => {
  if (!d) return false;
  const t = new Date(d.length === 10 ? d + "T12:00:00" : d).getTime();
  return t >= from.getTime() && t <= to.getTime();
};
const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);
export const ratio = (a: number, b: number) => (b ? a / b : null);
export const change = (cur: number | null, prev: number | null) => (cur == null || prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev));
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const dealTcv = (d: Pick<DealRow, "amount_one_time" | "amount_recurring" | "term_months">) => n(d.amount_one_time) + n(d.amount_recurring) * (d.term_months ?? 12);

export const OPEX_CLASSES: PlClass[] = ["payroll", "marketing", "software", "opex", "other"];
export const PL_LABELS: Record<string, string> = {
  cogs: "COGS", payroll: "Payroll", marketing: "Marketing", software: "Software", opex: "Operating", other: "Other",
  tax: "Taxes", interest: "Interest", depreciation: "Depreciation", amortization: "Amortization", owner_draw: "Owner draw", transfer: "Transfer",
};

// ───────── P&L ─────────
export interface Pnl {
  revenue: number; revenueOneTime: number; revenueRecurring: number;
  cogs: number; commissions: number; grossProfit: number; grossMargin: number | null;
  opexByClass: Record<string, number>; opex: number;
  ebitda: number; ebitdaMargin: number | null;
  interest: number; tax: number; da: number; netProfit: number; netMargin: number | null;
  ownerDraw: number;
}

export function pnl(ds: Pick<Dataset, "payments" | "expenses" | "commissions">, from: Date, to: Date): Pnl {
  const pays = ds.payments.filter((p) => within(p.received_at, from, to));
  const exps = ds.expenses.filter((e) => within(e.date, from, to));
  const comm = ds.commissions.filter((c) => c.status !== "clawed_back" && within(c.created_at, from, to));
  const revenue = sumBy(pays, (p) => n(p.amount));
  const revenueRecurring = sumBy(pays.filter((p) => p.kind === "recurring"), (p) => n(p.amount));
  const byClass = (cls: string) => sumBy(exps.filter((e) => e.pl_class === cls), (e) => n(e.amount));
  const cogs = byClass("cogs");
  const commissions = sumBy(comm, (c) => n(c.amount));
  const grossProfit = revenue - cogs - commissions;
  const opexByClass: Record<string, number> = Object.fromEntries(OPEX_CLASSES.map((c) => [c, byClass(c)]));
  const opex = sumBy(Object.values(opexByClass), (v) => v);
  const ebitda = grossProfit - opex;
  const interest = byClass("interest"), tax = byClass("tax"), da = byClass("depreciation") + byClass("amortization");
  const netProfit = ebitda - interest - tax - da;
  return {
    revenue, revenueOneTime: revenue - revenueRecurring, revenueRecurring, cogs, commissions, grossProfit, grossMargin: ratio(grossProfit, revenue),
    opexByClass, opex, ebitda, ebitdaMargin: ratio(ebitda, revenue), interest, tax, da, netProfit, netMargin: ratio(netProfit, revenue),
    ownerDraw: byClass("owner_draw"),
  };
}

export function monthlyPnl(ds: Pick<Dataset, "payments" | "expenses" | "commissions">, from: Date, to: Date, cap = 12) {
  return monthsBetween(from, to, cap).map((m) => {
    const f = m < from ? from : m;
    const e = endOfMonth(m) > to ? to : endOfMonth(m);
    return { month: m, ...pnl(ds, f, e) };
  });
}

/** Total expenses (all P&L classes except transfers/owner draws) per month, for revenue-vs-expense charts. */
export function revenueVsExpenses(ds: Pick<Dataset, "payments" | "expenses" | "commissions">, months: Date[]) {
  return months.map((m) => {
    const p = pnl(ds, m, endOfMonth(m));
    const expenses = p.cogs + p.commissions + p.opex + p.interest + p.tax + p.da;
    return { month: monthKey(m), revenue: p.revenue, expenses, net: p.netProfit };
  });
}

// ───────── Clients / SaaS-style ─────────
const activeAt = (c: ClientRow, d: Date) =>
  new Date(c.start_date + "T00:00:00") <= d && (!c.churned_at || new Date(c.churned_at) > d);

export function clientMetrics(ds: Pick<Dataset, "clients" | "payments" | "expenses" | "commissions" | "spend">, from: Date, to: Date) {
  const live = ds.clients.filter((c) => c.status !== "churned");
  const mrr = sumBy(live, (c) => n(c.mrr));
  const startActive = ds.clients.filter((c) => activeAt(c, from));
  const newClients = ds.clients.filter((c) => within(c.start_date, from, to));
  const churned = ds.clients.filter((c) => within(c.churned_at, from, to));
  const newMrr = sumBy(newClients, (c) => n(c.mrr));
  const churnedMrr = sumBy(churned, (c) => n(c.mrr));
  const months = Math.max(1, differenceInCalendarDays(to, from) / 30.44);
  const startMrr = sumBy(startActive, (c) => n(c.mrr));
  const logoChurnMonthly = startActive.length ? churned.length / startActive.length / months : null;
  const revenueChurnMonthly = startMrr ? churnedMrr / startMrr / months : null;

  const p = pnl(ds, from, to);
  const activeCount = ds.clients.filter((c) => activeAt(c, to) || within(c.start_date, from, to)).length;
  const arpcMonthly = activeCount ? p.revenue / activeCount / months : null;
  const gm = p.grossMargin ?? 1;

  // lifetime collected per client (fallback LTV)
  const collectedByClient = new Map<string, number>();
  for (const pay of ds.payments) if (pay.client_id) collectedByClient.set(pay.client_id, (collectedByClient.get(pay.client_id) ?? 0) + n(pay.amount));
  const avgCollected = ds.clients.length ? sumBy([...collectedByClient.values()], (v) => v) / ds.clients.length : null;

  const ltv = arpcMonthly != null && logoChurnMonthly ? (arpcMonthly * Math.max(gm, 0)) / logoChurnMonthly : avgCollected;
  const spend = sumBy(ds.spend.filter((s) => within(s.date, from, to)), (s) => n(s.amount));
  const cac = newClients.length ? spend / newClients.length : null;
  const ltvCac = ltv != null && cac ? ltv / cac : null;
  const paybackMonths = cac != null && arpcMonthly ? cac / (arpcMonthly * Math.max(gm, 0.01)) : null;
  return {
    mrr, arr: mrr * 12, activeClients: live.length, newClients: newClients.length, churnedClients: churned.length,
    newMrr, churnedMrr, netNewMrr: newMrr - churnedMrr, logoChurnMonthly, revenueChurnMonthly,
    arpcMonthly, ltv, ltvIsFallback: !(arpcMonthly != null && logoChurnMonthly), cac, ltvCac, paybackMonths, marketingSpend: spend,
  };
}

export function mrrWaterfall(clients: ClientRow[], months: Date[]) {
  return months.map((m) => {
    const end = endOfMonth(m);
    const starting = sumBy(clients.filter((c) => activeAt(c, m) && !within(c.start_date, m, end)), (c) => n(c.mrr));
    const added = sumBy(clients.filter((c) => within(c.start_date, m, end)), (c) => n(c.mrr));
    const lost = sumBy(clients.filter((c) => within(c.churned_at, m, end)), (c) => n(c.mrr));
    return { month: monthKey(m), starting, added, lost, ending: starting + added - lost };
  });
}

/** Retention matrix: for each start-month cohort, % of clients still active k months later. */
export function cohorts(clients: ClientRow[], now = new Date(), maxMonths = 12) {
  const groups = new Map<string, ClientRow[]>();
  for (const c of clients) {
    const k = monthKey(c.start_date + "T00:00:00");
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-maxMonths).map(([month, rows]) => {
    const start = startOfMonth(new Date(month + "-01T00:00:00"));
    const cells: (number | null)[] = [];
    for (let k = 0; k < maxMonths; k++) {
      const at = endOfMonth(addMonths(start, k));
      if (isAfter(startOfMonth(at), now)) { cells.push(null); continue; }
      const point = isBefore(at, now) ? at : now;
      cells.push(rows.filter((c) => !c.churned_at || new Date(c.churned_at) > point).length / rows.length);
    }
    return { month, size: rows.length, cells };
  });
}

export function healthBuckets(clients: ClientRow[]) {
  const live = clients.filter((c) => c.status !== "churned");
  return [
    { bucket: "At risk (0–39)", count: live.filter((c) => (c.health_score ?? 0) < 40).length },
    { bucket: "Watch (40–69)", count: live.filter((c) => (c.health_score ?? 0) >= 40 && (c.health_score ?? 0) < 70).length },
    { bucket: "Healthy (70–100)", count: live.filter((c) => (c.health_score ?? 0) >= 70).length },
  ];
}

// ───────── Sales ─────────
export function stageMaps(stages: StageRow[]) {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const byName = new Map(stages.map((s) => [s.name, s]));
  const byKey = new Map(stages.map((s) => [s.key, s]));
  return { byId, byName, byKey };
}

/** Highest pipeline position each deal ever reached (current stage + stage history), ignoring Lost. */
export function reachedPositions(ds: Pick<Dataset, "deals" | "stages" | "stageChanges">) {
  const { byId, byName } = stageMaps(ds.stages);
  const reached = new Map<string, number>();
  const bump = (dealId: string, pos: number | undefined) => {
    if (pos == null) return;
    reached.set(dealId, Math.max(reached.get(dealId) ?? -1, pos));
  };
  for (const d of ds.deals) {
    const s = byId.get(d.stage_id);
    if (s && !s.is_lost) bump(d.id, s.position);
    else reached.set(d.id, reached.get(d.id) ?? 0);
  }
  for (const c of ds.stageChanges) {
    if (!c.deal_id) continue;
    for (const nm of [c.metadata?.from, c.metadata?.to]) {
      const s = nm ? byName.get(nm) : undefined;
      if (s && !s.is_lost) bump(c.deal_id, s.position);
    }
  }
  return reached;
}

export function salesMetrics(ds: Pick<Dataset, "deals" | "stages" | "contacts" | "messages" | "calls">, from: Date, to: Date, ownerId?: string | null) {
  const { byId } = stageMaps(ds.stages);
  const deals = ownerId ? ds.deals.filter((d) => d.owner_id === ownerId) : ds.deals;
  const contacts = ownerId ? ds.contacts.filter((c) => c.owner_id === ownerId) : ds.contacts;
  const closed = deals.filter((d) => within(d.closed_at, from, to));
  const won = closed.filter((d) => byId.get(d.stage_id)?.is_won);
  const lost = closed.filter((d) => byId.get(d.stage_id)?.is_lost);
  const open = deals.filter((d) => { const s = byId.get(d.stage_id); return s && !s.is_won && !s.is_lost; });
  const bookedRevenue = sumBy(won, dealTcv);
  const cycle = won.map((d) => differenceInCalendarDays(new Date(d.closed_at!), new Date(d.created_at)));
  return {
    newLeads: contacts.filter((c) => within(c.created_at, from, to)).length,
    dealsCreated: deals.filter((d) => within(d.created_at, from, to)).length,
    won: won.length, lost: lost.length,
    winRate: ratio(won.length, won.length + lost.length),
    bookedRevenue,
    avgDealSize: won.length ? bookedRevenue / won.length : null,
    avgCycleDays: cycle.length ? sumBy(cycle, (x) => x) / cycle.length : null,
    pipelineValue: sumBy(open, dealTcv),
    weightedPipeline: sumBy(open, (d) => dealTcv(d) * (byId.get(d.stage_id)?.probability ?? 0) / 100),
    openDeals: open.length,
    speedToLeadMin: speedToLead(ds, from, to, ownerId),
  };
}

/** Median minutes from contact creation to the first outbound SMS/email/call. */
export function speedToLead(ds: Pick<Dataset, "contacts" | "messages" | "calls">, from: Date, to: Date, ownerId?: string | null) {
  const first = new Map<string, number>();
  const note = (cid: string | null, at: string) => {
    if (!cid) return;
    const t = new Date(at).getTime();
    if (!first.has(cid) || t < first.get(cid)!) first.set(cid, t);
  };
  for (const m of ds.messages) if (m.direction === "outbound") note(m.contact_id, m.created_at);
  for (const c of ds.calls) if (c.direction === "outbound") note(c.contact_id, c.started_at);
  const mins: number[] = [];
  for (const c of ds.contacts) {
    if (!within(c.created_at, from, to) || (ownerId && c.owner_id !== ownerId)) continue;
    const f = first.get(c.id);
    if (f != null && f >= new Date(c.created_at).getTime()) mins.push(differenceInMinutes(new Date(f), new Date(c.created_at)));
  }
  return median(mins);
}

export function pipelineByStage(ds: Pick<Dataset, "deals" | "stages">, ownerId?: string | null) {
  return [...ds.stages].sort((a, b) => a.position - b.position).filter((s) => !s.is_lost).map((s) => {
    const rows = ds.deals.filter((d) => d.stage_id === s.id && (!ownerId || d.owner_id === ownerId));
    return { stage: s.name, key: s.key, count: rows.length, value: sumBy(rows, dealTcv), weighted: sumBy(rows, (d) => dealTcv(d) * s.probability / 100) };
  });
}

// ───────── Funnel / attribution ─────────
export type GroupBy = "source" | "campaign" | "landing_page" | "variant" | "rep";

export const contactSource = (c: Pick<ContactRow, "source" | "utm_source">) => (c.utm_source || c.source || "Direct").trim() || "Direct";

export interface FunnelRow {
  key: string; label: string; leads: number; booked: number; showed: number; proposal: number; won: number;
  revenue: number; spend: number; cpl: number | null; bookedRate: number | null; showRate: number | null; closeRate: number | null; roas: number | null;
  views?: number; conversionRate?: number | null;
}

export function funnel(ds: Dataset, from: Date, to: Date, groupBy: GroupBy): FunnelRow[] {
  const { byKey } = stageMaps(ds.stages);
  const pos = (k: string) => byKey.get(k)?.position ?? Infinity;
  const reached = reachedPositions(ds);
  const dealsByContact = new Map<string, DealRow[]>();
  for (const d of ds.deals) if (d.contact_id) dealsByContact.set(d.contact_id, [...(dealsByContact.get(d.contact_id) ?? []), d]);
  const paidByContact = new Map<string, number>();
  for (const p of ds.payments) if (p.contact_id) paidByContact.set(p.contact_id, (paidByContact.get(p.contact_id) ?? 0) + n(p.amount));
  const pageName = new Map(ds.pages.map((p) => [p.id, p.name]));
  const variantName = new Map(ds.variants.map((v) => [v.id, `${pageName.get(v.page_id) ?? "Page"} · ${v.name}`]));
  const repName = new Map(ds.profiles.map((p) => [p.id, p.full_name || p.email]));
  const { byId } = stageMaps(ds.stages);

  const keyOf = (c: ContactRow): [string, string] => {
    switch (groupBy) {
      case "campaign": return [c.utm_campaign || "(none)", c.utm_campaign || "(none)"];
      case "landing_page": return [c.landing_page_id ?? "none", c.landing_page_id ? pageName.get(c.landing_page_id) ?? "Unknown page" : "No landing page"];
      case "variant": return [c.variant_id ?? "none", c.variant_id ? variantName.get(c.variant_id) ?? "Unknown variant" : "No variant"];
      case "rep": return [c.owner_id ?? "none", c.owner_id ? repName.get(c.owner_id) ?? "Unknown" : "Unassigned"];
      default: { const s = contactSource(c); return [s.toLowerCase(), s]; }
    }
  };

  const rows = new Map<string, FunnelRow>();
  const get = (k: string, label: string) => {
    if (!rows.has(k)) rows.set(k, { key: k, label, leads: 0, booked: 0, showed: 0, proposal: 0, won: 0, revenue: 0, spend: 0, cpl: null, bookedRate: null, showRate: null, closeRate: null, roas: null });
    return rows.get(k)!;
  };
  for (const c of ds.contacts) {
    if (!within(c.created_at, from, to)) continue;
    const [k, label] = keyOf(c);
    const r = get(k, label);
    r.leads++;
    const deals = dealsByContact.get(c.id) ?? [];
    const best = Math.max(-1, ...deals.map((d) => reached.get(d.id) ?? -1));
    if (best >= pos("booked")) r.booked++;
    if (best >= pos("showed")) r.showed++;
    if (best >= pos("proposal")) r.proposal++;
    if (deals.some((d) => byId.get(d.stage_id)?.is_won)) r.won++;
    r.revenue += paidByContact.get(c.id) ?? 0;
  }
  // spend attribution
  for (const s of ds.spend) {
    if (!within(s.date, from, to)) continue;
    if (groupBy === "source") { const k = s.channel.trim().toLowerCase(); get(k, s.channel).spend += n(s.amount); }
    else if (groupBy === "campaign" && s.campaign) get(s.campaign, s.campaign).spend += n(s.amount);
    else if (groupBy === "landing_page" && s.landing_page_id) get(s.landing_page_id, pageName.get(s.landing_page_id) ?? "Unknown page").spend += n(s.amount);
  }
  if (groupBy === "landing_page" || groupBy === "variant") {
    for (const e of ds.lpEvents) {
      if (e.type !== "view" || !within(e.created_at, from, to)) continue;
      const k = groupBy === "landing_page" ? e.page_id : e.variant_id ?? "none";
      const label = groupBy === "landing_page" ? pageName.get(e.page_id) ?? "Unknown page" : e.variant_id ? variantName.get(e.variant_id) ?? "Unknown variant" : "No variant";
      const r = get(k, label);
      r.views = (r.views ?? 0) + 1;
    }
  }
  for (const r of rows.values()) {
    r.cpl = r.spend && r.leads ? r.spend / r.leads : null;
    r.bookedRate = ratio(r.booked, r.leads);
    r.showRate = ratio(r.showed, r.booked);
    r.closeRate = ratio(r.won, r.leads);
    r.roas = r.spend ? r.revenue / r.spend : null;
    if (r.views != null) r.conversionRate = ratio(r.leads, r.views);
  }
  return [...rows.values()].sort((a, b) => b.leads - a.leads || b.revenue - a.revenue);
}

export function funnelTotals(rows: FunnelRow[]) {
  const t = { leads: 0, booked: 0, showed: 0, proposal: 0, won: 0 };
  for (const r of rows) { t.leads += r.leads; t.booked += r.booked; t.showed += r.showed; t.proposal += r.proposal; t.won += r.won; }
  return t;
}

// ───────── Reps ─────────
export function repLeaderboard(ds: Dataset, from: Date, to: Date) {
  const { byId } = stageMaps(ds.stages);
  return ds.profiles.filter((p) => p.role === "sales_rep" || ds.deals.some((d) => d.owner_id === p.id) || ds.contacts.some((c) => c.owner_id === p.id)).map((p) => {
    const f = funnel({ ...ds, contacts: ds.contacts.filter((c) => c.owner_id === p.id) }, from, to, "rep");
    const t = funnelTotals(f);
    const wonDeals = ds.deals.filter((d) => d.owner_id === p.id && within(d.closed_at, from, to) && byId.get(d.stage_id)?.is_won);
    const dealIds = new Set(ds.deals.filter((d) => d.owner_id === p.id).map((d) => d.id));
    return {
      id: p.id, name: p.full_name || p.email, active: p.is_active,
      leads: t.leads, booked: t.booked, showed: t.showed, won: wonDeals.length,
      bookedRevenue: sumBy(wonDeals, dealTcv),
      collected: sumBy(ds.payments.filter((pay) => pay.deal_id && dealIds.has(pay.deal_id) && within(pay.received_at, from, to)), (x) => n(x.amount)),
      commissions: sumBy(ds.commissions.filter((c) => c.rep_id === p.id && c.status !== "clawed_back" && within(c.created_at, from, to)), (c) => n(c.amount)),
      calls: ds.calls.filter((c) => c.user_id === p.id && within(c.started_at, from, to)).length,
      sms: ds.messages.filter((m) => m.sent_by === p.id && m.channel === "sms" && m.direction === "outbound" && within(m.created_at, from, to)).length,
      emails: ds.messages.filter((m) => m.sent_by === p.id && m.channel === "email" && m.direction === "outbound" && within(m.created_at, from, to)).length,
      speedToLeadMin: speedToLead(ds, from, to, p.id),
    };
  }).sort((a, b) => b.bookedRevenue - a.bookedRevenue || b.won - a.won);
}

// ───────── Activity ─────────
export function activitySeries(ds: Pick<Dataset, "calls" | "messages">, from: Date, to: Date) {
  const weekly = differenceInCalendarDays(to, from) > 62;
  const bucket = (d: string) => {
    const dt = new Date(d);
    if (weekly) { const s = new Date(dt); s.setDate(dt.getDate() - dt.getDay()); return s.toISOString().slice(0, 10); }
    return dt.toISOString().slice(0, 10);
  };
  const map = new Map<string, { date: string; calls: number; sms: number; emails: number; inbound: number }>();
  const get = (k: string) => { if (!map.has(k)) map.set(k, { date: k, calls: 0, sms: 0, emails: 0, inbound: 0 }); return map.get(k)!; };
  // seed every bucket so gaps render as zero
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + (weekly ? 7 : 1))) get(bucket(d.toISOString()));
  for (const c of ds.calls) if (within(c.started_at, from, to)) get(bucket(c.started_at)).calls++;
  for (const m of ds.messages) {
    if (!within(m.created_at, from, to)) continue;
    const r = get(bucket(m.created_at));
    if (m.direction === "inbound") r.inbound++;
    else if (m.channel === "sms") r.sms++;
    else r.emails++;
  }
  return { weekly, rows: [...map.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Median minutes between an inbound message and the next outbound reply to the same contact. */
export function responseTimes(ds: Pick<Dataset, "messages" | "calls">, from: Date, to: Date) {
  const byContact = new Map<string, { t: number; dir: string; channel: string }[]>();
  for (const m of ds.messages) if (m.contact_id) byContact.set(m.contact_id, [...(byContact.get(m.contact_id) ?? []), { t: new Date(m.created_at).getTime(), dir: m.direction, channel: m.channel }]);
  for (const c of ds.calls) if (c.contact_id && c.direction === "outbound") byContact.set(c.contact_id, [...(byContact.get(c.contact_id) ?? []), { t: new Date(c.started_at).getTime(), dir: "outbound", channel: "call" }]);
  const out: Record<"sms" | "email", number[]> = { sms: [], email: [] };
  let unanswered = 0;
  for (const evs of byContact.values()) {
    evs.sort((a, b) => a.t - b.t);
    evs.forEach((e, i) => {
      if (e.dir !== "inbound" || e.t < from.getTime() || e.t > to.getTime()) return;
      if (i > 0 && evs[i - 1].dir === "inbound") return; // only first inbound of a burst
      const reply = evs.slice(i + 1).find((x) => x.dir === "outbound");
      if (!reply) { unanswered++; return; }
      (e.channel === "email" ? out.email : out.sms).push((reply.t - e.t) / 60000);
    });
  }
  return { smsMedianMin: median(out.sms), emailMedianMin: median(out.email), unanswered, answered: out.sms.length + out.email.length };
}

// ───────── Cash / AR ─────────
export function cashflow(txns: TxnRow[], months: Date[]) {
  return months.map((m) => {
    const rows = txns.filter((t) => !t.ignored && within(t.posted_at ?? t.created_at, m, endOfMonth(m)));
    const inflow = sumBy(rows.filter((t) => n(t.amount) > 0), (t) => n(t.amount));
    const outflow = sumBy(rows.filter((t) => n(t.amount) < 0), (t) => -n(t.amount));
    return { month: monthKey(m), inflow, outflow, net: inflow - outflow };
  });
}

export function runway(balance: number | null, flows: { inflow: number; outflow: number }[]) {
  const recent = flows.slice(-3).filter((f) => f.inflow || f.outflow);
  if (balance == null || !recent.length) return { grossBurn: null, netBurn: null, months: null };
  const grossBurn = sumBy(recent, (f) => f.outflow) / recent.length;
  const netBurn = sumBy(recent, (f) => f.outflow - f.inflow) / recent.length;
  return { grossBurn, netBurn, months: netBurn > 0 ? balance / netBurn : Infinity };
}

export const AR_BUCKETS = ["Not yet due", "0–30 days", "31–60 days", "61–90 days", "90+ days"] as const;

export function arAging(invoices: InvoiceRow[], now = new Date()) {
  const open = invoices.filter((i) => i.status === "sent" || i.status === "overdue");
  const buckets = AR_BUCKETS.map((b) => ({ bucket: b, amount: 0, count: 0 }));
  for (const inv of open) {
    const due = inv.due_date ? new Date(inv.due_date + "T23:59:59") : new Date(inv.issued_at ?? inv.created_at);
    const late = differenceInCalendarDays(now, due);
    const idx = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    buckets[idx].amount += n(inv.amount);
    buckets[idx].count++;
  }
  const outstanding = sumBy(open, (i) => n(i.amount));
  const overdue = sumBy(buckets.slice(1), (b) => b.amount);
  return { buckets, outstanding, overdue, openCount: open.length };
}

export function expenseBreakdown(expenses: ExpenseRow[], from: Date, to: Date) {
  const map = new Map<string, number>();
  for (const e of expenses) if (within(e.date, from, to) && e.pl_class !== "transfer") map.set(e.pl_class, (map.get(e.pl_class) ?? 0) + n(e.amount));
  return [...map.entries()].map(([cls, amount]) => ({ cls, label: PL_LABELS[cls] ?? cls, amount })).sort((a, b) => b.amount - a.amount);
}

export function leadSources(contacts: ContactRow[], from: Date, to: Date, limit = 6) {
  const map = new Map<string, number>();
  for (const c of contacts) if (within(c.created_at, from, to)) { const s = contactSource(c); map.set(s, (map.get(s) ?? 0) + 1); }
  const rows = [...map.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
  if (rows.length <= limit) return rows;
  return [...rows.slice(0, limit - 1), { source: "Other", count: sumBy(rows.slice(limit - 1), (r) => r.count) }];
}

export function commissionSummary(commissions: CommissionRow[], repId?: string) {
  const rows = repId ? commissions.filter((c) => c.rep_id === repId) : commissions;
  const by = (s: string) => sumBy(rows.filter((c) => c.status === s), (c) => n(c.amount));
  const pending = by("pending"), approved = by("approved"), paid = by("paid");
  return { earned: pending + approved + paid, pending, approved, paid, outstanding: pending + approved, clawedBack: by("clawed_back") };
}
