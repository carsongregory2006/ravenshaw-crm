import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { CompaniesView, type CompanyRow } from "./companies-view";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: companies }, { data: users }] = await Promise.all([
    supabase.from("companies").select("*, contacts(count), deals(count)").order("name").limit(5000),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true),
  ]);
  return <CompaniesView companies={(companies as CompanyRow[]) ?? []} users={users ?? []} openNew={sp.new === "1"} />;
}
