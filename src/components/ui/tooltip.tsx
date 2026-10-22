"use client";
import * as React from "react";
import * as T from "@radix-ui/react-tooltip";

export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Provider delayDuration={300}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content side={side} sideOffset={4} className="z-50 rounded-md bg-[#333] px-2 py-1 text-xs text-white shadow-md dark:bg-[#ebebeb] dark:text-[#171717]">
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
