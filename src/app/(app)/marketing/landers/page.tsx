import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { landerRollup, rangeFrom } from "@/lib/marketing";
import { LandersView } from "./landers-view";

export const metadata = { title: "Marketing · Landers & forms" };
export const dynamic = "force-dynamic";

export default async function LandersPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const { days, from, to } = rangeFrom(Number((await searchParams).days));
  const db = await createClient();
  const [landers, { data: pages }] = await Promise.all([
    landerRollup(db, from, to),
    db.from("landing_pages").select("id, name, slug, external_url").neq("status", "archived").order("name"),
  ]);
  return <LandersView landers={landers} crmPages={pages ?? []} days={days} />;
}
