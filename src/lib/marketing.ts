import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { format, subDays } from "date-fns";

export const RANGE_DAYS = [7, 30, 90] as const;
/** Below this, an ad or page has too little data to rank. */
export const MIN_SPEND = 50;
export const MIN_LEADS = 3;

export function rangeFrom(days: number) {
  const d = RANGE_DAYS.includes(days as 7) ? days : 30;
  return { days: d, from: format(subDays(new Date(), d - 1), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd") };
}

export interface Totals { spend: number; impressions: number; clicks: number; leads: number; won_jobs: number }
export const ZERO: Totals = { spend: 0, impressions: 0, clicks: 0, leads: 0, won_jobs: 0 };
export const add = (a: Totals, b: Partial<Totals>): Totals => ({
  spend: a.spend + Number(b.spend ?? 0), impressions: a.impressions + Number(b.impressions ?? 0), clicks: a.clicks + Number(b.clicks ?? 0),
  leads: a.leads + Number(b.leads ?? 0), won_jobs: a.won_jobs + Number(b.won_jobs ?? 0),
});
export const cpl = (t: Totals) => (t.leads ? t.spend / t.leads : null);
export const cpw = (t: Totals) => (t.won_jobs ? t.spend / t.won_jobs : null);

export interface AdRow extends Totals {
  id: string; name: string; lander_id: string | null;
  ad_set_id: string; ad_set: string; campaign_id: string; campaign: string; platform: string;
}

/** Every ad with its totals for the date range (ads with no rows in range get zeros). */
export async function adRollup(db: SupabaseClient, from: string, to: string, opts: { campaignId?: string } = {}): Promise<AdRow[]> {
  const { data: all, error } = await db.from("mkt_ads").select("id, name, lander_id, ad_set:mkt_ad_sets!inner(id, name, campaign:mkt_campaigns!inner(id, name, platform))");
  if (error) throw new Error(error.message);
  const ads = opts.campaignId ? (all ?? []).filter((a) => (a.ad_set as unknown as { campaign: { id: string } }).campaign.id === opts.campaignId) : all;
  const ids = (ads ?? []).map((a) => a.id);
  const totals = new Map<string, Totals>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data: stats } = await db.from("mkt_ad_stats").select("ad_id, spend, impressions, clicks, leads, won_jobs").in("ad_id", ids.slice(i, i + 300)).gte("date", from).lte("date", to);
    for (const s of stats ?? []) totals.set(s.ad_id, add(totals.get(s.ad_id) ?? ZERO, s));
  }
  return (ads ?? []).map((a) => {
    const set = a.ad_set as unknown as { id: string; name: string; campaign: { id: string; name: string; platform: string } };
    return { id: a.id, name: a.name, lander_id: a.lander_id, ad_set_id: set.id, ad_set: set.name, campaign_id: set.campaign.id, campaign: set.campaign.name, platform: set.campaign.platform, ...(totals.get(a.id) ?? ZERO) };
  });
}

/** Group ad rows by a key into totals. */
export function groupBy<K extends string>(rows: AdRow[], key: (r: AdRow) => K, label: (r: AdRow) => string) {
  const m = new Map<K, Totals & { id: K; name: string; ads: number }>();
  for (const r of rows) {
    const k = key(r);
    const cur = m.get(k) ?? { ...ZERO, id: k, name: label(r), ads: 0 };
    m.set(k, { ...add(cur, r), id: k, name: cur.name, ads: cur.ads + 1 });
  }
  return [...m.values()];
}

export interface LanderRow { id: string; name: string; kind: "page" | "form"; url: string | null; landing_page_id: string | null; tracked: boolean; visits: number; leads: number; spend: number; ads: number }

/**
 * Landers & forms with visits, leads and the spend of ads pointing at them.
 * CRM-linked pages use the CRM's own visit tracking; manual entries use their ads' clicks and leads.
 */
export async function landerRollup(db: SupabaseClient, from: string, to: string): Promise<LanderRow[]> {
  const [{ data: landers }, ads] = await Promise.all([
    db.from("mkt_landers").select("id, name, kind, url, landing_page_id").order("created_at"),
    adRollup(db, from, to),
  ]);
  const fromTs = `${from}T00:00:00`, toTs = `${to}T23:59:59.999`;
  const out: LanderRow[] = [];
  for (const l of landers ?? []) {
    const mine = ads.filter((a) => a.lander_id === l.id);
    const t = mine.reduce((s, a) => add(s, a), ZERO);
    let visits = t.clicks, leads = t.leads;
    if (l.landing_page_id) {
      const [lv, lvc, ev, evc] = await Promise.all([
        db.from("lander_visits").select("id", { count: "exact", head: true }).eq("page_id", l.landing_page_id).gte("started_at", fromTs).lte("started_at", toTs),
        db.from("lander_visits").select("id", { count: "exact", head: true }).eq("page_id", l.landing_page_id).eq("converted", true).gte("started_at", fromTs).lte("started_at", toTs),
        db.from("landing_page_events").select("id", { count: "exact", head: true }).eq("page_id", l.landing_page_id).eq("type", "view").gte("created_at", fromTs).lte("created_at", toTs),
        db.from("landing_page_events").select("id", { count: "exact", head: true }).eq("page_id", l.landing_page_id).eq("type", "conversion").gte("created_at", fromTs).lte("created_at", toTs),
      ]);
      visits = Math.max(lv.count ?? 0, ev.count ?? 0);
      leads = Math.max(lvc.count ?? 0, evc.count ?? 0);
    }
    out.push({ id: l.id, name: l.name, kind: l.kind, url: l.url, landing_page_id: l.landing_page_id, tracked: !!l.landing_page_id, visits, leads, spend: t.spend, ads: mine.length });
  }
  return out;
}
