import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processRuns } from "@/lib/automations/engine";
import { runBillingCron } from "@/lib/billing/cron";
import { syncAllGoogleCalendars } from "@/lib/calendar/google-sync";
import { dueReminders } from "@/lib/calendar/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Heartbeat called every minute by Supabase pg_cron (see schedule_crm_tick) and daily by Vercel Cron.
 * Each job is isolated so one failing integration never blocks the others.
 */
async function tick(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const results: Record<string, unknown> = {};
  const jobs: [string, () => Promise<unknown>][] = [
    ["automations", () => processRuns({ limit: 200 })],
    ["billing", () => runBillingCron()],
    ["reminders", () => dueReminders()],
  ];
  // Google sync is heavier; run every 5 minutes.
  if (new Date().getMinutes() % 5 === 0) jobs.push(["google", () => syncAllGoogleCalendars()]);

  const errors: string[] = [];
  for (const [name, fn] of jobs) {
    try {
      results[name] = (await fn()) ?? "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results[name] = { error: msg };
      errors.push(`${name}: ${msg}`);
    }
  }

  await createAdminClient().from("webhook_events").insert({
    provider: "cron", event_type: "tick", payload: results, processed_at: new Date().toISOString(), error: errors.join("; ") || null,
  });
  return NextResponse.json({ ok: errors.length === 0, results });
}

export const GET = tick;
export const POST = tick;
