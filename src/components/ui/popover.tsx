"use client";
import * as React from "react";
import * as P from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;
export function PopoverContent({ children, className, align = "start", side }: { children: React.ReactNode; className?: string; align?: "start" | "end" | "center"; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <P.Portal>
      <P.Content align={align} side={side} sideOffset={4} className={cn("z-50 rounded-lg border border-border bg-bg p-2 shadow-lg outline-none", className)}>
        {children}
      </P.Content>
    </P.Portal>
  );
}
