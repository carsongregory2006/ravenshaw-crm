import { Receipt } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { lastStripeSync } from "@/lib/billing/stripe-sync";
import { integrations } from "@/lib/env";
import { InvoicesView, type InvoiceListRow } from "@/components/billing/invoices-view";
import { contactLabel } from "@/lib/utils";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaff();
  const { status } = await searchParams;
  const db = createAdminClient();
  const [{ data: invoices }, { data: clients }, last] = await Promise.all([
    db.from("invoices").select("*, contact:contacts(first_name, last_name, email), deal:deals(deal_number)").order("created_at", { ascending: false }).limit(1000),
    db.from("clients").select("id, contact_id, deal_id, contact:contacts(first_name, last_name, email)").neq("status", "churned"),
    lastStripeSync(),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: InvoiceListRow[] = (invoices ?? []).map((i: any) => ({ ...i, contact_name: i.contact ? contactLabel(i.contact) : undefined, deal_number: i.deal?.deal_number }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientOptions = (clients ?? []).map((c: any) => ({ id: c.id as string, contactId: c.contact_id as string, dealId: c.deal_id as string | null, label: contactLabel(c.contact) }));
  return (
    <Page>
      <PageHeader icon={Receipt} title="Invoices" />
      <InvoicesView rows={rows} clients={clientOptions} lastSync={last?.at ?? null} stripeConfigured={integrations.stripe()} initialStatus={status ?? "all"} />
    </Page>
  );
}
