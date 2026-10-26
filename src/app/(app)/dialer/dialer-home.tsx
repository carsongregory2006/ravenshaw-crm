"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, BarChart3, FileUp, ListPlus, Play, RotateCcw, Users, Zap } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Spinner } from "@/components/ui/misc";
import { Checkbox, Field, Input, Select, Switch } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Time } from "@/components/ui/time";
import { createClient } from "@/lib/supabase/client";
import { phoneLinesAction } from "@/lib/actions/comms";
import { archiveListAction, resetListAction, startSessionAction } from "@/lib/actions/dialer";
import { dispositionLabel } from "@/lib/dispositions";
import { cn, contactLabel, fmtPhone, lineLabel } from "@/lib/utils";
import type { LeadList, VoicemailDrop } from "@/lib/types";
import { ContactsListDialog, LeadImportDialog } from "./lead-import";
import { VoicemailManager } from "./voicemails";
import { CallerIdHealthCard, FoldersCard, useCallerIdHealth, useFolders } from "./folders";
import { DialerSettingsPanel } from "./dialer-settings";

type Counts = { total: number; pending: number; waiting: number; called: number; skipped: number };
type ListRow = LeadList & Counts;
const ZERO: Counts = { total: 0, pending: 0, waiting: 0, called: 0, skipped: 0 };

export function DialerHome() {
  const router = useRouter();
  const [lists, setLists] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [voicemails, setVoicemails] = useState<VoicemailDrop[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [defaultLine, setDefaultLine] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [viewList, setViewList] = useState<ListRow | null>(null);
  const { folders, reload: reloadFolders } = useFolders();
  const lineHealth = useCallerIdHealth();
  const healthOf = (l: string) => lineHealth.find((h) => h.line === l)?.score;

  // Session setup
  const [listId, setListId] = useState("");
  const [from, setFrom] = useState<string>("local");
  const [voicemailId, setVoicemailId] = useState("");
  const [onlyPending, setOnlyPending] = useState(true);
  const [threshold, setThreshold] = useState(30);
  const [delay, setDelay] = useState(5);
  const [starting, setStarting] = useState(false);
  const [tab, setTab] = useState<"dialer" | "settings">("dialer");

  const load = useCallback(async () => {
    const sb = createClient();
    const [{ data: ls }, { data: vms }] = await Promise.all([
      sb.from("lead_lists").select("*").is("archived_at", null).order("created_at", { ascending: false }),
      sb.from("voicemail_drops").select("*").order("created_at", { ascending: false }),
    ]);
    const ids = (ls ?? []).map((l) => l.id);
    const counts = new Map<string, Counts>();
    const now = new Date().toISOString();
    if (ids.length) {
      for (let page = 0; page < 30; page++) {
        const { data } = await sb.from("lead_list_items").select("list_id, status, available_at").in("list_id", ids).range(page * 1000, page * 1000 + 999);
        for (const it of data ?? []) {
          const c = counts.get(it.list_id) ?? { ...ZERO };
          c.total++;
          // Recycled leads count as "to call" only once their call-again time has passed.
          if (it.status === "pending" && it.available_at && it.available_at > now) c.waiting++;
          else c[it.status as "pending" | "called" | "skipped"]++;
          counts.set(it.list_id, c);
        }
        if (!data || data.length < 1000) break;
      }
    }
    const rows = (ls ?? []).map((l) => ({ ...(l as LeadList), ...(counts.get(l.id) ?? ZERO) }));
    setLists(rows);
    setVoicemails((vms as VoicemailDrop[]) ?? []);
    setListId((cur) => cur || rows[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    phoneLinesAction().then((r) => { if (r.ok) { setLines(r.data.lines); setDefaultLine(r.data.defaultLine); } });
  }, [load]);

  const start = async (opts: { listId: string | null; contactIds?: string[]; name?: string }) => {
    setStarting(true);
    const r = await startSessionAction({
      listId: opts.listId, contactIds: opts.contactIds ?? null, name: opts.name ?? null, onlyPending: opts.contactIds?.length ? false : onlyPending,
      fromMode: from === "local" ? "local" : "fixed", fromNumber: from === "local" ? defaultLine : from,
      thresholdSec: threshold, advanceDelaySec: delay, voicemailDropId: voicemailId || null,
    });
    setStarting(false);
    if (!r.ok) return toast.error(r.error);
    router.push(`/dialer/session/${r.data.id}`);
  };

  const selected = lists.find((l) => l.id === listId);

  return (
    <Page>
      <PageHeader icon={Zap} title="Power Dialer" actions={<>
        <Link href="/cold-calling"><Button size="sm" variant="ghost" icon={BarChart3}>Dashboard</Button></Link>
        <Button size="sm" icon={ListPlus} onClick={() => setContactsOpen(true)}>List from contacts</Button>
        <Button size="sm" variant="primary" icon={FileUp} onClick={() => setImportOpen(true)}>Import CSV</Button>
      </>}>
        <div className="ml-2 flex items-center gap-0.5">
          {(["dialer", "settings"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("h-6 rounded-md px-2 text-xs cursor-pointer", tab === t ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>
              {t === "dialer" ? "Dialer" : "Settings"}
            </button>
          ))}
        </div>
      </PageHeader>
      <PageBody className="p-4">
        {tab === "settings" ? <DialerSettingsPanel voicemails={voicemails} /> : (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            <Card title="Start a dialing session">
              <div className="space-y-3">
                <Field label="Lead list">
                  <Select value={listId} onChange={(e) => setListId(e.target.value)}>
                    {!lists.length && <option value="">No lists yet</option>}
                    {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.pending} to call)</option>)}
                  </Select>
                </Field>
                <Field label="Call from" hint={from === "local" ? "Uses your number closest to each lead's area code (falls back to your default)." : undefined}>
                  <Select value={from} onChange={(e) => setFrom(e.target.value)}>
                    <option value="local">Local presence (auto-match area code)</option>
                    {lines.map((l) => <option key={l} value={l}>{lineLabel(l)}{l === defaultLine ? " (default)" : ""}{healthOf(l) ? ` · health ${healthOf(l)}/5` : ""}</option>)}
                  </Select>
                </Field>
                <Field label="Voicemail drop" hint="Plays when you press Left VM (key 2) during a call.">
                  <Select value={voicemailId} onChange={(e) => setVoicemailId(e.target.value)}>
                    <option value="">None (just log the outcome)</option>
                    {voicemails.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Conversation ≥ (sec)"><Input type="number" min={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></Field>
                  <Field label="Auto-advance after (sec)"><Input type="number" min={0} max={30} value={delay} onChange={(e) => setDelay(Number(e.target.value))} /></Field>
                </div>
                <label className="flex items-center justify-between text-[13px]">
                  Only leads not called yet
                  <Switch checked={onlyPending} onChange={setOnlyPending} />
                </label>
                <Button variant="primary" icon={Play} className="w-full" loading={starting} disabled={!selected || (onlyPending && !selected.pending)}
                  onClick={() => selected && start({ listId: selected.id })}>
                  Start session{selected ? ` · ${onlyPending ? selected.pending : selected.total} leads` : ""}
                </Button>
              </div>
            </Card>
            <FoldersCard folders={folders} reload={reloadFolders} starting={starting}
              onDial={(ids, name) => start({ listId: null, contactIds: ids, name })} />
            <CallerIdHealthCard rows={lineHealth} />
            <VoicemailManager voicemails={voicemails} onChanged={load} />
          </div>

          <Card title="Lead lists" padded={false}>
            {loading ? <div className="flex justify-center py-10"><Spinner /></div>
              : !lists.length ? <EmptyState icon={Users} title="No lead lists yet" description="Import a CSV of leads or build a list from people already in the CRM."
                  action={<Button variant="primary" icon={FileUp} onClick={() => setImportOpen(true)}>Import CSV</Button>} />
              : (
                <table className="w-full text-[13px]">
                  <thead className="text-left text-xs text-fg-3">
                    <tr className="border-b border-border-light"><th className="px-3 py-2 font-medium">List</th><th className="px-3 py-2 font-medium">Leads</th><th className="px-3 py-2 font-medium">To call</th><th className="px-3 py-2 font-medium">Called</th><th className="px-3 py-2 font-medium">Created</th><th /></tr>
                  </thead>
                  <tbody>
                    {lists.map((l) => (
                      <tr key={l.id} className="border-b border-border-light last:border-0 hover:bg-hover">
                        <td className="px-3 py-2">
                          <button onClick={() => setViewList(l)} className="font-medium hover:underline cursor-pointer">{l.name}</button>
                          <Tag className="ml-2" color={l.source === "csv" ? "blue" : l.source === "quick" ? "gray" : l.source === "recycled" ? "orange" : "purple"}>{l.source === "csv" ? "CSV" : l.source === "quick" ? "Quick" : l.source === "recycled" ? "Recycled" : "Contacts"}</Tag>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{l.total}</td>
                        <td className="px-3 py-2 tabular-nums">{l.pending}{l.waiting ? <span className="text-fg-4"> · {l.waiting} waiting</span> : null}</td>
                        <td className="px-3 py-2 tabular-nums">{l.called}{l.skipped ? <span className="text-fg-4"> · {l.skipped} skipped</span> : null}</td>
                        <td className="px-3 py-2 text-fg-3"><Time value={l.created_at} format="date" /></td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <Button size="xs" variant="ghost" icon={Play} disabled={!l.pending} onClick={() => { setListId(l.id); start({ listId: l.id }); }}>Dial</Button>
                          <Button size="xs" variant="ghost" icon={RotateCcw} title="Put every lead back in the queue"
                            onClick={async () => { const r = await resetListAction(l.id); if (!r.ok) return toast.error(r.error); toast.success("List reset"); load(); }}>Reset</Button>
                          <Button size="xs" variant="ghost" icon={Archive} title="Archive list"
                            onClick={async () => { const r = await archiveListAction(l.id); if (!r.ok) return toast.error(r.error); toast.success("List archived"); load(); }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </Card>
        </div>
        )}
      </PageBody>

      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={(id) => { load(); setListId(id); }} />
      <ContactsListDialog open={contactsOpen} onOpenChange={setContactsOpen} onDone={(id) => { load(); setListId(id); }} />
      {viewList && <ListDialog list={viewList} onClose={() => setViewList(null)} starting={starting}
        onStart={(ids) => start({ listId: viewList.id, contactIds: ids })} />}
    </Page>
  );
}

interface ItemRow { contact_id: string; status: string; last_outcome: string | null; last_called_at: string | null; notes: string | null; added_at: string | null; created_at: string; available_at: string | null; attempts: number; contact: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null; do_not_contact: boolean; phone_bad: boolean } | null }

/** A list's leads; tick some to dial just those. */
function ListDialog({ list, onClose, onStart, starting }: { list: ListRow; onClose: () => void; onStart: (ids: string[]) => void; starting: boolean }) {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  useEffect(() => {
    createClient().from("lead_list_items")
      .select("contact_id, status, last_outcome, last_called_at, notes, added_at, created_at, available_at, attempts, contact:contacts(first_name, last_name, email, phone, do_not_contact, phone_bad)")
      .eq("list_id", list.id).order("position").limit(2000)
      .then(({ data }) => { setItems((data as unknown as ItemRow[]) ?? []); setLoading(false); });
  }, [list.id]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? items.filter((i) => [contactLabel(i.contact ?? {}), i.contact?.phone].some((s) => s?.toLowerCase().includes(n))) : items;
  }, [items, q]);
  const dialable = (i: ItemRow) => !!i.contact?.phone && !i.contact.do_not_contact && !i.contact.phone_bad;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={list.name} description={`${list.total} leads · ${list.pending} to call · ${list.called} called`}
      footer={<>
        <span className="mr-auto self-center text-xs text-fg-3">{sel.size ? `${sel.size} selected` : "Tick leads to dial only those"}</span>
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" icon={Play} loading={starting} disabled={!sel.size} onClick={() => onStart([...sel])}>Dial selected</Button>
      </>}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className="mb-2" />
      {loading ? <div className="flex justify-center py-8"><Spinner /></div> : (
        <table className="w-full text-[13px]">
          <thead className="text-left text-xs text-fg-3">
            <tr className="border-b border-border-light">
              <th className="w-8 py-1.5"><Checkbox checked={shown.length > 0 && shown.filter(dialable).every((i) => sel.has(i.contact_id))}
                onChange={(e) => setSel(e.target.checked ? new Set(shown.filter(dialable).map((i) => i.contact_id)) : new Set())} /></th>
              <th className="py-1.5 font-medium">Name</th><th className="py-1.5 font-medium">Phone</th><th className="py-1.5 font-medium">Status</th><th className="py-1.5 font-medium">Last outcome</th><th className="py-1.5 font-medium">Added</th>
              {list.source === "recycled" && <><th className="py-1.5 font-medium">Call again</th><th className="py-1.5 font-medium">Attempts</th></>}
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.contact_id} className={cn("border-b border-border-light last:border-0", !dialable(i) && "text-fg-4")}>
                <td className="py-1.5"><Checkbox disabled={!dialable(i)} checked={sel.has(i.contact_id)}
                  onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(i.contact_id); else n.delete(i.contact_id); return n; })} /></td>
                <td className="py-1.5"><Link href={`/contacts/${i.contact_id}`} className="hover:underline">{contactLabel(i.contact ?? {}) || "Unnamed"}</Link></td>
                <td className="py-1.5 tabular-nums">{fmtPhone(i.contact?.phone)}{i.contact?.phone_bad && <Tag className="ml-1" color="red">Bad</Tag>}{i.contact?.do_not_contact && <Tag className="ml-1" color="red">DNC</Tag>}</td>
                <td className="py-1.5 capitalize text-fg-3">{i.status}</td>
                <td className="py-1.5">{dispositionLabel(i.last_outcome) ?? <span className="text-fg-4">—</span>}</td>
                <td className="py-1.5 text-fg-3"><Time value={i.added_at ?? i.created_at} format="date" /></td>
                {list.source === "recycled" && <>
                  <td className="py-1.5 text-fg-3">{i.status !== "pending" ? "—" : i.available_at && new Date(i.available_at) > new Date() ? <Time value={i.available_at} format="datetime" /> : "Now"}</td>
                  <td className="py-1.5 tabular-nums text-fg-3">{i.attempts}</td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
