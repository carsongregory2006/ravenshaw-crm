"use client";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState icon={AlertTriangle} title="Something went wrong" description={error.message}
      action={<Button variant="secondary" onClick={reset}>Try again</Button>} className="h-full" />
  );
}
