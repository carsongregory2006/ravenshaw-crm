import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LandingPagesList, type LandingRow } from "@/components/landing/list";
import type { LandingPage } from "@/lib/types";

export const metadata = { title: "Landing Pages" };
export const dynamic = "force-dynamic";

export default async function LandingPagesPage() {
  await requireStaff();
  const db = createAdminClient();
  const [{ data: pages }, { data: variants }, { data: stats }, { data: contacts }, { data: stages }] = await Promise.all([
    db.from("landing_pages").select("*").order("updated_at", { ascending: false }),
    db.from("landing_page_variants").select("id, page_id, name, is_active"),
    db.rpc("lp_variant_stats", { p_page_id: null }),
    db.from("contacts").select("id, landing_page_id").not("landing_page_id", "is", null),
    db.from("pipeline_stages").select("id, key, position, is_won, is_lost"),
  ]);

  // booked = page contacts whose deal reached "Booked" or later (or won)
  const bookedPos = (stages ?? []).find((s) => s.key === "booked")?.position ?? 2;
  const bookedStageIds = new Set((stages ?? []).filter((s) => s.is_won || (!s.is_lost && s.position >= bookedPos)).map((s) => s.id));
  const pageOfContact = new Map((contacts ?? []).map((c) => [c.id, c.landing_page_id as string]));
  const bookedByPage = new Map<string, Set<string>>();
  const ids = [...pageOfContact.keys()];
  for (let i = 0; i < ids.length; i += 500) {
    const { data: deals } = await db.from("deals").select("contact_id, stage_id").in("contact_id", ids.slice(i, i + 500));
    for (const d of deals ?? []) {
      if (!bookedStageIds.has(d.stage_id)) continue;
      const p = pageOfContact.get(d.contact_id)!;
      if (!bookedByPage.has(p)) bookedByPage.set(p, new Set());
      bookedByPage.get(p)!.add(d.contact_id);
    }
  }

  type S = { page_id: string; variant_id: string | null; views: number; visitors: number; conversions: number };
  const rows: LandingRow[] = ((pages ?? []) as LandingPage[]).map((p) => {
    const vs = (variants ?? []).filter((v) => v.page_id === p.id);
    const st = ((stats ?? []) as S[]).filter((s) => s.page_id === p.id);
    const views = st.reduce((a, s) => a + Number(s.views), 0);
    const visitors = st.reduce((a, s) => a + Number(s.visitors), 0);
    const conversions = st.reduce((a, s) => a + Number(s.conversions), 0);
    let best: { name: string; cvr: number } | null = null;
    for (const s of st) {
      const v = vs.find((x) => x.id === s.variant_id);
      const denom = Number(s.visitors) || Number(s.views);
      if (!v || denom < 1) continue;
      const cvr = Number(s.conversions) / denom;
      if (!best || cvr > best.cvr) best = { name: v.name, cvr };
    }
    return {
      ...p,
      variantCount: vs.length,
      activeVariants: vs.filter((v) => v.is_active).length,
      views, visitors, conversions,
      cvr: (visitors || views) ? conversions / (visitors || views) : 0,
      booked: bookedByPage.get(p.id)?.size ?? 0,
      best,
    };
  });

  return <LandingPagesList rows={rows} />;
}
