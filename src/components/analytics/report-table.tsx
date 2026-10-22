"use client";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/misc";
import { CsvButton } from "./csv";
import { fmt, type Fmt } from "./viz";

export interface ReportCol { key: string; header: string; f?: Fmt; width?: number }

/** Serializable-column report table (usable from server components) with sorting + CSV export. */
export function ReportTable({ rows, cols, filename, title, emptyText = "No data for this period" }: {
  rows: Record<string, unknown>[]; cols: ReportCol[]; filename: string; title?: string; emptyText?: string;
}) {
  const withId = rows.map((r, i) => ({ ...r, id: String(r.id ?? r.key ?? i) }) as Record<string, unknown> & { id: string });
  const columns: Column<(typeof withId)[number]>[] = cols.map((c) => ({
    id: c.key,
    header: c.header,
    width: c.width,
    align: c.f && c.f !== "text" ? "right" : "left",
    sortValue: (r) => (r[c.key] as number | string | null) ?? null,
    cell: (r) => fmt(r[c.key], c.f ?? "text"),
  }));
  const csvRows = rows.map((r) => Object.fromEntries(cols.map((c) => [c.header, r[c.key] ?? ""])));
  return (
    <div>
      <div className="flex h-9 items-center justify-between px-1">
        <span className="text-[13px] font-medium">{title}</span>
        <CsvButton filename={filename} rows={csvRows} />
      </div>
      <div className="rounded-md border border-border">
        <DataTable rows={withId} columns={columns} empty={<EmptyState title={emptyText} className="py-8" />} />
      </div>
    </div>
  );
}
