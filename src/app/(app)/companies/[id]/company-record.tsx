"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Globe, Factory, Users, DollarSign, Phone, MapPin, AtSign, UserCheck, StickyNote, History, User, Target, Plus, Trash2, MoreHorizontal, Link2 } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { FieldRow, EmptyState } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { InlineText, STATUS_COLORS, CONTACT_STATUSES } from "@/components/records/inline-fields";
import { UserPicker } from "@/components/records/pickers";
import { Timeline, type TimelineActivity } from "@/components/records/timeline";
import { NewContactDialog, NewDealDialog, ConfirmDialog } from "@/components/records/dialogs";
import { updateCompany, deleteCompanies } from "@/lib/actions/crm";
import { contactLabel, fmtPhone, money, timeAgo } from "@/lib/utils";
import type { Company, PipelineStage } from "@/lib/types";

type Person = { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; title: string | null; status: string };
type DealLite = { id: string; deal_number: string; name: string; amount_one_time: number; amount_recurring: number; stage_id: string };

export function CompanyRecord({ company: co, people, deals, stages, activities, currentUserId }: {
  company: Company; people: Person[]; deals: DealLite[]; stages: PipelineStage[]; activities: TimelineActivity[]; currentUserId: string;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState("people");
  const [personOpen, setPersonOpen] = React.useState(false);
  const [dealOpen, setDealOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);

  const save = async (patch: Partial<Company>) => {
    const r = await updateCompany(co.id, patch);
    if (!r.ok) { toast.error(r.error); return; }
    router.refresh();
  };
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[^\d.]/g, "")) || null);
  const won = deals.filter((d) => stages.find((s) => s.id === d.stage_id)?.is_won);
  const mrr = won.reduce((a, d) => a + Number(d.amount_recurring), 0);
  const pipeline = deals.filter((d) => { const s = stages.find((x) => x.id === d.stage_id); return s && !s.is_won && !s.is_lost; })
    .reduce((a, d) => a + Number(d.amount_one_time) + Number(d.amount_recurring) * 12, 0);

  return (
    <Page>
      <PageHeader icon={Building2} title={<span className="flex items-center gap-1.5"><Link href="/companies" className="text-fg-3 hover:text-fg">Companies</Link><span className="text-fg-4">/</span>{co.name}</span>}
        actions={<Menu>
          <MenuTrigger asChild><Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="More" /></MenuTrigger>
          <MenuContent align="end"><MenuItem icon={Trash2} danger onSelect={() => setConfirm(true)}>Delete company</MenuItem></MenuContent>
        </Menu>} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-border">
          <div className="flex flex-col items-center gap-2 border-b border-border-light px-4 pb-4 pt-6 text-center">
            <Avatar name={co.name} size={56} square />
            <div className="text-base font-semibold">{co.name}</div>
            <div className="text-xs text-fg-3">{co.industry || "No industry"} · Added {timeAgo(co.created_at)}</div>
            <div className="mt-2 grid w-full grid-cols-3 gap-2 text-left">
              <Mini label="People" value={String(people.length)} />
              <Mini label="Client MRR" value={money(mrr)} />
              <Mini label="Open pipeline" value={money(pipeline, { compact: true })} />
            </div>
          </div>
          <div className="space-y-0.5 px-4 py-3">
            <FieldRow icon={Building2} label="Name"><InlineText value={co.name} onSave={(v) => { if (v.trim()) return save({ name: v }); }} /></FieldRow>
            <FieldRow icon={Globe} label="Domain"><InlineText value={co.domain} onSave={(v) => save({ domain: v || null })}
              display={co.domain ? <span className="flex items-center gap-1 text-accent">{co.domain}<a href={`https://${co.domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Link2 className="size-3" /></a></span> : undefined} /></FieldRow>
            <FieldRow icon={Globe} label="Website"><InlineText type="url" value={co.website} onSave={(v) => save({ website: v || null })} /></FieldRow>
            <FieldRow icon={Factory} label="Industry"><InlineText value={co.industry} onSave={(v) => save({ industry: v || null })} /></FieldRow>
            <FieldRow icon={Users} label="Employees"><InlineText type="number" value={co.employees} onSave={(v) => save({ employees: numOrNull(v) })} /></FieldRow>
            <FieldRow icon={DollarSign} label="Annual revenue"><InlineText value={co.annual_revenue} onSave={(v) => save({ annual_revenue: numOrNull(v) })} display={co.annual_revenue ? <span>{money(co.annual_revenue)}</span> : undefined} /></FieldRow>
            <FieldRow icon={Phone} label="Phone"><InlineText type="tel" value={co.phone} onSave={(v) => save({ phone: v || null })} display={co.phone ? <span>{fmtPhone(co.phone)}</span> : undefined} /></FieldRow>
            <FieldRow icon={MapPin} label="Address"><InlineText value={co.address} onSave={(v) => save({ address: v || null })} /></FieldRow>
            <FieldRow icon={AtSign} label="LinkedIn"><InlineText type="url" value={co.linkedin_url} onSave={(v) => save({ linkedin_url: v || null })} /></FieldRow>
            <FieldRow icon={UserCheck} label="Owner"><UserPicker value={co.owner_id} onChange={(id) => save({ owner_id: id })} className="h-7 border-transparent hover:border-border" /></FieldRow>
            <FieldRow icon={StickyNote} label="Notes"><InlineText multiline value={co.notes} onSave={(v) => save({ notes: v || null })} /></FieldRow>
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <Tabs value={tab} onChange={setTab} className="sticky top-0 z-10 bg-bg" tabs={[
            { id: "people", label: "People", icon: User, count: people.length },
            { id: "deals", label: "Deals", icon: Target, count: deals.length },
            { id: "timeline", label: "Timeline", icon: History },
          ]} />
          {tab === "people" && (
            <div className="p-4">
              <div className="mb-3 flex justify-end"><Button size="sm" icon={Plus} onClick={() => setPersonOpen(true)}>Add person</Button></div>
              {people.length === 0 ? <EmptyState icon={User} title="No people at this company" /> : (
                <ul className="divide-y divide-border-light rounded-lg border border-border">
                  {people.map((p) => (
                    <li key={p.id}>
                      <Link href={`/contacts/${p.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover">
                        <Avatar name={contactLabel(p)} size={24} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{contactLabel(p)}</div>
                          <div className="truncate text-xs text-fg-3">{[p.title, p.email, fmtPhone(p.phone)].filter(Boolean).join(" · ")}</div>
                        </div>
                        <Tag color={STATUS_COLORS[p.status]}>{CONTACT_STATUSES.find((s) => s.value === p.status)?.label}</Tag>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {tab === "deals" && (
            <div className="p-4">
              <div className="mb-3 flex justify-end"><Button size="sm" icon={Plus} onClick={() => setDealOpen(true)}>New deal</Button></div>
              {deals.length === 0 ? <EmptyState icon={Target} title="No deals yet" /> : (
                <ul className="divide-y divide-border-light rounded-lg border border-border">
                  {deals.map((d) => {
                    const s = stages.find((x) => x.id === d.stage_id);
                    return (
                      <li key={d.id}>
                        <Link href={`/deals/${d.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover">
                          <span className="font-mono text-xs text-fg-3">{d.deal_number}</span>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.name}</span>
                          <span className="text-xs tabular-nums text-fg-2">{money(d.amount_one_time)} + {money(d.amount_recurring)}/mo</span>
                          {s && <Tag color={s.color}>{s.name}</Tag>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {tab === "timeline" && <Timeline activities={activities} target={{ company_id: co.id }} currentUserId={currentUserId} />}
        </section>
      </div>
      <NewContactDialog open={personOpen} onOpenChange={setPersonOpen} defaults={{ company_id: co.id }} />
      <NewDealDialog open={dealOpen} onOpenChange={setDealOpen} stages={stages} defaults={{ company_id: co.id, name: `${co.name} — AI build` }} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete ${co.name}?`} description="People and deals stay but are unlinked from this company."
        onConfirm={async () => { const r = await deleteCompanies([co.id]); if (!r.ok) { toast.error(r.error); return; } toast.success("Deleted"); router.push("/companies"); }} />
    </Page>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2 py-1.5">
      <div className="text-[11px] text-fg-3">{label}</div>
      <div className="truncate text-[13px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
