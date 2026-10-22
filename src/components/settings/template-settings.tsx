"use client";
import { Time } from "@/components/ui/time";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText, Mail, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Tag } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { deleteTemplate, saveTemplate } from "@/lib/actions/settings";
import { renderTemplate, timeAgo } from "@/lib/utils";
import type { Channel, Template } from "@/lib/types";
import { PageTitle, Section } from "./section";

export const MERGE_TAGS = ["first_name", "last_name", "full_name", "email", "phone", "company", "rep_name", "rep_email", "agency_name", "booking_link"];
const SAMPLE = {
  first_name: "Jordan", last_name: "Lee", full_name: "Jordan Lee", email: "jordan@acme.co", phone: "+15555550123",
  company: "Acme Co", rep_name: "Alex Rivera", rep_email: "alex@ravenshaw.ai", agency_name: "Ravenshaw AI", booking_link: "https://calendly.com/ravenshaw/strategy",
};

type Draft = { id?: string; channel: Channel; name: string; subject: string; body: string };

export function TemplateSettings({ templates }: { templates: Template[] }) {
  const [channel, setChannel] = useState<Channel>("email");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, start] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const list = templates.filter((t) => t.channel === channel);

  const insertTag = (tag: string) => {
    if (!draft) return;
    const el = bodyRef.current;
    const token = `{{${tag}}}`;
    if (!el) return setDraft({ ...draft, body: draft.body + token });
    const s = el.selectionStart ?? draft.body.length, e = el.selectionEnd ?? s;
    const body = draft.body.slice(0, s) + token + draft.body.slice(e);
    setDraft({ ...draft, body });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };

  const save = () => start(async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.body.trim()) return void toast.error("Name and body are required");
    const r = await saveTemplate({ ...draft, name: draft.name.trim() });
    if (r.ok) { toast.success("Template saved"); setDraft(null); } else toast.error(r.error);
  });
  const remove = (t: Template) => start(async () => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    const r = await deleteTemplate(t.id);
    if (r.ok) toast.success("Template deleted"); else toast.error(r.error);
  });

  const preview = useMemo(() => draft ? { subject: renderTemplate(draft.subject, SAMPLE), body: renderTemplate(draft.body, SAMPLE) } : null, [draft]);
  const segments = draft?.channel === "sms" ? Math.max(1, Math.ceil((preview?.body.length ?? 0) / 160)) : 0;

  return (
    <>
      <PageTitle title="Templates" description="Reusable SMS and email copy for one-off sends and automations." />
      <Section title="Library" actions={<Button variant="primary" icon={Plus} onClick={() => setDraft({ channel, name: "", subject: "", body: "" })}>New {channel === "sms" ? "SMS" : "email"} template</Button>}>
        <div className="overflow-hidden rounded-lg border border-border">
          <Tabs value={channel} onChange={(v) => setChannel(v as Channel)} tabs={[
            { id: "email", label: "Email", icon: Mail, count: templates.filter((t) => t.channel === "email").length },
            { id: "sms", label: "SMS", icon: MessageSquare, count: templates.filter((t) => t.channel === "sms").length },
          ]} />
          {list.length === 0 ? (
            <EmptyState icon={FileText} title={`No ${channel === "sms" ? "SMS" : "email"} templates yet`} description="Templates support merge tags like {{first_name}}." />
          ) : (
            <ul className="divide-y divide-border-light">
              {list.map((t) => (
                <li key={t.id} className="group flex items-start gap-3 px-3 py-2.5 hover:bg-hover">
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setDraft({ id: t.id, channel: t.channel, name: t.name, subject: t.subject ?? "", body: t.body })}>
                    <div className="text-[13px] font-medium">{t.name}</div>
                    {t.subject && <div className="truncate text-xs text-fg-2">{t.subject}</div>}
                    <div className="line-clamp-2 text-xs text-fg-3">{t.body}</div>
                  </div>
                  <span className="shrink-0 text-xs text-fg-4"><Time value={t.created_at} /></span>
                  <Button size="xs" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setDraft({ id: t.id, channel: t.channel, name: t.name, subject: t.subject ?? "", body: t.body })} />
                  <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => remove(t)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)} size="xl" title={draft?.id ? "Edit template" : `New ${draft?.channel === "sms" ? "SMS" : "email"} template`}
        footer={<><Button onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save template</Button></>}>
        {draft && (
          <div className="grid grid-cols-2 gap-4 pb-2">
            <div className="space-y-3">
              <Field label="Name"><Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Speed-to-lead intro" /></Field>
              {draft.channel === "email" && <Field label="Subject"><Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>}
              <Field label="Body"><Textarea ref={bodyRef} rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
              <div>
                <div className="mb-1 text-xs text-fg-3">Insert merge tag</div>
                <div className="flex flex-wrap gap-1">
                  {MERGE_TAGS.map((t) => <button key={t} type="button" onClick={() => insertTag(t)} className="cursor-pointer rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] text-fg-2 hover:border-accent hover:text-accent">{`{{${t}}}`}</button>)}
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-fg-3">
                Preview (sample contact)
                {draft.channel === "sms" && <Tag color={segments > 2 ? "orange" : "gray"}>{preview?.body.length} chars · {segments} segment{segments > 1 ? "s" : ""}</Tag>}
              </div>
              {draft.channel === "sms" ? (
                <div className="rounded-lg border border-border bg-bg-2 p-4">
                  <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-[13px] text-white">{preview?.body || "…"}</div>
                </div>
              ) : (
                <div className="rounded-lg border border-border">
                  <div className="border-b border-border-light px-3 py-2 text-[13px]"><span className="text-fg-3">Subject: </span>{preview?.subject || "—"}</div>
                  <div className="whitespace-pre-wrap px-3 py-3 text-[13px] leading-relaxed">{preview?.body || "…"}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
