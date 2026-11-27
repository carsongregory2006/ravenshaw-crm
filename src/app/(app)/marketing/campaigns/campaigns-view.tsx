"use client";
import * as React from "react";
import Link from "next/link";
import { FileUp, Megaphone, Plus } from "lucide-react";
import { PageBody } from "@/components/ui/page";
import { Page } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { Tag } from "@/components/ui/badge";
import { MarketingHeader, fmtInt, fmtMoney } from "@/components/marketing/header";
import { AdEntryDialog, AdImportDialog } from "@/components/marketing/import-dialog";

export interface CampaignRow { id: string; name: string; platform: string; ads: number; spend: number; impressions: number; clicks: number; leads: number; won_jobs: number }

export function MetricHead({ first }: { first: string }) {
  return (
    <tr className="border-b border-border-light">
      <th className="px-3 py-2 font-medium">{first}</th>
      {["Spend", "Impressions", "Clicks", "Leads", "Cost / lead", "Won jobs", "Cost / won job"].map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}
    </tr>
  );
}
export function MetricCells({ r }: { r: { spend: number; impressions: number; clicks: number; leads: number; won_jobs: number } }) {
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.spend)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.impressions)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.clicks)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.leads)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.leads ? r.spend / r.leads : null)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.won_jobs)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.won_jobs ? r.spend / r.won_jobs : null)}</td>
    </>
  );
}

export function CampaignsView({ campaigns, days }: { campaigns: CampaignRow[]; days: number }) {
  const [importing, setImporting] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const total = campaigns.reduce((s, c) => ({ spend: s.spend + c.spend, impressions: s.impressions + c.impressions, clicks: s.clicks + c.clicks, leads: s.leads + c.leads, won_jobs: s.won_jobs + c.won_jobs }), { spend: 0, impressions: 0, clicks: 0, leads: 0, won_jobs: 0 });
  return (
    <Page>
      <MarketingHeader active="campaigns" days={days} actions={<>
        <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add numbers</Button>
        <Button size="sm" variant="primary" icon={FileUp} onClick={() => setImporting(true)}>Import CSV</Button>
      </>} />
      <PageBody>
        {!campaigns.length ? (
          <EmptyState icon={Megaphone} title="No campaigns yet" description="Import an Ads Manager export (broken down by day, at ad level) or add numbers by hand."
            action={<Button variant="primary" icon={FileUp} onClick={() => setImporting(true)}>Import CSV</Button>} />
        ) : (
          <Card padded={false}>
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-fg-3"><MetricHead first={`Campaign · last ${days} days`} /></thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border-light last:border-0 hover:bg-hover">
                    <td className="px-3 py-2"><Link href={`/marketing/campaigns/${c.id}?days=${days}`} className="font-medium hover:underline">{c.name}</Link><Tag className="ml-2 capitalize">{c.platform}</Tag></td>
                    <MetricCells r={c} />
                  </tr>
                ))}
                <tr className="bg-bg-2 font-medium"><td className="px-3 py-2">Total</td><MetricCells r={total} /></tr>
              </tbody>
            </table>
          </Card>
        )}
      </PageBody>
      <AdImportDialog open={importing} onOpenChange={setImporting} />
      <AdEntryDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}
