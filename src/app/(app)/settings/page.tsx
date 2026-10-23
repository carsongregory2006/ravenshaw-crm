import Link from "next/link";
import { Settings, User, SlidersHorizontal, Users, Columns3, FileText, Plug, Server, type LucideIcon } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { integrations } from "@/lib/env";
import { appUrl, cn } from "@/lib/utils";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { GeneralSettings } from "@/components/settings/general-settings";
import { TeamSettings } from "@/components/settings/team-settings";
import { PipelineSettings } from "@/components/settings/pipeline-settings";
import { TemplateSettings } from "@/components/settings/template-settings";
import { IntegrationSettings, type IntegrationInfo } from "@/components/settings/integration-settings";
import { SystemSettings } from "@/components/settings/system-settings";
import type { PipelineStage, Profile, RrMember, Template, WorkspaceSettings } from "@/lib/types";

export const metadata = { title: "Settings" };

type TabId = "profile" | "general" | "team" | "pipeline" | "templates" | "integrations" | "system";
const TABS: { id: TabId; label: string; icon: LucideIcon; admin?: boolean; group: string }[] = [
  { id: "profile", label: "Profile", icon: User, group: "User" },
  { id: "general", label: "General", icon: SlidersHorizontal, admin: true, group: "Workspace" },
  { id: "team", label: "Team", icon: Users, admin: true, group: "Workspace" },
  { id: "pipeline", label: "Pipeline", icon: Columns3, admin: true, group: "Workspace" },
  { id: "templates", label: "Templates", icon: FileText, group: "Workspace" },
  { id: "integrations", label: "Integrations", icon: Plug, admin: true, group: "Workspace" },
  { id: "system", label: "System", icon: Server, admin: true, group: "Workspace" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";
  const visible = TABS.filter((t) => !t.admin || isAdmin);
  const { tab: raw } = await searchParams;
  const tab: TabId = (visible.find((t) => t.id === raw)?.id ?? "profile") as TabId;
  const sb = await createClient();
  const { data: ws } = await sb.from("workspace_settings").select("*").eq("id", 1).single();
  const settings = ws as WorkspaceSettings;

  let content: React.ReactNode = null;
  if (tab === "profile") {
    const { data: { user } } = await sb.auth.getUser();
    content = <ProfileSettings profile={profile} email={user?.email ?? profile.email} />;
  } else if (tab === "general") {
    content = <GeneralSettings settings={settings} />;
  } else if (tab === "team") {
    const db = createAdminClient();
    const [{ data: members }, { data: pool }, { data: users }] = await Promise.all([
      db.from("profiles").select("*").order("created_at"),
      db.from("rr_members").select("*").is("page_id", null),
      db.auth.admin.listUsers({ perPage: 1000 }),
    ]);
    const pending = Object.fromEntries((users?.users ?? []).map((u) => [u.id, !u.last_sign_in_at]));
    content = <TeamSettings me={profile.id} members={(members ?? []) as Profile[]} pool={(pool ?? []) as RrMember[]} pending={pending} />;
  } else if (tab === "pipeline") {
    const [{ data: stages }, { data: deals }] = await Promise.all([
      sb.from("pipeline_stages").select("*").order("position"),
      createAdminClient().from("deals").select("stage_id"),
    ]);
    const counts: Record<string, number> = {};
    for (const d of deals ?? []) counts[d.stage_id] = (counts[d.stage_id] ?? 0) + 1;
    content = <PipelineSettings stages={(stages ?? []) as PipelineStage[]} counts={counts} />;
  } else if (tab === "templates") {
    const { data: templates } = await sb.from("templates").select("*").order("created_at", { ascending: false });
    content = <TemplateSettings templates={(templates ?? []) as Template[]} />;
  } else if (tab === "integrations") {
    const hook = (p: string) => appUrl(`/api/webhooks/${p}`);
    const list: IntegrationInfo[] = [
      { key: "mercury", name: "Mercury", purpose: "Invoices, payments & bank transactions", connected: integrations.mercury(), env: ["MERCURY_API_KEY", "MERCURY_ACCOUNT_ID"], webhook: `${hook("mercury")}?secret=<CRON_SECRET>` },
      { key: "telnyx", name: "Telnyx", purpose: "SMS and calling", connected: integrations.telnyx(), env: ["TELNYX_API_KEY", "TELNYX_FROM_NUMBER", "TELNYX_MESSAGING_PROFILE_ID", "TELNYX_PUBLIC_KEY", "TELNYX_CONNECTION_ID"], webhook: hook("telnyx"), extra: integrations.telnyxVoice() ? "Browser dialer ready" : "Add TELNYX_CONNECTION_ID to enable the browser dialer" },
      { key: "resend", name: "Resend", purpose: "Email sending, tracking & inbound replies", connected: integrations.resend(), env: ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"], webhook: hook("resend") },
      { key: "calendly", name: "Calendly", purpose: "Bookings sync into the calendar & deals", connected: integrations.calendly(), env: ["CALENDLY_API_TOKEN", "CALENDLY_WEBHOOK_SIGNING_KEY"], webhook: hook("calendly") },
      { key: "pandadoc", name: "PandaDoc", purpose: "One-click contracts & e-signature", connected: integrations.pandadoc(), env: ["PANDADOC_API_KEY", "PANDADOC_WEBHOOK_KEY"], webhook: hook("pandadoc") },
      { key: "openrouter", name: "OpenRouter", purpose: "AI summaries, drafting & automations", connected: integrations.openrouter(), env: ["OPENROUTER_API_KEY", "OPENROUTER_MODEL"] },
      { key: "google", name: "Google Calendar", purpose: "Two-way calendar sync", connected: integrations.google(), env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], webhook: appUrl("/api/integrations/google/callback"), webhookLabel: "OAuth redirect URI" },
      { key: "supabase", name: "Supabase", purpose: "Database, auth & realtime", connected: integrations.supabase(), env: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] },
    ];
    const { data: g } = await sb.from("google_accounts").select("email").eq("user_id", profile.id).maybeSingle();
    content = <IntegrationSettings integrations={list} settings={settings} googleEmail={g?.email ?? null} />;
  } else if (tab === "system") {
    const db = createAdminClient();
    const [{ data: events }, { data: lastTick }] = await Promise.all([
      db.from("webhook_events").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("webhook_events").select("created_at, error, payload").eq("provider", "cron").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    content = <SystemSettings events={events ?? []} lastTick={lastTick ?? null} cronConfigured={!!process.env.CRON_SECRET} appUrl={appUrl()} />;
  }

  const groups = [...new Set(visible.map((t) => t.group))];
  return (
    <Page>
      <PageHeader icon={Settings} title="Settings" />
      <div className="flex min-h-0 flex-1">
        <nav className="w-[200px] shrink-0 overflow-y-auto border-r border-border bg-bg-2 p-2">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="px-2 py-1 text-xs font-medium text-fg-3">{g}</div>
              {visible.filter((t) => t.group === g).map((t) => (
                <Link key={t.id} href={`/settings?tab=${t.id}`}
                  className={cn("flex h-7 items-center gap-2 rounded-md px-2 text-[13px]", tab === t.id ? "bg-active font-medium text-fg" : "text-fg-2 hover:bg-hover hover:text-fg")}>
                  <t.icon className="size-4 text-fg-3" /> {t.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-8">{content}</div>
        </div>
      </div>
    </Page>
  );
}
