"use client";
import * as React from "react";
import { Spinner } from "./misc";

/**
 * Renders children only in the browser. Use for timezone/clock-dependent UIs (e.g. the calendar grid),
 * which would otherwise hydrate with the server's UTC layout.
 */
export function ClientOnly({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return <>{fallback ?? <div className="flex h-full items-center justify-center"><Spinner /></div>}</>;
  return <>{children}</>;
}
