"use server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatJson } from "@/lib/integrations/openrouter";
import { safe } from "@/lib/actions/util";
import { slugify } from "@/lib/utils";
import { PAGE_TEMPLATES, uid } from "@/components/landing/templates";
import type { LandingPage, LandingPageVariant, LandingSection, RrMember } from "@/lib/types";

const db = () => createAdminClient();

async function uniqueSlug(base: string, excludeId?: string) {
  const root = slugify(base) || "page";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    let q = db().from("landing_pages").select("id").eq("slug", candidate);
    if (excludeId) q = q.neq("id", excludeId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${uid()}`;
}

const reval = (id?: string) => {
  revalidatePath("/landing-pages");
  if (id) revalidatePath(`/landing-pages/${id}`);
};

/* ───────── pages ───────── */

export async function createLandingPage(input: { name: string; template: string }) {
  return safe(async () => {
    const me = await requireStaff();
    const tpl = PAGE_TEMPLATES.find((t) => t.key === input.template) ?? PAGE_TEMPLATES[PAGE_TEMPLATES.length - 1];
    const name = input.name.trim() || tpl.name;
    const slug = await uniqueSlug(name);
    const { data: page, error } = await db().from("landing_pages").insert({
      name, slug, created_by: me.id, seo_title: name,
      after_submit: tpl.key === "book_call" ? "calendly" : "message",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const { error: vErr } = await db().from("landing_page_variants").insert({
      page_id: page.id, name: "Variant A", is_control: true, weight: 100, sections: tpl.sections(),
    });
    if (vErr) throw new Error(vErr.message);
    reval();
    return page.id as string;
  });
}

export async function duplicateLandingPage(id: string) {
  return safe(async () => {
    const me = await requireStaff();
    const { data: page } = await db().from("landing_pages").select("*").eq("id", id).single();
    if (!page) throw new Error("Page not found");
    const rest: Partial<LandingPage> = { ...(page as LandingPage) };
    delete rest.id; delete rest.created_at; delete rest.updated_at;
    const slug = await uniqueSlug(`${page.slug}-copy`);
    const { data: copy, error } = await db().from("landing_pages").insert({ ...rest, name: `${page.name} (copy)`, slug, status: "draft", created_by: me.id }).select("id").single();
    if (error) throw new Error(error.message);
    const { data: variants } = await db().from("landing_page_variants").select("*").eq("page_id", id);
    if (variants?.length) {
      await db().from("landing_page_variants").insert(variants.map((v: LandingPageVariant) => ({
        page_id: copy.id, name: v.name, is_control: v.is_control, is_active: v.is_active, weight: v.weight, sections: v.sections,
      })));
    }
    const { data: rr } = await db().from("rr_members").select("*").eq("page_id", id);
    if (rr?.length) {
      await db().from("rr_members").insert(rr.map((m: RrMember) => ({ page_id: copy.id, rep_id: m.rep_id, weight: m.weight, active: m.active })));
    }
    reval();
    return copy.id as string;
  });
}

export async function deleteLandingPage(id: string) {
  return safe(async () => {
    await requireStaff();
    const { error } = await db().from("landing_pages").delete().eq("id", id);
    if (error) throw new Error(error.message);
    reval();
  });
}

export async function setLandingStatus(id: string, status: "draft" | "published" | "archived") {
  return safe(async () => {
    await requireStaff();
    if (status === "published") {
      const { count } = await db().from("landing_page_variants").select("id", { count: "exact", head: true }).eq("page_id", id).eq("is_active", true);
      if (!count) throw new Error("Activate at least one variant before publishing");
    }
    const { error } = await db().from("landing_pages").update({ status }).eq("id", id);
    if (error) throw new Error(error.message);
    reval(id);
  });
}

export type LandingPagePatch = Partial<Pick<LandingPage,
  "name" | "slug" | "seo_title" | "seo_description" | "rr_enabled" | "rr_mode" | "default_owner_id" |
  "after_submit" | "success_message" | "redirect_url" | "calendly_url" | "theme">>;

export async function updateLandingPage(id: string, patch: LandingPagePatch) {
  return safe(async () => {
    await requireStaff();
    const next = { ...patch };
    if (next.slug !== undefined) {
      const s = slugify(next.slug);
      if (!s) throw new Error("Slug can't be empty");
      const { data: clash } = await db().from("landing_pages").select("id").eq("slug", s).neq("id", id).maybeSingle();
      if (clash) throw new Error(`The URL /p/${s} is already taken`);
      next.slug = s;
    }
    if (next.redirect_url && !/^https?:\/\//.test(next.redirect_url)) next.redirect_url = `https://${next.redirect_url}`;
    const { error } = await db().from("landing_pages").update(next).eq("id", id);
    if (error) throw new Error(error.message);
    reval(id);
    return next.slug ?? null;
  });
}

/* ───────── variants ───────── */

export async function saveVariant(id: string, patch: Partial<Pick<LandingPageVariant, "name" | "sections" | "weight" | "is_active" | "is_control">>) {
  return safe(async () => {
    await requireStaff();
    const { data: v, error } = await db().from("landing_page_variants").update(patch).eq("id", id).select("page_id").single();
    if (error) throw new Error(error.message);
    if (patch.is_control) {
      await db().from("landing_page_variants").update({ is_control: false }).eq("page_id", v.page_id).neq("id", id);
    }
    reval(v.page_id);
  });
}

function nextVariantName(existing: string[]) {
  for (let i = 0; i < 26; i++) {
    const n = `Variant ${String.fromCharCode(65 + i)}`;
    if (!existing.includes(n)) return n;
  }
  return `Variant ${existing.length + 1}`;
}

export async function createVariant(pageId: string, fromVariantId?: string | null) {
  return safe(async () => {
    await requireStaff();
    const { data: siblings } = await db().from("landing_page_variants").select("name, sections, id").eq("page_id", pageId).order("created_at");
    const src = siblings?.find((s) => s.id === fromVariantId) ?? siblings?.[0];
    const sections = ((src?.sections as LandingSection[]) ?? []).map((s) => ({ ...s, id: uid() }));
    const { data, error } = await db().from("landing_page_variants").insert({
      page_id: pageId, name: nextVariantName((siblings ?? []).map((s) => s.name)), weight: 50, sections, is_control: !(siblings ?? []).length,
    }).select("*").single();
    if (error) throw new Error(error.message);
    reval(pageId);
    return data as LandingPageVariant;
  });
}

export async function deleteVariant(id: string) {
  return safe(async () => {
    await requireStaff();
    const { data: v } = await db().from("landing_page_variants").select("page_id, is_control").eq("id", id).single();
    if (!v) throw new Error("Variant not found");
    const { count } = await db().from("landing_page_variants").select("id", { count: "exact", head: true }).eq("page_id", v.page_id);
    if ((count ?? 0) <= 1) throw new Error("A page needs at least one variant");
    await db().from("landing_page_variants").delete().eq("id", id);
    if (v.is_control) {
      const { data: first } = await db().from("landing_page_variants").select("id").eq("page_id", v.page_id).order("created_at").limit(1).single();
      if (first) await db().from("landing_page_variants").update({ is_control: true }).eq("id", first.id);
    }
    reval(v.page_id);
  });
}

export async function declareWinner(pageId: string, variantId: string) {
  return safe(async () => {
    await requireStaff();
    await db().from("landing_page_variants").update({ is_active: false, weight: 0 }).eq("page_id", pageId).neq("id", variantId);
    await db().from("landing_page_variants").update({ is_active: true, weight: 100, is_control: true }).eq("id", variantId);
    await db().from("landing_page_variants").update({ is_control: false }).eq("page_id", pageId).neq("id", variantId);
    reval(pageId);
  });
}

/** AI: rewrite copy of an existing variant for a new angle and save it as a new variant. */
export async function generateVariantCopy(pageId: string, fromVariantId: string, angle: string) {
  return safe(async () => {
    await requireStaff();
    const { data: page } = await db().from("landing_pages").select("name").eq("id", pageId).single();
    const { data: src } = await db().from("landing_page_variants").select("sections").eq("id", fromVariantId).single();
    if (!src) throw new Error("Source variant not found");
    const sections = src.sections as LandingSection[];
    // only send the copy-bearing sections; keep forms, videos etc. untouched
    const editable = sections.filter((s) => ["hero", "features", "cta", "stats", "faq"].includes(s.type));
    const result = await chatJson<{ sections: LandingSection[] }>([
      {
        role: "system",
        content: "You are a direct-response copywriter for an AI automation agency. You rewrite landing page copy for A/B tests. Keep the same JSON structure, section ids, section types and number of list items. Only change text values. Be specific, benefit-driven and concise. Return JSON: {\"sections\": [...]}",
      },
      {
        role: "user",
        content: `Landing page: ${page?.name ?? ""}\nTest angle / hypothesis: ${angle || "a sharper, more outcome-focused angle"}\n\nSections JSON:\n${JSON.stringify(editable)}`,
      },
    ], { maxTokens: 3000 });
    const byId = new Map((result.sections ?? []).map((s) => [s.id, s]));
    const merged = sections.map((s) => {
      const r = byId.get(s.id);
      return r && r.type === s.type ? ({ ...s, ...r, id: uid() } as LandingSection) : { ...s, id: uid() };
    });
    const { data: siblings } = await db().from("landing_page_variants").select("name").eq("page_id", pageId);
    const { data, error } = await db().from("landing_page_variants").insert({
      page_id: pageId, name: nextVariantName((siblings ?? []).map((s) => s.name)), weight: 50, sections: merged,
    }).select("*").single();
    if (error) throw new Error(error.message);
    reval(pageId);
    return data as LandingPageVariant;
  });
}

/* ───────── round robin ───────── */

export async function addRrMember(pageId: string, repId: string, weight = 1) {
  return safe(async () => {
    await requireStaff();
    const { data, error } = await db().from("rr_members").upsert({ page_id: pageId, rep_id: repId, weight, active: true }, { onConflict: "page_id,rep_id" }).select("*").single();
    if (error) throw new Error(error.message);
    reval(pageId);
    return data as RrMember;
  });
}

export async function updateRrMember(id: string, patch: Partial<Pick<RrMember, "weight" | "active">>) {
  return safe(async () => {
    await requireStaff();
    const { error } = await db().from("rr_members").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  });
}

export async function removeRrMember(id: string) {
  return safe(async () => {
    await requireStaff();
    const { error } = await db().from("rr_members").delete().eq("id", id);
    if (error) throw new Error(error.message);
  });
}

export async function resetRrCounts(pageId: string) {
  return safe(async () => {
    await requireStaff();
    const { error } = await db().from("rr_members").update({ assigned_count: 0, last_assigned_at: null }).eq("page_id", pageId);
    if (error) throw new Error(error.message);
    reval(pageId);
  });
}

/* ───────── analytics ───────── */

export interface VariantStats {
  variant_id: string;
  name: string;
  is_control: boolean;
  is_active: boolean;
  weight: number;
  views: number;
  visitors: number;
  conversions: number;
  cta_clicks: number;
  booked: number;
  won: number;
  revenue: number;
  cvr: number;
  lift: number | null;
  confidence: number | null;
}

export interface LandingAnalytics {
  variants: VariantStats[];
  daily: { day: string; [key: string]: number | string }[];
  totals: { views: number; visitors: number; conversions: number; booked: number; won: number; revenue: number };
}

function normCdf(z: number) {
  // Abramowitz–Stegun approximation of the standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Two-proportion z-test; returns two-sided confidence that the rates differ (0–1). */
function significance(c1: number, n1: number, c2: number, n2: number) {
  if (n1 < 1 || n2 < 1) return null;
  const p1 = c1 / n1, p2 = c2 / n2, p = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return null;
  const z = Math.abs(p1 - p2) / se;
  return 1 - 2 * (1 - normCdf(z));
}

export async function getLandingAnalytics(pageId: string, days = 30) {
  return safe(async (): Promise<LandingAnalytics> => {
    await requireStaff();
    const sb = db();
    const [{ data: variants }, { data: stats }, { data: daily }, { data: stages }, { data: contacts }] = await Promise.all([
      sb.from("landing_page_variants").select("id, name, is_control, is_active, weight").eq("page_id", pageId).order("created_at"),
      sb.rpc("lp_variant_stats", { p_page_id: pageId }),
      sb.rpc("lp_daily_stats", { p_page_id: pageId, p_days: days }),
      sb.from("pipeline_stages").select("id, key, position, is_won, is_lost"),
      sb.from("contacts").select("id, variant_id").eq("landing_page_id", pageId),
    ]);
    const contactIds = (contacts ?? []).map((c) => c.id);
    const variantOf = new Map((contacts ?? []).map((c) => [c.id, c.variant_id as string | null]));
    const [{ data: deals }, { data: payments }] = contactIds.length
      ? await Promise.all([
          sb.from("deals").select("contact_id, stage_id").in("contact_id", contactIds),
          sb.from("payments").select("contact_id, amount").in("contact_id", contactIds),
        ])
      : [{ data: [] as { contact_id: string; stage_id: string }[] }, { data: [] as { contact_id: string; amount: number }[] }];

    const stageById = new Map((stages ?? []).map((s) => [s.id, s]));
    const bookedPos = (stages ?? []).find((s) => s.key === "booked")?.position ?? 2;
    const bookedContacts = new Map<string | null, Set<string>>();
    const wonContacts = new Map<string | null, Set<string>>();
    for (const d of deals ?? []) {
      const st = stageById.get(d.stage_id);
      if (!st) continue;
      const v = variantOf.get(d.contact_id) ?? null;
      if (st.is_won || (!st.is_lost && st.position >= bookedPos)) {
        if (!bookedContacts.has(v)) bookedContacts.set(v, new Set());
        bookedContacts.get(v)!.add(d.contact_id);
      }
      if (st.is_won) {
        if (!wonContacts.has(v)) wonContacts.set(v, new Set());
        wonContacts.get(v)!.add(d.contact_id);
      }
    }
    const revenue = new Map<string | null, number>();
    for (const p of payments ?? []) {
      const v = variantOf.get(p.contact_id) ?? null;
      revenue.set(v, (revenue.get(v) ?? 0) + Number(p.amount));
    }

    type Row = { variant_id: string | null; views: number; visitors: number; conversions: number; cta_clicks: number; bookings: number };
    const statBy = new Map(((stats ?? []) as Row[]).map((s) => [s.variant_id, s]));

    const rows: VariantStats[] = (variants ?? []).map((v) => {
      const s = statBy.get(v.id);
      const views = Number(s?.views ?? 0), visitors = Number(s?.visitors ?? 0), conversions = Number(s?.conversions ?? 0);
      const denom = visitors || views;
      return {
        variant_id: v.id, name: v.name, is_control: v.is_control, is_active: v.is_active, weight: v.weight,
        views, visitors, conversions, cta_clicks: Number(s?.cta_clicks ?? 0),
        booked: Math.max(bookedContacts.get(v.id)?.size ?? 0, Number(s?.bookings ?? 0)),
        won: wonContacts.get(v.id)?.size ?? 0,
        revenue: revenue.get(v.id) ?? 0,
        cvr: denom ? conversions / denom : 0,
        lift: null, confidence: null,
      };
    });
    const control = rows.find((r) => r.is_control) ?? rows[0];
    if (control) {
      for (const r of rows) {
        if (r === control) continue;
        const nC = control.visitors || control.views, nR = r.visitors || r.views;
        r.lift = control.cvr > 0 ? r.cvr / control.cvr - 1 : null;
        r.confidence = significance(control.conversions, nC, r.conversions, nR);
      }
    }

    // daily series keyed by "<variant name> views" / "<variant name> leads"
    const names = new Map((variants ?? []).map((v) => [v.id, v.name]));
    const byDay = new Map<string, { day: string; [k: string]: number | string }>();
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const row: { day: string; [k: string]: number | string } = { day: key };
      for (const v of variants ?? []) { row[`${v.name} views`] = 0; row[`${v.name} leads`] = 0; }
      byDay.set(key, row);
    }
    for (const r of (daily ?? []) as { day: string; variant_id: string | null; views: number; conversions: number }[]) {
      const row = byDay.get(String(r.day).slice(0, 10));
      const name = names.get(r.variant_id ?? "");
      if (!row || !name) continue;
      row[`${name} views`] = Number(r.views);
      row[`${name} leads`] = Number(r.conversions);
    }

    const totals = rows.reduce((a, r) => ({
      views: a.views + r.views, visitors: a.visitors + r.visitors, conversions: a.conversions + r.conversions,
      booked: a.booked + r.booked, won: a.won + r.won, revenue: a.revenue + r.revenue,
    }), { views: 0, visitors: 0, conversions: 0, booked: 0, won: 0, revenue: 0 });

    return { variants: rows, daily: [...byDay.values()], totals };
  });
}
