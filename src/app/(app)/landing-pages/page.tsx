import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LandersList, type LanderRow } from "@/components/landing/landers-list";
import { summarize } from "@/lib/landers";
import type { LanderVisit } from "@/lib/types";

export const metadata = { title: "Landers" };
export const dynamic = "force-dynamic";

export default async function LandersPage() {
  await requireStaff();
  const db = createAdminClient();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: pages }, { data: visits }, { data: latest }] = await Promise.all([
    db.from("landing_pages").select("id, name, external_url, has_vsl, updated_at").not("external_url", "is", null).order("updated_at", { ascending: false }),
    db.from("lander_visits").select("*").gte("started_at", since).limit(50000),
    db.from("lander_visits").select("page_id, last_seen_at").order("last_seen_at", { ascending: false }).limit(1000),
  ]);

  const all = (visits ?? []) as LanderVisit[];
  const lastHit = new Map<string, string>();
  for (const v of latest ?? []) if (!lastHit.has(v.page_id)) lastHit.set(v.page_id, v.last_seen_at);

  const rows: LanderRow[] = (pages ?? []).map((p) => ({
    id: p.id, name: p.name, external_url: p.external_url, has_vsl: p.has_vsl,
    lastHit: lastHit.get(p.id) ?? null,
    ...summarize(all.filter((v) => v.page_id === p.id)),
  }));
  const ids = new Set(rows.map((r) => r.id));

  return <LandersList rows={rows} total={summarize(all.filter((v) => ids.has(v.page_id)))} />;
}
