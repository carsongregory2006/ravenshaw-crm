"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safe } from "@/lib/actions/util";
import { getProfile } from "@/lib/auth";
import { createContact } from "@/lib/actions/crm";
import type { NetworkLead } from "@/lib/types";

export type NetworkInput = Partial<Omit<NetworkLead, "id" | "contact_id" | "created_by" | "created_at" | "updated_at">>;

function clean(input: NetworkInput) {
  const out: Record<string, unknown> = { ...input };
  for (const k of ["name", "business", "phone", "email", "connection", "introduced_by", "notes", "follow_up_on"] as const) {
    if (out[k] !== undefined) out[k] = (out[k] as string | null)?.trim() || null;
  }
  return out;
}

export async function saveNetworkLeadAction(id: string | null, input: NetworkInput) {
  return safe(async () => {
    if (!(await getProfile())) throw new Error("Not signed in");
    const row = clean(input);
    if ((id === null || "name" in row) && !row.name) throw new Error("Add a name");
    const supabase = await createClient();
    const { data, error } = id
      ? await supabase.from("network_leads").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).select("*").single()
      : await supabase.from("network_leads").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    revalidatePath("/network");
    return data as NetworkLead;
  });
}

export async function deleteNetworkLeadAction(id: string) {
  return safe(async () => {
    const supabase = await createClient();
    const { error } = await supabase.from("network_leads").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/network");
  });
}

/** Turns a network lead into a CRM contact (so it can be called, texted and put in a deal) and links the two. */
export async function moveNetworkLeadToCrmAction(id: string) {
  return safe(async () => {
    const profile = await getProfile();
    if (!profile) throw new Error("Not signed in");
    const supabase = await createClient();
    const { data: lead, error } = await supabase.from("network_leads").select("*").eq("id", id).single();
    if (error || !lead) throw new Error("Lead not found");
    if (lead.contact_id) return lead.contact_id as string;

    const [first, ...rest] = (lead.name as string).split(/\s+/);
    const r = await createContact({
      first_name: first || null, last_name: rest.join(" ") || null,
      email: lead.email, phone: lead.phone, title: lead.business, source: "Network", tags: ["network"],
    });
    if (!r.ok) throw new Error(r.error);

    const body = [
      lead.business && `Business: ${lead.business}`,
      lead.connection && `How I know them: ${lead.connection}`,
      lead.introduced_by && `Intro from: ${lead.introduced_by}`,
      lead.notes,
    ].filter(Boolean).join("\n");
    if (body) await supabase.from("activities").insert({ type: "note", contact_id: r.data.id, title: "From Network", body, actor_id: profile.id });

    await supabase.from("network_leads").update({ contact_id: r.data.id, status: "converted", updated_at: new Date().toISOString() }).eq("id", id);
    revalidatePath("/network");
    return r.data.id;
  });
}
