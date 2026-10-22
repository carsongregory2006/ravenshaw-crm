"use client";
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "./input";

export interface Column<T> {
  id: string;
  header: string;
  icon?: LucideIcon;
  width?: number;
  cell: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  className?: string;
}

/**
 * Twenty-style table: sticky header, grid borders, row hover, checkbox selection, client-side sort.
 */
export function DataTable<T extends { id: string }>({
  rows, columns, onRowClick, selectable, selected, onSelectedChange, empty, className, footer, rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  empty?: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [sort, setSort] = React.useState<{ id: string; dir: 1 | -1 } | null>(null);
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a), bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);

  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected?.has(r.id));
  const toggleAll = () => onSelectedChange?.(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectedChange?.(next);
  };

  return (
    <div className={cn("min-w-0 overflow-auto", className)}>
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-10 bg-bg">
          <tr>
            {selectable && (
              <th className="w-8 border-b border-border px-2 text-left">
                <Checkbox checked={!!allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
            )}
            {columns.map((c) => (
              <th
                key={c.id}
                style={{ width: c.width, minWidth: c.width }}
                onClick={() => c.sortValue && setSort((s) => (s?.id === c.id ? (s.dir === 1 ? { id: c.id, dir: -1 } : null) : { id: c.id, dir: 1 }))}
                className={cn(
                  "h-8 whitespace-nowrap border-b border-r border-border-light border-b-border px-2 font-normal text-fg-3 last:border-r-0",
                  c.align === "right" ? "text-right" : "text-left",
                  c.sortValue && "cursor-pointer hover:bg-hover",
                )}
              >
                <span className={cn("inline-flex items-center gap-1.5", c.align === "right" && "flex-row-reverse")}>
                  {c.icon && <c.icon className="size-4" />}
                  {c.header}
                  {sort?.id === c.id && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.id}
              onClick={() => onRowClick?.(r)}
              className={cn("group", onRowClick && "cursor-pointer", selected?.has(r.id) ? "bg-accent-soft/60" : "hover:bg-hover", rowClassName?.(r))}
            >
              {selectable && (
                <td className="h-8 border-b border-border-light px-2" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={!!selected?.has(r.id)} onChange={() => toggle(r.id)} aria-label="Select row" />
                </td>
              )}
              {columns.map((c) => (
                <td
                  key={c.id}
                  className={cn(
                    "h-8 max-w-[320px] truncate border-b border-r border-border-light px-2 text-fg last:border-r-0",
                    c.align === "right" && "text-right tabular-nums",
                    c.className,
                  )}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && empty}
      {footer}
    </div>
  );
}
