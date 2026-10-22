import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { integrations } from "@/lib/env";
import { CalendarApp } from "@/components/calendar/calendar-app";
import type { CalendarRow } from "@/lib/types";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await requireProfile();
  const sb = await createClient();

  let { data: calendars } = await sb.from("calendars").select("*").order("created_at");
  // every user gets a personal calendar on first visit
  if (!(calendars ?? []).some((c) => c.owner_id === me.id && c.source === "internal")) {
    await sb.from("calendars").insert({ owner_id: me.id, name: me.full_name || me.email, color: "#1a73e8", source: "internal", is_visible: true });
    ({ data: calendars } = await sb.from("calendars").select("*").order("created_at"));
  }

  const [{ data: acct }, { data: profiles }] = await Promise.all([
    sb.from("google_accounts").select("email").eq("user_id", me.id).maybeSingle(),
    sb.from("profiles").select("id, full_name, email"),
  ]);
  const ownerNames = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));

  // own calendars first (internal, then google), then shared, then teammates'
  const order = (c: CalendarRow) => (c.owner_id === me.id ? (c.source === "internal" ? 0 : 1) : c.owner_id === null ? 2 : 3);
  const sorted = ((calendars ?? []) as CalendarRow[]).sort((a, b) => order(a) - order(b));

  return (
    <CalendarApp
      me={me}
      initialCalendars={sorted}
      ownerNames={ownerNames}
      google={{ configured: integrations.google(), connected: !!acct, email: acct?.email ?? null }}
      initial={{ date: sp.date, view: sp.view, event: sp.event, google: sp.google, create: sp.new === "1" }}
    />
  );
}
