import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adRollup, groupBy, rangeFrom } from "@/lib/marketing";
import { CampaignDetail } from "./campaign-detail";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { days, from, to } = rangeFrom(Number((await searchParams).days));
  const db = await createClient();
  const [{ data: campaign }, ads, { data: landers }] = await Promise.all([
    db.from("mkt_campaigns").select("id, name, platform").eq("id", id).maybeSingle(),
    adRollup(db, from, to, { campaignId: id }),
    db.from("mkt_landers").select("id, name, kind").order("name"),
  ]);
  if (!campaign) notFound();
  const adSets = groupBy(ads, (a) => a.ad_set_id, (a) => a.ad_set).sort((a, b) => b.spend - a.spend);
  return <CampaignDetail campaign={campaign} adSets={adSets} ads={ads.sort((a, b) => b.spend - a.spend)} landers={landers ?? []} days={days} />;
}
