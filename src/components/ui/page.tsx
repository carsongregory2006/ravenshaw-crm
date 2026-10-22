import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Top bar of every page (Twenty: 44px, icon + title, actions right). */
export function PageHeader({ icon: Icon, title, actions, children, className }: { icon?: LucideIcon; title: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("flex h-11 shrink-0 items-center gap-2 border-b border-border px-3", className)}>
      {Icon && <Icon className="size-4 text-fg-3" />}
      <h1 className="truncate text-[13px] font-medium text-fg">{title}</h1>
      {children}
      <div className="ml-auto flex items-center gap-1.5">{actions}</div>
    </header>
  );
}

/** Full-height page container inside the app shell. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex h-full min-h-0 flex-col", className)}>{children}</div>;
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-auto", className)}>{children}</div>;
}
