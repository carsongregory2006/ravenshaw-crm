"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Trophy } from "lucide-react";
import { Page, PageBody } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { MarketingHeader } from "@/components/marketing/header";
import { AdEntryDialog } from "@/components/marketing/import-dialog";
import { deleteCampaignAction, setAdLanderAction, setWonJobsAction } from "@/lib/actions/marketing";
import { MetricCells, MetricHead } from "../campaigns-view";

type T = { spend: number; impressions: number; clicks: number; leads: number; won_jobs: number };
type Ad = T & { id: string; name: string; ad_set: string; ad_set_id: string; lander_id: string | null };

export function CampaignDetail({ campaign, adSets, ads, landers, days }: {
  campaign: { id: string; name: string; platform: string }; adSets: (T & { id: string; name: string; ads: number })[]; ads: Ad[];
  landers: { id: string; name: string; kind: string }[]; days: number;
}) {
  const router = useRouter();
  const [won, setWon] = React.useState<Ad | null>(null);
  const [adding, setAdding] = React.useState(false);
  return (
    <Page>
      <MarketingHeader active="campaigns" days={days}
        title={<span className="flex items-center gap-2"><Link href={`/marketing/campaigns?days=${days}`} className="text-fg-3 hover:text-fg"><ArrowLeft className="size-4" /></Link>{campaign.name}</span>}
        actions={<>
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add numbers</Button>
          <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete campaign" onClick={async () => {
            if (!confirm(`Delete "${campaign.name}" with all its ad sets, ads and numbers?`)) return;
            const r = await deleteCampaignAction(campaign.id);
            if (!r.ok) return toast.error(r.error);
            router.push(`/marketing/campaigns?days=${days}`);
          }} />
        </>} />
      <PageBody className="space-y-4">
        <Card title="Ad sets" padded={false}>
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-fg-3"><MetricHead first={`Ad set · last ${days} days`} /></thead>
            <tbody>{adSets.map((s) => <tr key={s.id} className="border-b border-border-light last:border-0"><td className="px-3 py-2 font-medium">{s.name} <span className="text-xs font-normal text-fg-4">{s.ads} ad{s.ads === 1 ? "" : "s"}</span></td><MetricCells r={s} /></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Ads" padded={false}>
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-fg-3">
              <tr className="border-b border-border-light">
                <th className="px-3 py-2 font-medium">Ad</th><th className="px-3 py-2 font-medium">Sends to</th>
                {["Spend", "Impressions", "Clicks", "Leads", "Cost / lead", "Won jobs", "Cost / won job"].map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {ads.map((a) => (
                <tr key={a.id} className="border-b border-border-light last:border-0">
                  <td className="px-3 py-2"><div className="font-medium">{a.name}</div><div className="text-xs text-fg-4">{a.ad_set}</div></td>
                  <td className="px-3 py-2">
                    <Select value={a.lander_id ?? ""} className="h-7 w-40 text-xs" onChange={async (e) => { const r = await setAdLanderAction(a.id, e.target.value || null); if (!r.ok) return toast.error(r.error); router.refresh(); }}>
                      <option value="">—</option>
                      {landers.map((l) => <option key={l.id} value={l.id}>{l.name}{l.kind === "form" ? " (form)" : ""}</option>)}
                    </Select>
                  </td>
                  <MetricCells r={a} />
                  <td className="px-3 py-2 text-right"><Button size="xs" variant="ghost" icon={Trophy} onClick={() => setWon(a)}>Won jobs</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!landers.length && <p className="border-t border-border-light px-3 py-2 text-xs text-fg-4">Add your landing pages and lead forms under <Link href="/marketing/landers" className="underline">Landers &amp; forms</Link> to link ads to them.</p>}
        </Card>
      </PageBody>
      {won && <WonJobsDialog ad={won} onClose={() => setWon(null)} onSaved={() => { setWon(null); router.refresh(); }} />}
      <AdEntryDialog open={adding} onOpenChange={setAdding} defaults={{ campaign: campaign.name }} />
    </Page>
  );
}

function WonJobsDialog({ ad, onClose, onSaved }: { ad: Ad; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [count, setCount] = React.useState("1");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="sm" title={`Won jobs · ${ad.name}`} description="How many jobs this ad won on that day. Saving replaces that day's number."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true);
        const r = await setWonJobsAction(ad.id, date, Number(count) || 0);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Saved");
        onSaved();
      }}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Day the lead came in"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Won jobs"><Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
