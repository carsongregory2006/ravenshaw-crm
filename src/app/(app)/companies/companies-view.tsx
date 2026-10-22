"use client";
import { Time } from "@/components/ui/time";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Globe, Factory, Users, User, Target, UserCheck, CalendarPlus, Plus, Search, Download, Trash2, X } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/misc";
import { FilterChip } from "@/components/records/filter-chip";
import { NewCompanyDialog, ConfirmDialog } from "@/components/records/dialogs";
import { downloadCsv } from "@/components/records/csv";
import { deleteCompanies } from "@/lib/actions/crm";
import { fmtDate, num } from "@/lib/utils";
import type { Company } from "@/lib/types";

export type CompanyRow = Company & { contacts: { count: number }[]; deals: { count: number }[] };

export function CompaniesView({ companies, users, openNew }: { companies: CompanyRow[]; users: { id: string; full_name: string | null; email: string }[]; openNew?: boolean }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [industry, setIndustry] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = React.useState(!!openNew);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => { if (openNew) router.replace("/companies"); }, [openNew, router]);

  const userName = new Map(users.map((u) => [u.id, u.full_name || u.email]));
  const industries = [...new Set(companies.map((c) => c.industry).filter(Boolean) as string[])].sort();
  const rows = companies.filter((c) => {
    if (industry.length && !industry.includes(c.industry ?? "")) return false;
    const n = q.trim().toLowerCase();
    return !n || [c.name, c.domain, c.industry].some((v) => v?.toLowerCase().includes(n));
  });
  const ids = [...selected];

  const columns: Column<CompanyRow>[] = [
    { id: "name", header: "Name", icon: Building2, width: 220, sortValue: (c) => c.name.toLowerCase(), cell: (c) => (
      <Link href={`/companies/${c.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-2 font-medium hover:underline"><Avatar name={c.name} size={18} square />{c.name}</Link>
    ) },
    { id: "domain", header: "Domain", icon: Globe, width: 170, sortValue: (c) => c.domain, cell: (c) => c.domain ? <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">{c.domain}</a> : null },
    { id: "industry", header: "Industry", icon: Factory, width: 150, sortValue: (c) => c.industry, cell: (c) => c.industry },
    { id: "employees", header: "Employees", icon: Users, width: 110, align: "right", sortValue: (c) => c.employees, cell: (c) => (c.employees != null ? num(c.employees) : "") },
    { id: "people", header: "People", icon: User, width: 90, align: "right", sortValue: (c) => c.contacts?.[0]?.count ?? 0, cell: (c) => c.contacts?.[0]?.count ?? 0 },
    { id: "deals", header: "Deals", icon: Target, width: 90, align: "right", sortValue: (c) => c.deals?.[0]?.count ?? 0, cell: (c) => c.deals?.[0]?.count ?? 0 },
    { id: "owner", header: "Owner", icon: UserCheck, width: 150, cell: (c) => (c.owner_id ? <span className="inline-flex items-center gap-1.5"><Avatar name={userName.get(c.owner_id)} size={16} />{userName.get(c.owner_id)}</span> : null) },
    { id: "created", header: "Created", icon: CalendarPlus, width: 120, sortValue: (c) => c.created_at, cell: (c) => <Time value={c.created_at} format="date" /> },
  ];

  return (
    <Page>
      <PageHeader icon={Building2} title="Companies" actions={<>
        <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadCsv("companies.csv", [["Name", "Domain", "Website", "Industry", "Employees", "Phone", "Address"], ...rows.map((c) => [c.name, c.domain, c.website, c.industry, c.employees, c.phone, c.address])])}>Export</Button>
        <Button size="sm" variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>New</Button>
      </>}>
        <span className="text-xs text-fg-3">{rows.length}</span>
      </PageHeader>
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies…" className="h-6 w-56 rounded-md bg-transparent pl-7 pr-2 text-xs outline-none placeholder:text-fg-4 hover:bg-hover focus:bg-hover" />
        </div>
        <FilterChip label="Industry" value={industry} onChange={setIndustry} options={industries.map((i) => ({ value: i, label: i }))} />
        {ids.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5 text-xs">
            <span className="font-medium">{ids.length} selected</span>
            <button onClick={() => setSelected(new Set())} aria-label="Clear" className="text-fg-3 hover:text-fg cursor-pointer"><X className="size-3.5" /></button>
            <Button size="xs" icon={Trash2} className="text-danger" onClick={() => setConfirm(true)}>Delete</Button>
          </div>
        )}
      </div>
      <PageBody>
        <DataTable rows={rows} columns={columns} selectable selected={selected} onSelectedChange={setSelected} onRowClick={(c) => router.push(`/companies/${c.id}`)}
          empty={<EmptyState icon={Building2} title={q || industry.length ? "No matching companies" : "No companies yet"} description="Companies group the people and deals you work with."
            action={<Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>New company</Button>} />} />
      </PageBody>
      <NewCompanyDialog open={newOpen} onOpenChange={setNewOpen} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete ${ids.length} ${ids.length === 1 ? "company" : "companies"}?`}
        description="People and deals stay but are unlinked from the company."
        onConfirm={async () => { const r = await deleteCompanies(ids); if (!r.ok) { toast.error(r.error); return; } toast.success("Deleted"); setSelected(new Set()); router.refresh(); }} />
    </Page>
  );
}
