"use client";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { cn, money } from "@/lib/utils";

/** Marketing page header: optional 7/30/90-day range and actions. Section tabs come from the shell (HubTabs). */
export function MarketingHeader({ days, actions, title }: { active?: string; days?: number; actions?: React.ReactNode; title?: React.ReactNode }) {
  return (
    <PageHeader icon={Megaphone} title={title ?? "Marketing"} actions={<>
      {days !== undefined && (
        <div className="flex items-center rounded-md border border-border p-0.5">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`?days=${d}`} className={cn("h-6 rounded px-2 text-xs leading-6", d === days ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>{d} days</Link>
          ))}
        </div>
      )}
      {actions}
    </>} />
  );
}

export const fmtMoney = (v: number | null) => (v == null ? "—" : money(v, { cents: v < 100 }));
export const fmtInt = (v: number) => v.toLocaleString("en-CA");
export const fmtPct = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(1)}%` : "—");
