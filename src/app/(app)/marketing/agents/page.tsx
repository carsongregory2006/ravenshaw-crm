import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AGENTS } from "@/lib/marketing-agents";
import { rangeFrom } from "@/lib/marketing";
import { integrations } from "@/lib/env";
import { AgentsView } from "./agents-view";

export const metadata = { title: "Marketing · Agents" };
export const dynamic = "force-dynamic";

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();
  const { days } = rangeFrom(Number((await searchParams).days));
  const { data } = await (await createClient()).from("app_kv").select("key, value").like("key", "mkt_agent:%");
  const last = Object.fromEntries((data ?? []).map((r) => [r.key.slice("mkt_agent:".length), r.value as { output: string; at: string; input: string }]));
  return <AgentsView agents={AGENTS.map((a) => ({ ...a }))} last={last} days={days} aiReady={integrations.openrouter()} />;
}
