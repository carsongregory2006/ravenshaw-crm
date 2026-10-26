"use client";
import { Time } from "@/components/ui/time";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import {
  User, Mail, Phone, Briefcase, Building2, CircleDot, UserCheck, Globe, Tag as TagIcon, Gauge, Megaphone, Ban, MessageSquareOff,
  MailX, CalendarPlus, Clock, PhoneCall, MessageSquare, CalendarCheck, Target, Trash2, Sparkles, RefreshCw, Wand2, Copy, Send,
  History, MessagesSquare, CheckSquare, Plus, X, BadgeCheck, MoreHorizontal, Link2, ChevronDown, ChevronUp, FileText,
} from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { FieldRow, EmptyState, SectionTitle } from "@/components/ui/misc";
import { Switch, Input, Select, Textarea, Field } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InlineText, InlineSelect, TagEditor, CONTACT_STATUSES, STATUS_COLORS } from "@/components/records/inline-fields";
import { CompanyPicker, UserPicker } from "@/components/records/pickers";
import { Timeline, type TimelineActivity } from "@/components/records/timeline";
import { TasksList } from "@/components/records/tasks-list";
import { NewDealDialog, ConfirmDialog } from "@/components/records/dialogs";
import { ContactComms } from "@/components/comms/contact-comms";
import { useDialer } from "@/components/comms/dialer";
import { Folder as FolderIcon } from "lucide-react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { ContactFolder } from "@/lib/types";
import { useIsStaff } from "@/components/shell/profile-context";
import { updateContact, deleteContacts, type ContactInput } from "@/lib/actions/crm";
import { generateContactInsights, draftFollowUp, sendDraft } from "@/lib/ai-insights";
import { cn, contactLabel, fmtDate, fmtDateTime, fmtPhone, money, timeAgo } from "@/lib/utils";
import type { Contact, ContactStatus, PipelineStage } from "@/lib/types";

export interface ContactRecordData {
  contact: Contact & { company: { id: string; name: string; domain: string | null } | null };
  deals: { id: string; deal_number: string; name: string; amount_one_time: number; amount_recurring: number; stage_id: string; owner_id: string | null; created_at: string; closed_at: string | null }[];
  activities: TimelineActivity[];
  stages: PipelineStage[];
  calendlyUrl: string | null;
  client: { id: string; status: string; mrr: number } | null;
  landingPage: { id: string; name: string; slug: string } | null;
  tagSuggestions: string[];
}

export function ContactRecord({ data, currentUserId, initialTab }: { data: ContactRecordData; currentUserId: string; initialTab?: string }) {
  const router = useRouter();
  const staff = useIsStaff();
  const { call } = useDialer();
  const { contact: c, deals, stages } = data;
  const name = contactLabel(c);
  const [tab, setTab] = React.useState(initialTab ?? "timeline");
  const [commsFocus, setCommsFocus] = React.useState<{ channel: "sms" | "email" | "calls"; n: number } | undefined>();
  const openComms = (channel: "sms" | "email") => { setCommsFocus((f) => ({ channel, n: (f?.n ?? 0) + 1 })); setTab("comms"); };
  const [dealOpen, setDealOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [draftOpen, setDraftOpen] = React.useState(false);

  const save = async (patch: ContactInput) => {
    const r = await updateContact(c.id, patch);
    if (!r.ok) { toast.error(r.error); return; }
    router.refresh();
  };

  const bookingLink = React.useMemo(() => {
    if (!data.calendlyUrl) return null;
    try {
      const u = new URL(data.calendlyUrl);
      if (name && name !== "Unnamed") u.searchParams.set("name", name);
      if (c.email) u.searchParams.set("email", c.email);
      if (c.phone) u.searchParams.set("a1", c.phone);
      u.searchParams.set("utm_content", c.id);
      return u.toString();
    } catch { return data.calendlyUrl; }
  }, [data.calendlyUrl, name, c.email, c.phone, c.id]);

  const stageOf = (id: string) => stages.find((s) => s.id === id);

  return (
    <Page>
      <PageHeader icon={User} title={<span className="flex items-center gap-1.5"><Link href="/contacts" className="text-fg-3 hover:text-fg">People</Link><span className="text-fg-4">/</span>{name}</span>}
        actions={
          <Menu>
            <MenuTrigger asChild><Button size="sm" variant="ghost" icon={MoreHorizontal} aria-label="More" /></MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={Copy} onSelect={() => { navigator.clipboard.writeText(window.location.href); toast.success("Link copied"); }}>Copy link</MenuItem>
              {data.client && <MenuItem icon={BadgeCheck} onSelect={() => router.push(`/clients/${data.client!.id}`)}>Open client account</MenuItem>}
              <MenuItem icon={Trash2} danger onSelect={() => setConfirmDelete(true)}>Delete person</MenuItem>
            </MenuContent>
          </Menu>
        } />

      <div className="flex min-h-0 flex-1">
        {/* ── Left: identity + fields ── */}
        <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-border">
          <div className="flex flex-col items-center gap-2 border-b border-border-light px-4 pb-4 pt-6 text-center">
            <Avatar name={name} size={56} />
            <div className="text-base font-semibold">{name}</div>
            <div className="text-xs text-fg-3">
              {[c.title, c.company?.name].filter(Boolean).join(" at ") || "No title"} · Added <Time value={c.created_at} />
            </div>
            <div className="flex flex-wrap justify-center gap-1">
              <Tag color={STATUS_COLORS[c.status]}>{CONTACT_STATUSES.find((s) => s.value === c.status)?.label}</Tag>
              {data.client && <Link href={`/clients/${data.client.id}`}><Tag color="green"><BadgeCheck className="size-3" />Client · {money(data.client.mrr)}/mo</Tag></Link>}
              {c.do_not_contact && <Tag color="red">Do not contact</Tag>}
            </div>
            <div className="mt-2 grid w-full grid-cols-5 gap-1">
              <QuickAction icon={PhoneCall} label="Call" onClick={() => c.phone ? call({ phone: c.phone, contactId: c.id, name }) : toast.error("Add a phone number first")} />
              <QuickAction icon={MessageSquare} label="Text" onClick={() => c.phone ? openComms("sms") : toast.error("Add a phone number first")} />
              <QuickAction icon={Mail} label="Email" onClick={() => c.email ? openComms("email") : toast.error("Add an email first")} />
              <BookAction link={bookingLink} contactId={c.id} canText={!!c.phone} canEmail={!!c.email} />
              <QuickAction icon={Target} label="Deal" onClick={() => setDealOpen(true)} />
            </div>
          </div>

          <div className="space-y-0.5 px-4 py-3">
            <FieldRow icon={User} label="First name"><InlineText value={c.first_name} onSave={(v) => save({ first_name: v })} /></FieldRow>
            <FieldRow icon={User} label="Last name"><InlineText value={c.last_name} onSave={(v) => save({ last_name: v })} /></FieldRow>
            <FieldRow icon={Mail} label="Email"><InlineText type="email" value={c.email} onSave={(v) => save({ email: v })}
              display={c.email ? <span className="truncate text-accent">{c.email}</span> : undefined} /></FieldRow>
            <FieldRow icon={Phone} label="Phone">
              <div className="flex min-w-0 items-center gap-1">
                <InlineText type="tel" value={c.phone} onSave={(v) => save({ phone: v })} display={c.phone ? <span className={cn(c.phone_bad && "text-fg-3 line-through")}>{fmtPhone(c.phone)}</span> : undefined} />
                {c.phone_bad && (
                  <button onClick={() => save({ phone_bad: false, phone_bad_at: null })} title="Flagged from a call outcome. Click to clear (editing the number also clears it)." className="shrink-0 cursor-pointer">
                    <Tag color="red">Bad number ×</Tag>
                  </button>
                )}
              </div>
            </FieldRow>
            <FieldRow icon={FolderIcon} label="Folder"><FolderField value={c.folder_id} onSave={(id) => save({ folder_id: id, folder_updated_at: new Date().toISOString() })} /></FieldRow>
            <FieldRow icon={Briefcase} label="Job title"><InlineText value={c.title} onSave={(v) => save({ title: v })} /></FieldRow>
            <FieldRow icon={Building2} label="Company">
              <div className="flex items-center gap-1">
                <CompanyPicker value={c.company_id} valueLabel={c.company?.name} onChange={(id) => save({ company_id: id })} className="h-7 border-transparent hover:border-border" />
                {c.company && <Link href={`/companies/${c.company.id}`} className="rounded-sm p-1 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Open company"><Link2 className="size-3.5" /></Link>}
              </div>
            </FieldRow>
            <FieldRow icon={CircleDot} label="Status"><InlineSelect value={c.status} options={CONTACT_STATUSES} colors={STATUS_COLORS} onSave={(v) => save({ status: v as ContactStatus })} /></FieldRow>
            <FieldRow icon={UserCheck} label="Owner"><UserPicker value={c.owner_id} onChange={(id) => save({ owner_id: id })} disabled={!staff} className="h-7 border-transparent hover:border-border" /></FieldRow>
            <FieldRow icon={Globe} label="Source"><InlineText value={c.source} onSave={(v) => save({ source: v })} /></FieldRow>
            <FieldRow icon={Gauge} label="Lead score"><InlineText type="number" value={c.lead_score} onSave={(v) => save({ lead_score: Number(v) || 0 })} /></FieldRow>
            <FieldRow icon={TagIcon} label="Tags"><TagEditor tags={c.tags ?? []} suggestions={data.tagSuggestions} onSave={(tags) => save({ tags })} /></FieldRow>
            {data.landingPage && (
              <FieldRow icon={FileText} label="Landing page"><Link href={`/landing-pages/${data.landingPage.id}`} className="text-accent hover:underline">{data.landingPage.name}</Link></FieldRow>
            )}
            <FieldRow icon={Clock} label="Last contacted">{c.last_contacted_at ? <Time value={c.last_contacted_at} format="datetime" /> : <span className="text-fg-4">Never</span>}</FieldRow>
            <FieldRow icon={CalendarPlus} label="Created"><Time value={c.created_at} format="datetime" /></FieldRow>
          </div>

          <div className="border-t border-border-light px-4 py-3">
            <SectionTitle>Attribution</SectionTitle>
            {(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const).map((k) => (
              <FieldRow key={k} icon={Megaphone} label={k.replace("utm_", "UTM ")}><InlineText value={c[k]} onSave={(v) => save({ [k]: v || null })} /></FieldRow>
            ))}
          </div>

          <div className="border-t border-border-light px-4 py-3">
            <SectionTitle>Consent</SectionTitle>
            <ToggleRow icon={Ban} label="Do not contact" checked={c.do_not_contact} onChange={(v) => save({ do_not_contact: v })} />
            <ToggleRow icon={MessageSquareOff} label="SMS opt-out" checked={c.sms_opt_out} onChange={(v) => save({ sms_opt_out: v })} />
            <ToggleRow icon={MailX} label="Email opt-out" checked={c.email_opt_out} onChange={(v) => save({ email_opt_out: v })} />
          </div>

          <CustomFields fields={c.custom_fields ?? {}} onSave={(custom_fields) => save({ custom_fields })} />
        </aside>

        {/* ── Right: AI + tabs ── */}
        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <AiOverview contactId={c.id} summary={c.ai_summary} at={c.ai_summary_at} onDraft={() => setDraftOpen(true)} onExpand={() => setTab("ai")} />
          <Tabs value={tab} onChange={setTab} className="sticky top-0 z-10 bg-bg" tabs={[
            { id: "timeline", label: "Timeline", icon: History },
            { id: "comms", label: "Communications", icon: MessagesSquare },
            { id: "deals", label: "Deals", icon: Target, count: deals.length },
            { id: "tasks", label: "Tasks", icon: CheckSquare },
            { id: "ai", label: "AI", icon: Sparkles },
          ]} />
          <div className="flex-1">
            {tab === "timeline" && <Timeline activities={data.activities} target={{ contact_id: c.id }} currentUserId={currentUserId} />}
            {tab === "comms" && <ContactComms contact={c} focus={commsFocus} />}
            {tab === "deals" && (
              <div className="p-4">
                <div className="mb-3 flex justify-end"><Button size="sm" icon={Plus} onClick={() => setDealOpen(true)}>New deal</Button></div>
                {deals.length === 0 ? <EmptyState icon={Target} title="No deals yet" description="Create a deal to send a contract and invoice in one click." /> : (
                  <ul className="divide-y divide-border-light rounded-lg border border-border">
                    {deals.map((d) => {
                      const s = stageOf(d.stage_id);
                      return (
                        <li key={d.id}>
                          <Link href={`/deals/${d.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover">
                            <span className="font-mono text-xs text-fg-3">{d.deal_number}</span>
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.name}</span>
                            <span className="text-xs tabular-nums text-fg-2">{money(d.amount_one_time)} + {money(d.amount_recurring)}/mo</span>
                            {s && <Tag color={s.color}>{s.name}</Tag>}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            {tab === "tasks" && <div className="p-4"><TasksList filter={{ contact_id: c.id }} compact /></div>}
            {tab === "ai" && <AiFull contactId={c.id} summary={c.ai_summary} at={c.ai_summary_at} onDraft={() => setDraftOpen(true)} />}
          </div>
        </section>
      </div>

      <NewDealDialog open={dealOpen} onOpenChange={setDealOpen} stages={stages}
        defaults={{ contact_id: c.id, contact_label: name, company_id: c.company_id, name: c.company?.name ? `${c.company.name} — AI build` : `${name} — AI build` }} />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${name}?`}
        description="Messages, calls, notes and tasks for this person will be deleted too."
        onConfirm={async () => { const r = await deleteContacts([c.id]); if (!r.ok) { toast.error(r.error); return; } toast.success("Deleted"); router.push("/contacts"); }} />
      <DraftDialog open={draftOpen} onOpenChange={setDraftOpen} contactId={c.id} canSms={!!c.phone} canEmail={!!c.email} />
    </Page>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: typeof Phone; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 rounded-md border border-border py-2 text-xs text-fg-2 hover:bg-hover hover:text-fg cursor-pointer">
      <Icon className="size-4" />{label}
    </button>
  );
}

function BookAction({ link, contactId, canText, canEmail }: { link: string | null; contactId: string; canText: boolean; canEmail: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  if (!link) {
    return <QuickAction icon={CalendarCheck} label="Book" onClick={() => toast.error("No Calendly link set", { action: { label: "Settings", onClick: () => router.push("/settings") } })} />;
  }
  const send = async (channel: "sms" | "email") => {
    setBusy(true);
    const r = await sendDraft(contactId, channel, `Here's a link to grab a time with me: ${link}`, "Let's find a time to talk");
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`Booking link sent by ${channel === "sms" ? "text" : "email"}`);
    router.refresh();
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex flex-col items-center gap-1 rounded-md border border-border py-2 text-xs text-fg-2 hover:bg-hover hover:text-fg cursor-pointer">
          <CalendarCheck className="size-4" />Book
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1">
        <p className="px-2 py-1 text-xs text-fg-3">Prefilled Calendly link for this person</p>
        <button onClick={() => { navigator.clipboard.writeText(link); toast.success("Booking link copied"); }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover cursor-pointer"><Copy className="size-4 text-fg-3" />Copy link</button>
        <button disabled={!canText || busy} onClick={() => send("sms")} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover disabled:opacity-50 cursor-pointer"><MessageSquare className="size-4 text-fg-3" />Text link</button>
        <button disabled={!canEmail || busy} onClick={() => send("email")} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover disabled:opacity-50 cursor-pointer"><Mail className="size-4 text-fg-3" />Email link</button>
        <a href={link} target="_blank" rel="noreferrer" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover"><CalendarPlus className="size-4 text-fg-3" />Book on their behalf</a>
      </PopoverContent>
    </Popover>
  );
}

function ToggleRow({ icon: Icon, label, checked, onChange }: { icon: typeof Ban; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex h-8 items-center gap-2 text-[13px]">
      <Icon className="size-4 text-fg-3" /><span className="flex-1 text-fg-2">{label}</span>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function CustomFields({ fields, onSave }: { fields: Record<string, unknown>; onSave: (f: Record<string, unknown>) => void }) {
  const [adding, setAdding] = React.useState(false);
  const [k, setK] = React.useState("");
  const [v, setV] = React.useState("");
  const entries = Object.entries(fields);
  return (
    <div className="border-t border-border-light px-4 py-3">
      <SectionTitle actions={<Button size="xs" variant="ghost" icon={Plus} onClick={() => setAdding(true)}>Add</Button>}>Custom fields</SectionTitle>
      {entries.length === 0 && !adding && <p className="text-xs text-fg-4">No custom fields. Add things like budget, niche, or current tools.</p>}
      {entries.map(([key, val]) => (
        <div key={key} className="group flex items-center">
          <FieldRow label={key}><InlineText value={val == null ? "" : String(val)} onSave={(nv) => onSave({ ...fields, [key]: nv })} /></FieldRow>
          <button aria-label={`Remove ${key}`} onClick={() => { const n = { ...fields }; delete n[key]; onSave(n); }} className="invisible rounded-sm p-1 text-fg-4 hover:text-danger group-hover:visible cursor-pointer"><X className="size-3.5" /></button>
        </div>
      ))}
      {adding && (
        <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (!k.trim()) return; onSave({ ...fields, [k.trim()]: v }); setK(""); setV(""); setAdding(false); }}>
          <Input autoFocus placeholder="Field" value={k} onChange={(e) => setK(e.target.value)} className="h-7" />
          <Input placeholder="Value" value={v} onChange={(e) => setV(e.target.value)} className="h-7" />
          <Button size="sm" variant="primary" type="submit">Add</Button>
        </form>
      )}
    </div>
  );
}

function useGenerate(contactId: string) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    const r = await generateContactInsights(contactId);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("AI overview updated");
    router.refresh();
  };
  return { busy, run };
}

function AiOverview({ contactId, summary, at, onDraft, onExpand }: { contactId: string; summary: string | null; at: string | null; onDraft: () => void; onExpand: () => void }) {
  const { busy, run } = useGenerate(contactId);
  const [open, setOpen] = React.useState(true);
  const first = summary?.split("\n\n")[0];
  return (
    <div className="border-b border-border bg-gradient-to-b from-accent-soft/50 to-transparent px-4 py-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-accent" />
        <span className="text-[13px] font-medium">AI Overview</span>
        {at && <span className="text-xs text-fg-3">· <Time value={at} /></span>}
        <div className="ml-auto flex gap-1">
          <Button size="xs" variant="ghost" icon={Wand2} onClick={onDraft}>Draft follow-up</Button>
          <Button size="xs" variant="ghost" icon={RefreshCw} loading={busy} onClick={run}>{summary ? "Refresh" : "Generate"}</Button>
          {summary && <Button size="xs" variant="ghost" icon={open ? ChevronUp : ChevronDown} onClick={() => setOpen(!open)} aria-label="Toggle" />}
        </div>
      </div>
      {open && (summary ? (
        <div className="mt-1.5 text-[13px] leading-relaxed text-fg-2">
          <ReactMarkdown>{first ?? ""}</ReactMarkdown>
          <button onClick={onExpand} className="mt-1 text-xs text-accent hover:underline cursor-pointer">Signals, risks & next best actions →</button>
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] text-fg-3">Generate an AI read on this person from every message, call, deal and payment on record.</p>
      ))}
    </div>
  );
}

function AiFull({ contactId, summary, at, onDraft }: { contactId: string; summary: string | null; at: string | null; onDraft: () => void }) {
  const { busy, run } = useGenerate(contactId);
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-fg-3">{at ? <>Generated <Time value={at} format="datetime" /></> : "Not generated yet"}</span>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" icon={Wand2} onClick={onDraft}>Draft follow-up</Button>
          <Button size="sm" variant="primary" icon={RefreshCw} loading={busy} onClick={run}>{summary ? "Regenerate" : "Generate overview"}</Button>
        </div>
      </div>
      {summary ? (
        <article className="rounded-lg border border-border p-4 text-[13px] leading-relaxed text-fg [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:text-[13px] [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_p]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:text-fg-2">
          <ReactMarkdown>{summary}</ReactMarkdown>
        </article>
      ) : <EmptyState icon={Sparkles} title="No AI overview yet" description="Uses OpenRouter to summarize the relationship, buying signals, risks and next best actions." />}
    </div>
  );
}

function DraftDialog({ open, onOpenChange, contactId, canSms, canEmail }: { open: boolean; onOpenChange: (o: boolean) => void; contactId: string; canSms: boolean; canEmail: boolean }) {
  const router = useRouter();
  const [channel, setChannel] = React.useState<"sms" | "email">(canSms ? "sms" : "email");
  const [goal, setGoal] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState<"gen" | "send" | null>(null);
  React.useEffect(() => { if (open) { setBody(""); setSubject(""); } }, [open]);

  const generate = async () => {
    setBusy("gen");
    const r = await draftFollowUp(contactId, channel, goal || undefined);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    setSubject(r.data.subject);
    setBody(r.data.body);
  };
  const send = async () => {
    setBusy("send");
    const r = await sendDraft(contactId, channel, body, subject);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(channel === "sms" ? "Text sent" : "Email sent");
    onOpenChange(false);
    router.refresh();
  };
  const disabled = channel === "sms" ? !canSms : !canEmail;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Draft a follow-up with AI" description="Uses the full history of this person. Edit before sending."
      footer={<>
        <Button icon={Copy} disabled={!body} onClick={() => { navigator.clipboard.writeText(channel === "email" && subject ? `${subject}\n\n${body}` : body); toast.success("Copied"); }}>Copy</Button>
        <Button variant="primary" icon={Send} disabled={!body || disabled} loading={busy === "send"} onClick={send}>Send {channel === "sms" ? "text" : "email"}</Button>
      </>}>
      <div className="space-y-3 pb-2">
        <div className="grid grid-cols-[140px_1fr_auto] items-end gap-2">
          <Field label="Channel">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as "sms" | "email")}>
              <option value="sms">SMS{!canSms ? " (no phone)" : ""}</option>
              <option value="email">Email{!canEmail ? " (no email)" : ""}</option>
            </Select>
          </Field>
          <Field label="Goal (optional)"><Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. get them to book a call this week" /></Field>
          <Button variant="secondary" size="md" icon={Wand2} loading={busy === "gen"} onClick={generate}>{body ? "Regenerate" : "Generate"}</Button>
        </div>
        {channel === "email" && <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
        <Field label="Message" hint={channel === "sms" ? `${body.length} characters` : undefined}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className={cn(channel === "email" ? "min-h-56" : "min-h-28")} placeholder="Click Generate to draft a message…" />
        </Field>
      </div>
    </Dialog>
  );
}


/** Which dialer folder this person lives in (no folder = New). */
function FolderField({ value, onSave }: { value: string | null; onSave: (id: string) => void }) {
  const [folders, setFolders] = React.useState<ContactFolder[]>([]);
  React.useEffect(() => {
    createBrowserClient().from("contact_folders").select("*").order("position").order("name").then(({ data }) => setFolders((data as ContactFolder[]) ?? []));
  }, []);
  const current = value ?? folders.find((f) => f.system_key === "new")?.id ?? "";
  return (
    <Select value={current} onChange={(e) => e.target.value && e.target.value !== current && onSave(e.target.value)} className="h-7 border-transparent hover:border-border">
      {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </Select>
  );
}
