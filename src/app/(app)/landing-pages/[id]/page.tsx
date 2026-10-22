import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LandingEditor } from "@/components/landing/editor";
import type { LandingPage, LandingPageVariant, RrMember } from "@/lib/types";
import type { RepLite } from "@/components/landing/settings-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await createAdminClient().from("landing_pages").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Landing page" };
}

export default async function LandingEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const db = createAdminClient();
  const [{ data: page }, { data: variants }, { data: members }, { data: reps }, { data: ws }] = await Promise.all([
    db.from("landing_pages").select("*").eq("id", id).maybeSingle(),
    db.from("landing_page_variants").select("*").eq("page_id", id).order("created_at"),
    db.from("rr_members").select("*").eq("page_id", id),
    db.from("profiles").select("id, full_name, email, role, available_for_rr, avatar_url").eq("is_active", true).order("full_name"),
    db.from("workspace_settings").select("default_calendly_url").eq("id", 1).single(),
  ]);
  if (!page) notFound();
  return (
    <LandingEditor
      initialPage={page as LandingPage}
      initialVariants={(variants ?? []) as LandingPageVariant[]}
      initialMembers={(members ?? []) as RrMember[]}
      reps={(reps ?? []) as RepLite[]}
      defaultCalendly={ws?.default_calendly_url ?? null}
    />
  );
}
