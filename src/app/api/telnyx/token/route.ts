import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createWebRtcToken } from "@/lib/integrations/telnyx";
import { IntegrationNotConfigured } from "@/lib/env";
import { ourLines } from "@/lib/phone-lines";

export const dynamic = "force-dynamic";

/** Issues a short-lived Telnyx WebRTC login token for the signed-in user's browser dialer. */
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const token = await createWebRtcToken();
    const { lines, defaultLine } = await ourLines();
    return NextResponse.json({ token, lines, defaultLine });
  } catch (e) {
    if (e instanceof IntegrationNotConfigured) return NextResponse.json({ error: e.message, notConfigured: true }, { status: 501 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Token error" }, { status: 502 });
  }
}
