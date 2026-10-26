import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { withDefaults, type DialerSettings } from "@/lib/dialer/settings";

export async function getDialerSettings(): Promise<DialerSettings> {
  const { data } = await createAdminClient().from("app_kv").select("value").eq("key", "dialer_settings").maybeSingle();
  return withDefaults(data?.value as Partial<DialerSettings> | null);
}
