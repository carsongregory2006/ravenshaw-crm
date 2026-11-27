import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adRollup, groupBy, rangeFrom } from "@/lib/marketing";
import { CampaignsView } from "./campaigns-view";

export const metadata = { title: "Marketing · Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const { days, from, to } = rangeFrom(Number((await searchParams).days));
  const ads = await adRollup(await createClient(), from, to);
  const campaigns = groupBy(ads, (a) => a.campaign_id, (a) => a.campaign).map((c) => ({ ...c, platform: ads.find((a) => a.campaign_id === c.id)!.platform }));
  campaigns.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
  return <CampaignsView campaigns={campaigns} days={days} />;
}
