import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { exchangeCode } from "@/lib/integrations/google";
import { createAdminClient } from "@/lib/supabase/admin";
import { importGoogleCalendarList, syncUserGoogle } from "@/lib/calendar/google-sync";

function emailFromIdToken(idToken?: string) {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return (payload.email as string) ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/calendar?google=${q}`, req.url));
  const me = await getProfile();
  if (!me) return NextResponse.redirect(new URL("/login?next=/calendar", req.url));

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("denied");
  const state = params.get("state");
  const code = params.get("code");
  if (!code || !state || state !== req.cookies.get("g_oauth_state")?.value) return back("invalid_state");

  try {
    const tok = await exchangeCode(code);
    const db = createAdminClient();
    const { data: existing } = await db.from("google_accounts").select("refresh_token").eq("user_id", me.id).maybeSingle();
    await db.from("google_accounts").upsert({
      user_id: me.id,
      email: emailFromIdToken(tok.id_token),
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? existing?.refresh_token ?? null,
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    });
    await importGoogleCalendarList(me.id);
    await syncUserGoogle(me.id);
  } catch (e) {
    console.error("google oauth callback", e);
    return back("error");
  }
  const res = back("connected");
  res.cookies.delete("g_oauth_state");
  return res;
}
