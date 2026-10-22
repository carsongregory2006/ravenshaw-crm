"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { cn, contactLabel } from "@/lib/utils";

type C = { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null };

export function TestDialog({ open, onOpenChange, onRun, running }: {
  open: boolean; onOpenChange: (o: boolean) => void; onRun: (contactId: string, skipWaits: boolean) => void; running: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<C[]>([]);
  const [picked, setPicked] = useState<C | null>(null);
  const [skipWaits, setSkipWaits] = useState(true);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const sb = createClient();
      let query = sb.from("contacts").select("id, first_name, last_name, email, phone").order("created_at", { ascending: false }).limit(8);
      if (q.trim()) {
        const like = `%${q.trim()}%`;
        query = query.or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`);
      }
      const { data } = await query;
      setResults((data as C[]) ?? []);
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Run workflow on a contact"
      description="Enrolls the contact right now, regardless of the trigger. Real messages are sent — use your own contact record to test."
      footer={<>
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" disabled={!picked} loading={running} onClick={() => picked && onRun(picked.id, skipWaits)}>Run now</Button>
      </>}>
      <div className="space-y-3 pb-1">
        <div className="flex h-8 items-center gap-2 rounded-md border border-border px-2 focus-within:border-accent">
          <Search className="size-3.5 text-fg-3" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts by name, email or phone"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-4" />
        </div>
        <ul className="max-h-60 overflow-y-auto rounded-md border border-border-light">
          {results.map((c) => (
            <li key={c.id}>
              <button onClick={() => setPicked(c)} className={cn("flex w-full items-center gap-2 px-2 py-1.5 text-left cursor-pointer", picked?.id === c.id ? "bg-accent-soft" : "hover:bg-hover")}>
                <Avatar name={contactLabel(c)} size={20} />
                <span className="text-[13px]">{contactLabel(c)}</span>
                <span className="ml-auto truncate text-xs text-fg-3">{c.email ?? c.phone}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="px-2 py-4 text-center text-xs text-fg-3">No contacts found.</li>}
        </ul>
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox checked={skipWaits} onChange={(e) => setSkipWaits(e.target.checked)} />
          Skip wait steps (run the whole sequence immediately)
        </label>
      </div>
    </Dialog>
  );
}
