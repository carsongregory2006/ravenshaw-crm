import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const me = await getProfile();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data: acct } = await db.from("google_accounts").select("refresh_token, access_token").eq("user_id", me.id).maybeSingle();
  const token = acct?.refresh_token || acct?.access_token;
  if (token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => null);
  }
  await db.from("calendars").delete().eq("owner_id", me.id).eq("source", "google");
  await db.from("google_accounts").delete().eq("user_id", me.id);
  if (req.headers.get("accept")?.includes("application/json")) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL("/calendar?google=disconnected", req.url), 303);
}
