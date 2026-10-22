"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  User, Mail, Phone, Building2, Tag as TagIcon, UserCheck, Globe, Clock, CalendarPlus, Plus, Search, Upload, Download,
  Trash2, X, CircleDot, ChevronDown,
} from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuTrigger, MenuLabel } from "@/components/ui/menu";
import { FilterChip } from "@/components/records/filter-chip";
import { NewContactDialog, ConfirmDialog, PromptDialog } from "@/components/records/dialogs";
import { CONTACT_STATUSES, STATUS_COLORS } from "@/components/records/inline-fields";
import { downloadCsv } from "@/components/records/csv";
import { ImportDialog } from "./import-dialog";
import { bulkUpdateContacts, addTagToContacts, deleteContacts } from "@/lib/actions/crm";
import { useIsStaff } from "@/components/shell/profile-context";
import { contactLabel, feedTime, fmtDate, fmtPhone } from "@/lib/utils";
import type { Contact, ContactStatus } from "@/lib/types";

export type ContactListRow = Contact & { company: { id: string; name: string } | null };
type UserLite = { id: string; full_name: string | null; email: string; avatar_url: string | null; role: string };

export function ContactsView({ contacts, users, openNew, initialStatus }: { contacts: ContactListRow[]; users: UserLite[]; openNew?: boolean; initialStatus?: string }) {
  const router = useRouter();
  const staff = useIsStaff();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<string[]>(initialStatus ? [initialStatus] : []);
  const [owner, setOwner] = React.useState<string[]>([]);
  const [source, setSource] = React.useState<string[]>([]);
  const [tag, setTag] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = React.useState(!!openNew);
  const [importOpen, setImportOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [tagPrompt, setTagPrompt] = React.useState(false);

  React.useEffect(() => { if (openNew) router.replace("/contacts"); }, [openNew, router]);

  const userName = React.useMemo(() => new Map(users.map((u) => [u.id, u.full_name || u.email])), [users]);
  const sources = React.useMemo(() => [...new Set(contacts.map((c) => c.source).filter(Boolean) as string[])].sort(), [contacts]);
  const tags = React.useMemo(() => [...new Set(contacts.flatMap((c) => c.tags ?? []))].sort(), [contacts]);

  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contacts.filter((c) => {
      if (status.length && !status.includes(c.status)) return false;
      if (owner.length && !owner.includes(c.owner_id ?? "none")) return false;
      if (source.length && !source.includes(c.source ?? "")) return false;
      if (tag.length && !tag.some((t) => c.tags?.includes(t))) return false;
      if (!needle) return true;
      return [c.first_name, c.last_name, c.email, c.phone, c.company?.name, c.title].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [contacts, q, status, owner, source, tag]);

  const ids = [...selected].filter((id) => rows.some((r) => r.id === id));
  const hasFilters = !!(q || status.length || owner.length || source.length || tag.length);

  const run = async (p: Promise<{ ok: boolean; error?: string }>, msg: string): Promise<void> => {
    const r = await p;
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(msg);
    setSelected(new Set());
    router.refresh();
  };

  const exportCsv = (list: ContactListRow[]) => {
    downloadCsv(`people-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["First name", "Last name", "Email", "Phone", "Title", "Company", "Status", "Owner", "Source", "Tags", "UTM source", "UTM campaign", "Last contacted", "Created"],
      ...list.map((c) => [c.first_name, c.last_name, c.email, c.phone, c.title, c.company?.name, c.status, c.owner_id ? userName.get(c.owner_id) : "",
        c.source, (c.tags ?? []).join("; "), c.utm_source, c.utm_campaign, c.last_contacted_at, c.created_at]),
    ]);
  };

  const columns: Column<ContactListRow>[] = [
    {
      id: "name", header: "Name", icon: User, width: 220, sortValue: (c) => contactLabel(c).toLowerCase(),
      cell: (c) => (
        <Link href={`/contacts/${c.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full items-center gap-2 rounded-sm px-1 -mx-1 hover:bg-active">
          <Avatar name={contactLabel(c)} size={18} />
          <span className="truncate font-medium">{contactLabel(c)}</span>
        </Link>
      ),
    },
    { id: "email", header: "Email", icon: Mail, width: 210, sortValue: (c) => c.email, cell: (c) => c.email ? <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">{c.email}</a> : null },
    { id: "phone", header: "Phone", icon: Phone, width: 140, cell: (c) => fmtPhone(c.phone) },
    { id: "company", header: "Company", icon: Building2, width: 160, sortValue: (c) => c.company?.name, cell: (c) => c.company ? (
      <Link href={`/companies/${c.company.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 hover:underline"><Avatar name={c.company.name} size={16} square />{c.company.name}</Link>
    ) : null },
    { id: "status", header: "Status", icon: CircleDot, width: 110, sortValue: (c) => c.status, cell: (c) => <Tag color={STATUS_COLORS[c.status]}>{CONTACT_STATUSES.find((s) => s.value === c.status)?.label}</Tag> },
    { id: "owner", header: "Owner", icon: UserCheck, width: 150, sortValue: (c) => (c.owner_id ? userName.get(c.owner_id) : ""), cell: (c) => c.owner_id ? (
      <span className="inline-flex items-center gap-1.5"><Avatar name={userName.get(c.owner_id)} size={16} />{userName.get(c.owner_id)}</span>
    ) : <span className="text-fg-4">Unassigned</span> },
    { id: "source", header: "Source", icon: Globe, width: 120, sortValue: (c) => c.source, cell: (c) => c.source },
    { id: "tags", header: "Tags", icon: TagIcon, width: 180, cell: (c) => <span className="flex gap-1">{(c.tags ?? []).slice(0, 3).map((t) => <Tag key={t} color="blue">{t}</Tag>)}{(c.tags?.length ?? 0) > 3 && <span className="text-xs text-fg-3">+{c.tags.length - 3}</span>}</span> },
    { id: "last", header: "Last contacted", icon: Clock, width: 130, sortValue: (c) => c.last_contacted_at ?? "", cell: (c) => c.last_contacted_at ? feedTime(c.last_contacted_at) : <span className="text-fg-4">Never</span> },
    { id: "created", header: "Created", icon: CalendarPlus, width: 120, sortValue: (c) => c.created_at, cell: (c) => fmtDate(c.created_at) },
  ];

  return (
    <Page>
      <PageHeader icon={User} title="People" actions={
        <>
          <Button size="sm" variant="ghost" icon={Upload} onClick={() => setImportOpen(true)}>Import</Button>
          <Button size="sm" variant="ghost" icon={Download} onClick={() => exportCsv(rows)}>Export</Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>New</Button>
        </>
      }>
        <span className="text-xs text-fg-3">{rows.length}{rows.length !== contacts.length && ` of ${contacts.length}`}</span>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…"
            className="h-6 w-56 rounded-md bg-transparent pl-7 pr-2 text-xs outline-none placeholder:text-fg-4 hover:bg-hover focus:bg-hover" />
        </div>
        <FilterChip label="Status" value={status} onChange={setStatus} options={CONTACT_STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
        <FilterChip label="Owner" value={owner} onChange={setOwner} options={[{ value: "none", label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.full_name || u.email }))]} />
        <FilterChip label="Source" value={source} onChange={setSource} options={sources.map((s) => ({ value: s, label: s }))} />
        <FilterChip label="Tag" value={tag} onChange={setTag} options={tags.map((t) => ({ value: t, label: t }))} />
        {hasFilters && <button onClick={() => { setQ(""); setStatus([]); setOwner([]); setSource([]); setTag([]); }} className="h-6 px-1.5 text-xs text-fg-3 hover:text-fg cursor-pointer">Reset</button>}
      </div>

      {ids.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-border bg-accent-soft/50 px-3 py-1.5 text-xs">
          <span className="font-medium">{ids.length} selected</span>
          <button onClick={() => setSelected(new Set())} className="rounded-sm p-0.5 text-fg-3 hover:text-fg cursor-pointer" aria-label="Clear selection"><X className="size-3.5" /></button>
          <div className="ml-2 flex items-center gap-1">
            {staff && (
              <Menu>
                <MenuTrigger asChild><Button size="xs" iconRight={ChevronDown} icon={UserCheck}>Assign</Button></MenuTrigger>
                <MenuContent>
                  <MenuLabel>Assign owner</MenuLabel>
                  {users.map((u) => <MenuItem key={u.id} onSelect={() => run(bulkUpdateContacts(ids, { owner_id: u.id }), `Assigned to ${u.full_name || u.email}`)}>{u.full_name || u.email}</MenuItem>)}
                  <MenuItem onSelect={() => run(bulkUpdateContacts(ids, { owner_id: null }), "Unassigned")}>Unassigned</MenuItem>
                </MenuContent>
              </Menu>
            )}
            <Menu>
              <MenuTrigger asChild><Button size="xs" iconRight={ChevronDown} icon={CircleDot}>Status</Button></MenuTrigger>
              <MenuContent>
                {CONTACT_STATUSES.map((s) => <MenuItem key={s.value} onSelect={() => run(bulkUpdateContacts(ids, { status: s.value as ContactStatus }), `Status set to ${s.label}`)}>{s.label}</MenuItem>)}
              </MenuContent>
            </Menu>
            <Button size="xs" icon={TagIcon} onClick={() => setTagPrompt(true)}>Add tag</Button>
            <Button size="xs" icon={Download} onClick={() => exportCsv(rows.filter((r) => selected.has(r.id)))}>Export</Button>
            <Button size="xs" icon={Trash2} className="text-danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </div>
        </div>
      )}

      <PageBody>
        <DataTable rows={rows} columns={columns} selectable selected={selected} onSelectedChange={setSelected}
          onRowClick={(c) => router.push(`/contacts/${c.id}`)}
          empty={hasFilters
            ? <EmptyState icon={Search} title="No matching people" description="Try adjusting your search or filters." />
            : <EmptyState icon={User} title="No people yet" description="Add a person, import a CSV, or publish a landing page to start capturing leads."
                action={<div className="flex gap-2"><Button icon={Upload} onClick={() => setImportOpen(true)}>Import CSV</Button><Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>New person</Button></div>} />} />
      </PageBody>

      <NewContactDialog open={newOpen} onOpenChange={setNewOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} users={users} />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${ids.length} ${ids.length === 1 ? "person" : "people"}?`}
        description="This permanently deletes them along with their messages, notes and activity. This can't be undone."
        onConfirm={() => run(deleteContacts(ids), `Deleted ${ids.length}`)} />
      <PromptDialog open={tagPrompt} onOpenChange={setTagPrompt} title={`Tag ${ids.length} ${ids.length === 1 ? "person" : "people"}`} label="Tag"
        placeholder={tags[0] ?? "hot-lead"} confirmLabel="Add tag" required onSubmit={(t) => run(addTagToContacts(ids, t), `Tagged “${t}”`)} />
    </Page>
  );
}
