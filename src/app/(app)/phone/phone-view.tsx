"use client";
import { useCallback, useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { CallStage, StatusLine } from "@/components/comms/dialer";
import { CallRow } from "@/components/comms/calls";
import { createClient } from "@/lib/supabase/client";
import { contactLabel } from "@/lib/utils";
import type { Call, Contact } from "@/lib/types";

type Row = Call & { contact: Pick<Contact, "id" | "first_name" | "last_name" | "email" | "phone"> | null };

export function PhoneView() {
  const [calls, setCalls] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await createClient().from("calls")
      .select("*, contact:contacts(id, first_name, last_name, email, phone)")
      .order("started_at", { ascending: false }).limit(100);
    setCalls((data as unknown as Row[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const sb = createClient();
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = sb.channel(`phone-calls-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => { clearTimeout(t); t = setTimeout(load, 400); })
      .subscribe();
    return () => { clearTimeout(t); sb.removeChannel(ch); };
  }, [load]);

  return (
    <Page>
      <PageHeader icon={Phone} title="Phone" actions={<StatusLine />} />
      <div className="flex min-h-0 flex-1">
        <div className="w-[340px] shrink-0 overflow-y-auto border-r border-border">
          <CallStage large />
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="px-3 pt-3 text-xs font-medium text-fg-3">Call history</div>
          {loading ? <div className="flex justify-center py-10"><Spinner /></div>
            : calls.length === 0 ? <EmptyState icon={Phone} title="No calls yet" description="Calls you make or receive show up here." />
            : (
              <div className="space-y-2 p-3">
                {calls.map((c) => (
                  <CallRow key={c.id} call={c} onChanged={load} contact={c.contact ? { id: c.contact.id, name: contactLabel(c.contact) } : null} />
                ))}
              </div>
            )}
        </div>
      </div>
    </Page>
  );
}
