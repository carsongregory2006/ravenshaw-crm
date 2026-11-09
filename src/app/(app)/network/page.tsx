import { createClient } from "@/lib/supabase/server";
import { NetworkView } from "./network-view";
import type { NetworkLead } from "@/lib/types";

export const metadata = { title: "Network" };
export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("network_leads").select("*").order("created_at", { ascending: false });
  return <NetworkView initial={(data ?? []) as NetworkLead[]} />;
}
