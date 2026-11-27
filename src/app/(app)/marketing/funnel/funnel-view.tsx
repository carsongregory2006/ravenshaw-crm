"use client";
import * as React from "react";
import { Page, PageBody } from "@/components/ui/page";
import { Card, EmptyState } from "@/components/ui/misc";
import { Select } from "@/components/ui/input";
import { FunnelBars } from "@/components/analytics/viz";
import { MarketingHeader, fmtInt, fmtMoney, fmtPct } from "@/components/marketing/header";
import { Filter } from "lucide-react";

type F = { impressions: number; clicks: number; visits: number; leads: number; won_jobs: number; spend: number };

function Steps({ f }: { f: F }) {
  const steps = [
    { label: "Impressions", value: f.impressions, cost: f.impressions ? (f.spend / f.impressions) * 1000 : null, costLabel: "per 1,000" },
    { label: "Clicks", value: f.clicks, cost: f.clicks ? f.spend / f.clicks : null, costLabel: "per click" },
    { label: "Page visits", value: f.visits, cost: f.visits ? f.spend / f.visits : null, costLabel: "per visit" },
    { label: "Leads", value: f.leads, cost: f.leads ? f.spend / f.leads : null, costLabel: "per lead" },
    { label: "Won jobs", value: f.won_jobs, cost: f.won_jobs ? f.spend / f.won_jobs : null, costLabel: "per job" },
  ];
  return (
    <div className="space-y-4">
      <FunnelBars steps={steps.map((s, i) => ({ label: s.label, value: s.value, rate: i === 0 ? null : steps[i - 1].value ? s.value / steps[i - 1].value : null }))} />
      <table className="w-full text-[13px]">
        <thead className="text-left text-xs text-fg-3"><tr className="border-b border-border-light"><th className="py-1.5 font-medium">Step</th><th className="py-1.5 text-right font-medium">Count</th><th className="py-1.5 text-right font-medium">From previous step</th><th className="py-1.5 text-right font-medium">Cost</th></tr></thead>
        <tbody>{steps.map((s, i) => (
          <tr key={s.label} className="border-b border-border-light last:border-0">
            <td className="py-1.5">{s.label}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtInt(s.value)}</td>
            <td className="py-1.5 text-right tabular-nums">{i === 0 ? "—" : fmtPct(s.value, steps[i - 1].value)}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtMoney(s.cost)} <span className="text-xs text-fg-4">{s.cost != null ? s.costLabel : ""}</span></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function FunnelView({ days, total, campaigns }: { days: number; total: F; campaigns: (F & { id: string; name: string })[] }) {
  const [pick, setPick] = React.useState("");
  const chosen = campaigns.find((c) => c.id === pick);
  return (
    <Page>
      <MarketingHeader days={days} title="Funnel" />
      <PageBody>
        {!total.impressions && !total.clicks && !total.leads ? (
          <EmptyState icon={Filter} title="No funnel data yet" description="Import ad numbers on the Campaigns tab to see the path from impression to won job." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title={`All campaigns · last ${days} days`}><Steps f={total} /></Card>
            <Card title="One campaign" actions={
              <Select value={pick} onChange={(e) => setPick(e.target.value)} className="h-7 w-56 text-xs">
                <option value="">Pick a campaign…</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            }>
              {chosen ? <Steps f={chosen} /> : <p className="py-10 text-center text-xs text-fg-3">Pick a campaign to compare its funnel.</p>}
            </Card>
          </div>
        )}
        <p className="mt-3 text-xs text-fg-4">Page visits come from CRM landing page tracking where an ad is linked to one; otherwise link clicks are used.</p>
      </PageBody>
    </Page>
  );
}
