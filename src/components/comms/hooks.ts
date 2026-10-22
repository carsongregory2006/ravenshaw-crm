"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Call, Channel, Message, Template } from "@/lib/types";

/** Messages for a contact (oldest → newest), live-updated via Supabase realtime. */
export function useContactMessages(contactId: string | null, channel?: Channel) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!contactId) { setMessages([]); setLoading(false); return; }
    let q = createClient().from("messages").select("*").eq("contact_id", contactId).order("created_at", { ascending: true }).limit(500);
    if (channel) q = q.eq("channel", channel);
    const { data } = await q;
    setMessages((data as Message[]) ?? []);
    setLoading(false);
  }, [contactId, channel]);

  useEffect(() => {
    setLoading(true);
    load();
    if (!contactId) return;
    const sb = createClient();
    const ch = sb.channel(`msgs-${contactId}-${channel ?? "all"}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `contact_id=eq.${contactId}` }, (p) => {
        const m = (p.new ?? p.old) as Message;
        if (channel && m.channel !== channel) return;
        setMessages((xs) => {
          if (p.eventType === "DELETE") return xs.filter((x) => x.id !== m.id);
          const i = xs.findIndex((x) => x.id === m.id);
          if (i >= 0) { const next = [...xs]; next[i] = p.new as Message; return next; }
          return [...xs, p.new as Message];
        });
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [contactId, channel, load]);

  return { messages, loading, reload: load };
}

export function useContactCalls(contactId: string) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await createClient().from("calls").select("*").eq("contact_id", contactId).order("started_at", { ascending: false }).limit(100);
    setCalls((data as Call[]) ?? []);
    setLoading(false);
  }, [contactId]);
  useEffect(() => {
    load();
    const sb = createClient();
    const ch = sb.channel(`calls-${contactId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `contact_id=eq.${contactId}` }, () => load())
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [contactId, load]);
  return { calls, loading, reload: load };
}

export function useTemplates(channel: Channel) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const load = useCallback(async () => {
    const { data } = await createClient().from("templates").select("*").eq("channel", channel).order("name");
    setTemplates((data as Template[]) ?? []);
  }, [channel]);
  useEffect(() => { load(); }, [load]);
  return { templates, reload: load };
}

/** GSM-7 vs UCS-2 segment math for the SMS counter. */
export function smsSegments(text: string) {
  const gsm = /^[\n\r -_a-zA-Z0-9@£$¥èéùìòÇØøÅåΔΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(text);
  const len = [...text].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const segments = len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi);
  return { len, segments, encoding: gsm ? "GSM-7" : "Unicode" };
}
