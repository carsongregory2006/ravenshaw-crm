/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase join rows and recharts render props are untyped */
import { format, startOfMonth, subMonths } from "date-fns";
import {
  BarChart3, Trophy, Banknote, Timer, Target, Hourglass, Scale, Megaphone, UserPlus, Coins, Repeat, TrendingDown, HeartPulse, Users,
  Phone, MessageSquare, Mail, Inbox, Clock, AlertCircle,
} from "lucide-react";
import { Page, PageHeader, PageBody } from "@/components/ui/page";
import { Card } from "@/components/ui/misc";
import { requireProfile } from "@/lib/auth";
import { loadDataset } from "@/lib/metrics/load";
import { resolveRange, monthsBetween } from "@/lib/metrics/range";
import {
  salesMetrics, funnel, funnelTotals, repLeaderboard, clientMetrics, mrrWaterfall, cohorts, healthBuckets, activitySeries, responseTimes,
  within, ratio, type GroupBy,
} from "@/lib/metrics/compute";
import { RangePicker } from "@/components/analytics/range-picker";
import { UrlTabs } from "@/components/analytics/url-tabs";
import { ParamSelect } from "@/components/analytics/group-select";
import { Kpi } from "@/components/analytics/kpi";
import { ReportTable } from "@/components/analytics/report-table";
import { BarList, CohortGrid, FunnelBars, LineSeriesChart, MrrMovement } from "@/components/analytics/viz";
import { SpendManager } from "@/components/analytics/spend-manager";
import { contactLabel, money } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Analytics" };

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: "source", label: "Source" },
  { value: "campaign", label: "UTM campaign" },
  { value: "landing_page", label: "Landing page" },
  { value: "variant", label: "Page variant" },
  { value: "rep", label: "Sales rep" },
];

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const profile = await requireProfile();
  const staff = profile.role === "admin" || profile.role === "ops";
  const tab = ["sales", "marketing", "clients", "activity"].includes(sp.tab ?? "") ? sp.tab! : "sales";
  const range = resolveRange(sp);
  const ds = await loadDataset(range);
  const { from, to, prevFrom, prevTo } = range;
  const group = (GROUPS.some((g) => g.value === sp.group) ? sp.group : "source") as GroupBy;

  let content: React.ReactNode = null;

  if (tab === "sales") {
    const owner = staff ? null : profile.id;
    const cur = salesMetrics(ds, from, to, owner), prev = salesMetrics(ds, prevFrom, prevTo, owner);
    const scoped = owner ? { ...ds, contacts: ds.contacts.filter((c) => c.owner_id === owner) } : ds;
    const rows = funnel(scoped, from, to, group);
    const t = funnelTotals(rows);
    const board = repLeaderboard(ds, from, to);
    content = (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Deals won" icon={Trophy} f="num" value={cur.won} prev={prev.won} />
          <Kpi label="Win rate" icon={Scale} f="pct" value={cur.winRate} prev={prev.winRate} hint="Won ÷ (won + lost) closed in period" />
          <Kpi label="Booked revenue (TCV)" icon={Banknote} value={cur.bookedRevenue} prev={prev.bookedRevenue} hint="One-time + monthly × term for deals won" />
          <Kpi label="Avg deal size" icon={Target} value={cur.avgDealSize} prev={prev.avgDealSize} />
          <Kpi label="Sales cycle" icon={Hourglass} f="days" value={cur.avgCycleDays} prev={prev.avgCycleDays} upIsGood={false} />
          <Kpi label="Open pipeline" icon={Target} value={cur.pipelineValue} hint={`${cur.openDeals} open deals`} />
          <Kpi label="Weighted pipeline" icon={Target} value={cur.weightedPipeline} />
          <Kpi label="Speed to lead (median)" icon={Timer} f="minutes" value={cur.speedToLeadMin} prev={prev.speedToLeadMin} upIsGood={false} />
        </div>
        <Card title="Lead → won funnel (leads created in period)">
          <FunnelBars steps={[
            { label: "Leads", value: t.leads },
            { label: "Booked", value: t.booked, rate: ratio(t.booked, t.leads) },
            { label: "Showed", value: t.showed, rate: ratio(t.showed, t.booked) },
            { label: "Proposal", value: t.proposal, rate: ratio(t.proposal, t.showed) },
            { label: "Won", value: t.won, rate: ratio(t.won, t.proposal) },
          ]} />
          <p className="mt-2 text-xs text-fg-3">Percentages are step-to-step conversion. Overall lead → won: {t.leads ? `${((t.won / t.leads) * 100).toFixed(1)}%` : "—"}.</p>
        </Card>
        <Card padded={false} className="p-2" title={<ParamSelect param="group" value={group} options={GROUPS} label="Funnel by" />}>
          <ReportTable filename={`funnel-by-${group}`} rows={rows as unknown as Record<string, unknown>[]} cols={[
            { key: "label", header: GROUPS.find((g) => g.value === group)!.label },
            { key: "leads", header: "Leads", f: "num" }, { key: "booked", header: "Booked", f: "num" }, { key: "bookedRate", header: "Book %", f: "pct" },
            { key: "showed", header: "Showed", f: "num" }, { key: "showRate", header: "Show %", f: "pct" }, { key: "won", header: "Won", f: "num" },
            { key: "closeRate", header: "Close %", f: "pct" }, { key: "revenue", header: "Collected", f: "money" },
          ]} />
        </Card>
        {staff && (
          <Card padded={false} className="p-2">
            <ReportTable title="Rep leaderboard" filename="rep-leaderboard" rows={board as unknown as Record<string, unknown>[]} cols={[
              { key: "name", header: "Rep" }, { key: "leads", header: "Leads", f: "num" }, { key: "booked", header: "Booked", f: "num" },
              { key: "showed", header: "Showed", f: "num" }, { key: "won", header: "Won", f: "num" }, { key: "bookedRevenue", header: "Booked rev.", f: "money" },
              { key: "collected", header: "Collected", f: "money" }, { key: "commissions", header: "Commission", f: "money" },
              { key: "calls", header: "Calls", f: "num" }, { key: "sms", header: "SMS", f: "num" }, { key: "emails", header: "Emails", f: "num" },
              { key: "speedToLeadMin", header: "Speed to lead", f: "minutes" },
            ]} />
          </Card>
        )}
      </>
    );
  }

  if (tab === "marketing") {
    const mg = (["source", "campaign", "landing_page", "variant"].includes(group) ? group : "source") as GroupBy;
    const rows = funnel(ds, from, to, mg);
    const prevRows = funnel(ds, prevFrom, prevTo, mg);
    const sum = (rs: typeof rows, k: "leads" | "spend" | "revenue" | "won") => rs.reduce((s, r) => s + (r[k] as number), 0);
    const spend = sum(rows, "spend"), leads = sum(rows, "leads"), revenue = sum(rows, "revenue");
    const pSpend = sum(prevRows, "spend"), pLeads = sum(prevRows, "leads"), pRevenue = sum(prevRows, "revenue");
    const cm = clientMetrics(ds, from, to), pcm = clientMetrics(ds, prevFrom, prevTo);
    const sb = await createClient();
    const { data: spendRows } = await sb.from("marketing_spend").select("*").gte("date", format(from, "yyyy-MM-dd")).lte("date", format(to, "yyyy-MM-dd")).order("date", { ascending: false });
    content = (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Ad spend" icon={Megaphone} value={spend} prev={pSpend} upIsGood={false} />
          <Kpi label="Leads" icon={UserPlus} f="num" value={leads} prev={pLeads} />
          <Kpi label="Cost per lead" icon={Coins} value={leads && spend ? spend / leads : null} prev={pLeads && pSpend ? pSpend / pLeads : null} upIsGood={false} />
          <Kpi label="CAC" icon={Coins} value={cm.cac} prev={pcm.cac} upIsGood={false} hint="Spend ÷ new clients" />
          <Kpi label="ROAS" icon={Banknote} f="x" value={spend ? revenue / spend : null} prev={pSpend ? pRevenue / pSpend : null} hint="Cash collected from leads in period ÷ spend" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Leads by channel">
            {rows.length ? <BarList data={rows.slice(0, 8) as unknown as Record<string, unknown>[]} label="label" value="leads" /> : <p className="text-[13px] text-fg-3">No leads in this period.</p>}
          </Card>
          <Card title="Collected revenue by channel">
            {rows.some((r) => r.revenue) ? <BarList data={rows.filter((r) => r.revenue).slice(0, 8) as unknown as Record<string, unknown>[]} label="label" value="revenue" f="money" /> : <p className="text-[13px] text-fg-3">No attributed revenue yet.</p>}
          </Card>
        </div>
        <Card padded={false} className="p-2" title={<ParamSelect param="group" value={mg} options={GROUPS.filter((g) => g.value !== "rep")} label="Attribution by" />}>
          <ReportTable filename={`marketing-by-${mg}`} rows={rows as unknown as Record<string, unknown>[]} cols={[
            { key: "label", header: GROUPS.find((g) => g.value === mg)!.label },
            ...(mg === "landing_page" || mg === "variant" ? [{ key: "views", header: "Views", f: "num" as const }, { key: "conversionRate", header: "Conv. %", f: "pct" as const }] : []),
            { key: "leads", header: "Leads", f: "num" }, { key: "spend", header: "Spend", f: "money" }, { key: "cpl", header: "CPL", f: "money" },
            { key: "bookedRate", header: "Booked %", f: "pct" }, { key: "closeRate", header: "Close %", f: "pct" }, { key: "won", header: "Won", f: "num" },
            { key: "revenue", header: "Collected", f: "money" }, { key: "roas", header: "ROAS", f: "x" },
          ]} />
        </Card>
        <SpendManager rows={(spendRows ?? []).map((r) => ({ ...r, amount: Number(r.amount) }))} pages={ds.pages} canEdit={staff} />
      </>
    );
  }

  if (tab === "clients") {
    const cm = clientMetrics(ds, from, to), pcm = clientMetrics(ds, prevFrom, prevTo);
    const months = monthsBetween(startOfMonth(subMonths(to, 11)), to, 12);
    const water = mrrWaterfall(ds.clients, months);
    const collected = new Map<string, number>();
    for (const p of ds.payments) if (p.client_id) collected.set(p.client_id, (collected.get(p.client_id) ?? 0) + p.amount);
    const sb = await createClient();
    const { data: clientNames } = await sb.from("clients").select("id, contact:contacts(first_name,last_name,email), company:companies(name)");
    const nameOf = new Map((clientNames ?? []).map((c: any) => [c.id, c.company?.name || contactLabel(c.contact)]));
    const top = ds.clients.map((c) => ({
      id: c.id, name: nameOf.get(c.id) ?? "Client", status: c.status, mrr: c.mrr, health: c.health_score, start: c.start_date,
      collected: collected.get(c.id) ?? 0, collectedPeriod: ds.payments.filter((p) => p.client_id === c.id && within(p.received_at, from, to)).reduce((s, p) => s + p.amount, 0),
    })).sort((a, b) => b.collected - a.collected);
    content = (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="MRR" icon={Repeat} value={cm.mrr} hint={`ARR ${money(cm.arr)}`} />
          <Kpi label="Net new MRR" icon={Repeat} value={cm.netNewMrr} prev={pcm.netNewMrr} />
          <Kpi label="Active clients" icon={Users} f="num" value={cm.activeClients} hint={`+${cm.newClients} new · −${cm.churnedClients} churned in period`} />
          <Kpi label="Logo churn / mo" icon={TrendingDown} f="pct" value={cm.logoChurnMonthly} prev={pcm.logoChurnMonthly} upIsGood={false} />
          <Kpi label="Revenue churn / mo" icon={TrendingDown} f="pct" value={cm.revenueChurnMonthly} prev={pcm.revenueChurnMonthly} upIsGood={false} />
          <Kpi label="ARPC / mo" icon={Banknote} value={cm.arpcMonthly} prev={pcm.arpcMonthly} />
          <Kpi label={cm.ltvIsFallback ? "LTV (avg collected)" : "LTV"} icon={Banknote} value={cm.ltv} hint={cm.ltvIsFallback ? "No churn yet — showing average lifetime cash per client" : "ARPC × gross margin ÷ monthly churn"} />
          <Kpi label="CAC" icon={Coins} value={cm.cac} prev={pcm.cac} upIsGood={false} />
          <Kpi label="LTV : CAC" icon={Scale} f="x" value={cm.ltvCac} hint="Healthy ≥ 3×" />
          <Kpi label="CAC payback" icon={Hourglass} f="num" value={cm.paybackMonths} upIsGood={false} hint="Months of gross profit to recover CAC" />
        </div>
        <Card title="MRR movement — last 12 months"><MrrMovement data={water} /></Card>
        <div className="grid gap-3 lg:grid-cols-3">
          <Card title="Cohort retention (clients still active)" className="lg:col-span-2">
            {ds.clients.length ? <CohortGrid rows={cohorts(ds.clients)} /> : <p className="text-[13px] text-fg-3">No clients yet.</p>}
          </Card>
          <Card title={<span className="inline-flex items-center gap-1.5"><HeartPulse className="size-4 text-fg-3" />Client health</span>}>
            <BarList data={healthBuckets(ds.clients)} label="bucket" value="count" />
          </Card>
        </div>
        <Card padded={false} className="p-2">
          <ReportTable title="Clients by lifetime cash collected" filename="clients-ltv" rows={top} cols={[
            { key: "name", header: "Client" }, { key: "status", header: "Status" }, { key: "start", header: "Start date" },
            { key: "mrr", header: "MRR", f: "money" }, { key: "collectedPeriod", header: "Collected (period)", f: "money" },
            { key: "collected", header: "Collected (lifetime)", f: "money" }, { key: "health", header: "Health", f: "num" },
          ]} />
        </Card>
      </>
    );
  }

  if (tab === "activity") {
    const owner = staff ? null : profile.id;
    const scoped = owner ? { calls: ds.calls.filter((c) => c.user_id === owner), messages: ds.messages.filter((m) => m.sent_by === owner || m.direction === "inbound") } : ds;
    const series = activitySeries(scoped, from, to);
    const rt = responseTimes(ds, from, to), prt = responseTimes(ds, prevFrom, prevTo);
    const count = (src: typeof scoped, f: Date, t: Date) => ({
      calls: src.calls.filter((c) => within(c.started_at, f, t)).length,
      connected: src.calls.filter((c) => within(c.started_at, f, t) && ["answered", "completed"].includes(c.status) && (c.duration_sec ?? 0) > 0).length,
      sms: src.messages.filter((m) => m.channel === "sms" && m.direction === "outbound" && within(m.created_at, f, t)).length,
      emails: src.messages.filter((m) => m.channel === "email" && m.direction === "outbound" && within(m.created_at, f, t)).length,
      inbound: src.messages.filter((m) => m.direction === "inbound" && within(m.created_at, f, t)).length,
      automated: src.messages.filter((m) => m.automation_run_id && within(m.created_at, f, t)).length,
    });
    const c = count(scoped, from, to), pc = count(scoped, prevFrom, prevTo);
    const board = staff ? repLeaderboard(ds, from, to) : [];
    content = (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Calls" icon={Phone} f="num" value={c.calls} prev={pc.calls} hint={`${c.connected} connected`} />
          <Kpi label="SMS sent" icon={MessageSquare} f="num" value={c.sms} prev={pc.sms} />
          <Kpi label="Emails sent" icon={Mail} f="num" value={c.emails} prev={pc.emails} hint={`${c.automated} sent by automations`} />
          <Kpi label="Inbound replies" icon={Inbox} f="num" value={c.inbound} prev={pc.inbound} />
          <Kpi label="SMS response (median)" icon={Clock} f="minutes" value={rt.smsMedianMin} prev={prt.smsMedianMin} upIsGood={false} />
          <Kpi label="Email response (median)" icon={Clock} f="minutes" value={rt.emailMedianMin} prev={prt.emailMedianMin} upIsGood={false} />
          <Kpi label="Unanswered inbound" icon={AlertCircle} f="num" value={rt.unanswered} prev={prt.unanswered} upIsGood={false} />
          <Kpi label="Call connect rate" icon={Phone} f="pct" value={ratio(c.connected, c.calls)} prev={ratio(pc.connected, pc.calls)} />
        </div>
        <Card title={`Outreach volume (${series.weekly ? "weekly" : "daily"})`}>
          <LineSeriesChart data={series.rows} x="date" series={[
            { key: "calls", label: "Calls", slot: 1 }, { key: "sms", label: "SMS sent", slot: 2 }, { key: "emails", label: "Emails sent", slot: 3 }, { key: "inbound", label: "Inbound", slot: 7 },
          ]} />
        </Card>
        {staff && (
          <Card padded={false} className="p-2">
            <ReportTable title="Activity by rep" filename="activity-by-rep" rows={board as unknown as Record<string, unknown>[]} cols={[
              { key: "name", header: "Rep" }, { key: "calls", header: "Calls", f: "num" }, { key: "sms", header: "SMS", f: "num" },
              { key: "emails", header: "Emails", f: "num" }, { key: "leads", header: "Leads owned", f: "num" }, { key: "speedToLeadMin", header: "Speed to lead", f: "minutes" },
            ]} />
          </Card>
        )}
      </>
    );
  }

  return (
    <Page>
      <PageHeader icon={BarChart3} title="Analytics"
        actions={<RangePicker value={range.key} label={range.label} from={format(from, "yyyy-MM-dd")} to={format(to, "yyyy-MM-dd")} />} />
      <UrlTabs value={tab} tabs={[
        { id: "sales", label: "Sales" }, { id: "marketing", label: "Marketing" }, { id: "clients", label: "Clients" }, { id: "activity", label: "Activity" },
      ]} />
      <PageBody className="space-y-3 p-3">{content}</PageBody>
    </Page>
  );
}
