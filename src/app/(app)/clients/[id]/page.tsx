import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { getInvoiceLines } from "@/lib/billing/invoices";
import { ClientProfile } from "@/components/billing/client-profile";
import type { Activity, BillingSchedule, Client, Company, Contact, Contract, Invoice, OnboardingStep, Payment, Profile } from "@/lib/types";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireProfile();
  const sb = await createClient();
  const { data: client } = await sb.from("clients").select("*").eq("id", id).maybeSingle();
  if (!client) notFound();
  const c = client as Client;
  const canManage = me.role === "admin" || me.role === "ops";
  const db = createAdminClient();

  const [contact, company, deal, steps, invoices, payments, schedules, contracts, team, activities] = await Promise.all([
    sb.from("contacts").select("*").eq("id", c.contact_id).maybeSingle().then((r) => r.data as Contact | null),
    c.company_id ? sb.from("companies").select("*").eq("id", c.company_id).maybeSingle().then((r) => r.data as Company | null) : null,
    c.deal_id ? sb.from("deals").select("id, deal_number, name, amount_one_time, amount_recurring, term_months, owner_id").eq("id", c.deal_id).maybeSingle().then((r) => r.data) : null,
    sb.from("onboarding_steps").select("*").eq("client_id", id).order("position").then((r) => (r.data ?? []) as OnboardingStep[]),
    db.from("invoices").select("*").or(`client_id.eq.${id}${c.deal_id ? `,deal_id.eq.${c.deal_id}` : ""}`).order("created_at", { ascending: false }).then((r) => (r.data ?? []) as Invoice[]),
    db.from("payments").select("*").eq("client_id", id).order("received_at", { ascending: false }).then((r) => (r.data ?? []) as Payment[]),
    canManage ? db.from("billing_schedules").select("*").eq("client_id", id).order("next_invoice_date").then((r) => (r.data ?? []) as BillingSchedule[]) : ([] as BillingSchedule[]),
    c.deal_id ? db.from("contracts").select("*").eq("deal_id", c.deal_id).order("created_at", { ascending: false }).then((r) => (r.data ?? []) as Contract[]) : ([] as Contract[]),
    sb.from("profiles").select("id, full_name, email, avatar_url, role, is_active").eq("is_active", true).order("full_name").then((r) => (r.data ?? []) as Profile[]),
    sb.from("activities").select("*").or(`client_id.eq.${id},contact_id.eq.${c.contact_id}`).order("created_at", { ascending: false }).limit(100).then((r) => (r.data ?? []) as Activity[]),
  ]);
  if (!contact) notFound();
  const invoicesWithLines = await Promise.all(invoices.map(async (i) => ({ ...i, lines: await getInvoiceLines(i.id) })));

  return (
    <ClientProfile
      client={c} contact={contact} company={company} deal={deal} steps={steps} invoices={invoicesWithLines} payments={payments}
      schedules={schedules} contracts={contracts} team={team} activities={activities} canManage={canManage}
    />
  );
}
