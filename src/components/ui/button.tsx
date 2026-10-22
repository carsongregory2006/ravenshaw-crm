"use client";
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "tertiary";
type Size = "xs" | "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent",
  secondary: "bg-bg text-fg border border-border hover:bg-hover shadow-sm",
  tertiary: "bg-bg-3 text-fg-2 border border-transparent hover:bg-active hover:text-fg",
  ghost: "bg-transparent text-fg-2 border border-transparent hover:bg-hover hover:text-fg",
  danger: "bg-danger text-white border border-transparent hover:opacity-90",
};
const sizes: Record<Size, string> = {
  xs: "h-6 px-1.5 gap-1 text-xs rounded-sm",
  sm: "h-7 px-2 gap-1.5 text-[13px] rounded-md",
  md: "h-8 px-3 gap-1.5 text-[13px] rounded-md",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", icon: Icon, iconRight: IconRight, loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant], sizes[size], !children && (size === "xs" ? "w-6 px-0" : size === "sm" ? "w-7 px-0" : "w-8 px-0"), className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      {children}
      {IconRight && <IconRight className="size-3.5 shrink-0" />}
    </button>
  );
});
