"use client";
import { Time } from "@/components/ui/time";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Activity as ActivityIcon, BadgeCheck, Building2, Calendar, ChevronDown, CircleDollarSign, ExternalLink, FileSignature, Heart,
  MessagesSquare, Pause, Play, Plus, Receipt, Rocket, Trash2, User, UserX, Wallet, Mail, Phone, Hash,
} from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, FieldRow, Stat, EmptyState } from "@/components/ui/misc";
import { StatusTag, Tag } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Tabs } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { ContactComms } from "@/components/comms/contact-comms";
import { cn, contactLabel, fmtDate, fmtDateTime, fmtPhone, money, timeAgo } from "@/lib/utils";
import { addStep, deleteStep, setClientStatus, toggleStep, updateClient, updateStep, resumeClientBilling, type InvoiceWithLines } from "@/lib/actions/billing";
import { InvoiceTable, CreateInvoiceDialog, ScheduleList } from "./invoice-ui";
import { HealthDot, Progress } from "./clients-table";
import type { Activity, BillingSchedule, Client, Company, Contact, Contract, OnboardingStep, Payment, Profile } from "@/lib/types";

type DealLite = { id: string; deal_number: string; name: string; amount_one_time: number; amount_recurring: number; term_months: number | null; owner_id: string | null } | null;

async function run(p: Promise<{ ok: boolean; error?: string }>, msg: string, after?: () => void) {
  const r = await p;
  if (r.ok) { toast.success(msg); after?.(); } else toast.error((r as { error: string }).error);
  return r.ok;
}

export function ClientProfile(props: {
  client: Client; contact: Contact; company: Company | null; deal: DealLite; steps: OnboardingStep[]; invoices: InvoiceWithLines[];
  payments: Payment[]; schedules: BillingSchedule[]; contracts: Contract[]; team: Profile[]; activities: Activity[]; canManage: boolean;
}) {
  const { client, contact, company, deal, steps, invoices, payments, schedules, contracts, team, activities, canManage } = props;
  const router = useRouter();
  const refresh = () => router.refresh();
  const [tab, setTab] = useState("billing");
  const [churnOpen, setChurnOpen] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  const name = contactLabel(contact);
  const ltv = payments.reduce((a, p) => a + Number(p.amount), 0);
  const outstanding = invoices.filter((i) => i.status === "sent" || i.status === "overdue").reduce((a, i) => a + Number(i.amount), 0);
  const overdue = invoices.filter((i) => i.status === "overdue").length;
  const done = steps.filter((s) => s.completed_at).length;
  const manager = team.find((t) => t.id === client.account_manager_id);
  const contract = contracts[0];

  return (
    <Page>
      <PageHeader icon={BadgeCheck} title={<span className="flex items-center gap-1.5"><Link href="/clients" className="text-fg-3 hover:text-fg">Clients</Link><span className="text-fg-4">/</span>{name}</span>}
        actions={canManage && (
          <>
            <Button size="sm" icon={Receipt} onClick={() => setCreatingInvoice(true)}>Invoice</Button>
            <Menu>
              <MenuTrigger asChild><Button size="sm" iconRight={ChevronDown}>Status: {client.status}</Button></MenuTrigger>
              <MenuContent align="end">
                {client.status !== "active" && <MenuItem icon={Play} onSelect={() => run(setClientStatus(client.id, "active"), "Client marked active", refresh)}>Mark active</MenuItem>}
                {client.status !== "onboarding" && client.status !== "churned" && <MenuItem icon={Rocket} onSelect={() => run(setClientStatus(client.id, "onboarding"), "Moved back to onboarding", refresh)}>Back to onboarding</MenuItem>}
                {client.status !== "paused" && client.status !== "churned" && <MenuItem icon={Pause} onSelect={() => run(setClientStatus(client.id, "paused", "Paused"), "Client paused — automatic invoices on hold", refresh)}>Pause (hold invoices)</MenuItem>}
                {client.status === "churned" && <MenuItem icon={Play} onSelect={async () => { if (await run(setClientStatus(client.id, "active"), "Client reactivated", refresh)) run(resumeClientBilling(client.id), "Billing resumed", refresh); }}>Reactivate + resume billing</MenuItem>}
                {client.status !== "churned" && <MenuItem icon={UserX} danger onSelect={() => setChurnOpen(true)}>Mark churned…</MenuItem>}
              </MenuContent>
            </Menu>
          </>
        )} />
      <PageBody>
        <div className="flex flex-col lg:flex-row">
          {/* Left: record summary (Twenty-style) */}
          <aside className="w-full shrink-0 border-b border-border p-4 lg:w-[340px] lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-3">
              <Avatar name={name} size={40} />
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{name}</div>
                <div className="flex items-center gap-1.5 text-xs text-fg-3"><StatusTag status={client.status} /> since {fmtDate(client.start_date)}</div>
              </div>
            </div>
            <div className="mt-4 space-y-0.5">
              <FieldRow icon={Mail} label="Email">{contact.email ? <a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a> : <span className="text-fg-4">—</span>}</FieldRow>
              <FieldRow icon={Phone} label="Phone">{contact.phone ? fmtPhone(contact.phone) : <span className="text-fg-4">—</span>}</FieldRow>
              <FieldRow icon={Building2} label="Company">{company ? <Link href={`/companies/${company.id}`} className="hover:underline">{company.name}</Link> : <span className="text-fg-4">—</span>}</FieldRow>
              <FieldRow icon={Hash} label="Deal">{deal ? <Link href={`/deals/${deal.id}`} className="hover:underline">{deal.deal_number}</Link> : <span className="text-fg-4">—</span>}</FieldRow>
              <FieldRow icon={User} label="Account mgr">
                {canManage ? (
                  <Select value={client.account_manager_id ?? ""} className="h-7" onChange={(e) => run(updateClient(client.id, { account_manager_id: e.target.value || null }), "Account manager updated", refresh)}>
                    <option value="">Unassigned</option>
                    {team.map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
                  </Select>
                ) : manager?.full_name ?? "—"}
              </FieldRow>
              <FieldRow icon={CircleDollarSign} label="MRR">
                {canManage ? <Input type="number" className="h-7" defaultValue={client.mrr} onBlur={(e) => Number(e.target.value) !== Number(client.mrr) && run(updateClient(client.id, { mrr: Number(e.target.value) }), "MRR updated", refresh)} /> : money(client.mrr)}
              </FieldRow>
              <FieldRow icon={Heart} label="Health">
                {canManage ? (
                  <div className="flex items-center gap-2">
                    <input type="range" min={0} max={100} step={5} defaultValue={client.health_score ?? 80} className="flex-1 accent-[var(--accent)]"
                      onMouseUp={(e) => run(updateClient(client.id, { health_score: Number((e.target as HTMLInputElement).value) }), "Health score updated", refresh)}
                      onKeyUp={(e) => run(updateClient(client.id, { health_score: Number((e.target as HTMLInputElement).value) }), "Health score updated", refresh)} />
                    <HealthDot score={client.health_score} />
                  </div>
                ) : <HealthDot score={client.health_score} />}
              </FieldRow>
              <FieldRow icon={Calendar} label="Start date">
                {canManage ? <Input type="date" className="h-7" defaultValue={client.start_date} onBlur={(e) => e.target.value && e.target.value !== client.start_date && run(updateClient(client.id, { start_date: e.target.value }), "Start date updated", refresh)} /> : fmtDate(client.start_date)}
              </FieldRow>
              {client.status === "churned" && <FieldRow icon={UserX} label="Churned"><Time value={client.churned_at} format="date" />{client.churn_reason && <span className="text-fg-3"> · {client.churn_reason}</span>}</FieldRow>}
            </div>
            <Link href={`/contacts/${contact.id}`} className="mt-3 inline-flex items-center gap-1 text-[13px] text-accent hover:underline">Open full contact profile <ExternalLink className="size-3" /></Link>

            <div className="mt-6">
              <OnboardingChecklist clientId={client.id} steps={steps} team={team} onChange={refresh} />
            </div>
          </aside>

          {/* Right: metrics + tabs */}
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-2 gap-2 p-3 xl:grid-cols-4">
              <Stat icon={CircleDollarSign} label="MRR" value={money(client.mrr)} sub={`${money(Number(client.mrr) * 12, { compact: true })} ARR`} />
              <Stat icon={Wallet} label="Collected (LTV)" value={money(ltv)} sub={`${payments.length} payment${payments.length === 1 ? "" : "s"}`} />
              <Stat icon={Receipt} label="Outstanding" value={money(outstanding)} sub={overdue ? <span className="text-danger">{overdue} overdue</span> : "nothing overdue"} />
              <Stat icon={Rocket} label="Onboarding" value={`${done}/${steps.length}`} sub={<Progress done={done} total={steps.length} className="w-24" />} />
            </div>
            <Tabs value={tab} onChange={setTab} tabs={[
              { id: "billing", label: "Billing", icon: Receipt, count: invoices.length },
              { id: "comms", label: "Communications", icon: MessagesSquare },
              { id: "timeline", label: "Timeline", icon: ActivityIcon, count: activities.length },
            ]} />
            <div className="p-3">
              {tab === "billing" && (
                <div className="space-y-3">
                  <Card title="Invoices" padded={false} actions={canManage && <Button size="xs" variant="ghost" icon={Plus} onClick={() => setCreatingInvoice(true)}>Create invoice</Button>}>
                    <InvoiceTable invoices={invoices} canManage={canManage} onChange={refresh} />
                  </Card>
                  {canManage && (
                    <Card title="Automatic billing" padded={false}>
                      <div className="py-1"><ScheduleList schedules={schedules} canManage={canManage} onChange={refresh} clientId={client.id} /></div>
                    </Card>
                  )}
                  <Card title="Payments" padded={false}>
                    {payments.length ? (
                      <ul className="divide-y divide-border-light">
                        {payments.map((p) => (
                          <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                            <Wallet className="size-4 text-success" />
                            <span className="flex-1"><Time value={p.received_at} format="date" /> <span className="text-fg-3">· {p.method ?? "—"}{p.note ? ` · ${p.note}` : ""}</span></span>
                            <Tag color={p.kind === "recurring" ? "purple" : p.kind === "milestone" ? "orange" : "blue"}>{p.kind.replace("_", "-")}</Tag>
                            <span className="w-24 text-right font-medium tabular-nums">{money(p.amount, { cents: true })}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="px-3 py-4 text-[13px] text-fg-3">No payments yet. Stripe payments are matched automatically.</p>}
                  </Card>
                  <Card title={<span className="flex items-center gap-1.5"><FileSignature className="size-4 text-fg-3" /> Contract</span>}>
                    {contract ? (
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="font-medium">{contract.name}</span><StatusTag status={contract.status} />
                        {contract.completed_at && <span className="text-fg-3">signed <Time value={contract.completed_at} format="date" /></span>}
                        {contract.document_url && <Button size="xs" icon={ExternalLink} className="ml-auto" onClick={() => window.open(contract.document_url!, "_blank")}>Open in PandaDoc</Button>}
                      </div>
                    ) : <p className="text-[13px] text-fg-3">No contract on file.</p>}
                  </Card>
                </div>
              )}
              {tab === "comms" && <ContactComms contact={contact} />}
              {tab === "timeline" && (
                activities.length ? (
                  <ol className="relative ml-2 border-l border-border pl-4">
                    {activities.map((a) => (
                      <li key={a.id} className="mb-4">
                        <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-bg bg-border-strong" />
                        <div className="flex items-baseline gap-2 text-[13px]"><span className="font-medium">{a.title}</span><Time value={a.created_at} className="text-xs text-fg-4" /></div>
                        {a.body && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-fg-2">{a.body}</p>}
                      </li>
                    ))}
                  </ol>
                ) : <EmptyState icon={ActivityIcon} title="No activity yet" />
              )}
            </div>
          </div>
        </div>
      </PageBody>

      <ChurnDialog open={churnOpen} onClose={() => setChurnOpen(false)} onConfirm={(reason) => run(setClientStatus(client.id, "churned", reason), "Client churned — automatic billing stopped", refresh)} />
      {creatingInvoice && (
        <CreateInvoiceDialog open onClose={() => setCreatingInvoice(false)} contactId={contact.id} dealId={deal?.id ?? null} clientId={client.id} onDone={refresh} />
      )}
    </Page>
  );
}

function ChurnDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("Budget");
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Mark client as churned" description="Stops all automatic invoices and records the churn reason for reporting." size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={loading} onClick={async () => { setLoading(true); const ok = await onConfirm(detail ? `${reason}: ${detail}` : reason); setLoading(false); if (ok) onClose(); }}>Mark churned</Button></>}>
      <div className="space-y-3">
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {["Budget", "No results / ROI", "Went in-house", "Switched agency", "Business closed", "Poor fit", "Service issues", "Other"].map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Details"><Textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What happened? (optional)" /></Field>
      </div>
    </Dialog>
  );
}

export function OnboardingChecklist({ clientId, steps, team, onChange, compact }: { clientId: string; steps: OnboardingStep[]; team: Pick<Profile, "id" | "full_name" | "email">[]; onChange: () => void; compact?: boolean }) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const done = steps.filter((s) => s.completed_at).length;
  const add = async () => {
    if (!title.trim()) return;
    setAdding(true);
    if (await run(addStep(clientId, { title }), "Step added", onChange)) setTitle("");
    setAdding(false);
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-fg-3">Onboarding · {done}/{steps.length}</h4>
      </div>
      {!compact && <Progress done={done} total={steps.length} className="mb-2" />}
      <ul className="space-y-0.5">
        {steps.map((s) => (
          <li key={s.id} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-hover">
            <Checkbox className="mt-0.5" checked={!!s.completed_at} onChange={(e) => run(toggleStep(s.id, e.target.checked), e.target.checked ? "Step completed" : "Step reopened", onChange)} />
            <div className="min-w-0 flex-1">
              <div className={cn("text-[13px]", s.completed_at && "text-fg-3 line-through")}>{s.title}</div>
              {!compact && (
                <div className="mt-0.5 flex items-center gap-1.5">
                  <select value={s.assignee_id ?? ""} onChange={(e) => run(updateStep(s.id, { assignee_id: e.target.value || null }), "Assignee updated", onChange)}
                    className="h-5 max-w-[120px] truncate rounded-sm bg-transparent text-xs text-fg-3 hover:bg-bg-3 cursor-pointer">
                    <option value="">Unassigned</option>
                    {team.map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
                  </select>
                  <input type="date" value={s.due_date ?? ""} onChange={(e) => run(updateStep(s.id, { due_date: e.target.value || null }), "Due date updated", onChange)}
                    className={cn("h-5 rounded-sm bg-transparent text-xs hover:bg-bg-3", s.due_date && !s.completed_at && new Date(s.due_date) < new Date() ? "text-danger" : "text-fg-3")} />
                </div>
              )}
            </div>
            <button aria-label="Delete step" onClick={() => confirm(`Delete "${s.title}"?`) && run(deleteStep(s.id), "Step deleted", onChange)}
              className="invisible rounded-sm p-0.5 text-fg-4 hover:text-danger group-hover:visible cursor-pointer"><Trash2 className="size-3.5" /></button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mt-2 flex gap-1.5">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a step…" className="h-7" />
        <Button type="submit" size="sm" icon={Plus} loading={adding} disabled={!title.trim()} aria-label="Add step" />
      </form>
    </div>
  );
}
