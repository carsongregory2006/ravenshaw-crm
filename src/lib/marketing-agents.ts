import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chat } from "@/lib/integrations/openrouter";
import { adRollup, dailySeries, landerRollup, rangeFrom, cpl, cpw } from "@/lib/marketing";

export const AGENTS = [
  { id: "analyst", name: "Ad analyst", description: "Looks at every ad and tells you what to cut, what to scale and what to test next.", input: "Anything to focus on? (optional)" },
  { id: "copywriter", name: "Copywriter", description: "Writes new ad copy variations based on your best ads and past lessons.", input: "Describe the offer, audience and city" },
  { id: "report", name: "Weekly report", description: "A short plain-English report of how the ads did, ready to read or send.", input: "Who is it for? (optional)" },
  { id: "lessons", name: "Lessons from past campaigns", description: "Pulls the patterns out of everything you've written in Past campaigns.", input: "Question to answer (optional)" },
] as const;
export type AgentId = (typeof AGENTS)[number]["id"];

const r2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

async function context(db: SupabaseClient, days: number) {
  const { from, to } = rangeFrom(days);
  const [ads, series, landers, { data: past }] = await Promise.all([
    adRollup(db, from, to), dailySeries(db, from, to), landerRollup(db, from, to),
    db.from("mkt_past_campaigns").select("name, platform, start_date, end_date, notes, learnings").order("end_date", { ascending: false, nullsFirst: false }).limit(30),
  ]);
  return {
    period: `${from} to ${to} (${days} days)`,
    totals: { ...series.total, cost_per_lead: r2(cpl(series.total)), cost_per_won_job: r2(cpw(series.total)) },
    ads: ads.filter((a) => a.spend > 0 || a.leads > 0).sort((a, b) => b.spend - a.spend).slice(0, 80).map((a) => ({
      campaign: a.campaign, ad_set: a.ad_set, ad: a.name, platform: a.platform, spend: r2(a.spend), impressions: a.impressions, clicks: a.clicks,
      leads: a.leads, won_jobs: a.won_jobs, cost_per_lead: r2(cpl(a)), cost_per_won_job: r2(cpw(a)), ctr: a.impressions ? r2((a.clicks / a.impressions) * 100) : null,
    })),
    landers: landers.map((l) => ({ name: l.name, kind: l.kind, visits: l.visits, leads: l.leads, spend: r2(l.spend), conversion_pct: l.visits ? r2((l.leads / l.visits) * 100) : null })),
    past_campaigns: past ?? [],
  };
}

const SYSTEM = "You are a direct-response marketing expert working for Ravenshaw AI, a Canadian agency that runs paid ads (mostly Meta) for local service businesses. Amounts are in CAD. Be specific, use the numbers given, never invent numbers. Ads with under $50 spend or under 3 leads don't have enough data to judge. Write in short plain-English sections with markdown headings and bullet points. Keep it under 400 words unless asked to write ad copy.";

const TASK: Record<AgentId, string> = {
  analyst: "Analyse these ads. Give: 1) Cut — ads to turn off and why, 2) Scale — ads to put more budget on and why, 3) Fix — ads with good clicks but poor leads (landing page or offer problem), 4) Test next — 3 concrete tests. Mention cost per lead and cost per won job.",
  copywriter: "Write 5 new Meta ad variations for the offer described. For each: a hook (first line), primary text (2–4 short lines), headline (under 40 characters) and a call to action. Base the angles on what the best-performing ads and past lessons suggest (ad names often describe the angle). Plain, local, no hype words.",
  report: "Write a short performance report for the period: headline numbers vs what good looks like, what's working, what isn't, and the 3 priorities for next week.",
  lessons: "Read the past campaigns' notes and 'what we learned'. Summarise the recurring lessons: what consistently works, what to avoid, and a checklist for launching the next campaign.",
};

export async function runAgent(db: SupabaseClient, agent: AgentId, days: number, input: string) {
  const ctx = await context(db, days);
  if (agent !== "lessons" && agent !== "copywriter" && !ctx.ads.length) throw new Error("No ad numbers in this period yet — import some on the Campaigns tab first.");
  if (agent === "lessons" && !ctx.past_campaigns.length) throw new Error("No past campaigns saved yet.");
  const data = agent === "lessons" ? { past_campaigns: ctx.past_campaigns } : ctx;
  return chat([
    { role: "system", content: SYSTEM },
    { role: "user", content: `${TASK[agent]}${input.trim() ? `\n\nExtra instructions from the user: ${input.trim().slice(0, 2000)}` : ""}\n\nData (JSON):\n${JSON.stringify(data)}` },
  ], { maxTokens: agent === "copywriter" ? 1800 : 1300, temperature: agent === "copywriter" ? 0.8 : 0.3 });
}
