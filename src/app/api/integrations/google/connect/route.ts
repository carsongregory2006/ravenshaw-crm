import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { googleAuthUrl } from "@/lib/integrations/google";
import { integrations } from "@/lib/env";

export async function GET(req: NextRequest) {
  const me = await getProfile();
  if (!me) return NextResponse.redirect(new URL("/login?next=/calendar", req.url));
  if (!integrations.google()) return NextResponse.redirect(new URL("/calendar?google=not_configured", req.url));
  const nonce = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(googleAuthUrl(nonce));
  res.cookies.set("g_oauth_state", nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
