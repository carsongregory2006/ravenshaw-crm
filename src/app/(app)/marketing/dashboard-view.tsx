"use client";
import Link from "next/link";
import { DollarSign, MousePointerClick, Target, Trophy, UserPlus, Megaphone } from "lucide-react";
import { Page, PageBody } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { Kpi } from "@/components/analytics/kpi";
import { ColumnChart, LineSeriesChart, BarList } from "@/components/analytics/viz";
import { MarketingHeader, fmtMoney } from "@/components/marketing/header";

type T = { spend: number; impressions: number; clicks: number; leads: number; won_jobs: number };
type AdLite = { id: string; name: string; campaign: string; campaign_id: string; spend: number; leads: number; cpl: number };
const div = (a: number, b: number) => (b ? a / b : null);

export function DashboardView({ days, series, total, prev, best, worst, platforms, hasData }: {
  days: number; series: (T & { date: string })[]; total: T; prev: T; best: AdLite[]; worst: AdLite[]; platforms: { platform: string; spend: number }[]; hasData: boolean;
}) {
  const chart = series.map((d) => ({ date: d.date, spend: d.spend, leads: d.leads, cpl: div(d.spend, d.leads) }));
  return (
    <Page>
      <MarketingHeader days={days} title="Ads dashboard" />
      <PageBody className="space-y-4">
        {!hasData ? (
          <EmptyState icon={Megaphone} title="No ad numbers yet" description="Import an Ads Manager export on the Campaigns tab to fill this dashboard."
            action={<Link href="/marketing/campaigns"><Button variant="primary">Go to Campaigns</Button></Link>} />
        ) : (<>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Spend" icon={DollarSign} value={total.spend} prev={prev.spend} f="money" upIsGood={false} />
            <Kpi label="Leads" icon={UserPlus} value={total.leads} prev={prev.leads} f="num" />
            <Kpi label="Cost / lead" icon={Target} value={div(total.spend, total.leads)} prev={div(prev.spend, prev.leads)} f="money" upIsGood={false} />
            <Kpi label="Won jobs" icon={Trophy} value={total.won_jobs} prev={prev.won_jobs} f="num" />
            <Kpi label="Cost / won job" icon={Trophy} value={div(total.spend, total.won_jobs)} prev={div(prev.spend, prev.won_jobs)} f="money" upIsGood={false} />
            <Kpi label="Click-through rate" icon={MousePointerClick} value={div(total.clicks, total.impressions)} prev={div(prev.clicks, prev.impressions)} f="pct" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Daily spend"><ColumnChart data={chart} x="date" series={[{ key: "spend", label: "Spend", slot: 1 }]} f="money" height={220} /></Card>
            <Card title="Daily leads"><LineSeriesChart data={chart} x="date" series={[{ key: "leads", label: "Leads", slot: 3 }]} f="num" height={220} area /></Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <AdList title="Best ads (cost / lead)" ads={best} days={days} />
            <AdList title="Worst ads (cost / lead)" ads={worst} days={days} empty="Needs more than 5 ads with enough data." />
            <Card title="Spend by platform">{platforms.length ? <BarList data={platforms} label="platform" value="spend" f="money" /> : <p className="text-xs text-fg-3">No spend in this period.</p>}</Card>
          </div>
        </>)}
      </PageBody>
    </Page>
  );
}

function AdList({ title, ads, days, empty }: { title: string; ads: AdLite[]; days: number; empty?: string }) {
  return (
    <Card title={title} padded={false}>
      {!ads.length ? <p className="px-3 py-4 text-xs text-fg-3">{empty ?? "No ad has $50+ spend and 3+ leads yet."}</p> : (
        <ul>{ads.map((a) => (
          <li key={a.id} className="flex items-center gap-2 border-b border-border-light px-3 py-2 text-[13px] last:border-0">
            <div className="min-w-0 flex-1"><Link href={`/marketing/campaigns/${a.campaign_id}?days=${days}`} className="truncate font-medium hover:underline">{a.name}</Link><div className="truncate text-xs text-fg-4">{a.campaign}</div></div>
            <div className="text-right"><div className="font-medium tabular-nums">{fmtMoney(a.cpl)}</div><div className="text-xs text-fg-4">{a.leads} leads</div></div>
          </li>
        ))}</ul>
      )}
    </Card>
  );
}
