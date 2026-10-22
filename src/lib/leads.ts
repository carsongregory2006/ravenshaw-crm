import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { findContact } from "@/lib/comms";
import { emitEvent } from "@/lib/events";
import { notify } from "@/lib/activity";
import { contactLabel, toE164 } from "@/lib/utils";
import type { Contact, LandingPage } from "@/lib/types";

export interface CreateLeadInput {
  pageId?: string | null;
  variantId?: string | null;
  visitorId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  website?: string | null;
  message?: string | null;
  utm?: Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_term" | "utm_content", string>> | null;
  referrer?: string | null;
  /** Overrides the computed source (default: landing_page:<slug> or "api"). */
  source?: string | null;
  /** Force an owner instead of round robin. */
  ownerId?: string | null;
  /** Extra fields captured by the form, stored on the activity + custom_fields. */
  extra?: Record<string, unknown>;
}

export interface CreateLeadResult {
  contactId: string;
  dealId: string | null;
  ownerId: string | null;
  isNew: boolean;
}

const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);

/**
 * Single entry point for inbound leads (landing pages, embeds, API).
 * Dedupes on email/phone, assigns an owner via round robin, opens a deal, logs, notifies, and fires automations.
 */
export async function createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
  const db = createAdminClient();
  const email = clean(input.email)?.toLowerCase() ?? null;
  const phone = toE164(clean(input.phone));
  if (!email && !phone) throw new Error("An email or phone number is required");

  let page: Pick<LandingPage, "id" | "name" | "slug" | "rr_enabled" | "default_owner_id"> | null = null;
  if (input.pageId) {
    const { data } = await db.from("landing_pages").select("id, name, slug, rr_enabled, default_owner_id").eq("id", input.pageId).maybeSingle();
    page = data;
  }
  const source = clean(input.source) ?? (page ? `landing_page:${page.slug}` : "api");

  // company (match by name, case-insensitive)
  let companyId: string | null = null;
  const companyName = clean(input.company);
  if (companyName) {
    const { data: existingCo } = await db.from("companies").select("id").ilike("name", companyName).limit(1).maybeSingle();
    if (existingCo) companyId = existingCo.id;
    else {
      const website = clean(input.website);
      let domain: string | null = null;
      try { domain = website ? new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "") : null; } catch {}
      const { data: co } = await db.from("companies").insert({ name: companyName, website, domain }).select("id").single();
      companyId = co?.id ?? null;
    }
  }

  const existing = await findContact({ email, phone });

  // owner: keep the existing owner, else forced → round robin → page default
  let ownerId: string | null = existing?.owner_id ?? clean(input.ownerId);
  if (!ownerId && page) {
    if (page.rr_enabled) {
      const { data: rep } = await db.rpc("rr_next_rep", { p_page_id: page.id });
      ownerId = (rep as string | null) ?? null;
    }
    ownerId = ownerId ?? page.default_owner_id ?? null;
  }
  if (!ownerId && !page) {
    const { data: rep } = await db.rpc("rr_next_rep", { p_page_id: null });
    ownerId = (rep as string | null) ?? null;
  }

  const utm = input.utm ?? {};
  const extra = { ...(input.extra ?? {}), ...(clean(input.website) ? { website: clean(input.website) } : {}), ...(clean(input.message) ? { message: clean(input.message) } : {}) };

  let contact: Contact;
  const isNew = !existing;
  if (existing) {
    const patch: Record<string, unknown> = {
      first_name: existing.first_name || clean(input.firstName),
      last_name: existing.last_name || clean(input.lastName),
      email: existing.email || email,
      phone: existing.phone || phone,
      company_id: existing.company_id || companyId,
      owner_id: existing.owner_id || ownerId,
      custom_fields: { ...(existing.custom_fields ?? {}), ...extra },
    };
    // re-engaged contacts that had gone cold become leads again
    if (existing.status === "unqualified" || existing.status === "churned") patch.status = "lead";
    const { data, error } = await db.from("contacts").update(patch).eq("id", existing.id).select("*").single();
    if (error) throw new Error(error.message);
    contact = data as Contact;
  } else {
    const { data, error } = await db.from("contacts").insert({
      first_name: clean(input.firstName),
      last_name: clean(input.lastName),
      email,
      phone,
      company_id: companyId,
      status: "lead",
      source,
      landing_page_id: page?.id ?? null,
      variant_id: input.variantId ?? null,
      utm_source: utm.utm_source ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_campaign: utm.utm_campaign ?? null,
      utm_term: utm.utm_term ?? null,
      utm_content: utm.utm_content ?? null,
      owner_id: ownerId,
      custom_fields: { ...extra, ...(input.referrer ? { referrer: input.referrer } : {}) },
    }).select("*").single();
    if (error) throw new Error(error.message);
    contact = data as Contact;
  }

  // open a deal unless the contact already has one in flight
  let dealId: string | null = null;
  const { data: stages } = await db.from("pipeline_stages").select("id, key, is_won, is_lost, position").order("position");
  const openStageIds = (stages ?? []).filter((s) => !s.is_won && !s.is_lost).map((s) => s.id);
  const { data: openDeal } = await db.from("deals").select("id").eq("contact_id", contact.id).in("stage_id", openStageIds.length ? openStageIds : ["00000000-0000-0000-0000-000000000000"]).limit(1).maybeSingle();
  if (openDeal) dealId = openDeal.id;
  else {
    const newStage = (stages ?? []).find((s) => s.key === "new") ?? (stages ?? [])[0];
    if (newStage) {
      const name = `${contactLabel(contact)}${page ? ` – ${page.name}` : ""}`;
      const { data: deal } = await db.from("deals").insert({
        name, contact_id: contact.id, company_id: contact.company_id, owner_id: contact.owner_id ?? ownerId, stage_id: newStage.id, source,
      }).select("id").single();
      dealId = deal?.id ?? null;
    }
  }

  const fields: Record<string, unknown> = {
    first_name: clean(input.firstName), last_name: clean(input.lastName), email, phone, company: companyName, ...extra,
  };
  const body = Object.entries(fields).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("\n");
  await db.from("activities").insert({
    type: "form",
    contact_id: contact.id,
    deal_id: dealId,
    title: page ? `Submitted form on “${page.name}”` : "Lead captured",
    body,
    metadata: { page_id: page?.id ?? null, variant_id: input.variantId ?? null, utm, referrer: input.referrer ?? null, is_new: isNew },
  });

  if (page) {
    await db.from("landing_page_events").insert({
      page_id: page.id, variant_id: input.variantId ?? null, visitor_id: input.visitorId ?? null, type: "conversion",
      contact_id: contact.id, referrer: input.referrer ?? null, utm,
    });
  }

  const link = `/contacts/${contact.id}`;
  const title = isNew ? `New lead${page ? ` from ${page.name}` : ""}` : `${contactLabel(contact)} re-submitted${page ? ` on ${page.name}` : ""}`;
  const desc = [contactLabel(contact), email, phone].filter(Boolean).join(" · ");
  const owner = contact.owner_id ?? ownerId;
  await notify([owner], { title: owner ? `${title} — assigned to you` : title, body: desc, link });
  const { data: admins } = await db.from("profiles").select("id").eq("role", "admin").eq("is_active", true);
  await notify((admins ?? []).map((a) => a.id).filter((id) => id !== owner), { title, body: desc, link });

  try {
    if (isNew) await emitEvent({ type: "lead_created", contactId: contact.id, dealId, data: { page_id: page?.id ?? null, source } });
    await emitEvent({ type: "form_submitted", contactId: contact.id, dealId, data: { page_id: page?.id ?? null, source } });
  } catch (e) {
    console.error("emitEvent failed", e);
  }

  return { contactId: contact.id, dealId, ownerId: owner ?? null, isNew };
}
