"use client";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { cn, money } from "@/lib/utils";

const TABS = [
  { href: "/marketing", label: "Campaigns", key: "campaigns" },
  { href: "/marketing/past", label: "Past campaigns", key: "past" },
  { href: "/marketing/winners", label: "Winners", key: "winners" },
  { href: "/marketing/landers", label: "Landers & forms", key: "landers" },
] as const;

/** Marketing page header: section tabs, optional 7/30/90-day range, actions. The range is kept in ?days when switching tabs. */
export function MarketingHeader({ active, days, actions, title }: { active: (typeof TABS)[number]["key"]; days?: number; actions?: React.ReactNode; title?: React.ReactNode }) {
  const q = days ? `?days=${days}` : "";
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
    </>}>
      <div className="ml-2 flex items-center gap-0.5">
        {TABS.map((t) => (
          <Link key={t.key} href={`${t.href}${q}`} className={cn("h-6 rounded-md px-2 text-xs leading-6", active === t.key ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>{t.label}</Link>
        ))}
      </div>
    </PageHeader>
  );
}

export const fmtMoney = (v: number | null) => (v == null ? "—" : money(v, { cents: v < 100 }));
export const fmtInt = (v: number) => v.toLocaleString("en-CA");
export const fmtPct = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(1)}%` : "—");
