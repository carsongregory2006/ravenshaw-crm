"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-md border border-border bg-bg px-2 text-[13px] text-fg placeholder:text-fg-4 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(base, "h-8", className)} {...p} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(base, "py-1.5 min-h-20 resize-y leading-relaxed", className)} {...p} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(base, "h-8 pr-7 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23999%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_8px_center]", className)} {...p}>
      {children}
    </select>
  );
});

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-xs font-medium text-fg-2 mb-1", className)} {...p} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-fg-3">{hint}</p>}
    </div>
  );
}

export function Checkbox({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={cn("size-3.5 rounded-sm accent-[var(--accent)] cursor-pointer", className)} {...p} />;
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-border-strong")}
    >
      <span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow transition-transform", checked ? "translate-x-3.5" : "translate-x-0.5")} />
    </button>
  );
}
