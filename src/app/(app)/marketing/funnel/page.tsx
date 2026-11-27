import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adRollup, groupBy, landerRollup, rangeFrom } from "@/lib/marketing";
import { FunnelView } from "./funnel-view";

export const metadata = { title: "Marketing · Funnel" };
export const dynamic = "force-dynamic";

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const { days, from, to } = rangeFrom(Number((await searchParams).days));
  const db = await createClient();
  const [ads, landers] = await Promise.all([adRollup(db, from, to), landerRollup(db, from, to)]);
  // Landing page visits: tracked CRM pages use real visits; everything else counts link clicks as visits.
  const visitsFor = (adIds: Set<string>) => {
    let v = 0;
    for (const a of ads) if (adIds.has(a.id)) { const l = landers.find((x) => x.id === a.lander_id); v += l?.tracked ? 0 : a.clicks; }
    for (const l of landers) if (l.tracked && ads.some((a) => adIds.has(a.id) && a.lander_id === l.id)) v += l.visits;
    return v;
  };
  const all = new Set(ads.map((a) => a.id));
  const total = ads.reduce((s, a) => ({ impressions: s.impressions + a.impressions, clicks: s.clicks + a.clicks, leads: s.leads + a.leads, won_jobs: s.won_jobs + a.won_jobs, spend: s.spend + a.spend }), { impressions: 0, clicks: 0, leads: 0, won_jobs: 0, spend: 0 });
  const campaigns = groupBy(ads, (a) => a.campaign_id, (a) => a.campaign).map((c) => ({ ...c, visits: visitsFor(new Set(ads.filter((a) => a.campaign_id === c.id).map((a) => a.id))) })).sort((a, b) => b.spend - a.spend);
  return <FunnelView days={days} total={{ ...total, visits: visitsFor(all) }} campaigns={campaigns} />;
}
