import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { DealsView, type DealRow } from "./deals-view";
import type { PipelineStage } from "@/lib/types";

export const metadata = { title: "Deals" };

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ new?: string; view?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: deals }, { data: stages }, { data: users }] = await Promise.all([
    supabase.from("deals")
      .select("*, contact:contacts(id, first_name, last_name, email, phone), company:companies(id, name)")
      .order("position").order("created_at", { ascending: false }).limit(3000),
    supabase.from("pipeline_stages").select("*").order("position"),
    supabase.from("profiles").select("id, full_name, email, avatar_url").eq("is_active", true).order("full_name"),
  ]);
  return <DealsView deals={(deals as DealRow[]) ?? []} stages={(stages as PipelineStage[]) ?? []} users={users ?? []}
    openNew={sp.new === "1"} initialView={sp.view === "table" ? "table" : "board"} />;
}
