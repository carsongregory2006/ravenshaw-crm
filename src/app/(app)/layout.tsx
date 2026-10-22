import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/login?deactivated=1");
  const supabase = await createClient();
  const { data: ws } = await supabase.from("workspace_settings").select("name").eq("id", 1).single();
  return <AppShell profile={profile} workspaceName={ws?.name ?? "Ravenshaw AI"}>{children}</AppShell>;
}
