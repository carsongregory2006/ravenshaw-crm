import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, clientIp, rateLimited } from "../cors";

const int = z.coerce.number().int().min(0).max(86400).optional();

const schema = z.object({
  visit_id: z.string().min(8).max(64),
  page_id: z.string().uuid(),
  visitor_id: z.string().max(64).nullable().optional(),
  variant: z.string().max(60).nullable().optional(),
  time_on_page_s: int,
  max_scroll_pct: int,
  cta_clicks: int,
  vsl_started: z.boolean().optional(),
  vsl_watch_s: int,
  vsl_duration_s: int,
  vsl_max_pct: int,
  converted: z.boolean().optional(),
  booked: z.boolean().optional(),
  referrer: z.string().max(2000).nullable().optional(),
  utm: z.record(z.string(), z.string().max(300)).nullable().optional(),
  device: z.enum(["mobile", "tablet", "desktop"]).optional(),
});

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Lander tracker beacon (sent as text/plain so browsers skip the CORS preflight). */
export async function POST(req: Request) {
  if (rateLimited(`visit:${clientIp(req)}`, 240, 60_000)) {
    return NextResponse.json({ ok: false }, { status: 429, headers: CORS_HEADERS });
  }
  let body: unknown;
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ ok: false }, { status: 400, headers: CORS_HEADERS }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400, headers: CORS_HEADERS });

  const country = req.headers.get("x-vercel-ip-country");
  const { error } = await createAdminClient().rpc("lander_track", { p: { ...parsed.data, country } });
  if (error) {
    console.error("lander_track", error.message);
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS_HEADERS });
  }
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
