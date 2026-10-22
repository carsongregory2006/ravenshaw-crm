"use client";
import { cn } from "@/lib/utils";
import { CsvButton } from "./csv";
import { fmt } from "./viz";

export interface PnlColumn { label: string; values: Record<string, number | null>; emphasis?: boolean }
export interface PnlLine { key: string; label: string; kind?: "money" | "pct"; bold?: boolean; indent?: boolean; negative?: boolean; separator?: boolean }

/** P&L statement: lines down, periods across. Costs are shown as positive numbers in parentheses. */
export function PnlTable({ lines, columns, filename }: { lines: PnlLine[]; columns: PnlColumn[]; filename: string }) {
  const csv = lines.map((l) => Object.fromEntries([["Line", l.label], ...columns.map((c) => [c.label, c.values[l.key] ?? ""])]));
  return (
    <div>
      <div className="flex justify-end pb-1"><CsvButton filename={filename} rows={csv} /></div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 bg-bg">
            <tr>
              <th className="sticky left-0 z-10 h-8 min-w-[180px] border-b border-border bg-bg px-3 text-left font-normal text-fg-3">Line item</th>
              {columns.map((c) => (
                <th key={c.label} className={cn("h-8 whitespace-nowrap border-b border-border px-3 text-right font-normal text-fg-3", c.emphasis && "bg-bg-2 font-medium text-fg")}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className={cn("hover:bg-hover", l.separator && "[&>td]:border-t [&>td]:border-border")}>
                <td className={cn("sticky left-0 h-8 bg-bg px-3 whitespace-nowrap", l.indent && "pl-7 text-fg-2", l.bold && "font-semibold", l.kind === "pct" && "text-xs text-fg-3")}>{l.label}</td>
                {columns.map((c) => {
                  const v = c.values[l.key];
                  const text = l.kind === "pct" ? fmt(v, "pct") : v == null ? "—" : l.negative ? (v === 0 ? "—" : `(${fmt(Math.abs(v), "money")})`) : fmt(v, "money");
                  return (
                    <td key={c.label} className={cn("h-8 px-3 text-right tabular-nums whitespace-nowrap", c.emphasis && "bg-bg-2", l.bold && "font-semibold",
                      l.kind === "pct" && "text-xs text-fg-3", !l.negative && l.kind !== "pct" && v != null && v < 0 && "text-danger")}>{text}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
