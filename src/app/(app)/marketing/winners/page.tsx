import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adRollup, landerRollup, rangeFrom, MIN_LEADS, MIN_SPEND } from "@/lib/marketing";
import { WinnersView } from "./winners-view";

export const metadata = { title: "Marketing · Winners" };
export const dynamic = "force-dynamic";

export default async function WinnersPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const { days, from, to } = rangeFrom(Number((await searchParams).days));
  const db = await createClient();
  const [ads, landers] = await Promise.all([adRollup(db, from, to), landerRollup(db, from, to)]);
  const enough = (r: { spend: number; leads: number }) => r.spend >= MIN_SPEND && r.leads >= MIN_LEADS;
  const adRows = ads.map((a) => ({ id: a.id, name: a.name, sub: `${a.campaign} · ${a.ad_set}`, href: `/marketing/campaigns/${a.campaign_id}?days=${days}`, spend: a.spend, leads: a.leads, won_jobs: a.won_jobs }));
  // Landers are ranked on the spend of the ads pointing at them.
  const landerRows = landers.map((l) => ({ id: l.id, name: l.name, sub: l.kind === "form" ? "Lead form" : l.tracked ? "CRM landing page" : "Landing page", href: "/marketing/landers", spend: l.spend, leads: l.leads, won_jobs: 0 }));
  // Won jobs for landers: from the ads linked to them.
  for (const l of landerRows) l.won_jobs = ads.filter((a) => a.lander_id === l.id).reduce((s, a) => s + a.won_jobs, 0);
  return (
    <WinnersView days={days}
      ads={adRows.filter(enough)} landers={landerRows.filter(enough)}
      skipped={{ ads: adRows.filter((r) => !enough(r)).length, landers: landerRows.filter((r) => !enough(r)).length }}
      minSpend={MIN_SPEND} minLeads={MIN_LEADS} />
  );
}
