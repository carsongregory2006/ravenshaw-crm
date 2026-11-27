import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PastView } from "./past-view";

export const metadata = { title: "Marketing · Past campaigns" };
export const dynamic = "force-dynamic";

export default async function PastPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireAdmin();
  const { id } = await searchParams;
  const db = await createClient();
  const { data: list } = await db.from("mkt_past_campaigns").select("id, name, platform, start_date, end_date, notes, learnings, updated_at").order("end_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  const files = id ? (await db.from("mkt_past_campaign_files").select("id, file_name, headers, rows, created_at").eq("past_campaign_id", id).order("created_at")).data ?? [] : [];
  return <PastView campaigns={list ?? []} openId={id ?? null} files={files as { id: string; file_name: string; headers: string[]; rows: string[][]; created_at: string }[]} />;
}
