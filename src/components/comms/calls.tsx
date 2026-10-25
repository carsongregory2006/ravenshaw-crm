"use client";
import { Time } from "@/components/ui/time";
import Link from "next/link";
import { useState } from "react";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Sparkles, Pencil, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { StatusTag, Tag } from "@/components/ui/badge";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { summarizeCallAction, updateCallAction } from "@/lib/actions/comms";
import { fmtDateTime, fmtPhone, cn, lineLabel } from "@/lib/utils";
import { DISPOSITIONS, dispositionLabel } from "@/lib/dispositions";
import type { Call } from "@/lib/types";

export { DISPOSITIONS } from "@/lib/dispositions";

export function fmtDuration(sec?: number | null) {
  if (!sec) return "0:00";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function CallEditDialog({ call, open, onOpenChange, onSaved }: { call: Call; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [disposition, setDisposition] = useState(call.disposition ?? "");
  const [notes, setNotes] = useState(call.notes ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const r = await updateCallAction(call.id, { disposition: disposition || null, notes: notes || null });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Call updated");
    onOpenChange(false);
    onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Call outcome" size="sm"
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Disposition">
          <Select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
            <option value="">—</option>
            {DISPOSITIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </Select>
        </Field>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was discussed, objections, next steps…" /></Field>
      </div>
    </Dialog>
  );
}

export function CallRow({ call, onChanged, contact }: { call: Call; onChanged: () => void; contact?: { id: string; name: string } | null }) {
  const [editing, setEditing] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const missed = call.status === "missed";
  const Icon = missed ? PhoneMissed : call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  const summarize = async () => {
    setSummarizing(true);
    const r = await summarizeCallAction(call.id);
    setSummarizing(false);
    if (!r.ok) return toast.error(r.error);
    onChanged();
  };
  const disp = dispositionLabel(call.disposition);
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <span className={cn("flex size-7 items-center justify-center rounded-full", missed ? "bg-danger-soft text-danger" : "bg-bg-3 text-fg-2")}><Icon className="size-3.5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            {contact ? <Link href={`/contacts/${contact.id}`} className="hover:underline">{contact.name}</Link> : <>{call.direction === "inbound" ? "Inbound" : "Outbound"} call</>}
            <StatusTag status={call.status} />
            {disp && <Tag color={call.disposition === "bad_number" ? "red" : "purple"}>{disp}</Tag>}
          </div>
          <div className="text-xs text-fg-3">
            <Time value={call.started_at} format="datetime" /> · {fmtDuration(call.duration_sec)} · {fmtPhone(call.direction === "inbound" ? call.from_number : call.to_number)}
            {(call.direction === "inbound" ? call.to_number : call.from_number) && <> · {call.direction === "inbound" ? "on" : "from"} {lineLabel(call.direction === "inbound" ? call.to_number : call.from_number)}</>}
          </div>
        </div>
        <Button size="xs" variant="ghost" icon={Pencil} onClick={() => setEditing(true)}>Outcome</Button>
        <Button size="xs" variant="ghost" icon={Sparkles} loading={summarizing} onClick={summarize} title="Summarize notes/transcript with AI">Summarize</Button>
      </div>
      {call.recording_url && <audio controls preload="none" src={call.recording_url} className="mt-2 h-8 w-full" />}
      {call.notes && <p className="mt-2 whitespace-pre-wrap text-[13px] text-fg-2">{call.notes}</p>}
      {call.ai_summary && (
        <div className="mt-2 rounded-md bg-accent-soft/50 p-2 text-[13px]">
          <div className="mb-1 flex items-center gap-1 text-xs font-medium text-accent"><Sparkles className="size-3" /> AI summary</div>
          <div className="whitespace-pre-wrap text-fg-2">{call.ai_summary}</div>
        </div>
      )}
      <CallEditDialog call={call} open={editing} onOpenChange={setEditing} onSaved={onChanged} />
    </div>
  );
}

export function CallList({ calls, loading, onChanged, onCall, callDisabled }: { calls: Call[]; loading: boolean; onChanged: () => void; onCall?: () => void; callDisabled?: string | null }) {
  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;
  return (
    <div className="space-y-2 p-3">
      {onCall && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-fg-3">{calls.length} call{calls.length === 1 ? "" : "s"}</span>
          <Button size="sm" variant="primary" icon={Phone} onClick={onCall} disabled={!!callDisabled} title={callDisabled ?? undefined}>Call</Button>
        </div>
      )}
      {calls.length === 0
        ? <EmptyState icon={Phone} title="No calls yet" description="Calls made from the dialer and inbound calls appear here with recordings and AI summaries." />
        : calls.map((c) => <CallRow key={c.id} call={c} onChanged={onChanged} />)}
    </div>
  );
}
