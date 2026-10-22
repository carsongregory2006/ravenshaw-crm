import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { DealRecord } from "./deal-record";
import type { DealLineItem, PipelineStage } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("deals").select("deal_number, name").eq("id", id).maybeSingle();
  return { title: data ? `${data.deal_number} · ${data.name}` : "Deal" };
}

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();
  const { data: deal } = await supabase.from("deals")
    .select("*, contact:contacts(id, first_name, last_name, email, phone), company:companies(id, name)").eq("id", id).maybeSingle();
  if (!deal) notFound();
  const [{ data: items }, { data: stages }, { data: activities }] = await Promise.all([
    supabase.from("deal_line_items").select("*").eq("deal_id", id).order("position").order("name"),
    supabase.from("pipeline_stages").select("*").order("position"),
    supabase.from("activities").select("*, actor:profiles!activities_actor_id_fkey(full_name, avatar_url)").eq("deal_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  return <DealRecord deal={deal} items={(items as DealLineItem[]) ?? []} stages={(stages as PipelineStage[]) ?? []} activities={activities ?? []} currentUserId={profile.id} />;
}
