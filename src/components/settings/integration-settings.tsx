"use client";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, CheckCircle2, Circle, Copy, CreditCard, ExternalLink, Landmark, Mail, MessageSquare, Phone, Calendar, FileSignature, Sparkles, CalendarDays, Database, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import {
  calendlyEventTypes, calendlyRegisterWebhook, mercuryAccounts, pandadocTemplates, testAi, testEmail, testSms, updateWorkspace,
} from "@/lib/actions/settings";
import { lineLabel, money } from "@/lib/utils";
import { phoneLinesAction } from "@/lib/actions/comms";
import type { WorkspaceSettings } from "@/lib/types";
import { PageTitle, Section } from "./section";

export interface IntegrationInfo {
  key: "stripe" | "mercury" | "telnyx" | "resend" | "calendly" | "pandadoc" | "openrouter" | "google" | "supabase";
  name: string;
  purpose: string;
  connected: boolean;
  env: string[];
  webhook?: string;
  webhookLabel?: string;
  extra?: string;
}

const ICONS: Record<IntegrationInfo["key"], LucideIcon> = {
  stripe: CreditCard, mercury: Landmark, telnyx: Phone, resend: Mail, calendly: Calendar, pandadoc: FileSignature, openrouter: Sparkles, google: CalendarDays, supabase: Database,
};

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-xs text-fg-3">{label}</div>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg-2 px-2 py-1 font-mono text-xs text-fg-2">{value}</code>
        <Button size="xs" variant="ghost" icon={copied ? Check : Copy} aria-label="Copy"
          onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }} />
      </div>
    </div>
  );
}

function useRun() {
  const [busy, start] = useTransition();
  const run = <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, onOk: (d: T) => void) =>
    start(async () => { const r = await fn(); if (r.ok) onOk(r.data); else toast.error(r.error); });
  return { busy, run };
}

function TelnyxActions() {
  const { busy, run } = useRun();
  const [to, setTo] = useState("");
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => testSms(to), (id) => toast.success("Test SMS sent", { description: `Telnyx message ${id}` })); }}>
      <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Your mobile number" className="max-w-[220px]" />
      <Button type="submit" icon={MessageSquare} loading={busy} disabled={!to}>Send test SMS</Button>
    </form>
  );
}

function ResendActions() {
  const { busy, run } = useRun();
  const [to, setTo] = useState("");
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => testEmail(to), (id) => toast.success("Test email sent", { description: `Resend id ${id}` })); }}>
      <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@yourdomain.com" className="max-w-[220px]" />
      <Button type="submit" icon={Mail} loading={busy} disabled={!to}>Send test email</Button>
    </form>
  );
}

function CalendlyActions({ settings }: { settings: WorkspaceSettings }) {
  const { busy, run } = useRun();
  const [types, setTypes] = useState<{ name: string; url: string; duration: number; active: boolean }[] | null>(null);
  const [def, setDef] = useState(settings.default_calendly_url ?? "");
  const [onb, setOnb] = useState(settings.onboarding_calendly_url ?? "");
  const options = [...new Set([...(types ?? []).map((t) => t.url), def, onb].filter(Boolean))];
  const label = (url: string) => { const t = types?.find((x) => x.url === url); return t ? `${t.name} (${t.duration} min)` : url; };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button loading={busy} onClick={() => run(calendlyEventTypes, (t) => { setTypes(t); toast.success(`Loaded ${t.length} event types`); })}>List event types</Button>
        <Button variant="ghost" loading={busy} title="Instant booking updates. Needs Calendly Standard or higher."
          onClick={() => run(calendlyRegisterWebhook, (m) => toast.success(m))}>Register webhook (paid Calendly)</Button>
      </div>
      <p className="text-xs text-fg-3">Bookings sync automatically every 5 minutes. On a paid Calendly plan, registering the webhook makes them instant.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Default booking link" hint="Used on landing pages and in {{booking_link}}.">
          {types ? (
            <Select value={def} onChange={(e) => setDef(e.target.value)}>
              <option value="">None</option>
              {options.map((u) => <option key={u} value={u}>{label(u)}</option>)}
            </Select>
          ) : <Input value={def} onChange={(e) => setDef(e.target.value)} placeholder="https://calendly.com/…" />}
        </Field>
        <Field label="Onboarding call link" hint="Sent to new clients after signing.">
          {types ? (
            <Select value={onb} onChange={(e) => setOnb(e.target.value)}>
              <option value="">None</option>
              {options.map((u) => <option key={u} value={u}>{label(u)}</option>)}
            </Select>
          ) : <Input value={onb} onChange={(e) => setOnb(e.target.value)} placeholder="https://calendly.com/…" />}
        </Field>
      </div>
      <Button variant="primary" loading={busy} onClick={() => run(() => updateWorkspace({ default_calendly_url: def || null, onboarding_calendly_url: onb || null }), () => toast.success("Booking links saved"))}>Save booking links</Button>
    </div>
  );
}

function PandaDocActions({ settings }: { settings: WorkspaceSettings }) {
  const { busy, run } = useRun();
  const [templates, setTemplates] = useState<{ id: string; name: string }[] | null>(null);
  const [tid, setTid] = useState(settings.pandadoc_template_id ?? "");
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <Field label="Contract template" className="flex-1" hint="Used by the one-click “Send contract” button on deals. Client and deal details (name, company, deal number, pricing) are filled into the template’s tokens and pricing table.">
          {templates ? (
            <Select value={tid} onChange={(e) => setTid(e.target.value)}>
              <option value="">Select a template…</option>
              {[...templates, ...(tid && !templates.some((t) => t.id === tid) ? [{ id: tid, name: tid }] : [])].map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          ) : <Input value={tid} onChange={(e) => setTid(e.target.value)} placeholder="Template ID" />}
        </Field>
      </div>
      <div className="flex gap-2">
        <Button loading={busy} onClick={() => run(pandadocTemplates, (t) => { setTemplates(t); toast.success(`Loaded ${t.length} templates`); })}>Load templates</Button>
        <Button variant="primary" loading={busy} onClick={() => run(() => updateWorkspace({ pandadoc_template_id: tid || null }), () => toast.success("Contract template saved"))}>Save template</Button>
      </div>
    </div>
  );
}

function MercuryActions() {
  const { busy, run } = useRun();
  const [accts, setAccts] = useState<{ id: string; name: string; available: number; current: number; kind: string; status: string; selected: boolean }[]>();
  return (
    <div className="space-y-2">
      <Button loading={busy} onClick={() => run(mercuryAccounts, (a) => setAccts(a))}>Load accounts</Button>
      {accts && (
        <div className="overflow-hidden rounded-md border border-border">
          {accts.length === 0 && <div className="px-3 py-2 text-[13px] text-fg-3">No accounts returned.</div>}
          {accts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 border-b border-border-light px-3 py-2 text-[13px] last:border-0">
              <span className="font-medium">{a.name}</span>
              <Tag>{a.kind}</Tag>
              {a.selected && <Tag color="green">MERCURY_ACCOUNT_ID</Tag>}
              <span className="ml-auto tabular-nums">{money(a.available, { cents: true })}</span>
              <Button size="xs" variant="ghost" icon={Copy} aria-label="Copy account id" title="Copy account ID"
                onClick={async () => { await navigator.clipboard.writeText(a.id); toast.success("Account ID copied — set it as MERCURY_ACCOUNT_ID"); }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OpenRouterActions({ model }: { model: string }) {
  const { busy, run } = useRun();
  return <Button icon={Sparkles} loading={busy} onClick={() => run(() => testAi(model), (r) => toast.success(`${model} replied in ${r.ms}ms`, { description: r.text }))}>Test {model}</Button>;
}

function GoogleActions({ email }: { email: string | null }) {
  return (
    <div className="flex items-center gap-2">
      {email && <Tag color="green">Connected as {email}</Tag>}
      <a href="/api/integrations/google/connect"><Button icon={ExternalLink}>{email ? "Reconnect Google Calendar" : "Connect Google Calendar"}</Button></a>
    </div>
  );
}

function SenderSettings({ settings, defaultFromEmail }: { settings: WorkspaceSettings; defaultFromEmail: string | null }) {
  const { busy, run } = useRun();
  const [f, setF] = useState({ email_from_name: settings.email_from_name ?? "", email_from_address: settings.email_from_address ?? "", sms_from_number: settings.sms_from_number ?? "" });
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => { phoneLinesAction().then((r) => r.ok && setLines(r.data.lines)); }, []);
  const lineOptions = [...new Set([...lines, ...(f.sms_from_number ? [f.sms_from_number] : [])])];
  return (
    <Section title="Senders" description="Who outbound email, SMS and calls come from. Falls back to RESEND_FROM_EMAIL / TELNYX_FROM_NUMBER. Every active number in your Telnyx account can be picked when texting or calling.">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Email from name"><Input value={f.email_from_name} onChange={(e) => setF({ ...f, email_from_name: e.target.value })} placeholder="Ravenshaw AI" /></Field>
        <Field label="Email from address" hint="Must be on a domain verified in Resend."><Input type="email" value={f.email_from_address} onChange={(e) => setF({ ...f, email_from_address: e.target.value })} placeholder={defaultFromEmail ? `${defaultFromEmail} (default from RESEND_FROM_EMAIL)` : "team@ravenshaw.ai"} /></Field>
        <Field label="Default phone number" hint="Used for new conversations and calls. Contacts you've already talked to get replies from the number they used.">
          {lineOptions.length
            ? <Select value={f.sms_from_number} onChange={(e) => setF({ ...f, sms_from_number: e.target.value })}>
                <option value="">TELNYX_FROM_NUMBER (env)</option>
                {lineOptions.map((l) => <option key={l} value={l}>{lineLabel(l)}</option>)}
              </Select>
            : <Input value={f.sms_from_number} onChange={(e) => setF({ ...f, sms_from_number: e.target.value })} placeholder="+1…" />}
        </Field>
      </div>
      <Button className="mt-3" variant="primary" loading={busy}
        onClick={() => run(() => updateWorkspace({ email_from_name: f.email_from_name || null, email_from_address: f.email_from_address || null, sms_from_number: f.sms_from_number || null }), () => toast.success("Senders saved"))}>Save senders</Button>
    </Section>
  );
}

export function IntegrationSettings({ integrations, settings, googleEmail, defaultFromEmail }: { integrations: IntegrationInfo[]; settings: WorkspaceSettings; googleEmail: string | null; defaultFromEmail: string | null }) {
  const connected = integrations.filter((i) => i.connected).length;
  return (
    <>
      <PageTitle title="Integrations" description={`${connected} of ${integrations.length} connected. API keys live in Vercel → Project → Settings → Environment Variables; redeploy after changing them.`} />
      <SenderSettings settings={settings} defaultFromEmail={defaultFromEmail} />
      <Section title="Services">
        <div className="space-y-3">
          {integrations.map((i) => {
            const Icon = ICONS[i.key];
            return (
              <div key={i.key} className="rounded-lg border border-border">
                <div className="flex items-center gap-3 border-b border-border-light px-3 py-2.5">
                  <span className="flex size-8 items-center justify-center rounded-md border border-border bg-bg-2"><Icon className="size-4 text-fg-2" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{i.name}</div>
                    <div className="text-xs text-fg-3">{i.purpose}</div>
                  </div>
                  {i.connected
                    ? <Tag color="green"><CheckCircle2 className="size-3" />Connected</Tag>
                    : <Tag color="gray"><Circle className="size-3" />Not configured</Tag>}
                </div>
                <div className="space-y-3 px-3 py-3">
                  <div>
                    <div className="mb-1 text-xs text-fg-3">Environment variables</div>
                    <div className="flex flex-wrap gap-1">{i.env.map((e) => <code key={e} className="rounded-sm bg-bg-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-2">{e}</code>)}</div>
                  </div>
                  {i.extra && <div className="text-xs text-fg-3">{i.extra}</div>}
                  {i.webhook && <CopyField label={i.webhookLabel ?? "Webhook URL (paste into the provider dashboard)"} value={i.webhook} />}
                  {i.connected && (
                    <div className="pt-1">
                      {i.key === "telnyx" && <TelnyxActions />}
                      {i.key === "resend" && <ResendActions />}
                      {i.key === "calendly" && <CalendlyActions settings={settings} />}
                      {i.key === "pandadoc" && <PandaDocActions settings={settings} />}
                      {i.key === "mercury" && <MercuryActions />}
                      {i.key === "openrouter" && <OpenRouterActions model={settings.ai_model} />}
                      {i.key === "google" && <GoogleActions email={googleEmail} />}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
