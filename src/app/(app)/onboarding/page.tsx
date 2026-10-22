import { Rocket } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { OnboardingBoard, type OnboardingCard } from "@/components/billing/onboarding-board";
import type { Profile } from "@/lib/types";

export const metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const me = await requireProfile();
  const sb = await createClient();
  const [{ data }, { data: team }] = await Promise.all([
    sb.from("clients")
      .select("*, contact:contacts(id, first_name, last_name, email), company:companies(id, name), manager:profiles!clients_account_manager_id_fkey(id, full_name, avatar_url), steps:onboarding_steps(*)")
      .eq("status", "onboarding").order("start_date"),
    sb.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
  ]);
  const cards = ((data ?? []) as OnboardingCard[]).map((c) => ({ ...c, steps: [...(c.steps ?? [])].sort((a, b) => a.position - b.position) }));
  return (
    <Page>
      <PageHeader icon={Rocket} title="Onboarding"><span className="text-[13px] text-fg-3">{cards.length}</span></PageHeader>
      <OnboardingBoard cards={cards} team={(team ?? []) as Pick<Profile, "id" | "full_name" | "email">[]} canManage={me.role !== "sales_rep"} />
    </Page>
  );
}
