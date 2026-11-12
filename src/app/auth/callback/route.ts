import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") || "/dashboard";
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  // Only same-site paths: "//evil.com" and "/\\evil.com" would leave the site.
  const safe = /^\/(?![\/\\])/.test(next) ? next : "/dashboard";
  return NextResponse.redirect(new URL(safe, req.url));
}
