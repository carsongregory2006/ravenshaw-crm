"use client";
import * as React from "react";
import { feedTime, fmtDate, fmtDateTime, timeAgo } from "@/lib/utils";

const FORMATS = { ago: timeAgo, feed: feedTime, date: fmtDate, datetime: fmtDateTime } as const;

/**
 * Renders a timestamp in the viewer's timezone. Server HTML (UTC, and "now" at render time) is replaced
 * after hydration, avoiding hydration mismatches and wrong-timezone times.
 */
export function Time({ value, format = "ago", className, title = true }: { value?: string | Date | null; format?: keyof typeof FORMATS; className?: string; title?: boolean }) {
  const [, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
    if (format !== "ago" && format !== "feed") return;
    const t = setInterval(() => setMounted((m) => !m), 60_000); // keep relative times fresh
    return () => clearInterval(t);
  }, [format]);
  if (!value) return <span className={className}>—</span>;
  return (
    <time suppressHydrationWarning dateTime={new Date(value).toISOString()} title={title ? fmtDateTime(value) : undefined} className={className}>
      {FORMATS[format](value)}
    </time>
  );
}
