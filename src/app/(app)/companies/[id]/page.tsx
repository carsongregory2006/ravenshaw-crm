import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { CompanyRecord } from "./company-record";
import type { PipelineStage } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Company" };
}

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
  if (!company) notFound();
  const [{ data: people }, { data: deals }, { data: stages }] = await Promise.all([
    supabase.from("contacts").select("id, first_name, last_name, email, phone, title, status").eq("company_id", id).order("created_at"),
    supabase.from("deals").select("id, deal_number, name, amount_one_time, amount_recurring, stage_id").eq("company_id", id).order("created_at", { ascending: false }),
    supabase.from("pipeline_stages").select("*").order("position"),
  ]);
  const contactIds = (people ?? []).map((p) => p.id);
  const or = [`company_id.eq.${id}`];
  if (contactIds.length) or.push(`contact_id.in.(${contactIds.join(",")})`);
  const { data: activities } = await supabase.from("activities").select("*, actor:profiles!activities_actor_id_fkey(full_name, avatar_url)")
    .or(or.join(",")).order("created_at", { ascending: false }).limit(200);
  return <CompanyRecord company={company} people={people ?? []} deals={deals ?? []} stages={(stages as PipelineStage[]) ?? []} activities={activities ?? []} currentUserId={profile.id} />;
}
