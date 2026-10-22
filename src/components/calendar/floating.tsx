"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A card positioned next to an anchor rect (Google-style event popovers).
 * Prefers the right side of the anchor, flips left, clamps to viewport. Closes on outside click / Esc.
 */
export function Floating({ anchor, onClose, children, width = 448, className }: {
  anchor: DOMRect | null; onClose: () => void; children: React.ReactNode; width?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(width, vw - 16);
    let left: number, top: number;
    if (!anchor) {
      left = (vw - w) / 2;
      top = Math.max(16, (vh - h) / 3);
    } else {
      left = anchor.right + 8;
      if (left + w > vw - 8) left = anchor.left - w - 8;
      if (left < 8) left = Math.min(Math.max(8, anchor.left), vw - w - 8);
      top = anchor.top;
      if (top + h > vh - 8) top = vh - h - 8;
      top = Math.max(8, top);
    }
    setPos({ left, top });
  }, [anchor, width, children]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      // ignore clicks inside radix portals (menus/selects opened from the card)
      if (t.closest("[data-radix-popper-content-wrapper],[role=dialog],[role=menu]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    const id = setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(id); window.removeEventListener("pointerdown", onDown); };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      style={{ width: Math.min(width, typeof window !== "undefined" ? window.innerWidth - 16 : width), left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className={cn("fixed z-50 rounded-lg border border-border bg-bg shadow-lg", className)}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}
