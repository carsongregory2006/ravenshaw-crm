"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessagesSquare, Search, Phone, ExternalLink, Mail, MessageSquare, PenSquare } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { useProfile } from "@/components/shell/profile-context";
import { createClient } from "@/lib/supabase/client";
import { markConversationReadAction } from "@/lib/actions/comms";
import { cn, contactLabel, feedTime, fmtPhone } from "@/lib/utils";
import { useContactMessages } from "@/components/comms/hooks";
import { SmsBubble, SmsComposer, useAutoScroll } from "@/components/comms/sms";
import { EmailComposer, EmailItem, replySubject } from "@/components/comms/email";
import { callBlockReason, emailBlockReason, smsBlockReason } from "@/components/comms/contact-comms";
import { useDialer } from "@/components/comms/dialer";
import type { Channel, Contact, Message } from "@/lib/types";

type ContactLite = Pick<Contact, "id" | "first_name" | "last_name" | "email" | "phone" | "owner_id">;
type Row = Pick<Message, "id" | "contact_id" | "channel" | "direction" | "subject" | "body" | "created_at" | "read_at"> & { contact: ContactLite | null };
interface Convo { contact: ContactLite; last: Row; unread: number; channels: Set<Channel> }

export function Inbox() {
  const profile = useProfile();
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("c");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<"all" | Channel>("all");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient().from("messages")
      .select("id, contact_id, channel, direction, subject, body, created_at, read_at, contact:contacts(id, first_name, last_name, email, phone, owner_id)")
      .not("contact_id", "is", null).order("created_at", { ascending: false }).limit(1500);
    setRows((data as unknown as Row[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const sb = createClient();
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = sb.channel(`inbox-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        clearTimeout(t);
        t = setTimeout(load, 400);
      })
      .subscribe();
    return () => { clearTimeout(t); sb.removeChannel(ch); };
  }, [load]);

  const convos = useMemo(() => {
    const map = new Map<string, Convo>();
    for (const r of rows) {
      if (!r.contact) continue;
      let c = map.get(r.contact.id);
      if (!c) { c = { contact: r.contact, last: r, unread: 0, channels: new Set() }; map.set(r.contact.id, c); }
      c.channels.add(r.channel);
      if (r.direction === "inbound" && !r.read_at) c.unread++;
    }
    const needle = q.trim().toLowerCase();
    return [...map.values()].filter((c) =>
      (channel === "all" || c.channels.has(channel)) &&
      (scope === "all" || c.contact.owner_id === profile.id) &&
      (!unreadOnly || c.unread > 0) &&
      (!needle || [contactLabel(c.contact), c.contact.email, c.contact.phone].some((s) => s?.toLowerCase().includes(needle))),
    );
  }, [rows, channel, scope, unreadOnly, q, profile.id]);

  const totalUnread = useMemo(() => rows.filter((r) => r.direction === "inbound" && !r.read_at).length, [rows]);
  const select = (id: string) => router.replace(`/inbox?c=${id}`, { scroll: false });

  return (
    <Page>
      <PageHeader icon={MessagesSquare} title="Inbox" actions={<Button size="sm" variant="primary" icon={PenSquare} onClick={() => setNewOpen(true)}>New message</Button>}>
        {totalUnread > 0 && <Tag color="blue">{totalUnread} unread</Tag>}
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[320px] shrink-0 flex-col border-r border-border">
          <div className="space-y-2 border-b border-border-light p-2">
            <div className="relative">
              <Search className="absolute left-2 top-2 size-4 text-fg-4" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search conversations" className="pl-7" />
            </div>
            <div className="flex items-center gap-1">
              {(["all", "sms", "email"] as const).map((c) => (
                <button key={c} onClick={() => setChannel(c)} className={cn("h-6 rounded-md px-2 text-xs cursor-pointer", channel === c ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>
                  {c === "all" ? "All" : c === "sms" ? "SMS" : "Email"}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-border" />
              {(["all", "mine"] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)} className={cn("h-6 rounded-md px-2 text-xs cursor-pointer", scope === s ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>
                  {s === "all" ? "Everyone" : "Mine"}
                </button>
              ))}
              <button onClick={() => setUnreadOnly(!unreadOnly)} className={cn("ml-auto h-6 rounded-md px-2 text-xs cursor-pointer", unreadOnly ? "bg-accent-soft font-medium text-accent" : "text-fg-3 hover:bg-hover")}>Unread</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? <div className="flex justify-center py-10"><Spinner /></div>
              : convos.length === 0 ? <EmptyState icon={MessagesSquare} title="No conversations" description="Texts and emails with your contacts appear here, newest first." />
              : convos.map((c) => (
                <button key={c.contact.id} onClick={() => select(c.contact.id)}
                  className={cn("flex w-full gap-2 border-b border-border-light px-3 py-2.5 text-left cursor-pointer", selectedId === c.contact.id ? "bg-active" : "hover:bg-hover")}>
                  <Avatar name={contactLabel(c.contact)} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className={cn("truncate text-[13px]", c.unread ? "font-semibold" : "font-medium")}>{contactLabel(c.contact)}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-fg-4">{feedTime(c.last.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {c.last.channel === "sms" ? <MessageSquare className="size-3 shrink-0 text-fg-4" /> : <Mail className="size-3 shrink-0 text-fg-4" />}
                      <span className={cn("truncate text-xs", c.unread ? "text-fg" : "text-fg-3")}>
                        {c.last.direction === "outbound" && "You: "}{c.last.channel === "email" ? c.last.subject : c.last.body}
                      </span>
                      {c.unread > 0 && <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">{c.unread}</span>}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          {selectedId ? <Conversation key={selectedId} contactId={selectedId} /> : (
            <EmptyState icon={MessagesSquare} title="Select a conversation" description="Pick a conversation on the left, or start a new one." className="h-full"
              action={<Button icon={PenSquare} onClick={() => setNewOpen(true)}>New message</Button>} />
          )}
        </div>
      </div>
      <NewConversationDialog open={newOpen} onOpenChange={setNewOpen} onPick={(id) => { setNewOpen(false); select(id); }} />
    </Page>
  );
}

function Conversation({ contactId }: { contactId: string }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [missing, setMissing] = useState(false);
  const { messages, loading } = useContactMessages(contactId);
  const [mode, setMode] = useState<Channel>("sms");
  const modeChosen = useRef(false);
  const dialer = useDialer();
  const scrollRef = useAutoScroll(messages.length + (contact ? 1 : 0));

  useEffect(() => {
    createClient().from("contacts").select("*").eq("id", contactId).maybeSingle().then(({ data }) => {
      if (!data) setMissing(true);
      setContact(data as Contact | null);
    });
  }, [contactId]);

  // Default the composer to the channel of the latest message (or what the contact supports).
  useEffect(() => {
    if (modeChosen.current || !contact) return;
    const last = messages[messages.length - 1];
    if (last) setMode(last.channel);
    else setMode(contact.phone ? "sms" : "email");
  }, [messages, contact]);

  const unreadCount = messages.filter((m) => m.direction === "inbound" && !m.read_at).length;
  useEffect(() => {
    if (unreadCount > 0) markConversationReadAction(contactId);
  }, [contactId, unreadCount]);

  if (missing) return <EmptyState title="Contact not found" description="It may have been deleted or you don't have access." className="h-full" />;
  if (!contact) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const lastEmail = [...messages].reverse().find((m) => m.channel === "email");
  const sReason = smsBlockReason(contact);
  const eReason = emailBlockReason(contact);
  const cReason = callBlockReason(contact);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-light px-3">
        <Avatar name={contactLabel(contact)} size={28} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{contactLabel(contact)}</div>
          <div className="truncate text-xs text-fg-3">{[fmtPhone(contact.phone), contact.email].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="ml-auto flex gap-1">
          <Button size="sm" icon={Phone} disabled={!!cReason} title={cReason ?? "Call"}
            onClick={() => contact.phone && dialer.call({ phone: contact.phone, contactId: contact.id, name: contactLabel(contact) })}>Call</Button>
          <Link href={`/contacts/${contact.id}`}><Button size="sm" variant="ghost" icon={ExternalLink}>Profile</Button></Link>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-bg-2/40 p-4">
        {loading ? <div className="flex justify-center py-8"><Spinner /></div>
          : messages.length === 0 ? <EmptyState icon={MessagesSquare} title="No messages yet" description="Send the first text or email below." />
          : messages.map((m) => (
            m.channel === "sms"
              ? <SmsBubble key={m.id} m={m} />
              : <div key={m.id} className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}>
                  <div className="w-[85%]"><EmailItem m={m} defaultOpen={m.id === lastEmail?.id} /></div>
                </div>
          ))}
      </div>
      <div className="flex items-center gap-1 border-t border-border-light px-2 pt-1.5">
        {(["sms", "email"] as const).map((c) => (
          <button key={c} onClick={() => { modeChosen.current = true; setMode(c); }}
            className={cn("flex h-6 items-center gap-1 rounded-md px-2 text-xs cursor-pointer", mode === c ? "bg-active font-medium text-fg" : "text-fg-3 hover:bg-hover")}>
            {c === "sms" ? <MessageSquare className="size-3" /> : <Mail className="size-3" />}{c === "sms" ? "SMS" : "Email"}
          </button>
        ))}
      </div>
      {mode === "sms"
        ? <SmsComposer contactId={contact.id} disabledReason={sReason} autoFocus />
        : eReason
          ? <SmsComposer contactId={contact.id} disabledReason={eReason} />
          : <EmailComposer compact contactId={contact.id} to={contact.email!} initialSubject={replySubject(lastEmail?.subject)} />}
    </div>
  );
}

function NewConversationDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ContactLite[]>([]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const like = `%${q.trim()}%`;
      let query = createClient().from("contacts").select("id, first_name, last_name, email, phone, owner_id").order("updated_at", { ascending: false }).limit(12);
      if (q.trim()) query = query.or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`);
      const { data } = await query;
      setHits((data as ContactLite[]) ?? []);
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New message" description="Choose who to text or email." size="sm">
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people by name, email or phone" />
      <div className="mt-2 max-h-72 overflow-y-auto pb-2">
        {hits.length === 0 && <p className="py-4 text-center text-xs text-fg-3">No matches</p>}
        {hits.map((h) => (
          <button key={h.id} onClick={() => onPick(h.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover cursor-pointer">
            <Avatar name={contactLabel(h)} size={22} />
            <span className="truncate text-[13px]">{contactLabel(h)}</span>
            <span className="ml-auto truncate text-xs text-fg-3">{h.phone ? fmtPhone(h.phone) : h.email}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
