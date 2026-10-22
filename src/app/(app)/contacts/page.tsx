import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { ContactsView, type ContactListRow } from "./contacts-view";

export const metadata = { title: "People" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ new?: string; status?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: contacts }, { data: users }] = await Promise.all([
    supabase.from("contacts")
      .select("*, company:companies(id, name)")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase.from("profiles").select("id, full_name, email, avatar_url, role").eq("is_active", true).order("full_name"),
  ]);
  return <ContactsView contacts={(contacts as ContactListRow[]) ?? []} users={users ?? []} openNew={sp.new === "1"} initialStatus={sp.status} />;
}
