"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safe } from "@/lib/actions/util";
import { getProfile } from "@/lib/auth";

async function admin() {
  const p = await getProfile();
  if (p?.role !== "admin") throw new Error("Only admins can use Marketing");
  return p;
}
const refresh = () => revalidatePath("/marketing", "layout");
const txt = (s: unknown, max = 300) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };

export interface AdStatInput {
  date: string; campaign: string; ad_set: string; ad: string;
  spend?: number; impressions?: number; clicks?: number; leads?: number; won_jobs?: number;
}

/**
 * Upsert ad numbers (manual entry or Ads Manager CSV). Campaigns, ad sets and ads are found by name or created.
 * Fields left out of a row keep their saved value (so a CSV without won jobs doesn't wipe the ones you entered).
 */
export async function saveAdStatsAction(input: { platform: string; rows: AdStatInput[] }) {
  return safe(async () => {
    await admin();
    if (input.rows.length > 20000) throw new Error("Import up to 20,000 rows at a time");
    const db = await createClient();
    const platform = txt(input.platform, 40).toLowerCase() || "meta";
    const rows = input.rows
      .map((r) => ({ ...r, campaign: txt(r.campaign) || "Untitled campaign", ad_set: txt(r.ad_set) || "Default ad set", ad: txt(r.ad) || "Default ad" }))
      .filter((r) => isDay(r.date));
    if (!rows.length) throw new Error("No rows with a valid date (YYYY-MM-DD)");

    const campIds = new Map<string, string>();
    for (const name of [...new Set(rows.map((r) => r.campaign))]) {
      const { data, error } = await db.from("mkt_campaigns").upsert({ platform, name }, { onConflict: "platform,name" }).select("id").single();
      if (error) throw new Error(error.message);
      campIds.set(name, data.id);
    }
    const setIds = new Map<string, string>();
    for (const key of [...new Set(rows.map((r) => `${r.campaign}\u0000${r.ad_set}`))]) {
      const [c, s] = key.split("\u0000");
      const { data, error } = await db.from("mkt_ad_sets").upsert({ campaign_id: campIds.get(c), name: s }, { onConflict: "campaign_id,name" }).select("id").single();
      if (error) throw new Error(error.message);
      setIds.set(key, data.id);
    }
    const adIds = new Map<string, string>();
    for (const key of [...new Set(rows.map((r) => `${r.campaign}\u0000${r.ad_set}\u0000${r.ad}`))]) {
      const [c, s, a] = key.split("\u0000");
      const { data, error } = await db.from("mkt_ads").upsert({ ad_set_id: setIds.get(`${c}\u0000${s}`), name: a }, { onConflict: "ad_set_id,name" }).select("id").single();
      if (error) throw new Error(error.message);
      adIds.set(key, data.id);
    }

    // Merge duplicate (ad, date) rows in the file, then upsert in batches grouped by which fields are present.
    const FIELDS = ["spend", "impressions", "clicks", "leads", "won_jobs"] as const;
    const merged = new Map<string, Record<string, number | string>>();
    for (const r of rows) {
      const ad_id = adIds.get(`${r.campaign}\u0000${r.ad_set}\u0000${r.ad}`)!;
      const k = `${ad_id}|${r.date}`;
      const cur = merged.get(k) ?? { ad_id, date: r.date };
      for (const f of FIELDS) if (r[f] !== undefined && r[f] !== null) cur[f] = Number(cur[f] ?? 0) + n(r[f]);
      merged.set(k, cur);
    }
    const byShape = new Map<string, Record<string, number | string>[]>();
    for (const row of merged.values()) {
      const shape = FIELDS.filter((f) => f in row).join(",");
      byShape.set(shape, [...(byShape.get(shape) ?? []), row]);
    }
    for (const list of byShape.values()) {
      for (let i = 0; i < list.length; i += 500) {
        const { error } = await db.from("mkt_ad_stats").upsert(list.slice(i, i + 500), { onConflict: "ad_id,date" });
        if (error) throw new Error(error.message);
      }
    }
    refresh();
    return { rows: merged.size, campaigns: campIds.size, ads: adIds.size };
  });
}

/** Set won jobs for an ad on a day (creates the day row if needed). */
export async function setWonJobsAction(adId: string, date: string, wonJobs: number) {
  return safe(async () => {
    await admin();
    if (!isDay(date)) throw new Error("Pick a date");
    const { error } = await (await createClient()).from("mkt_ad_stats").upsert({ ad_id: adId, date, won_jobs: Math.round(n(wonJobs)) }, { onConflict: "ad_id,date" });
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

export async function setAdLanderAction(adId: string, landerId: string | null) {
  return safe(async () => {
    await admin();
    const { error } = await (await createClient()).from("mkt_ads").update({ lander_id: landerId || null }).eq("id", adId);
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

export async function deleteCampaignAction(id: string) {
  return safe(async () => {
    await admin();
    const { error } = await (await createClient()).from("mkt_campaigns").delete().eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

// ───────────── Landers & forms ─────────────

export async function saveLanderAction(input: { id?: string; name: string; kind: string; url?: string; landing_page_id?: string | null }) {
  return safe(async () => {
    await admin();
    const row = { name: txt(input.name, 120), kind: input.kind === "form" ? "form" : "page", url: txt(input.url, 500) || null, landing_page_id: input.landing_page_id || null };
    if (!row.name) throw new Error("Give it a name");
    const db = await createClient();
    const { error } = input.id ? await db.from("mkt_landers").update(row).eq("id", input.id) : await db.from("mkt_landers").insert(row);
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

export async function deleteLanderAction(id: string) {
  return safe(async () => {
    await admin();
    const { error } = await (await createClient()).from("mkt_landers").delete().eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

// ───────────── Past campaigns ─────────────

export interface PastCampaignInput { name: string; platform: string; start_date: string | null; end_date: string | null; notes: string; learnings: string }

export async function savePastCampaignAction(input: PastCampaignInput & { id?: string }) {
  return safe(async () => {
    const p = await admin();
    const row = {
      name: txt(input.name, 200), platform: txt(input.platform, 40).toLowerCase() || "meta",
      start_date: isDay(input.start_date) ? input.start_date : null, end_date: isDay(input.end_date) ? input.end_date : null,
      notes: txt(input.notes, 20000) || null, learnings: txt(input.learnings, 20000) || null, updated_at: new Date().toISOString(),
    };
    if (!row.name) throw new Error("Give the campaign a name");
    if (row.start_date && row.end_date && row.end_date < row.start_date) throw new Error("End date is before the start date");
    const db = await createClient();
    if (input.id) {
      const { error } = await db.from("mkt_past_campaigns").update(row).eq("id", input.id);
      if (error) throw new Error(error.message);
      refresh();
      return { id: input.id };
    }
    const { data, error } = await db.from("mkt_past_campaigns").insert({ ...row, created_by: p.id }).select("id").single();
    if (error) throw new Error(error.message);
    refresh();
    return { id: data.id as string };
  });
}

export async function deletePastCampaignAction(id: string) {
  return safe(async () => {
    await admin();
    const { error } = await (await createClient()).from("mkt_past_campaigns").delete().eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

export async function addPastCampaignFileAction(pastCampaignId: string, file: { name: string; headers: string[]; rows: string[][] }) {
  return safe(async () => {
    await admin();
    if (!file.headers.length) throw new Error("The file has no header row");
    if (file.rows.length > 10000) throw new Error("Files up to 10,000 rows");
    const { error } = await (await createClient()).from("mkt_past_campaign_files").insert({
      past_campaign_id: pastCampaignId, file_name: txt(file.name, 200) || "upload.csv",
      headers: file.headers.map((h) => String(h).slice(0, 200)), rows: file.rows.map((r) => r.map((c) => String(c ?? "").slice(0, 2000))),
    });
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

export async function deletePastCampaignFileAction(id: string) {
  return safe(async () => {
    await admin();
    const { error } = await (await createClient()).from("mkt_past_campaign_files").delete().eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
    return null;
  });
}

// ───────────── Agents ─────────────

export async function runAgentAction(agent: string, days: number, input: string) {
  return safe(async () => {
    await admin();
    const { AGENTS, runAgent } = await import("@/lib/marketing-agents");
    const a = AGENTS.find((x) => x.id === agent);
    if (!a) throw new Error("Unknown agent");
    const db = await createClient();
    const output = await runAgent(db, a.id, days, input);
    const at = new Date().toISOString();
    await db.from("app_kv").upsert({ key: `mkt_agent:${a.id}`, value: { output, input, days, at }, updated_at: at });
    return { output, at };
  });
}
