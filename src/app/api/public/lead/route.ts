import { NextResponse } from "next/server";
import { z } from "zod";
import { createLead } from "@/lib/leads";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, clientIp, rateLimited } from "../cors";

const str = (max = 200) => z.string().trim().max(max).optional().nullable();

const schema = z.object({
  page_id: z.string().uuid().optional().nullable(),
  page_slug: str(80),
  variant_id: z.string().uuid().optional().nullable(),
  visitor_id: str(100),
  first_name: str(),
  last_name: str(),
  name: str(), // convenience for external forms: split into first/last
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  phone: str(40),
  company: str(),
  website: str(300),
  message: str(5000),
  utm: z.record(z.string(), z.string().max(300)).optional().nullable(),
  referrer: str(2000),
  hp: str(),
}).passthrough();

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(`lead:${ip}`, 8, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many submissions. Please try again later." }, { status: 429, headers: CORS_HEADERS });
  }

  let raw: unknown;
  const ct = req.headers.get("content-type") || "";
  try {
    raw = ct.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400, headers: CORS_HEADERS });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0];
    return NextResponse.json({ ok: false, error: msg?.path.join(".") === "email" ? "Please enter a valid email" : "Please check the form and try again" }, { status: 400, headers: CORS_HEADERS });
  }
  const b = parsed.data;

  // Honeypot: pretend success so bots don't retry.
  if (b.hp) return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  if (!b.email && !b.phone) return NextResponse.json({ ok: false, error: "Please enter an email or phone number" }, { status: 400, headers: CORS_HEADERS });

  let pageId = b.page_id ?? null;
  if (!pageId && b.page_slug) {
    const { data } = await createAdminClient().from("landing_pages").select("id").eq("slug", b.page_slug).maybeSingle();
    pageId = data?.id ?? null;
  }

  let first = b.first_name, last = b.last_name;
  if (!first && b.name) {
    const parts = b.name.split(/\s+/);
    first = parts.shift() ?? null;
    last = parts.join(" ") || null;
  }

  const known = new Set(Object.keys(schema.shape));
  const extra = Object.fromEntries(Object.entries(b).filter(([k, v]) => !known.has(k) && typeof v !== "object" && !k.startsWith("utm_")));
  const flatUtm = Object.fromEntries(Object.entries(b).filter(([k, v]) => k.startsWith("utm_") && typeof v === "string")) as Record<string, string>;

  try {
    const r = await createLead({
      pageId,
      variantId: b.variant_id ?? null,
      visitorId: b.visitor_id ?? null,
      firstName: first,
      lastName: last,
      email: b.email || null,
      phone: b.phone,
      company: b.company,
      website: b.website,
      message: b.message,
      utm: { ...flatUtm, ...(b.utm ?? {}) },
      referrer: b.referrer ?? req.headers.get("referer"),
      extra,
    });
    return NextResponse.json({ ok: true, contact_id: r.contactId }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("lead capture failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not submit" }, { status: 500, headers: CORS_HEADERS });
  }
}
