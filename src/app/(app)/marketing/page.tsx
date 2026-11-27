import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adRollup, dailySeries, groupBy, prevRange, rangeFrom, MIN_LEADS, MIN_SPEND } from "@/lib/marketing";
import { DashboardView } from "./dashboard-view";

export const metadata = { title: "Marketing" };
export const dynamic = "force-dynamic";

export default async function MarketingDashboard({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const { days, from, to } = rangeFrom(Number((await searchParams).days));
  const prev = prevRange(days);
  const db = await createClient();
  const [cur, before, ads] = await Promise.all([dailySeries(db, from, to), dailySeries(db, prev.from, prev.to), adRollup(db, from, to)]);
  const judged = ads.filter((a) => a.spend >= MIN_SPEND && a.leads >= MIN_LEADS).map((a) => ({ id: a.id, name: a.name, campaign: a.campaign, campaign_id: a.campaign_id, spend: a.spend, leads: a.leads, cpl: a.spend / a.leads }));
  judged.sort((a, b) => a.cpl - b.cpl);
  const platforms = groupBy(ads, (a) => a.platform, (a) => a.platform).filter((p) => p.spend > 0).map((p) => ({ platform: p.name, spend: p.spend }));
  return <DashboardView days={days} series={cur.days} total={cur.total} prev={before.total} best={judged.slice(0, 5)} worst={judged.length > 5 ? judged.slice(-5).reverse() : []} platforms={platforms} hasData={ads.length > 0} />;
}
