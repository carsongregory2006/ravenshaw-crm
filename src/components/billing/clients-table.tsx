"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Building2, Calendar, DollarSign, Heart, Rocket, Search, User, Wallet } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/input";
import { StatusTag } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, Stat } from "@/components/ui/misc";
import { PageBody } from "@/components/ui/page";
import { cn, contactLabel, fmtDate, money } from "@/lib/utils";
import type { ClientRow } from "@/lib/billing/queries";
import type { ClientStatus } from "@/lib/types";

const FILTERS: { id: "all" | ClientStatus; label: string }[] = [
  { id: "all", label: "All" }, { id: "onboarding", label: "Onboarding" }, { id: "active", label: "Active" },
  { id: "paused", label: "Paused" }, { id: "churned", label: "Churned" },
];

export function Progress({ done, total, className }: { done: number; total: number; className?: string }) {
  const pctDone = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-3">
        <div className={cn("h-full rounded-full", pctDone === 100 ? "bg-success" : "bg-accent")} style={{ width: `${pctDone}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-fg-3">{pctDone}%</span>
    </div>
  );
}

export function HealthDot({ score }: { score: number | null }) {
  const s = score ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", s >= 75 ? "bg-success" : s >= 50 ? "bg-warning" : "bg-danger")} />
      <span className="tabular-nums">{score ?? "—"}</span>
    </span>
  );
}

export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [q, setQ] = useState("");
  const [manager, setManager] = useState("");

  const managers = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => r.manager && m.set(r.manager.id, r.manager.full_name ?? "Unnamed"));
    return [...m.entries()];
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (manager && r.account_manager_id !== manager) return false;
    if (q) {
      const hay = `${contactLabel(r.contact)} ${r.contact?.email ?? ""} ${r.company?.name ?? ""} ${r.deal?.deal_number ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const live = rows.filter((r) => r.status === "active" || r.status === "onboarding");
  const mrr = live.reduce((a, r) => a + Number(r.mrr), 0);
  const ltv = rows.reduce((a, r) => a + r.ltv, 0);
  const owed = rows.reduce((a, r) => a + r.outstanding, 0);

  const columns: Column<ClientRow>[] = [
    { id: "name", header: "Client", icon: User, width: 220, sortValue: (r) => contactLabel(r.contact).toLowerCase(),
      cell: (r) => <span className="inline-flex items-center gap-2 font-medium"><Avatar name={contactLabel(r.contact)} size={18} />{contactLabel(r.contact)}</span> },
    { id: "company", header: "Company", icon: Building2, width: 160, sortValue: (r) => r.company?.name ?? "",
      cell: (r) => r.company ? <span className="inline-flex items-center gap-1.5"><Avatar name={r.company.name} size={16} square />{r.company.name}</span> : <span className="text-fg-4">—</span> },
    { id: "status", header: "Status", icon: BadgeCheck, width: 110, sortValue: (r) => r.status, cell: (r) => <StatusTag status={r.status} /> },
    { id: "mrr", header: "MRR", icon: DollarSign, width: 100, align: "right", sortValue: (r) => Number(r.mrr), cell: (r) => money(r.mrr) },
    { id: "ltv", header: "LTV collected", icon: Wallet, width: 120, align: "right", sortValue: (r) => r.ltv,
      cell: (r) => <span>{money(r.ltv)}{r.outstanding > 0 && <span className="ml-1 text-xs text-warning">+{money(r.outstanding, { compact: true })} due</span>}</span> },
    { id: "onboarding", header: "Onboarding", icon: Rocket, width: 150, sortValue: (r) => (r.steps_total ? r.steps_done / r.steps_total : 0),
      cell: (r) => r.steps_total ? <Progress done={r.steps_done} total={r.steps_total} /> : <span className="text-fg-4">—</span> },
    { id: "health", header: "Health", icon: Heart, width: 80, sortValue: (r) => r.health_score ?? 0, cell: (r) => <HealthDot score={r.health_score} /> },
    { id: "manager", header: "Account manager", icon: User, width: 150, sortValue: (r) => r.manager?.full_name ?? "",
      cell: (r) => r.manager ? <span className="inline-flex items-center gap-1.5"><Avatar name={r.manager.full_name} src={r.manager.avatar_url} size={16} />{r.manager.full_name}</span> : <span className="text-fg-4">Unassigned</span> },
    { id: "start", header: "Start date", icon: Calendar, width: 110, sortValue: (r) => r.start_date, cell: (r) => fmtDate(r.start_date) },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-3 md:grid-cols-4">
        <Stat label="Live clients" value={live.length} sub={`${rows.filter((r) => r.status === "onboarding").length} onboarding`} />
        <Stat label="MRR" value={money(mrr)} sub={`${money(mrr * 12, { compact: true })} ARR`} />
        <Stat label="Lifetime collected" value={money(ltv)} sub={live.length ? `${money(ltv / Math.max(rows.length, 1))} avg / client` : undefined} />
        <Stat label="Outstanding" value={money(owed)} sub="open + overdue invoices" />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-0.5">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={cn("h-7 rounded-md px-2 text-[13px] cursor-pointer", filter === f.id ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover hover:text-fg")}>
              {f.label}
              <span className="ml-1 text-xs text-fg-4">{f.id === "all" ? rows.length : rows.filter((r) => r.status === f.id).length}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {managers.length > 0 && (
            <Select value={manager} onChange={(e) => setManager(e.target.value)} className="h-7 w-44">
              <option value="">All account managers</option>
              {managers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-4" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="h-7 w-52 pl-7" />
          </div>
        </div>
      </div>
      <PageBody>
        <DataTable rows={filtered} columns={columns} onRowClick={(r) => router.push(`/clients/${r.id}`)}
          empty={<EmptyState icon={BadgeCheck} title={rows.length ? "No clients match" : "No clients yet"}
            description={rows.length ? "Try a different filter." : "Clients are created automatically when a PandaDoc contract is signed (or a deal is marked won from its billing panel)."} />} />
      </PageBody>
    </>
  );
}
