/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase join rows and recharts render props are untyped */
import Link from "next/link";
import { endOfDay, format, startOfMonth, subMonths, addDays } from "date-fns";
import {
  LayoutDashboard, Banknote, Repeat, TrendingUp, Activity as ActivityIcon, Target, UserPlus, Trophy, Receipt, Coins, Timer,
  Mail, MessageSquare, Phone, StickyNote, ArrowRightLeft, FileSignature, CreditCard, Sparkles, Calendar, FormInput, Bell,
} from "lucide-react";
import { Page, PageHeader, PageBody } from "@/components/ui/page";
import { Card } from "@/components/ui/misc";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { integrations } from "@/lib/env";
import { loadDataset } from "@/lib/metrics/load";
import { resolveRange, monthsBetween, monthLabel } from "@/lib/metrics/range";
import {
  pnl, clientMetrics, salesMetrics, arAging, pipelineByStage, leadSources, revenueVsExpenses, commissionSummary, within,
} from "@/lib/metrics/compute";
import { RangePicker } from "@/components/analytics/range-picker";
import { Kpi } from "@/components/analytics/kpi";
import { BarList, ColumnChart } from "@/components/analytics/viz";
import { AskAi, BriefingCard } from "@/components/analytics/ai-panel";
import { TodayTasks, UpcomingEvents } from "@/components/analytics/today";
import { contactLabel, money, timeAgo } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

const ACT_ICONS: Record<string, typeof Mail> = {
  email: Mail, sms: MessageSquare, call: Phone, note: StickyNote, stage_change: ArrowRightLeft, contract: FileSignature,
  invoice: Receipt, payment: CreditCard, ai: Sparkles, meeting: Calendar, form: FormInput, task: Target, system: Bell,
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const profile = await requireProfile();
  const staff = profile.role === "admin" || profile.role === "ops";
  const range = resolveRange(sp);
  const ds = await loadDataset(range);
  const sb = await createClient();
  const now = new Date();

  const [{ data: tasks }, { data: events }, { data: acts }, { data: brief }] = await Promise.all([
    sb.from("tasks").select("id, title, due_at, priority, contact_id, contact:contacts(first_name,last_name,email)")
      .eq("assignee_id", profile.id).is("completed_at", null).lte("due_at", endOfDay(now).toISOString()).order("due_at").limit(8),
    sb.from("calendar_events").select("id, title, start_at, end_at, all_day, color, meeting_url, calendar:calendars!inner(is_visible, color)")
      .gte("end_at", now.toISOString()).lte("start_at", addDays(now, 7).toISOString()).neq("status", "cancelled").order("start_at").limit(6),
    sb.from("activities").select("id, type, title, created_at, contact_id, deal_id, contact:contacts(first_name,last_name,email)").order("created_at", { ascending: false }).limit(12),
    sb.from("ai_briefings").select("content, created_at").eq("user_id", profile.id).eq("kind", "weekly").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const owner = staff ? null : profile.id;
  const sales = salesMetrics(ds, range.from, range.to, owner);
  const salesPrev = salesMetrics(ds, range.prevFrom, range.prevTo, owner);
  const months = monthsBetween(startOfMonth(subMonths(now, 11)), now, 12);
  const ar = arAging(ds.invoices);
  const pipe = pipelineByStage(ds, owner).filter((s) => s.key !== "won");
  const sources = leadSources(owner ? ds.contacts.filter((c) => c.owner_id === owner) : ds.contacts, range.from, range.to);
  const rangeQ = { range: sp.range, from: sp.from, to: sp.to };
  const aiReady = integrations.openrouter();

  let kpis: React.ReactNode;
  if (staff) {
    const cur = pnl(ds, range.from, range.to), prev = pnl(ds, range.prevFrom, range.prevTo);
    const cm = clientMetrics(ds, range.from, range.to);
    const prevMrr = ds.clients.filter((c) => new Date(c.start_date + "T00:00:00") <= range.from && (!c.churned_at || new Date(c.churned_at) > range.from)).reduce((s, c) => s + c.mrr, 0);
    const rev = revenueVsExpenses(ds, months);
    kpis = (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Cash collected" icon={Banknote} value={cur.revenue} prev={prev.revenue} spark={rev.map((r) => r.revenue)} hint="Payments received in the period" />
          <Kpi label="MRR" icon={Repeat} value={cm.mrr} prev={prevMrr} hint="Sum of active client monthly retainers" />
          <Kpi label="Net profit" icon={TrendingUp} value={cur.netProfit} prev={prev.netProfit} spark={rev.map((r) => r.net)} />
          <Kpi label="EBITDA" icon={ActivityIcon} value={cur.ebitda} prev={prev.ebitda} />
          <Kpi label="Weighted pipeline" icon={Target} value={sales.weightedPipeline} hint="Open deal value × stage probability" />
          <Kpi label="New leads" icon={UserPlus} f="num" value={sales.newLeads} prev={salesPrev.newLeads} />
          <Kpi label="Win rate" icon={Trophy} f="pct" value={sales.winRate} prev={salesPrev.winRate} />
          <Kpi label="Outstanding AR" icon={Receipt} value={ar.outstanding} upIsGood={false} hint={`${ar.openCount} open invoices · ${money(ar.overdue)} overdue`} />
        </div>
        <Card title="Revenue vs expenses — last 12 months" actions={<Link href="/finance" className="text-xs text-fg-3 hover:text-fg">P&L →</Link>}>
          <ColumnChart data={rev.map((r) => ({ ...r, label: monthLabel(r.month + "-01") }))} x="month"
            series={[{ key: "revenue", label: "Revenue (cash)", slot: 1 }, { key: "expenses", label: "Expenses incl. commissions", slot: 2 }]} />
        </Card>
      </>
    );
  } else {
    const com = commissionSummary(ds.commissions, profile.id);
    const earnedPeriod = ds.commissions.filter((c) => c.rep_id === profile.id && c.status !== "clawed_back" && within(c.created_at, range.from, range.to)).reduce((s, c) => s + c.amount, 0);
    const earnedPrev = ds.commissions.filter((c) => c.rep_id === profile.id && c.status !== "clawed_back" && within(c.created_at, range.prevFrom, range.prevTo)).reduce((s, c) => s + c.amount, 0);
    kpis = (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="My new leads" icon={UserPlus} f="num" value={sales.newLeads} prev={salesPrev.newLeads} />
        <Kpi label="Deals won" icon={Trophy} f="num" value={sales.won} prev={salesPrev.won} />
        <Kpi label="Booked revenue" icon={Banknote} value={sales.bookedRevenue} prev={salesPrev.bookedRevenue} />
        <Kpi label="My weighted pipeline" icon={Target} value={sales.weightedPipeline} />
        <Kpi label="Commission earned" icon={Coins} value={earnedPeriod} prev={earnedPrev} />
        <Kpi label="Commission outstanding" icon={Coins} value={com.outstanding} hint="Pending + approved, not yet paid" />
        <Kpi label="Win rate" icon={Trophy} f="pct" value={sales.winRate} prev={salesPrev.winRate} />
        <Kpi label="Speed to lead (median)" icon={Timer} f="minutes" value={sales.speedToLeadMin} prev={salesPrev.speedToLeadMin} upIsGood={false} />
      </div>
    );
  }

  return (
    <Page>
      <PageHeader icon={LayoutDashboard} title="Dashboard"
        actions={<RangePicker value={range.key} label={range.label} from={format(range.from, "yyyy-MM-dd")} to={format(range.to, "yyyy-MM-dd")} />}>
        <span className="text-xs text-fg-3">Good {now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"}, {profile.full_name?.split(" ")[0] ?? ""}</span>
      </PageHeader>
      <PageBody className="space-y-3 p-3">
        {kpis}
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <div className="grid gap-3 md:grid-cols-2">
              <Card title={staff ? "Open pipeline by stage" : "My open pipeline"} actions={<Link href="/deals" className="text-xs text-fg-3 hover:text-fg">Deals →</Link>}>
                {pipe.some((p) => p.count) ? <BarList data={pipe} label="stage" value="value" f="money" /> : <p className="text-[13px] text-fg-3">No open deals yet.</p>}
              </Card>
              <Card title="Lead sources" actions={<Link href="/analytics?tab=marketing" className="text-xs text-fg-3 hover:text-fg">Marketing →</Link>}>
                {sources.length ? <BarList data={sources} label="source" value="count" f="num" slot={1} /> : <p className="text-[13px] text-fg-3">No leads in this period.</p>}
              </Card>
            </div>
            <AskAi range={rangeQ} aiReady={aiReady} />
            <BriefingCard initial={brief ?? null} aiReady={aiReady} />
          </div>
          <div className="space-y-3">
            <TodayTasks tasks={(tasks ?? []).map((t: any) => ({ ...t, contact_name: t.contact ? contactLabel(t.contact) : null }))} />
            <UpcomingEvents events={(events ?? []).filter((e: any) => e.calendar?.is_visible !== false).map((e: any) => ({ ...e, color: e.color ?? e.calendar?.color ?? null }))} />
            <Card title="Recent activity" padded={false}>
              {!acts?.length ? <p className="p-3 text-[13px] text-fg-3">No activity yet.</p> : (
                <ul className="divide-y divide-border-light">
                  {acts.map((a: any) => {
                    const I = ACT_ICONS[a.type] ?? Bell;
                    const href = a.contact_id ? `/contacts/${a.contact_id}` : a.deal_id ? `/deals/${a.deal_id}` : null;
                    const body = (
                      <div className="flex items-start gap-2 px-3 py-2 hover:bg-hover">
                        <I className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px]">{a.title}</div>
                          <div className="truncate text-xs text-fg-3">{a.contact ? contactLabel(a.contact) + " · " : ""}{timeAgo(a.created_at)}</div>
                        </div>
                      </div>
                    );
                    return <li key={a.id}>{href ? <Link href={href}>{body}</Link> : body}</li>;
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
