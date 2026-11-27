"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { matchPage, visiblePages } from "./nav";
import type { UserRole } from "@/lib/types";

/** Tabs across the top of the page for the sidebar button's sub-pages (only when it has more than one). */
export function HubTabs({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const m = matchPage(pathname);
  if (!m) return null;
  const pages = visiblePages(m.hub, role);
  if (pages.length < 2) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-light px-3 pt-2">
      <span className="mr-2 flex items-center gap-1.5 pb-2 text-[13px] font-semibold"><m.hub.icon className="size-4 text-accent" />{m.hub.label}</span>
      {pages.map((p) => {
        const active = p.href === m.page.href;
        return (
          <Link key={p.href} href={p.href}
            className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 pb-2 text-[13px]", active ? "border-accent font-medium text-fg" : "border-transparent text-fg-3 hover:text-fg")}>
            <p.icon className="size-3.5" />{p.label}
          </Link>
        );
      })}
    </div>
  );
}
