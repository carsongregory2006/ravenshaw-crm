"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Target, Plus, Search, LayoutGrid, Table2, Hash, User, Building2, CircleDot, DollarSign, Repeat, UserCheck, CalendarClock, CalendarPlus, Download } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/misc";
import { FilterChip } from "@/components/records/filter-chip";
import { NewDealDialog, PromptDialog } from "@/components/records/dialogs";
import { downloadCsv } from "@/components/records/csv";
import { moveDealStage } from "@/lib/actions/crm";
import { cn, contactLabel, fmtDate, money } from "@/lib/utils";
import type { Deal, PipelineStage } from "@/lib/types";

export type DealRow = Deal & {
  contact: { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
  company: { id: string; name: string } | null;
};
type UserLite = { id: string; full_name: string | null; email: string; avatar_url: string | null };

const COLOR_BAR: Record<string, string> = {
  gray: "bg-[#999]", blue: "bg-[#1961ed]", sky: "bg-[#0e9ad6]", purple: "bg-[#7b49e8]", orange: "bg-[#e5701e]",
  yellow: "bg-[#e2b100]", green: "bg-[#29a383]", red: "bg-[#e5484d]", pink: "bg-[#d6409f]", turquoise: "bg-[#12a594]",
};

export function DealsView({ deals: initial, stages, users, openNew, initialView }: { deals: DealRow[]; stages: PipelineStage[]; users: UserLite[]; openNew?: boolean; initialView: "board" | "table" }) {
  const router = useRouter();
  const [deals, setDeals] = React.useState(initial);
  React.useEffect(() => setDeals(initial), [initial]);
  const [view, setView] = React.useState<"board" | "table">(initialView);
  const [q, setQ] = React.useState("");
  const [owner, setOwner] = React.useState<string[]>([]);
  const [stageFilter, setStageFilter] = React.useState<string[]>([]);
  const [newOpen, setNewOpen] = React.useState(!!openNew);
  const [newStage, setNewStage] = React.useState<string | undefined>();
  const [lostPending, setLostPending] = React.useState<{ dealId: string; stageId: string } | null>(null);
  const [dragging, setDragging] = React.useState<DealRow | null>(null);
  React.useEffect(() => { if (openNew) router.replace("/deals"); }, [openNew, router]);

  const userMap = React.useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const filtered = deals.filter((d) => {
    if (owner.length && !owner.includes(d.owner_id ?? "none")) return false;
    if (stageFilter.length && !stageFilter.includes(d.stage_id)) return false;
    const n = q.trim().toLowerCase();
    return !n || [d.name, d.deal_number, d.company?.name, contactLabel(d.contact)].some((v) => v?.toLowerCase().includes(n));
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const doMove = async (dealId: string, stageId: string, lostReason?: string) => {
    const prev = deals;
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, stage_id: stageId } : d)));
    const r = await moveDealStage(dealId, stageId, lostReason);
    if (!r.ok) { setDeals(prev); toast.error(r.error); return; }
    const s = stages.find((x) => x.id === stageId);
    toast.success(`Moved to ${s?.name}`);
    router.refresh();
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const dealId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || !stageId || deal.stage_id === stageId) return;
    if (stages.find((s) => s.id === stageId)?.is_lost) { setLostPending({ dealId, stageId }); return; }
    doMove(dealId, stageId);
  };

  const columns: Column<DealRow>[] = [
    { id: "num", header: "Deal #", icon: Hash, width: 100, sortValue: (d) => d.deal_number, cell: (d) => <span className="font-mono text-xs text-fg-2">{d.deal_number}</span> },
    { id: "name", header: "Name", icon: Target, width: 240, sortValue: (d) => d.name.toLowerCase(), cell: (d) => <Link href={`/deals/${d.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{d.name}</Link> },
    { id: "stage", header: "Stage", icon: CircleDot, width: 130, sortValue: (d) => stages.find((s) => s.id === d.stage_id)?.position, cell: (d) => { const s = stages.find((x) => x.id === d.stage_id); return s ? <Tag color={s.color}>{s.name}</Tag> : null; } },
    { id: "contact", header: "Person", icon: User, width: 160, sortValue: (d) => contactLabel(d.contact), cell: (d) => d.contact ? <Link href={`/contacts/${d.contact.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 hover:underline"><Avatar name={contactLabel(d.contact)} size={16} />{contactLabel(d.contact)}</Link> : null },
    { id: "company", header: "Company", icon: Building2, width: 150, sortValue: (d) => d.company?.name, cell: (d) => d.company?.name },
    { id: "one", header: "One-time", icon: DollarSign, width: 110, align: "right", sortValue: (d) => Number(d.amount_one_time), cell: (d) => money(d.amount_one_time) },
    { id: "mrr", header: "MRR", icon: Repeat, width: 100, align: "right", sortValue: (d) => Number(d.amount_recurring), cell: (d) => money(d.amount_recurring) },
    { id: "owner", header: "Owner", icon: UserCheck, width: 150, cell: (d) => { const u = d.owner_id ? userMap.get(d.owner_id) : null; return u ? <span className="inline-flex items-center gap-1.5"><Avatar name={u.full_name || u.email} src={u.avatar_url} size={16} />{u.full_name || u.email}</span> : null; } },
    { id: "close", header: "Expected close", icon: CalendarClock, width: 130, sortValue: (d) => d.expected_close_date ?? "", cell: (d) => (d.expected_close_date ? fmtDate(d.expected_close_date) : "") },
    { id: "created", header: "Created", icon: CalendarPlus, width: 120, sortValue: (d) => d.created_at, cell: (d) => fmtDate(d.created_at) },
  ];

  const openPipeline = filtered.filter((d) => { const s = stages.find((x) => x.id === d.stage_id); return s && !s.is_won && !s.is_lost; });
  const weighted = openPipeline.reduce((a, d) => {
    const p = (stages.find((x) => x.id === d.stage_id)?.probability ?? 0) / 100;
    return a + p * (Number(d.amount_one_time) + Number(d.amount_recurring) * (d.term_months ?? 12));
  }, 0);

  return (
    <Page>
      <PageHeader icon={Target} title="Deals" actions={<>
        <div className="mr-2 hidden items-center gap-3 text-xs text-fg-3 md:flex">
          <span>Open: <b className="text-fg">{openPipeline.length}</b></span>
          <span>Weighted TCV: <b className="text-fg">{money(weighted, { compact: true })}</b></span>
        </div>
        <div className="flex rounded-md border border-border p-0.5">
          <button onClick={() => setView("board")} aria-label="Board view" className={cn("rounded-sm p-1 cursor-pointer", view === "board" ? "bg-active text-fg" : "text-fg-3 hover:text-fg")}><LayoutGrid className="size-3.5" /></button>
          <button onClick={() => setView("table")} aria-label="Table view" className={cn("rounded-sm p-1 cursor-pointer", view === "table" ? "bg-active text-fg" : "text-fg-3 hover:text-fg")}><Table2 className="size-3.5" /></button>
        </div>
        <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadCsv("deals.csv", [["Deal #", "Name", "Stage", "Person", "Company", "One-time", "MRR", "Term", "Owner", "Expected close", "Created"],
          ...filtered.map((d) => [d.deal_number, d.name, stages.find((s) => s.id === d.stage_id)?.name, contactLabel(d.contact), d.company?.name, d.amount_one_time, d.amount_recurring, d.term_months, d.owner_id ? userMap.get(d.owner_id)?.full_name : "", d.expected_close_date, d.created_at])])}>Export</Button>
        <Button size="sm" variant="primary" icon={Plus} onClick={() => { setNewStage(undefined); setNewOpen(true); }}>New</Button>
      </>}>
        <span className="text-xs text-fg-3">{filtered.length}</span>
      </PageHeader>
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deals…" className="h-6 w-56 rounded-md bg-transparent pl-7 pr-2 text-xs outline-none placeholder:text-fg-4 hover:bg-hover focus:bg-hover" />
        </div>
        <FilterChip label="Owner" value={owner} onChange={setOwner} options={[{ value: "none", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.full_name || u.email }))]} />
        {view === "table" && <FilterChip label="Stage" value={stageFilter} onChange={setStageFilter} options={stages.map((s) => ({ value: s.id, label: s.name }))} />}
      </div>

      {view === "table" ? (
        <PageBody>
          <DataTable rows={filtered} columns={columns} onRowClick={(d) => router.push(`/deals/${d.id}`)}
            empty={<EmptyState icon={Target} title="No deals" action={<Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>New deal</Button>} />} />
        </PageBody>
      ) : (
        <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setDragging(deals.find((d) => d.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-3">
            {stages.map((s) => {
              const items = filtered.filter((d) => d.stage_id === s.id);
              const one = items.reduce((a, d) => a + Number(d.amount_one_time), 0);
              const mrr = items.reduce((a, d) => a + Number(d.amount_recurring), 0);
              return (
                <Column key={s.id} stage={s} count={items.length} one={one} mrr={mrr} onAdd={() => { setNewStage(s.id); setNewOpen(true); }}>
                  {items.map((d) => <DealCard key={d.id} deal={d} owner={d.owner_id ? userMap.get(d.owner_id) : undefined} />)}
                </Column>
              );
            })}
          </div>
          <DragOverlay>{dragging && <DealCardBody deal={dragging} owner={dragging.owner_id ? userMap.get(dragging.owner_id) : undefined} overlay />}</DragOverlay>
        </DndContext>
      )}

      <NewDealDialog open={newOpen} onOpenChange={setNewOpen} stages={stages} defaults={{ stage_id: newStage }} />
      <PromptDialog open={!!lostPending} onOpenChange={(o) => !o && setLostPending(null)} title="Mark deal as lost" label="Lost reason"
        placeholder="Price, timing, went with competitor, no response…" confirmLabel="Mark lost"
        onSubmit={async (reason) => { if (lostPending) await doMove(lostPending.dealId, lostPending.stageId, reason || "Not specified"); setLostPending(null); }} />
    </Page>
  );
}

function Column({ stage, count, one, mrr, onAdd, children }: { stage: PipelineStage; count: number; one: number; mrr: number; onAdd: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className="flex w-[264px] shrink-0 flex-col">
      <div className="flex h-8 items-center gap-1.5 px-1">
        <span className={cn("size-2 rounded-full", COLOR_BAR[stage.color] ?? "bg-fg-3")} />
        <Tag color={stage.color}>{stage.name}</Tag>
        <span className="text-xs text-fg-3">{count}</span>
        <button onClick={onAdd} aria-label={`Add deal to ${stage.name}`} className="ml-auto rounded-sm p-0.5 text-fg-3 hover:bg-hover hover:text-fg cursor-pointer"><Plus className="size-3.5" /></button>
      </div>
      <div className="mb-1.5 px-1 text-[11px] text-fg-3 tabular-nums">{money(one, { compact: true })} one-time · {money(mrr, { compact: true })}/mo</div>
      <div ref={setNodeRef} className={cn("flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto rounded-lg p-1 transition-colors", isOver ? "bg-accent-soft" : "bg-bg-2")}>
        {children}
      </div>
    </div>
  );
}

function DealCard({ deal, owner }: { deal: DealRow; owner?: UserLite }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("touch-none", isDragging && "opacity-30")}>
      <DealCardBody deal={deal} owner={owner} />
    </div>
  );
}

function DealCardBody({ deal: d, owner, overlay }: { deal: DealRow; owner?: UserLite; overlay?: boolean }) {
  const router = useRouter();
  return (
    <div onClick={() => !overlay && router.push(`/deals/${d.id}`)}
      className={cn("cursor-pointer rounded-md border border-border bg-bg p-2.5 text-[13px] shadow-sm hover:border-border-strong", overlay && "rotate-2 shadow-lg")}>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-fg-3">{d.deal_number}</span>
        {owner && <span className="ml-auto"><Avatar name={owner.full_name || owner.email} src={owner.avatar_url} size={16} /></span>}
      </div>
      <div className="mt-1 line-clamp-2 font-medium">{d.name}</div>
      {(d.contact || d.company) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-2">
          <Avatar name={d.company?.name ?? contactLabel(d.contact)} size={14} square={!!d.company} />
          <span className="truncate">{d.company?.name ?? contactLabel(d.contact)}</span>
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-xs tabular-nums">
        {Number(d.amount_one_time) > 0 && <span className="text-fg">{money(d.amount_one_time)}</span>}
        {Number(d.amount_recurring) > 0 && <span className="text-success">{money(d.amount_recurring)}/mo</span>}
        {!Number(d.amount_one_time) && !Number(d.amount_recurring) && <span className="text-fg-4">No line items</span>}
        {d.expected_close_date && <span className="ml-auto text-fg-3">{fmtDate(d.expected_close_date, "MMM d")}</span>}
      </div>
    </div>
  );
}
