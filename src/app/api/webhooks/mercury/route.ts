import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncMercury } from "@/lib/billing/mercury-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Mercury webhook receiver. Register as https://<app>/api/webhooks/mercury?secret=<CRON_SECRET>. */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await req.text();
  let payload: unknown = null;
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  const db = createAdminClient();
  const p = payload as { type?: string; eventType?: string; id?: string };
  const { data: log } = await db.from("webhook_events").insert({
    provider: "mercury", event_type: p?.type ?? p?.eventType ?? "event", payload,
  }).select("id").single();
  try {
    const summary = await syncMercury();
    if (log) await db.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", log.id);
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (log) await db.from("webhook_events").update({ error }).eq("id", log.id);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
