"use client";
import { Time } from "@/components/ui/time";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Target, Copy, User, Building2, UserCheck, CalendarClock, Globe, Clock, StickyNote, History, CheckSquare, MoreHorizontal, Trash2,
  Hash, CalendarPlus, XCircle, Check, Phone, Mail, Link2, Repeat, DollarSign, Sigma,
} from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Tabs } from "@/components/ui/tabs";
import { FieldRow, Stat } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { InlineText } from "@/components/records/inline-fields";
import { CompanyPicker, ContactPicker, UserPicker } from "@/components/records/pickers";
import { Timeline, type TimelineActivity } from "@/components/records/timeline";
import { TasksList } from "@/components/records/tasks-list";
import { LineItemsEditor } from "@/components/records/line-items-editor";
import { ConfirmDialog, PromptDialog } from "@/components/records/dialogs";
import { DealBillingPanel } from "@/components/billing/deal-billing-panel";
import { useDialer } from "@/components/comms/dialer";
import { updateDeal, moveDealStage, deleteDeals } from "@/lib/actions/crm";
import { cn, contactLabel, fmtDate, fmtDateTime, money } from "@/lib/utils";
import type { Deal, DealLineItem, PipelineStage } from "@/lib/types";

type DealFull = Deal & {
  contact: { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
  company: { id: string; name: string } | null;
};

export function DealRecord({ deal: d, items, stages, activities, currentUserId }: { deal: DealFull; items: DealLineItem[]; stages: PipelineStage[]; activities: TimelineActivity[]; currentUserId: string }) {
  const router = useRouter();
  const { call } = useDialer();
  const [tab, setTab] = React.useState("timeline");
  const [confirm, setConfirm] = React.useState(false);
  const [lostStage, setLostStage] = React.useState<string | null>(null);
  const stage = stages.find((s) => s.id === d.stage_id);
  const openStages = stages.filter((s) => !s.is_won && !s.is_lost);
  const won = stages.find((s) => s.is_won);
  const lost = stages.find((s) => s.is_lost);

  const save = async (patch: Partial<Deal>) => {
    const r = await updateDeal(d.id, patch);
    if (!r.ok) { toast.error(r.error); return; }
    router.refresh();
  };
  const move = async (stageId: string, reason?: string) => {
    if (stageId === d.stage_id) return;
    const r = await moveDealStage(d.id, stageId, reason);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`Moved to ${stages.find((s) => s.id === stageId)?.name}`);
    router.refresh();
  };

  const term = d.term_months ?? 12;
  const tcv = Number(d.amount_one_time) + Number(d.amount_recurring) * term;
  const curIdx = openStages.findIndex((s) => s.id === d.stage_id);

  return (
    <Page>
      <PageHeader icon={Target} title={<span className="flex items-center gap-1.5"><Link href="/deals" className="text-fg-3 hover:text-fg">Deals</Link><span className="text-fg-4">/</span>{d.name}</span>}
        actions={<>
          <button onClick={() => { navigator.clipboard.writeText(d.deal_number); toast.success(`${d.deal_number} copied`); }}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 font-mono text-xs text-fg-2 hover:bg-hover cursor-pointer" title="Copy deal number">
            <Hash className="size-3.5" />{d.deal_number}<Copy className="size-3 text-fg-4" />
          </button>
          {won && !stage?.is_won && <Button size="sm" icon={Check} className="text-success" onClick={() => move(won.id)}>Mark won</Button>}
          {lost && !stage?.is_lost && <Button size="sm" icon={XCircle} className="text-danger" onClick={() => setLostStage(lost.id)}>Mark lost</Button>}
          <Menu>
            <MenuTrigger asChild><Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="More" /></MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={Copy} onSelect={() => { navigator.clipboard.writeText(window.location.href); toast.success("Link copied"); }}>Copy link</MenuItem>
              <MenuItem icon={Trash2} danger onSelect={() => setConfirm(true)}>Delete deal</MenuItem>
            </MenuContent>
          </Menu>
        </>} />

      {/* Stage stepper */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border px-3 py-2">
        {openStages.map((s, i) => {
          const done = stage?.is_won || (curIdx >= 0 && i < curIdx);
          const current = s.id === d.stage_id;
          return (
            <button key={s.id} onClick={() => move(s.id)}
              className={cn(
                "h-7 shrink-0 px-3 text-xs font-medium transition-colors cursor-pointer [clip-path:polygon(0_0,calc(100%-8px)_0,100%_50%,calc(100%-8px)_100%,0_100%,8px_50%)] first:[clip-path:polygon(0_0,calc(100%-8px)_0,100%_50%,calc(100%-8px)_100%,0_100%)] first:rounded-l-md",
                current ? "bg-accent text-white" : done ? "bg-accent-soft text-accent" : "bg-bg-3 text-fg-3 hover:bg-active hover:text-fg",
              )}>
              {s.name}
            </button>
          );
        })}
        {stage?.is_won && <span className="ml-2 inline-flex h-7 items-center gap-1 rounded-md bg-success-soft px-3 text-xs font-medium text-success"><Check className="size-3.5" />Won {d.closed_at && fmtDate(d.closed_at)}</span>}
        {stage?.is_lost && <span className="ml-2 inline-flex h-7 items-center gap-1 rounded-md bg-danger-soft px-3 text-xs font-medium text-danger"><XCircle className="size-3.5" />Lost{d.lost_reason && ` · ${d.lost_reason}`}</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[340px] shrink-0 overflow-y-auto border-r border-border px-4 py-3">
          <FieldRow icon={Target} label="Name"><InlineText value={d.name} onSave={(v) => { if (v.trim()) return save({ name: v }); }} /></FieldRow>
          <FieldRow icon={User} label="Person">
            <div className="flex items-center gap-1">
              <ContactPicker value={d.contact_id} valueLabel={d.contact ? contactLabel(d.contact) : null} onChange={(id) => save({ contact_id: id })} className="h-7 border-transparent hover:border-border" />
              {d.contact && <Link href={`/contacts/${d.contact.id}`} aria-label="Open person" className="rounded-sm p-1 text-fg-3 hover:bg-hover hover:text-fg"><Link2 className="size-3.5" /></Link>}
            </div>
          </FieldRow>
          <FieldRow icon={Building2} label="Company">
            <CompanyPicker value={d.company_id} valueLabel={d.company?.name} onChange={(id) => save({ company_id: id })} className="h-7 border-transparent hover:border-border" />
          </FieldRow>
          <FieldRow icon={UserCheck} label="Owner"><UserPicker value={d.owner_id} onChange={(id) => save({ owner_id: id })} className="h-7 border-transparent hover:border-border" /></FieldRow>
          <FieldRow icon={CalendarClock} label="Expected close"><InlineText type="date" value={d.expected_close_date} onSave={(v) => save({ expected_close_date: v || null })} display={d.expected_close_date ? <span>{fmtDate(d.expected_close_date)}</span> : undefined} /></FieldRow>
          <FieldRow icon={Repeat} label="Term (months)"><InlineText type="number" value={d.term_months} onSave={(v) => save({ term_months: Number(v) || null })} /></FieldRow>
          <FieldRow icon={Globe} label="Source"><InlineText value={d.source} onSave={(v) => save({ source: v || null })} /></FieldRow>
          {stage?.is_lost && <FieldRow icon={XCircle} label="Lost reason"><InlineText value={d.lost_reason} onSave={(v) => save({ lost_reason: v || null })} /></FieldRow>}
          <FieldRow icon={CalendarPlus} label="Created"><Time value={d.created_at} format="datetime" /></FieldRow>
          <FieldRow icon={Clock} label="Closed">{d.closed_at ? <Time value={d.closed_at} format="datetime" /> : <span className="text-fg-4">Open</span>}</FieldRow>
          <FieldRow icon={StickyNote} label="Notes"><InlineText multiline value={d.notes} onSave={(v) => save({ notes: v || null })} /></FieldRow>

          {d.contact && (
            <div className="mt-4 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Avatar name={contactLabel(d.contact)} size={28} />
                <div className="min-w-0">
                  <Link href={`/contacts/${d.contact.id}`} className="block truncate text-[13px] font-medium hover:underline">{contactLabel(d.contact)}</Link>
                  <div className="truncate text-xs text-fg-3">{d.contact.email ?? d.contact.phone}</div>
                </div>
              </div>
              <div className="mt-2 flex gap-1.5">
                <Button size="xs" icon={Phone} disabled={!d.contact.phone} onClick={() => call({ phone: d.contact!.phone!, contactId: d.contact!.id, name: contactLabel(d.contact) })}>Call</Button>
                <Button size="xs" icon={Mail} disabled={!d.contact.email} onClick={() => router.push(`/contacts/${d.contact!.id}?tab=comms`)}>Message</Button>
              </div>
            </div>
          )}
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto">
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat icon={DollarSign} label="One-time" value={money(d.amount_one_time)} />
              <Stat icon={Repeat} label="MRR" value={money(d.amount_recurring)} sub={`${money(Number(d.amount_recurring) * 12)} ARR`} />
              <Stat icon={CalendarClock} label="Term" value={`${term} mo`} />
              <Stat icon={Sigma} label="Total contract value" value={money(tcv)} sub={stage ? `${stage.probability}% → ${money(tcv * stage.probability / 100)} weighted` : undefined} />
            </div>
            <LineItemsEditor dealId={d.id} items={items} />
            <DealBillingPanel dealId={d.id} />
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "timeline", label: "Timeline", icon: History }, { id: "tasks", label: "Tasks", icon: CheckSquare }]} />
          {tab === "timeline" && <Timeline activities={activities} target={{ deal_id: d.id, contact_id: d.contact_id }} currentUserId={currentUserId} />}
          {tab === "tasks" && <div className="p-4"><TasksList filter={{ deal_id: d.id }} compact /></div>}
        </section>
      </div>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete ${d.deal_number}?`} description="Line items, contracts and the deal timeline will be deleted."
        onConfirm={async () => { const r = await deleteDeals([d.id]); if (!r.ok) { toast.error(r.error); return; } toast.success("Deal deleted"); router.push("/deals"); }} />
      <PromptDialog open={!!lostStage} onOpenChange={(o) => !o && setLostStage(null)} title="Mark deal as lost" label="Lost reason" placeholder="Price, timing, competitor…" confirmLabel="Mark lost"
        onSubmit={async (reason) => { if (lostStage) await move(lostStage, reason || "Not specified"); setLostStage(null); }} />
    </Page>
  );
}
