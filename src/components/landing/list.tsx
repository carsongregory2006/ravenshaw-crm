"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive, Copy, ExternalLink, Eye, EyeOff, Globe, Link2, MoreHorizontal, Pencil, Plus, Search, Trash2,
} from "lucide-react";
import { Page, PageHeader, PageBody } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusTag, Tag } from "@/components/ui/badge";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tabs } from "@/components/ui/tabs";
import { cn, num, pct, timeAgo } from "@/lib/utils";
import { PAGE_TEMPLATES } from "./templates";
import { createLandingPage, deleteLandingPage, duplicateLandingPage, setLandingStatus } from "@/lib/actions/landing";
import type { LandingPage } from "@/lib/types";

export type LandingRow = LandingPage & {
  variantCount: number; activeVariants: number; views: number; visitors: number; conversions: number; cvr: number; booked: number;
  best: { name: string; cvr: number } | null;
};

export function publicUrl(slug: string) {
  return typeof window === "undefined" ? `/p/${slug}` : `${window.location.origin}/p/${slug}`;
}

export function LandingPagesList({ rows }: { rows: LandingRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "published" | "draft" | "archived">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(PAGE_TEMPLATES[0].key);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LandingRow | null>(null);

  const filtered = useMemo(() => rows.filter((r) =>
    (tab === "all" ? r.status !== "archived" : r.status === tab) &&
    (!q || r.name.toLowerCase().includes(q.toLowerCase()) || r.slug.includes(q.toLowerCase())),
  ), [rows, tab, q]);

  const live = rows.filter((r) => r.status === "published");
  const totals = live.reduce((a, r) => ({ views: a.views + r.views, conv: a.conv + r.conversions, booked: a.booked + r.booked, vis: a.vis + (r.visitors || r.views) }), { views: 0, conv: 0, booked: 0, vis: 0 });

  const create = async () => {
    setBusy(true);
    const res = await createLandingPage({ name, template });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Page created");
    setCreateOpen(false);
    router.push(`/landing-pages/${res.data}`);
  };

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => {
    const r = await fn();
    if (!r.ok) toast.error(r.error ?? "Failed");
    else { toast.success(msg); router.refresh(); }
  };

  const copyUrl = (slug: string) => {
    navigator.clipboard.writeText(publicUrl(slug));
    toast.success("Link copied");
  };

  const columns: Column<LandingRow>[] = [
    { id: "name", header: "Name", icon: Globe, width: 240, sortValue: (r) => r.name.toLowerCase(), cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      id: "url", header: "URL", width: 220, cell: (r) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <span className="truncate text-fg-2">/p/{r.slug}</span>
          <button onClick={() => copyUrl(r.slug)} className="rounded-sm p-0.5 text-fg-3 opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100 cursor-pointer" aria-label="Copy link"><Link2 className="size-3.5" /></button>
          {r.status === "published" && (
            <a href={`/p/${r.slug}`} target="_blank" rel="noreferrer" className="rounded-sm p-0.5 text-fg-3 opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100" aria-label="Open page"><ExternalLink className="size-3.5" /></a>
          )}
        </span>
      ),
    },
    { id: "status", header: "Status", width: 100, sortValue: (r) => r.status, cell: (r) => <StatusTag status={r.status} /> },
    { id: "variants", header: "Variants", width: 90, align: "right", sortValue: (r) => r.variantCount, cell: (r) => <span>{r.activeVariants}<span className="text-fg-3">/{r.variantCount}</span></span> },
    { id: "views", header: "Views", width: 90, align: "right", sortValue: (r) => r.views, cell: (r) => num(r.views) },
    { id: "leads", header: "Leads", width: 80, align: "right", sortValue: (r) => r.conversions, cell: (r) => num(r.conversions) },
    { id: "cvr", header: "Conv. rate", width: 100, align: "right", sortValue: (r) => r.cvr, cell: (r) => (r.views ? pct(r.cvr) : <span className="text-fg-4">—</span>) },
    { id: "booked", header: "Booked", width: 80, align: "right", sortValue: (r) => r.booked, cell: (r) => num(r.booked) },
    { id: "best", header: "Best variant", width: 150, cell: (r) => (r.best && r.variantCount > 1 ? <Tag color="green">{r.best.name} · {pct(r.best.cvr)}</Tag> : <span className="text-fg-4">—</span>) },
    { id: "updated", header: "Updated", width: 120, sortValue: (r) => r.updated_at, cell: (r) => <span className="text-fg-2">{timeAgo(r.updated_at)}</span> },
    {
      id: "actions", header: "", width: 44, cell: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu>
            <MenuTrigger asChild><Button size="xs" variant="ghost" icon={MoreHorizontal} aria-label="Actions" /></MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={Pencil} onSelect={() => router.push(`/landing-pages/${r.id}`)}>Edit</MenuItem>
              <MenuItem icon={Link2} onSelect={() => copyUrl(r.slug)}>Copy link</MenuItem>
              {r.status === "published"
                ? <MenuItem icon={EyeOff} onSelect={() => act(() => setLandingStatus(r.id, "draft"), "Unpublished")}>Unpublish</MenuItem>
                : <MenuItem icon={Eye} onSelect={() => act(() => setLandingStatus(r.id, "published"), "Published")}>Publish</MenuItem>}
              <MenuItem icon={Copy} onSelect={() => act(() => duplicateLandingPage(r.id), "Duplicated")}>Duplicate</MenuItem>
              {r.status !== "archived"
                ? <MenuItem icon={Archive} onSelect={() => act(() => setLandingStatus(r.id, "archived"), "Archived")}>Archive</MenuItem>
                : <MenuItem icon={Archive} onSelect={() => act(() => setLandingStatus(r.id, "draft"), "Restored")}>Restore</MenuItem>}
              <MenuSeparator />
              <MenuItem icon={Trash2} danger onSelect={() => setConfirmDelete(r)}>Delete</MenuItem>
            </MenuContent>
          </Menu>
        </span>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader icon={Globe} title="Landing Pages" actions={<Button variant="primary" icon={Plus} onClick={() => { setName(""); setCreateOpen(true); }}>New page</Button>} />
      <PageBody>
        <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">
          <Stat label="Live pages" value={live.length} sub={`${rows.length} total`} />
          <Stat label="Views (live)" value={num(totals.views)} />
          <Stat label="Leads (live)" value={num(totals.conv)} sub={totals.vis ? `${pct(totals.conv / totals.vis)} conversion` : undefined} />
          <Stat label="Booked calls" value={num(totals.booked)} sub={totals.conv ? `${pct(totals.booked / totals.conv)} of leads` : undefined} />
        </div>
        <Tabs
          tabs={[
            { id: "all", label: "All", count: rows.filter((r) => r.status !== "archived").length },
            { id: "published", label: "Published", count: live.length },
            { id: "draft", label: "Drafts", count: rows.filter((r) => r.status === "draft").length },
            { id: "archived", label: "Archived", count: rows.filter((r) => r.status === "archived").length },
          ]}
          value={tab}
          onChange={(t) => setTab(t as typeof tab)}
          right={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages" className="h-7 w-52 pl-7" />
            </div>
          }
        />
        <DataTable
          rows={filtered}
          columns={columns}
          onRowClick={(r) => router.push(`/landing-pages/${r.id}`)}
          empty={
            <EmptyState icon={Globe} title={rows.length ? "No pages match" : "No landing pages yet"}
              description="Build a page, split-test copy, and route every lead to the right rep automatically."
              action={<Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>New page</Button>} />
          }
        />
      </PageBody>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="New landing page" description="Start from a proven template — everything is editable." size="lg"
        footer={<><Button onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={create}>Create page</Button></>}>
        <div className="space-y-3">
          <Field label="Page name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={PAGE_TEMPLATES.find((t) => t.key === template)?.name}
              onKeyDown={(e) => e.key === "Enter" && create()} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {PAGE_TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => setTemplate(t.key)}
                className={cn("rounded-lg border p-3 text-left transition-colors cursor-pointer", template === t.key ? "border-accent bg-accent-soft/50" : "border-border hover:bg-hover")}>
                <div className="text-[13px] font-medium">{t.name}</div>
                <div className="mt-0.5 text-xs text-fg-3">{t.description}</div>
                <div className="mt-2 text-xs text-fg-4">{t.sections().length} sections</div>
              </button>
            ))}
          </div>
        </div>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)} title={`Delete “${confirmDelete?.name}”?`} size="sm"
        description="This permanently deletes the page, its variants and analytics events. Leads already captured are kept."
        footer={<><Button onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" onClick={async () => {
          const r = confirmDelete!;
          setConfirmDelete(null);
          await act(() => deleteLandingPage(r.id), "Page deleted");
        }}>Delete</Button></>} />
    </Page>
  );
}
