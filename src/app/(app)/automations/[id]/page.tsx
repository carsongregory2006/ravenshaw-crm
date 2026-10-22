import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AutomationBuilder } from "@/components/automations/builder";
import type { Automation } from "@/lib/types";

export const metadata = { title: "Automation" };

export default async function AutomationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireStaff();
  const { id } = await params;
  const { tab } = await searchParams;
  const sb = await createClient();
  const [{ data: automation }, { data: stages }, { data: pages }, { data: reps }, { data: templates }] = await Promise.all([
    sb.from("automations").select("*").eq("id", id).maybeSingle(),
    sb.from("pipeline_stages").select("key, name").order("position"),
    sb.from("landing_pages").select("id, name").neq("status", "archived").order("name"),
    sb.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
    sb.from("templates").select("id, channel, name, subject, body").order("name"),
  ]);
  if (!automation) notFound();
  return (
    <AutomationBuilder
      automation={automation as Automation}
      initialTab={tab === "executions" ? "executions" : "editor"}
      lookups={{ stages: stages ?? [], pages: pages ?? [], reps: reps ?? [], templates: templates ?? [] }}
    />
  );
}
