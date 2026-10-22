"use client";
import { Time } from "@/components/ui/time";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Drawer } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { createClient } from "@/lib/supabase/client";
import { cn, timeAgo } from "@/lib/utils";
import type { Notification } from "@/lib/types";
import { toast } from "sonner";

export function useNotifications(userId: string) {
  const [items, setItems] = useState<Notification[]>([]);
  const load = useCallback(async () => {
    const { data } = await createClient().from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
    setItems((data as Notification[]) ?? []);
  }, [userId]);

  useEffect(() => {
    load();
    const sb = createClient();
    const ch = sb.channel(`notif-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (p) => {
        const n = p.new as Notification;
        setItems((xs) => [n, ...xs]);
        toast(n.title, { description: n.body ?? undefined });
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [userId, load]);

  const markAll = async () => {
    await createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
    load();
  };
  const markOne = async (id: string) => {
    await createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x)));
  };
  return { items, unread: items.filter((i) => !i.read_at).length, markAll, markOne };
}

export function NotificationsPanel({ open, onOpenChange, state }: { open: boolean; onOpenChange: (o: boolean) => void; state: ReturnType<typeof useNotifications> }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Notifications" width={400}
      actions={<Button size="xs" variant="ghost" icon={CheckCheck} onClick={state.markAll}>Mark all read</Button>}>
      {state.items.length === 0 ? (
        <EmptyState icon={Bell} title="You're all caught up" description="New leads, replies, signed contracts and payments will show up here." />
      ) : (
        <ul className="divide-y divide-border-light">
          {state.items.map((n) => {
            const inner = (
              <div className={cn("flex gap-2 px-3 py-2.5 hover:bg-hover", !n.read_at && "bg-accent-soft/40")}>
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{n.title}</div>
                  {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-fg-2">{n.body}</div>}
                  <div className="mt-1 text-xs text-fg-4"><Time value={n.created_at} /></div>
                </div>
              </div>
            );
            return (
              <li key={n.id} onClick={() => { state.markOne(n.id); if (n.link) onOpenChange(false); }}>
                {n.link ? <Link href={n.link}>{inner}</Link> : inner}
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
