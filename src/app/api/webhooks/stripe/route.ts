import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInvoice, verifyStripeWebhook } from "@/lib/integrations/stripe";
import { applyStripeInvoice } from "@/lib/billing/stripe-sync";
import { notifyAdmins } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HANDLED = ["invoice.paid", "invoice.voided", "invoice.marked_uncollectible", "invoice.payment_failed"];

/** Stripe webhook receiver: https://<app>/api/webhooks/stripe, signed with STRIPE_WEBHOOK_SECRET. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyStripeWebhook(raw, req.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const event = JSON.parse(raw) as { id: string; type: string; data: { object: { id: string; object: string; metadata?: Record<string, string> } } };
  const db = createAdminClient();
  const { data: log } = await db.from("webhook_events").insert({
    provider: "stripe", event_type: event.type, external_id: event.id, payload: event,
  }).select("id").single();
  try {
    const obj = event.data.object;
    if (HANDLED.includes(event.type) && obj.object === "invoice") {
      // Re-fetch with our pinned API version (expands the fee) rather than trusting the event's shape.
      const inv = await getInvoice(obj.id);
      await applyStripeInvoice(inv);
      if (event.type === "invoice.payment_failed" || event.type === "invoice.marked_uncollectible") {
        await notifyAdmins({
          title: event.type === "invoice.payment_failed" ? "Stripe payment failed" : "Invoice marked uncollectible",
          body: inv.metadata?.crm_invoice_number ?? inv.id, link: "/finance/invoices",
        });
      }
    }
    if (log) await db.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", log.id);
    return NextResponse.json({ received: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (log) await db.from("webhook_events").update({ error }).eq("id", log.id);
    return NextResponse.json({ error }, { status: 500 });
  }
}
