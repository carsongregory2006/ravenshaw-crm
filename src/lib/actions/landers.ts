"use server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { safe } from "@/lib/actions/util";
import { slugify } from "@/lib/utils";

const db = () => createAdminClient();

function cleanUrl(raw: string) {
  const s = raw.trim();
  if (!s) throw new Error("Add the lander's URL");
  const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  return url.toString();
}

async function uniqueSlug(name: string) {
  const root = slugify(name) || "lander";
  for (let i = 0; i < 50; i++) {
    const slug = i ? `${root}-${i + 1}` : root;
    const { data } = await db().from("landing_pages").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

const reval = (id?: string) => {
  revalidatePath("/landing-pages");
  if (id) revalidatePath(`/landing-pages/${id}`);
};

export async function connectLanderAction(input: { name: string; url: string; hasVsl: boolean }) {
  return safe(async () => {
    const me = await requireStaff();
    const url = cleanUrl(input.url);
    const name = input.name.trim() || new URL(url).hostname;
    const { data, error } = await db().from("landing_pages").insert({
      name, slug: await uniqueSlug(name), status: "published", external_url: url, has_vsl: input.hasVsl, created_by: me.id,
    }).select("id").single();
    if (error) throw new Error(error.message);
    reval();
    return data.id as string;
  });
}

export async function updateLanderAction(id: string, input: { name: string; url: string; hasVsl: boolean }) {
  return safe(async () => {
    await requireStaff();
    const name = input.name.trim();
    if (!name) throw new Error("Add a name");
    const { error } = await db().from("landing_pages")
      .update({ name, external_url: cleanUrl(input.url), has_vsl: input.hasVsl, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    reval(id);
  });
}

/** Deletes the lander and its visit stats. Leads it produced stay in the CRM. */
export async function deleteLanderAction(id: string) {
  return safe(async () => {
    await requireStaff();
    const { error } = await db().from("landing_pages").delete().eq("id", id);
    if (error) throw new Error(error.message);
    reval();
  });
}
