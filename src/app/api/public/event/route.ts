import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, clientIp, rateLimited } from "../cors";

const schema = z.object({
  page_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable().optional(),
  visitor_id: z.string().max(100).nullable().optional(),
  type: z.enum(["view", "cta_click", "booking"]),
  contact_id: z.string().uuid().nullable().optional(),
  referrer: z.string().max(2000).nullable().optional(),
  utm: z.record(z.string(), z.string().max(300)).nullable().optional(),
});

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  if (rateLimited(`ev:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429, headers: CORS_HEADERS });
  }
  let body: unknown;
  try { body = JSON.parse(await req.text()); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid event" }, { status: 400, headers: CORS_HEADERS });
  const e = parsed.data;
  const db = createAdminClient();
  const { error } = await db.from("landing_page_events").insert({
    page_id: e.page_id, variant_id: e.variant_id ?? null, visitor_id: e.visitor_id ?? null, type: e.type,
    contact_id: e.contact_id ?? null, referrer: e.referrer ?? null, utm: e.utm ?? null,
  });
  if (error) return NextResponse.json({ ok: false, error: "Could not record event" }, { status: 400, headers: CORS_HEADERS });
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
