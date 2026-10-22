"use client";
import * as React from "react";

/** "Good morning/afternoon/evening" in the viewer's local time. */
export function Greeting({ name }: { name?: string | null }) {
  const [part, setPart] = React.useState<string | null>(null);
  React.useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? "morning" : h < 18 ? "afternoon" : "evening");
  }, []);
  if (!part) return null;
  return <>Good {part}{name ? `, ${name}` : ""}</>;
}
