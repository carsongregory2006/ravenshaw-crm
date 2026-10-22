import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createWebRtcToken } from "@/lib/integrations/telnyx";
import { IntegrationNotConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Issues a short-lived Telnyx WebRTC login token for the signed-in user's browser dialer. */
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const token = await createWebRtcToken();
    const { data: settings } = await sb.from("workspace_settings").select("sms_from_number").eq("id", 1).single();
    return NextResponse.json({ token, callerNumber: settings?.sms_from_number || process.env.TELNYX_FROM_NUMBER || null });
  } catch (e) {
    if (e instanceof IntegrationNotConfigured) return NextResponse.json({ error: e.message, notConfigured: true }, { status: 501 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Token error" }, { status: 502 });
  }
}
