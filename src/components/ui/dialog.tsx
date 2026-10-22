"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({
  open, onOpenChange, title, description, children, footer, className, size = "md",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] data-[state=open]:animate-in" />
        <D.Content
          className={cn("fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg border border-border bg-bg shadow-lg max-h-[76vh] flex flex-col", w, className)}
        >
          <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-2">
            <div>
              <D.Title className="text-sm font-semibold text-fg">{title}</D.Title>
              {description && <D.Description className="mt-0.5 text-xs text-fg-3">{description}</D.Description>}
            </div>
            <D.Close className="rounded-sm p-1 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close"><X className="size-4" /></D.Close>
          </div>
          <div className="px-4 py-2 overflow-y-auto">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border-light px-4 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Right-side drawer (Twenty "record side panel"). */
export function Drawer({ open, onOpenChange, title, children, width = 480, actions }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; children: React.ReactNode; width?: number; actions?: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/10" />
        <D.Content style={{ width }} className="fixed right-2 top-2 bottom-2 z-50 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-bg shadow-lg flex flex-col">
          <div className="flex h-11 items-center justify-between border-b border-border-light px-3">
            <D.Title className="text-[13px] font-medium truncate">{title}</D.Title>
            <div className="flex items-center gap-1">
              {actions}
              <D.Close className="rounded-sm p-1 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close"><X className="size-4" /></D.Close>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
