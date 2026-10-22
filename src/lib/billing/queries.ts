import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Client, Contact, Company, OnboardingStep, Profile } from "@/lib/types";

export type ClientRow = Client & {
  contact: Pick<Contact, "id" | "first_name" | "last_name" | "email" | "phone"> | null;
  company: Pick<Company, "id" | "name" | "domain"> | null;
  manager: Pick<Profile, "id" | "full_name" | "avatar_url"> | null;
  deal: { id: string; deal_number: string } | null;
  steps_total: number;
  steps_done: number;
  ltv: number;
  outstanding: number;
};

/** Clients visible to the current user, enriched with onboarding progress, LTV collected and open balance. */
export async function listClients(): Promise<ClientRow[]> {
  const sb = await createClient();
  const { data } = await sb.from("clients")
    .select("*, contact:contacts(id, first_name, last_name, email, phone), company:companies(id, name, domain), manager:profiles!clients_account_manager_id_fkey(id, full_name, avatar_url), deal:deals(id, deal_number), steps:onboarding_steps(completed_at)")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as (Client & { steps: Pick<OnboardingStep, "completed_at">[] } & Omit<ClientRow, keyof Client | "steps_total" | "steps_done" | "ltv" | "outstanding">)[];
  const ids = rows.map((r) => r.id);
  const db = createAdminClient();
  const [{ data: pays }, { data: open }] = ids.length
    ? await Promise.all([
        db.from("payments").select("client_id, amount").in("client_id", ids),
        db.from("invoices").select("client_id, amount").in("client_id", ids).in("status", ["sent", "overdue"]),
      ])
    : [{ data: [] }, { data: [] }];
  const ltv = new Map<string, number>();
  (pays ?? []).forEach((p) => ltv.set(p.client_id, (ltv.get(p.client_id) ?? 0) + Number(p.amount)));
  const owed = new Map<string, number>();
  (open ?? []).forEach((p) => owed.set(p.client_id, (owed.get(p.client_id) ?? 0) + Number(p.amount)));
  return rows.map(({ steps, ...r }) => ({
    ...r,
    steps_total: steps?.length ?? 0,
    steps_done: steps?.filter((s) => s.completed_at).length ?? 0,
    ltv: ltv.get(r.id) ?? 0,
    outstanding: owed.get(r.id) ?? 0,
  }));
}
