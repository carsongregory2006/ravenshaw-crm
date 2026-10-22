import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { contactLabel } from "@/lib/utils";
import { ContactRecord, type ContactRecordData } from "./contact-record";
import type { PipelineStage } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("contacts").select("first_name,last_name,email,phone").eq("id", id).maybeSingle();
  return { title: data ? contactLabel(data) : "Person" };
}

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  const { tab } = await searchParams;
  const supabase = await createClient();
  const { data: contact } = await supabase.from("contacts").select("*, company:companies(id, name, domain)").eq("id", id).maybeSingle();
  if (!contact) notFound();

  const [{ data: deals }, { data: activities }, { data: stages }, { data: settings }, { data: client }, { data: page }, { data: allTags }] = await Promise.all([
    supabase.from("deals").select("id, deal_number, name, amount_one_time, amount_recurring, stage_id, owner_id, created_at, closed_at").eq("contact_id", id).order("created_at", { ascending: false }),
    supabase.from("activities").select("*, actor:profiles!activities_actor_id_fkey(full_name, avatar_url)").eq("contact_id", id).order("created_at", { ascending: false }).limit(300),
    supabase.from("pipeline_stages").select("*").order("position"),
    supabase.from("workspace_settings").select("default_calendly_url").eq("id", 1).single(),
    supabase.from("clients").select("id, status, mrr").eq("contact_id", id).maybeSingle(),
    contact.landing_page_id ? supabase.from("landing_pages").select("id, name, slug").eq("id", contact.landing_page_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("contacts").select("tags").not("tags", "eq", "{}").limit(1000),
  ]);

  const data: ContactRecordData = {
    contact,
    deals: deals ?? [],
    activities: activities ?? [],
    stages: (stages as PipelineStage[]) ?? [],
    calendlyUrl: settings?.default_calendly_url ?? null,
    client: client ?? null,
    landingPage: page ?? null,
    tagSuggestions: [...new Set((allTags ?? []).flatMap((r: { tags: string[] }) => r.tags))].sort(),
  };
  return <ContactRecord data={data} currentUserId={profile.id} initialTab={tab} />;
}
