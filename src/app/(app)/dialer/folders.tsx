"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FolderPlus, Play } from "lucide-react";
import { Card, Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Time } from "@/components/ui/time";
import { HealthMeter } from "@/components/dialer/health";
import {
  callerIdHealthAction, createFolderAction, folderContactsAction, foldersAction, moveToFolderAction,
} from "@/lib/actions/dialer";
import { cn, fmtPhone, lineLabel } from "@/lib/utils";
import type { Health } from "@/lib/dialer/health";
import type { ContactFolder } from "@/lib/types";

export type FolderRow = ContactFolder & { count: number };
const DOT: Record<string, string> = {
  blue: "bg-[#1961ed]", yellow: "bg-[#d9a400]", sky: "bg-[#0e9ad6]", orange: "bg-[#e5701e]", green: "bg-[#1e8c5a]",
  gray: "bg-[#8d8d8d]", red: "bg-[#d93036]", purple: "bg-[#7b49e8]", pink: "bg-[#c4317f]", turquoise: "bg-[#0f8a78]",
};
export const FolderDot = ({ color }: { color: string }) => <span className={cn("size-2 shrink-0 rounded-full", DOT[color] ?? DOT.gray)} />;

export function useFolders() {
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const reload = useCallback(() => foldersAction().then((r) => r.ok && setFolders(r.data)), []);
  useEffect(() => { reload(); }, [reload]);
  return { folders, reload };
}

/** Folders sidebar for the Power Dialer: where people live before and after they're called. */
export function FoldersCard({ folders, reload, onDial, starting }: { folders: FolderRow[]; reload: () => void; onDial: (contactIds: string[], name: string) => void; starting: boolean }) {
  const [open, setOpen] = useState<FolderRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("purple");

  const create = async () => {
    const r = await createFolderAction(name, color);
    if (!r.ok) return toast.error(r.error);
    setName(""); setCreating(false); reload();
  };

  return (
    <Card title="Folders" padded={false} actions={<Button size="xs" variant="ghost" icon={FolderPlus} onClick={() => setCreating((v) => !v)}>New</Button>}>
      <ul>
        {folders.map((f) => (
          <li key={f.id}>
            <button onClick={() => setOpen(f)} className="flex w-full items-center gap-2 border-b border-border-light px-3 py-2 text-left text-[13px] hover:bg-hover cursor-pointer">
              <FolderDot color={f.color} />
              <span className="flex-1 truncate">{f.name}</span>
              {!f.system_key && <span className="text-[10px] text-fg-4">custom</span>}
              <span className="tabular-nums text-fg-3">{f.count}</span>
            </button>
          </li>
        ))}
      </ul>
      {creating && (
        <div className="flex items-center gap-1.5 p-2">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Folder name" className="h-8" />
          <Select value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-24 text-xs">
            {Object.keys(DOT).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Button size="sm" variant="primary" onClick={create} disabled={!name.trim()}>Add</Button>
        </div>
      )}
      <p className="px-3 py-2 text-[11px] leading-relaxed text-fg-4">Call outcomes file people automatically (No answer/VM → Attempted, Call back later → Call Back, Interested → Interested…). People you move into a custom folder stay there.</p>
      {open && <FolderDialog folder={open} folders={folders} onClose={() => setOpen(null)} onChanged={reload} onDial={(ids) => onDial(ids, `${open.name} folder`)} starting={starting} />}
    </Card>
  );
}

type Person = { id: string; name: string; phone: string | null; company: string | null; status: string; doNotContact: boolean; phoneBad: boolean; movedAt: string | null; health: Health };

function FolderDialog({ folder, folders, onClose, onChanged, onDial, starting }: {
  folder: FolderRow; folders: FolderRow[]; onClose: () => void; onChanged: () => void; onDial: (ids: string[]) => void; starting: boolean;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [minHealth, setMinHealth] = useState(0);
  const [moveTo, setMoveTo] = useState("");

  const load = useCallback(() => folderContactsAction(folder.id).then((r) => { if (r.ok) setPeople(r.data); else toast.error(r.error); }), [folder.id]);
  useEffect(() => { load(); }, [load]);

  const dialable = (p: Person) => !!p.phone && !p.doNotContact && !p.phoneBad;
  const shown = useMemo(() => (people ?? []).filter((p) => {
    const n = q.trim().toLowerCase();
    if (n && ![p.name, p.phone, p.company].some((s) => s?.toLowerCase().includes(n))) return false;
    return !minHealth || (p.health.score ?? 5) >= minHealth;
  }), [people, q, minHealth]);

  const move = async () => {
    if (!moveTo) return;
    const r = await moveToFolderAction([...sel], moveTo);
    if (!r.ok) return toast.error(r.error);
    toast.success(`Moved ${r.data.moved} to ${folders.find((f) => f.id === moveTo)?.name}`);
    setSel(new Set()); setMoveTo(""); load(); onChanged();
  };

  const dialIds = sel.size ? [...sel] : shown.filter(dialable).map((p) => p.id);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={<span className="inline-flex items-center gap-2"><FolderDot color={folder.color} />{folder.name}</span>}
      description={`${people?.length ?? "…"} people${people?.length === 1000 ? " (showing the latest 1,000)" : ""}`}
      footer={<>
        {sel.size > 0 && <>
          <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="h-8 w-48 text-xs">
            <option value="">Move {sel.size} to…</option>
            {folders.filter((f) => f.id !== folder.id).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          <Button onClick={move} disabled={!moveTo}>Move</Button>
        </>}
        <span className="mr-auto" />
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" icon={Play} loading={starting} disabled={!dialIds.length} onClick={() => onDial(dialIds)}>
          {sel.size ? `Dial ${sel.size} selected` : `Dial folder (${dialIds.length})`}
        </Button>
      </>}>
      <div className="mb-2 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or company" />
        <Select value={minHealth} onChange={(e) => setMinHealth(Number(e.target.value))} className="w-44">
          <option value={0}>Any number health</option>
          {[2, 3, 4, 5].map((n) => <option key={n} value={n}>Health {n}+ (and new)</option>)}
        </Select>
      </div>
      {!people ? <div className="flex justify-center py-8"><Spinner /></div> : !shown.length ? <p className="py-6 text-center text-xs text-fg-3">Nobody here yet.</p> : (
        <table className="w-full text-[13px]">
          <thead className="text-left text-xs text-fg-3">
            <tr className="border-b border-border-light">
              <th className="w-8 py-1.5"><Checkbox checked={shown.every((p) => sel.has(p.id))} onChange={(e) => setSel(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())} /></th>
              <th className="py-1.5 font-medium">Name</th><th className="py-1.5 font-medium">Phone</th><th className="py-1.5 font-medium">Health</th><th className="py-1.5 font-medium">Status</th><th className="py-1.5 font-medium">In folder since</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={cn("border-b border-border-light last:border-0", !dialable(p) && "text-fg-4")}>
                <td className="py-1.5"><Checkbox checked={sel.has(p.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} /></td>
                <td className="py-1.5"><Link href={`/contacts/${p.id}`} className="hover:underline">{p.name}</Link>{p.company && <span className="text-fg-3"> · {p.company}</span>}</td>
                <td className="py-1.5 tabular-nums">{fmtPhone(p.phone)}{p.doNotContact && <Tag className="ml-1" color="red">DNC</Tag>}</td>
                <td className="py-1.5"><HealthMeter health={p.health} label /></td>
                <td className="py-1.5 capitalize text-fg-3">{p.status}</td>
                <td className="py-1.5 text-fg-3">{p.movedAt ? <Time value={p.movedAt} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

export type LineHealth = Health & { line: string; dials24h: number; rate7: number | null };

export function useCallerIdHealth() {
  const [rows, setRows] = useState<LineHealth[]>([]);
  useEffect(() => { callerIdHealthAction().then((r) => r.ok && setRows(r.data)); }, []);
  return rows;
}

/** 1–5 health for each of our caller IDs. */
export function CallerIdHealthCard({ rows }: { rows: LineHealth[] }) {
  return (
    <Card title="Caller ID health" padded={false}>
      <ul>
        {rows.map((r) => (
          <li key={r.line} className="flex items-center gap-2 border-b border-border-light px-3 py-2 text-[13px] last:border-0">
            <span className="flex-1 truncate">{lineLabel(r.line)}</span>
            <span className="text-xs text-fg-4 tabular-nums" title="Dials in the last 24 hours">{r.dials24h}/24h</span>
            <HealthMeter health={r} label />
          </li>
        ))}
        {!rows.length && <li className="px-3 py-3 text-xs text-fg-3">Loading…</li>}
      </ul>
      <p className="px-3 py-2 text-[11px] leading-relaxed text-fg-4">Scored from call volume, connect-rate trend and instant hang-ups. Keep each number under ~100 dials a day, and rest numbers that drop to 2 or below.</p>
    </Card>
  );
}
