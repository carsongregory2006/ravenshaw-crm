"use client";
import * as React from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CalendarCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, Spinner } from "@/components/ui/misc";
import { Field, Input, Switch } from "@/components/ui/input";
import {
  addDailyItemAction, loadDailyAction, removeDailyItemAction, saveDailyRemindersAction, toggleDailyAction, updateDailyItemAction,
} from "@/lib/actions/workspace";
import { cn } from "@/lib/utils";

type Data = Extract<Awaited<ReturnType<typeof loadDailyAction>>, { ok: true }>["data"];

export function DailyView() {
  const [data, setData] = React.useState<Data | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [newItem, setNewItem] = React.useState("");
  const [renaming, setRenaming] = React.useState<{ id: string; title: string } | null>(null);
  const [email, setEmail] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);

  const load = React.useCallback(async () => {
    const r = await loadDailyAction();
    if (!r.ok) return toast.error(r.error);
    setData(r.data);
    setEmail(r.data.reminders.email ?? "");
    setEnabled(r.data.reminders.enabled);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  // The list resets at midnight: reload when the tab comes back into focus.
  React.useEffect(() => {
    const f = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [load]);

  if (!data) return <Page><PageHeader icon={CalendarCheck} title="Daily inputs" /><PageBody><div className="flex justify-center py-16"><Spinner /></div></PageBody></Page>;

  const toggle = async (id: string, done: boolean) => {
    setData((d) => d && { ...d, done: d.done + (done ? 1 : -1), items: d.items.map((i) => (i.id === id ? { ...i, done } : i)) });
    const r = await toggleDailyAction(id, done);
    if (!r.ok) { toast.error(r.error); load(); }
    else if (done && data.done + 1 === data.total) toast.success("All daily inputs done 🎉");
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await addDailyItemAction(newItem);
    if (!r.ok) return toast.error(r.error);
    setNewItem("");
    load();
  };
  const move = async (idx: number, dir: -1 | 1) => {
    const a = data.items[idx], b = data.items[idx + dir];
    if (!a || !b) return;
    await Promise.all([updateDailyItemAction(a.id, { position: idx + dir }), updateDailyItemAction(b.id, { position: idx })]);
    load();
  };
  const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;
  const streak = (() => {
    let n = 0;
    const days = [...data.history].reverse();
    for (const [i, h] of days.entries()) {
      const full = h.total > 0 && h.done >= h.total;
      if (full) n++;
      else if (i === 0) continue; // today not finished yet doesn't break the streak
      else break;
    }
    return n;
  })();
  const dayLabel = new Date(`${data.day}T12:00:00`).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });

  return (
    <Page>
      <PageHeader icon={CalendarCheck} title="Daily inputs" actions={
        <Button size="sm" variant={editing ? "primary" : "ghost"} icon={Pencil} onClick={() => setEditing((v) => !v)}>{editing ? "Done editing" : "Edit list"}</Button>
      } />
      <PageBody>
        <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-[1fr_280px]">
          <Card title={<span>{dayLabel}</span>} actions={<span className="text-xs text-fg-3 tabular-nums">{data.done}/{data.total} done</span>}>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-bg-2"><div className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} /></div>
            {!data.items.length && <p className="py-6 text-center text-[13px] text-fg-3">No daily inputs yet. Add the things you need to do every day below.</p>}
            <ul className="space-y-1">
              {data.items.map((i, idx) => (
                <li key={i.id} className={cn("group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover", i.done && "text-fg-3")}>
                  <input type="checkbox" checked={i.done} onChange={(e) => toggle(i.id, e.target.checked)} disabled={editing}
                    className="size-5 shrink-0 cursor-pointer accent-[var(--accent)]" aria-label={i.title} />
                  {renaming?.id === i.id ? (
                    <form className="flex flex-1 gap-1" onSubmit={async (e) => { e.preventDefault(); const r = await updateDailyItemAction(i.id, { title: renaming.title }); if (!r.ok) return toast.error(r.error); setRenaming(null); load(); }}>
                      <Input autoFocus value={renaming.title} onChange={(e) => setRenaming({ id: i.id, title: e.target.value })} className="h-7" />
                      <Button size="sm" type="submit">Save</Button>
                    </form>
                  ) : (
                    <span className={cn("flex-1 text-[14px]", i.done && "line-through")} onClick={() => !editing && toggle(i.id, !i.done)}>{i.title}</span>
                  )}
                  {editing && renaming?.id !== i.id && (
                    <span className="flex shrink-0 items-center">
                      <Button size="xs" variant="ghost" icon={ArrowUp} aria-label="Move up" disabled={idx === 0} onClick={() => move(idx, -1)} />
                      <Button size="xs" variant="ghost" icon={ArrowDown} aria-label="Move down" disabled={idx === data.items.length - 1} onClick={() => move(idx, 1)} />
                      <Button size="xs" variant="ghost" icon={Pencil} aria-label="Rename" onClick={() => setRenaming({ id: i.id, title: i.title })} />
                      <Button size="xs" variant="ghost" icon={Trash2} aria-label="Remove" onClick={async () => { const r = await removeDailyItemAction(i.id); if (!r.ok) return toast.error(r.error); load(); }} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {(editing || !data.items.length) && (
              <form onSubmit={add} className="mt-3 flex gap-2">
                <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="e.g. 100 cold calls, Post on LinkedIn, 1h building" />
                <Button type="submit" icon={Plus} disabled={!newItem.trim()}>Add</Button>
              </form>
            )}
            <p className="mt-3 text-xs text-fg-4">Resets every day at midnight (Montreal time).</p>
          </Card>

          <div className="space-y-4">
            <Card title="Last 14 days" actions={<span className="text-xs text-fg-3">{streak} day streak</span>}>
              <div className="grid grid-cols-7 gap-1.5">
                {data.history.map((h) => {
                  const r = h.total ? h.done / h.total : 0;
                  return <div key={h.day} title={`${h.day}: ${h.done}/${h.total}`}
                    className={cn("aspect-square rounded-sm", !h.total || r === 0 ? "bg-bg-2" : r >= 1 ? "bg-success" : r >= 0.5 ? "bg-accent/60" : "bg-accent/25")} />;
                })}
              </div>
            </Card>
            <Card title="Email reminders">
              <div className="space-y-2">
                <label className="flex items-center justify-between text-[13px]">Remind me at 5 PM and 8 PM if not done <Switch checked={enabled} onChange={setEnabled} /></label>
                <Field label="Email to" hint={!email ? "Leave empty to use your login email." : undefined}>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </Field>
                <Button size="sm" className="w-full" onClick={async () => {
                  const r = await saveDailyRemindersAction({ enabled, email });
                  if (!r.ok) return toast.error(r.error);
                  toast.success(enabled ? `Reminders on${email ? ` → ${email}` : ""}` : "Reminders off");
                  load();
                }}>Save</Button>
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
