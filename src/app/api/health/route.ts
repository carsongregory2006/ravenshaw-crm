import { NextResponse } from "next/server";
import { integrations } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Public health check: integration configuration + database connectivity. Never returns secrets. */
export async function GET() {
  const status = Object.fromEntries(Object.entries(integrations).map(([k, fn]) => [k, fn()]));
  let db: { ok: boolean; latency_ms?: number; error?: string } = { ok: false };
  if (status.supabase) {
    const t = Date.now();
    try {
      const { error } = await createAdminClient().from("workspace_settings").select("id").eq("id", 1).single();
      db = error ? { ok: false, error: error.message } : { ok: true, latency_ms: Date.now() - t };
    } catch (e) {
      db = { ok: false, error: e instanceof Error ? e.message : "unreachable" };
    }
  } else {
    db = { ok: false, error: "Supabase env vars missing" };
  }
  return NextResponse.json(
    { ok: db.ok, time: new Date().toISOString(), database: db, integrations: status },
    { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
