"use client";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, Plus, Target, User } from "lucide-react";
import * as D from "@radix-ui/react-dialog";
import { createClient } from "@/lib/supabase/client";
import { NAV, SETTINGS_ITEM } from "./nav";
import { contactLabel } from "@/lib/utils";

type Hit = { id: string; label: string; sub?: string; href: string; kind: "person" | "company" | "deal" };

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(async () => {
      const sb = createClient();
      const like = `%${q.trim()}%`;
      const [c, co, d] = await Promise.all([
        sb.from("contacts").select("id, first_name, last_name, email, phone").or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`).limit(6),
        sb.from("companies").select("id, name, domain").or(`name.ilike.${like},domain.ilike.${like}`).limit(4),
        sb.from("deals").select("id, name, deal_number").or(`name.ilike.${like},deal_number.ilike.${like}`).limit(4),
      ]);
      setHits([
        ...(c.data ?? []).map((r) => ({ id: r.id, label: contactLabel(r), sub: r.email ?? r.phone ?? "", href: `/contacts/${r.id}`, kind: "person" as const })),
        ...(co.data ?? []).map((r) => ({ id: r.id, label: r.name, sub: r.domain ?? "", href: `/companies/${r.id}`, kind: "company" as const })),
        ...(d.data ?? []).map((r) => ({ id: r.id, label: r.name, sub: r.deal_number, href: `/deals/${r.id}`, kind: "deal" as const })),
      ]);
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const go = (href: string) => { onOpenChange(false); setQ(""); router.push(href); };
  const icon = { person: User, company: Building2, deal: Target };
  const item = "flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-fg data-[selected=true]:bg-hover";

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <D.Content className="fixed left-1/2 top-[15vh] z-50 w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-bg shadow-lg">
          <D.Title className="sr-only">Search</D.Title>
          <Command shouldFilter={false} label="Command menu">
            <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Search people, companies, deals… or jump to a page"
              className="h-11 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-fg-4" />
            <Command.List className="max-h-[50vh] overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-3">No results</Command.Empty>
              {hits.length > 0 && (
                <Command.Group heading="Records" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                  {hits.map((h) => {
                    const I = icon[h.kind];
                    return (
                      <Command.Item key={h.kind + h.id} value={h.kind + h.id} onSelect={() => go(h.href)} className={item}>
                        <I className="size-4 text-fg-3" /> {h.label} <span className="ml-auto truncate text-xs text-fg-3">{h.sub}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}
              <Command.Group heading="Create" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                {[
                  { label: "New person", href: "/contacts?new=1" },
                  { label: "New company", href: "/companies?new=1" },
                  { label: "New deal", href: "/deals?new=1" },
                  { label: "New task", href: "/tasks?new=1" },
                  { label: "New event", href: "/calendar?new=1" },
                ].filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase())).map((a) => (
                  <Command.Item key={a.href} value={a.label} onSelect={() => go(a.href)} className={item}>
                    <Plus className="size-4 text-fg-3" /> {a.label}
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-3">
                {[...NAV.flatMap((s) => s.items), SETTINGS_ITEM]
                  .filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()))
                  .map((i) => (
                    <Command.Item key={i.href} value={i.href} onSelect={() => go(i.href)} className={item}>
                      <i.icon className="size-4 text-fg-3" /> {i.label}
                    </Command.Item>
                  ))}
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
