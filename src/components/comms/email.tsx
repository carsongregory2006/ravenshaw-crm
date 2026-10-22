"use client";
import { Time } from "@/components/ui/time";
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Mail, ChevronDown, ChevronRight, Reply, AlertCircle, Eye, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { StatusTag } from "@/components/ui/badge";
import { aiDraftEmailAction, sendEmailAction } from "@/lib/actions/comms";
import { cn, feedTime, fmtDateTime } from "@/lib/utils";
import { MergeTagMenu, SaveTemplateButton, TemplatePicker } from "./templates";
import type { Message } from "@/lib/types";

export function EmailComposer({ contactId, to, initialSubject = "", onSent, onSettled, onCancel, compact }: {
  contactId: string; to: string; initialSubject?: string; onSent?: () => void; onSettled?: () => void; onCancel?: () => void; compact?: boolean;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setSubject(initialSubject), [initialSubject]);

  const insert = (tag: string) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    setBody(body.slice(0, start) + tag + body.slice(el?.selectionEnd ?? start));
  };

  const send = async () => {
    setSending(true);
    const r = await sendEmailAction(contactId, subject, body);
    setSending(false);
    onSettled?.();
    if (!r.ok) return toast.error(r.error);
    toast.success("Email sent");
    setBody("");
    if (!initialSubject) setSubject("");
    onSent?.();
  };

  const draft = async () => {
    setDrafting(true);
    const r = await aiDraftEmailAction({ contactId, subject, body, instruction });
    setDrafting(false);
    if (!r.ok) return toast.error(r.error);
    if (r.data.subject && !subject.trim()) setSubject(r.data.subject);
    else if (r.data.subject && !body.trim()) setSubject(r.data.subject);
    setBody(r.data.body ?? "");
  };

  return (
    <div className={cn("space-y-2", compact && "border-t border-border-light p-2")}>
      {!compact && (
        <div className="flex items-center gap-2 text-[13px]">
          <span className="w-14 text-fg-3">To</span>
          <span className="truncate text-fg">{to}</span>
        </div>
      )}
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
      <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your email… merge tags like {{first_name}} are filled in on send."
        className={compact ? "min-h-24" : "min-h-48"} />
      <div className="flex items-center gap-1">
        <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="AI instructions (optional), e.g. “recap our call, propose Tuesday”" className="h-7 flex-1 text-xs" />
        <Button size="sm" variant="tertiary" icon={Sparkles} loading={drafting} onClick={draft}>{body.trim() ? "Improve" : "AI draft"}</Button>
      </div>
      <div className="flex items-center gap-0.5">
        <TemplatePicker channel="email" onPick={(t) => { setSubject(t.subject ?? subject); setBody(t.body); }} />
        <MergeTagMenu onInsert={insert} />
        <SaveTemplateButton channel="email" subject={subject} body={body} />
        <div className="ml-auto flex gap-1.5">
          {onCancel && <Button size="sm" onClick={onCancel}>Cancel</Button>}
          <Button size="sm" variant="primary" icon={Send} loading={sending} disabled={!subject.trim() || !body.trim()} onClick={send}>Send email</Button>
        </div>
      </div>
    </div>
  );
}

export function EmailComposerDialog({ open, onOpenChange, contactId, to, initialSubject, onSettled }: { open: boolean; onOpenChange: (o: boolean) => void; contactId: string; to: string; initialSubject?: string; onSettled?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New email" size="lg">
      <div className="pb-2">
        <EmailComposer contactId={contactId} to={to} initialSubject={initialSubject} onSettled={onSettled} onSent={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
      </div>
    </Dialog>
  );
}

const EMAIL_STATUS_ICON: Record<string, typeof Eye> = { opened: Eye, clicked: MousePointerClick, bounced: AlertCircle, failed: AlertCircle };

/** One email in a thread — collapsed shows a preview line; click to expand. */
export function EmailItem({ m, onReply, defaultOpen }: { m: Message; onReply?: (m: Message) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const out = m.direction === "outbound";
  const Icon = EMAIL_STATUS_ICON[m.status];
  return (
    <div className={cn("rounded-lg border border-border bg-bg", !out && "border-l-2 border-l-accent")}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-hover rounded-lg">
        {open ? <ChevronDown className="size-3.5 text-fg-3" /> : <ChevronRight className="size-3.5 text-fg-3" />}
        <Mail className="size-3.5 text-fg-3" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{m.subject || "(no subject)"}</span>
            {out && <StatusTag status={m.status} />}
            {Icon && <Icon className={cn("size-3", m.status === "bounced" || m.status === "failed" ? "text-danger" : "text-fg-3")} />}
            {m.automation_run_id && <span className="rounded-sm bg-bg-3 px-1 text-[11px] text-fg-3">Automation</span>}
          </div>
          {!open && <div className="truncate text-xs text-fg-3">{out ? "You" : m.from_addr}: {m.body}</div>}
        </div>
        <span className="shrink-0 text-xs text-fg-4"><Time value={m.created_at} format="feed" /></span>
      </button>
      {open && (
        <div className="border-t border-border-light px-3 py-2">
          <div className="mb-2 text-xs text-fg-3">
            <div>From: {m.from_addr}</div>
            <div>To: {m.to_addr}</div>
            <div><Time value={m.created_at} format="datetime" /></div>
            {m.error && <div className="text-danger">Error: {m.error}</div>}
          </div>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.body}</div>
          {onReply && (
            <div className="mt-2"><Button size="xs" icon={Reply} onClick={() => onReply(m)}>Reply</Button></div>
          )}
        </div>
      )}
    </div>
  );
}

export const replySubject = (s?: string | null) => (s ? (/^re:/i.test(s) ? s : `Re: ${s}`) : "");
