import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity";


/**
 * Give a person a client account if they don't have one: client record (onboarding, $0) + onboarding checklist.
 * No deal, invoice or billing. Used by "Make client" and when a person's status is set to Client.
 */
export async function ensureClientAccount(supabase: SupabaseClient, contactId: string, actorId: string) {
  const { data: existing } = await supabase.from("clients").select("id").eq("contact_id", contactId).neq("status", "churned").limit(1).maybeSingle();
  if (existing) return { clientId: existing.id as string, created: false };
  const { data: contact } = await supabase.from("contacts").select("id, company_id, owner_id").eq("id", contactId).maybeSingle();
  if (!contact) throw new Error("Person not found");
  const manager = contact.owner_id ?? actorId;
  const { data: client, error } = await supabase.from("clients").insert({
    contact_id: contact.id, company_id: contact.company_id, account_manager_id: manager, status: "onboarding", mrr: 0,
  }).select("id").single();
  if (error) throw new Error(error.message);
  const { data: settings } = await supabase.from("workspace_settings").select("onboarding_checklist").eq("id", 1).maybeSingle();
  const checklist: string[] = Array.isArray(settings?.onboarding_checklist) ? settings.onboarding_checklist : [];
  if (checklist.length) {
    await supabase.from("onboarding_steps").insert(checklist.map((title, i) => ({ client_id: client.id, title, position: i, assignee_id: manager })));
  }
  await logActivity({ type: "system", title: "Made a client (no contract)", contact_id: contactId, client_id: client.id, actor_id: actorId });
  return { clientId: client.id as string, created: true };
}
