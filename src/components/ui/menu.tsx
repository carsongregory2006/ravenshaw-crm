"use client";
import * as React from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = "start", className, width = 200 }: { children: React.ReactNode; align?: "start" | "end" | "center"; className?: string; width?: number }) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={4} style={{ minWidth: width }} className={cn("z-50 rounded-lg border border-border bg-bg p-1 shadow-lg", className)}>
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ icon: Icon, children, onSelect, danger, shortcut, disabled }: { icon?: LucideIcon; children: React.ReactNode; onSelect?: () => void; danger?: boolean; shortcut?: string; disabled?: boolean }) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-50",
        danger ? "text-danger" : "text-fg",
      )}
    >
      {Icon && <Icon className={cn("size-4", danger ? "text-danger" : "text-fg-3")} />}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="text-xs text-fg-4">{shortcut}</span>}
    </DM.Item>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border-light" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <DM.Label className="px-2 py-1 text-xs text-fg-3">{children}</DM.Label>;
}
