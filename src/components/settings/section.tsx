import * as React from "react";
import { cn } from "@/lib/utils";

/** Twenty-style settings block: title + description, then content. */
export function Section({ title, description, children, actions, className }: { title: string; description?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mb-10", className)}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-fg-3">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-[13px] text-fg-3">{description}</p>}
    </div>
  );
}

export const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage",
  "Pacific/Honolulu", "America/Toronto", "America/Vancouver", "America/Mexico_City", "America/Sao_Paulo", "Europe/London",
  "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Amsterdam", "Africa/Johannesburg", "Asia/Dubai",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Manila", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland", "UTC",
];
