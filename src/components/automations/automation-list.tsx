"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, MoreHorizontal, Plus, Trash2, Workflow, Zap, Play, Pencil, ListTree } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/misc";
import { Switch } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { StatusTag, Tag } from "@/components/ui/badge";
import { createAutomation, deleteAutomation, duplicateAutomation, setAutomationStatus } from "@/lib/actions/automations";
import { AUTOMATION_TEMPLATES } from "@/lib/automations/templates";
import { triggerLabel } from "@/lib/automations/catalog";
import { pct, timeAgo, cn } from "@/lib/utils";

export interface AutomationRow {
  id: string; name: string; description: string | null; status: "draft" | "active" | "paused"; trigger_type: string; updated_at: string;
  steps: number; active: number; completed: number; enrolled30: number; replied30: number;
}

export function AutomationList({ rows }: { rows: AutomationRow[] }) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AutomationRow | null>(null);

  const create = (key?: string) => {
    setBusyKey(key ?? "blank");
    start(async () => {
      const r = await createAutomation(key);
      setBusyKey(null);
      if (!r.ok) return void toast.error(r.error);
      setNewOpen(false);
      router.push(`/automations/${r.data}`);
    });
  };

  const toggle = (row: AutomationRow, on: boolean) => start(async () => {
    const r = await setAutomationStatus(row.id, on ? "active" : "paused");
    if (!r.ok) return void toast.error(r.error, { description: "Open the workflow to fix it." });
    toast.success(on ? `"${row.name}" is live` : `"${row.name}" paused`);
    router.refresh();
  });

  const duplicate = (row: AutomationRow) => start(async () => {
    const r = await duplicateAutomation(row.id);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Duplicated");
    router.push(`/automations/${r.data}`);
  });

  const remove = () => toDelete && start(async () => {
    const r = await deleteAutomation(toDelete.id);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Automation deleted");
    setToDelete(null);
    router.refresh();
  });

  const columns: Column<AutomationRow>[] = [
    {
      id: "name", header: "Name", icon: Workflow, width: 300, sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-sm bg-[#ff6d5a]/15"><Zap className="size-3 text-[#ff6d5a]" /></span>
          <span className="truncate font-medium">{r.name}</span>
        </span>
      ),
    },
    { id: "trigger", header: "Trigger", width: 200, sortValue: (r) => r.trigger_type, cell: (r) => <Tag color="orange">{triggerLabel(r.trigger_type)}</Tag> },
    {
      id: "status", header: "Status", width: 130, sortValue: (r) => r.status,
      cell: (r) => (
        <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Switch checked={r.status === "active"} onChange={(v) => toggle(r, v)} disabled={pending} />
          <StatusTag status={r.status} />
        </span>
      ),
    },
    { id: "steps", header: "Steps", width: 70, align: "right", sortValue: (r) => r.steps, cell: (r) => r.steps },
    { id: "active", header: "In progress", width: 100, align: "right", sortValue: (r) => r.active, cell: (r) => <span className={cn(r.active && "text-accent font-medium")}>{r.active}</span> },
    { id: "completed", header: "Completed", width: 100, align: "right", sortValue: (r) => r.completed, cell: (r) => r.completed },
    { id: "enrolled", header: "Enrolled (30d)", width: 120, align: "right", sortValue: (r) => r.enrolled30, cell: (r) => r.enrolled30 },
    { id: "reply", header: "Reply rate", width: 100, align: "right", sortValue: (r) => (r.enrolled30 ? r.replied30 / r.enrolled30 : -1), cell: (r) => (r.enrolled30 ? pct(r.replied30 / r.enrolled30) : "—") },
    { id: "updated", header: "Updated", width: 120, sortValue: (r) => r.updated_at, cell: (r) => <span className="text-fg-3">{timeAgo(r.updated_at)}</span> },
    {
      id: "menu", header: "", width: 44,
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu>
            <MenuTrigger asChild><Button size="xs" variant="ghost" icon={MoreHorizontal} aria-label="Actions" /></MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={Pencil} onSelect={() => router.push(`/automations/${r.id}`)}>Open editor</MenuItem>
              <MenuItem icon={ListTree} onSelect={() => router.push(`/automations/${r.id}?tab=executions`)}>View executions</MenuItem>
              <MenuItem icon={Play} onSelect={() => toggle(r, r.status !== "active")}>{r.status === "active" ? "Pause" : "Activate"}</MenuItem>
              <MenuItem icon={Copy} onSelect={() => duplicate(r)}>Duplicate</MenuItem>
              <MenuSeparator />
              <MenuItem icon={Trash2} danger onSelect={() => setToDelete(r)}>Delete</MenuItem>
            </MenuContent>
          </Menu>
        </span>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader icon={Workflow} title="Automations" actions={<Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>New automation</Button>}>
        <span className="text-xs text-fg-3">{rows.filter((r) => r.status === "active").length} active · {rows.reduce((a, r) => a + r.active, 0)} contacts in flight</span>
      </PageHeader>
      <PageBody>
        <DataTable
          rows={rows}
          columns={columns}
          onRowClick={(r) => router.push(`/automations/${r.id}`)}
          empty={
            <EmptyState icon={Workflow} title="No automations yet"
              description="Build SMS + email follow-up sequences that run automatically when leads come in, book, sign or pay."
              action={<Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>Create your first automation</Button>} />
          }
        />
      </PageBody>

      <Dialog open={newOpen} onOpenChange={setNewOpen} title="New automation" description="Start from a proven template or a blank canvas." size="lg">
        <div className="grid gap-2 pb-2 sm:grid-cols-2">
          <button onClick={() => create()} disabled={pending}
            className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-border-strong p-3 text-left hover:bg-hover cursor-pointer disabled:opacity-50">
            <span className="flex items-center gap-2 text-[13px] font-medium"><Plus className="size-4" /> Blank workflow {busyKey === "blank" && "…"}</span>
            <span className="text-xs text-fg-3">Start with just a trigger and build your own sequence.</span>
          </button>
          {AUTOMATION_TEMPLATES.map((t) => (
            <button key={t.key} onClick={() => create(t.key)} disabled={pending}
              className="flex flex-col items-start gap-1 rounded-lg border border-border p-3 text-left hover:bg-hover cursor-pointer disabled:opacity-50">
              <span className="flex items-center gap-2 text-[13px] font-medium"><Zap className="size-4 text-[#ff6d5a]" /> {t.name} {busyKey === t.key && "…"}</span>
              <span className="text-xs text-fg-3">{t.description}</span>
              <span className="mt-1 flex gap-1"><Tag color="orange">{triggerLabel(t.trigger_type)}</Tag><Tag>{t.nodes.length - 1} steps</Tag></span>
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title={`Delete "${toDelete?.name}"?`} size="sm"
        description="This removes the workflow and all of its execution history. Contacts currently in the sequence stop immediately."
        footer={<><Button onClick={() => setToDelete(null)}>Cancel</Button><Button variant="danger" loading={pending} onClick={remove}>Delete</Button></>} />
    </Page>
  );
}
