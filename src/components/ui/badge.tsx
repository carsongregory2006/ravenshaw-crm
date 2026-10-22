import * as React from "react";
import { cn } from "@/lib/utils";

export type TagColor = "gray" | "blue" | "sky" | "purple" | "orange" | "yellow" | "green" | "red" | "pink" | "turquoise";

const colors: Record<TagColor, string> = {
  gray: "bg-[#ebebeb] text-[#666] dark:bg-[#2a2a2a] dark:text-[#b3b3b3]",
  blue: "bg-[#e8efff] text-[#1961ed] dark:bg-[#1a2643] dark:text-[#7aa5ff]",
  sky: "bg-[#e1f6fd] text-[#0e7aa6] dark:bg-[#0f2a35] dark:text-[#5ccbf5]",
  purple: "bg-[#f1ebff] text-[#7b49e8] dark:bg-[#271b40] dark:text-[#b195ff]",
  orange: "bg-[#ffefe2] text-[#d1580b] dark:bg-[#3a2111] dark:text-[#ff9c5c]",
  yellow: "bg-[#fff6d5] text-[#a77b00] dark:bg-[#33290b] dark:text-[#f5c33b]",
  green: "bg-[#e6f6eb] text-[#1e8c5a] dark:bg-[#132d21] dark:text-[#4cc38a]",
  red: "bg-[#feebec] text-[#d93036] dark:bg-[#3b1a1c] dark:text-[#ff6369]",
  pink: "bg-[#fde8f3] text-[#c4317f] dark:bg-[#3a1529] dark:text-[#f57cbd]",
  turquoise: "bg-[#ddf6f2] text-[#0f8a78] dark:bg-[#0f2e29] dark:text-[#3fd6be]",
};

export function Tag({ color = "gray", className, children, dot }: { color?: TagColor | string; className?: string; children: React.ReactNode; dot?: boolean }) {
  const c = colors[(color as TagColor)] ?? colors.gray;
  return (
    <span className={cn("inline-flex items-center gap-1 h-5 px-1.5 rounded-sm text-xs font-medium whitespace-nowrap max-w-full truncate", c, className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_COLORS: Record<string, TagColor> = {
  lead: "blue", prospect: "purple", client: "green", churned: "red", unqualified: "gray",
  onboarding: "sky", active: "green", paused: "yellow",
  draft: "gray", sent: "blue", viewed: "purple", completed: "green", declined: "red", voided: "gray", error: "red",
  paid: "green", overdue: "red", void: "gray",
  pending: "yellow", approved: "blue", clawed_back: "red",
  published: "green", archived: "gray",
  running: "blue", waiting: "yellow", failed: "red", cancelled: "gray",
  queued: "gray", delivered: "green", received: "blue", opened: "purple", clicked: "turquoise", bounced: "red",
  low: "gray", medium: "blue", high: "orange", urgent: "red",
};

export function StatusTag({ status, className }: { status: string; className?: string }) {
  return <Tag color={STATUS_COLORS[status] ?? "gray"} className={className}>{status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Tag>;
}
