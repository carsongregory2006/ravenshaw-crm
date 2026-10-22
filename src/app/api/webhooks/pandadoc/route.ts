import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPandaDocWebhook } from "@/lib/integrations/pandadoc";
import { applyContractStatus, mapPandaDocStatus } from "@/lib/billing/contracts";
import type { Contract } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyPandaDocWebhook(raw, req.nextUrl.searchParams.get("signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let events: { event: string; data: { id: string; status: string; metadata?: Record<string, string> } }[];
  try {
    const parsed = JSON.parse(raw);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const db = createAdminClient();
  for (const ev of events) {
    const { data: log } = await db.from("webhook_events").insert({ provider: "pandadoc", event_type: ev.event, payload: ev }).select("id").single();
    try {
      if (ev.event === "document_state_changed" || ev.event === "recipient_completed" || ev.event === "document_completed_pdf_ready") {
        const docId = ev.data?.id;
        let { data: contract } = await db.from("contracts").select("*").eq("pandadoc_document_id", docId).maybeSingle();
        if (!contract && ev.data?.metadata?.contract_id) {
          ({ data: contract } = await db.from("contracts").select("*").eq("id", ev.data.metadata.contract_id).maybeSingle());
        }
        const status = mapPandaDocStatus(ev.data?.status ?? "");
        if (contract && status && status !== contract.status) await applyContractStatus(contract as Contract, status);
      }
      if (log) await db.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", log.id);
    } catch (e) {
      if (log) await db.from("webhook_events").update({ error: e instanceof Error ? e.message : String(e) }).eq("id", log.id);
    }
  }
  return NextResponse.json({ ok: true });
}
