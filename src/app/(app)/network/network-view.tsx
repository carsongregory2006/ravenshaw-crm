"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightCircle, MoreHorizontal, Pencil, Plus, Search, Trash2, UserCheck, Users } from "lucide-react";
import { Page, PageHeader, PageBody } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Tag, type TagColor } from "@/components/ui/badge";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { deleteNetworkLeadAction, moveNetworkLeadToCrmAction, saveNetworkLeadAction, type NetworkInput } from "@/lib/actions/network";
import type { NetworkLead, NetworkStatus } from "@/lib/types";

const STATUSES: { id: NetworkStatus; label: string; color: TagColor }[] = [
  { id: "idea", label: "Idea", color: "gray" },
  { id: "intro_asked", label: "Asked for intro", color: "yellow" },
  { id: "reached_out", label: "Reached out", color: "blue" },
  { id: "talking", label: "Talking", color: "purple" },
  { id: "converted", label: "In CRM", color: "green" },
  { id: "not_fit", label: "Not a fit", color: "red" },
];
const WARMTH: { id: NetworkLead["warmth"]; label: string; color: TagColor }[] = [
  { id: "hot", label: "Hot", color: "red" },
  { id: "warm", label: "Warm", color: "orange" },
  { id: "cold", label: "Cold", color: "sky" },
];
const warmthOf = (w: NetworkLead["warmth"]) => WARMTH.find((x) => x.id === w)!;
const isOpen = (l: NetworkLead) => l.status !== "converted" && l.status !== "not_fit";
const today = () => new Date().toLocaleDateString("en-CA");
const isDue = (l: NetworkLead) => isOpen(l) && !!l.follow_up_on && l.follow_up_on <= today();

type TabId = "active" | "due" | "converted" | "not_fit" | "all";
const EMPTY: NetworkInput = { name: "", business: "", phone: "", email: "", connection: "", introduced_by: "", warmth: "warm", status: "idea", follow_up_on: "", notes: "" };

export function NetworkView({ initial }: { initial: NetworkLead[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);
  const [tab, setTab] = useState<TabId>("active");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<NetworkLead | "new" | null>(null);
  const [form, setForm] = useState<NetworkInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<NetworkLead | null>(null);

  const set = <K extends keyof NetworkInput>(k: K, v: NetworkInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const upsert = (l: NetworkLead) => setRows((rs) => (rs.some((r) => r.id === l.id) ? rs.map((r) => (r.id === l.id ? l : r)) : [l, ...rs]));

  const openNew = () => { setForm(EMPTY); setEditing("new"); };
  const openEdit = (l: NetworkLead) => {
    setForm({ name: l.name, business: l.business ?? "", phone: l.phone ?? "", email: l.email ?? "", connection: l.connection ?? "", introduced_by: l.introduced_by ?? "", warmth: l.warmth, status: l.status, follow_up_on: l.follow_up_on ?? "", notes: l.notes ?? "" });
    setEditing(l);
  };

  const save = async () => {
    setBusy(true);
    const r = await saveNetworkLeadAction(editing === "new" ? null : editing!.id, form);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    upsert(r.data);
    toast.success(editing === "new" ? "Added" : "Saved");
    setEditing(null);
  };

  const quickStatus = async (l: NetworkLead, status: NetworkStatus) => {
    upsert({ ...l, status });
    const r = await saveNetworkLeadAction(l.id, { status });
    if (!r.ok) { upsert(l); toast.error(r.error); }
  };

  const moveToCrm = async (l: NetworkLead) => {
    const r = await moveNetworkLeadToCrmAction(l.id);
    if (!r.ok) return toast.error(r.error);
    upsert({ ...l, status: "converted", contact_id: r.data });
    toast.success(`${l.name} added to People`, { action: { label: "Open", onClick: () => router.push(`/contacts/${r.data}`) } });
  };

  const remove = async (l: NetworkLead) => {
    setConfirmDelete(null);
    const r = await deleteNetworkLeadAction(l.id);
    if (!r.ok) return toast.error(r.error);
    setRows((rs) => rs.filter((x) => x.id !== l.id));
    toast.success("Deleted");
  };

  const counts = {
    active: rows.filter(isOpen).length,
    due: rows.filter(isDue).length,
    converted: rows.filter((r) => r.status === "converted").length,
    not_fit: rows.filter((r) => r.status === "not_fit").length,
    all: rows.length,
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => tab === "all" ? true : tab === "active" ? isOpen(r) : tab === "due" ? isDue(r) : r.status === tab)
      .filter((r) => !needle || [r.name, r.business, r.connection, r.introduced_by, r.notes].some((v) => v?.toLowerCase().includes(needle)));
  }, [rows, tab, q]);

  const columns: Column<NetworkLead>[] = [
    {
      id: "name", header: "Name", icon: Users, width: 220, sortValue: (r) => r.name.toLowerCase(), cell: (r) => (
        <span className="min-w-0">
          <span className="block truncate font-medium">{r.name}</span>
          {r.business && <span className="block truncate text-xs text-fg-3">{r.business}</span>}
        </span>
      ),
    },
    { id: "warmth", header: "Warmth", width: 80, sortValue: (r) => WARMTH.findIndex((w) => w.id === r.warmth), cell: (r) => <Tag color={warmthOf(r.warmth).color}>{warmthOf(r.warmth).label}</Tag> },
    {
      id: "status", header: "Status", width: 150, sortValue: (r) => STATUSES.findIndex((s) => s.id === r.status), cell: (r) => r.status === "converted" && r.contact_id ? (
        <Link href={`/contacts/${r.contact_id}`} onClick={(e) => e.stopPropagation()}><Tag color="green">In CRM →</Tag></Link>
      ) : (
        <span onClick={(e) => e.stopPropagation()}>
          <Select value={r.status} onChange={(e) => quickStatus(r, e.target.value as NetworkStatus)} className="h-6 w-36 text-xs" aria-label="Status">
            {STATUSES.filter((s) => s.id !== "converted").map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </span>
      ),
    },
    { id: "connection", header: "How I know them", width: 200, cell: (r) => <span className="truncate text-fg-2">{r.connection ?? ""}</span> },
    { id: "intro", header: "Intro from", width: 140, sortValue: (r) => r.introduced_by ?? "", cell: (r) => <span className="truncate text-fg-2">{r.introduced_by ?? ""}</span> },
    {
      id: "follow", header: "Follow up", width: 110, sortValue: (r) => r.follow_up_on ?? "9999", cell: (r) => r.follow_up_on
        ? <span className={cn("tabular-nums", isDue(r) ? "font-medium text-danger" : "text-fg-2")}>{new Date(`${r.follow_up_on}T12:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</span>
        : null,
    },
    { id: "notes", header: "Notes", width: 240, cell: (r) => <span className="truncate text-fg-3">{r.notes ?? ""}</span> },
    {
      id: "actions", header: "", width: 44, cell: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu>
            <MenuTrigger asChild><Button size="xs" variant="ghost" icon={MoreHorizontal} aria-label="Actions" /></MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={Pencil} onSelect={() => openEdit(r)}>Edit</MenuItem>
              {r.contact_id
                ? <MenuItem icon={UserCheck} onSelect={() => router.push(`/contacts/${r.contact_id}`)}>Open in People</MenuItem>
                : <MenuItem icon={ArrowRightCircle} onSelect={() => moveToCrm(r)}>Move to CRM</MenuItem>}
              <MenuSeparator />
              <MenuItem icon={Trash2} danger onSelect={() => setConfirmDelete(r)}>Delete</MenuItem>
            </MenuContent>
          </Menu>
        </span>
      ),
    },
  ];

  const current = editing && editing !== "new" ? editing : null;

  return (
    <Page>
      <PageHeader icon={Users} title="Network" actions={<Button variant="primary" icon={Plus} onClick={openNew}>Add person</Button>} />
      <PageBody>
        <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
          <Stat label="Follow-ups due" value={counts.due} sub={counts.due ? "Today or overdue" : "Nothing due"} className={cn(counts.due > 0 && "border-danger/40")} />
          <Stat label="Hot" value={rows.filter((r) => isOpen(r) && r.warmth === "hot").length} />
          <Stat label="Talking" value={rows.filter((r) => r.status === "talking").length} />
          <Stat label="Moved to CRM" value={counts.converted} />
        </div>
        <Tabs
          tabs={[
            { id: "active", label: "Active", count: counts.active },
            { id: "due", label: "Due", count: counts.due },
            { id: "converted", label: "In CRM", count: counts.converted },
            { id: "not_fit", label: "Not a fit", count: counts.not_fit },
            { id: "all", label: "All", count: counts.all },
          ]}
          value={tab}
          onChange={(t) => setTab(t as TabId)}
          right={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-7 w-52 pl-7" />
            </div>
          }
        />
        <DataTable
          rows={filtered}
          columns={columns}
          onRowClick={openEdit}
          empty={
            <EmptyState icon={Users} title={rows.length ? "Nobody here" : "Your network list is empty"}
              description="Jot down people you know (or friends of friends) who could become clients. Move them into the CRM when you're ready to reach out."
              action={<Button variant="primary" icon={Plus} onClick={openNew}>Add person</Button>} />
          }
        />
      </PageBody>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} size="lg"
        title={editing === "new" ? "Add to network" : form.name || "Edit"}
        description={editing === "new" ? "Only the name is required. Fill in the rest whenever you know it." : undefined}
        footer={<>
          {current && !current.contact_id && (
            <Button variant="ghost" icon={ArrowRightCircle} className="mr-auto" onClick={async () => { setEditing(null); await moveToCrm(current); }}>Move to CRM</Button>
          )}
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>{editing === "new" ? "Add" : "Save"}</Button>
        </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input autoFocus value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="Mike Tremblay" /></Field>
          <Field label="Business"><Input value={form.business ?? ""} onChange={(e) => set("business", e.target.value)} placeholder="Tremblay Landscaping" /></Field>
          <Field label="Phone"><Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="514-555-0123" /></Field>
          <Field label="Email"><Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="How I know them"><Input value={form.connection ?? ""} onChange={(e) => set("connection", e.target.value)} placeholder="Dad's friend, plays hockey with Jake" /></Field>
          <Field label="Intro from"><Input value={form.introduced_by ?? ""} onChange={(e) => set("introduced_by", e.target.value)} placeholder="Who can connect you" /></Field>
          <Field label="Warmth">
            <div className="flex gap-1">
              {WARMTH.map((w) => (
                <button key={w.id} type="button" onClick={() => set("warmth", w.id)}
                  className={cn("h-8 flex-1 rounded-md border text-[13px] cursor-pointer", form.warmth === w.id ? "border-accent bg-accent-soft font-medium" : "border-border hover:bg-hover")}>
                  {w.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value as NetworkStatus)}>
              {STATUSES.filter((s) => s.id !== "converted" || form.status === "converted").map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Follow up on"><Input type="date" value={form.follow_up_on ?? ""} onChange={(e) => set("follow_up_on", e.target.value)} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Has 3 crews, always complains about missed calls" /></Field>
        </div>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)} size="sm" title={`Delete ${confirmDelete?.name}?`}
        description={confirmDelete?.contact_id ? "Removes them from Network only. Their CRM contact stays." : "This can't be undone."}
        footer={<><Button onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" onClick={() => remove(confirmDelete!)}>Delete</Button></>} />
    </Page>
  );
}
