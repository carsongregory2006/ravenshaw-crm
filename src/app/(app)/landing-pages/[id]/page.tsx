import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LanderStats } from "@/components/landing/lander-stats";
import type { LanderVisit } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await createAdminClient().from("landing_pages").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Lander" };
}

const RANGES = { "7": 7, "30": 30, "90": 90, all: null } as const;

export default async function LanderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string }> }) {
  await requireStaff();
  const { id } = await params;
  const { range: raw } = await searchParams;
  const range = (raw && raw in RANGES ? raw : "30") as keyof typeof RANGES;
  const days = RANGES[range];

  const db = createAdminClient();
  let visitsQ = db.from("lander_visits").select("*").eq("page_id", id).order("started_at").limit(50000);
  if (days) visitsQ = visitsQ.gte("started_at", new Date(Date.now() - days * 86400_000).toISOString());
  const [{ data: page }, { data: visits }, { data: lastHit }, { count: crmLeads }] = await Promise.all([
    db.from("landing_pages").select("id, name, external_url, has_vsl").eq("id", id).maybeSingle(),
    visitsQ,
    db.from("lander_visits").select("last_seen_at").eq("page_id", id).order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("contacts").select("id", { count: "exact", head: true }).eq("landing_page_id", id),
  ]);
  if (!page || !page.external_url) notFound();

  return (
    <LanderStats
      lander={page}
      visits={(visits ?? []) as LanderVisit[]}
      range={range}
      lastHit={lastHit?.last_seen_at ?? null}
      crmLeads={crmLeads ?? 0}
    />
  );
}
