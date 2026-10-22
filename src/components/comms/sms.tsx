"use client";
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, AlertCircle, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { aiDraftSmsAction, sendSmsAction } from "@/lib/actions/comms";
import { cn, feedTime, fmtDateTime } from "@/lib/utils";
import { MergeTagMenu, SaveTemplateButton, TemplatePicker } from "./templates";
import { smsSegments } from "./hooks";
import type { Message } from "@/lib/types";

export function SmsComposer({ contactId, disabledReason, onSent, autoFocus }: { contactId: string; disabledReason?: string | null; onSent?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { len, segments, encoding } = smsSegments(text);

  const insert = (tag: string) => {
    const el = ref.current;
    if (!el) return setText((t) => t + tag);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + tag + text.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); });
  };

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const r = await sendSmsAction(contactId, text);
    setSending(false);
    if (!r.ok) return toast.error(r.error);
    setText("");
    onSent?.();
  };

  const draft = async () => {
    setDrafting(true);
    const r = await aiDraftSmsAction({ contactId, text });
    setDrafting(false);
    if (!r.ok) return toast.error(r.error);
    setText(r.data.text);
  };

  if (disabledReason) {
    return <div className="flex items-center gap-2 border-t border-border-light bg-bg-2 px-3 py-2.5 text-xs text-fg-3"><AlertCircle className="size-3.5" />{disabledReason}</div>;
  }

  return (
    <div className="border-t border-border-light p-2">
      <Textarea
        ref={ref}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        placeholder="Text message… (Enter to send, Shift+Enter for new line)"
        className="min-h-16 border-transparent bg-bg-2 focus:bg-bg"
      />
      <div className="mt-1.5 flex items-center gap-0.5">
        <TemplatePicker channel="sms" onPick={(t) => setText(t.body)} />
        <MergeTagMenu onInsert={insert} />
        <Button size="xs" variant="ghost" icon={Sparkles} loading={drafting} onClick={draft}>{text.trim() ? "Improve" : "AI draft"}</Button>
        <SaveTemplateButton channel="sms" body={text} />
        <span className={cn("ml-auto mr-2 text-xs tabular-nums", segments > 2 ? "text-warning" : "text-fg-4")} title={`${encoding} encoding`}>
          {len} chars · {segments} segment{segments === 1 ? "" : "s"}
        </span>
        <Button size="sm" variant="primary" icon={Send} loading={sending} disabled={!text.trim()} onClick={send}>Send</Button>
      </div>
    </div>
  );
}

function StatusIcon({ m }: { m: Message }) {
  if (m.status === "failed") return <Tooltip content={m.error ?? "Failed"}><AlertCircle className="size-3 text-danger" /></Tooltip>;
  if (m.status === "delivered") return <CheckCheck className="size-3" />;
  if (m.status === "sent") return <Check className="size-3" />;
  return null;
}

export function SmsBubble({ m }: { m: Message }) {
  const out = m.direction === "outbound";
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className="max-w-[78%]">
        <div className={cn(
          "whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[13px] leading-snug",
          out ? "rounded-br-sm bg-accent text-accent-fg" : "rounded-bl-sm bg-bg-3 text-fg",
          m.status === "failed" && "bg-danger-soft text-danger",
        )}>
          {m.body}
        </div>
        <div className={cn("mt-0.5 flex items-center gap-1 text-[11px] text-fg-4", out && "justify-end")} title={fmtDateTime(m.created_at)}>
          {m.automation_run_id && <span className="rounded-sm bg-bg-3 px-1">Automation</span>}
          {feedTime(m.created_at)}
          {out && <StatusIcon m={m} />}
          {m.status === "failed" && <span className="text-danger">Failed</span>}
        </div>
      </div>
    </div>
  );
}

/** Scrolls to bottom when new messages arrive. */
export function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}
