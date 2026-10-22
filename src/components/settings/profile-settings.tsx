"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { updateMyProfile } from "@/lib/actions/settings";
import { fmtPhone, pct } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { PageTitle, Section, TIMEZONES } from "./section";

export function ProfileSettings({ profile, email }: { profile: Profile; email: string }) {
  const [form, setForm] = useState({
    full_name: profile.full_name ?? "",
    phone: fmtPhone(profile.phone),
    avatar_url: profile.avatar_url ?? "",
    timezone: profile.timezone,
    available_for_rr: profile.available_for_rr,
  });
  const [pending, start] = useTransition();
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [pwLoading, setPwLoading] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => start(async () => {
    const r = await updateMyProfile(form);
    if (r.ok) toast.success("Profile saved"); else toast.error(r.error);
  });

  const changePassword = async () => {
    if (pw.next.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw.next !== pw.confirm) return toast.error("Passwords don't match");
    setPwLoading(true);
    const { error } = await createClient().auth.updateUser({ password: pw.next });
    setPwLoading(false);
    if (error) toast.error(error.message);
    else { toast.success("Password updated"); setPw({ next: "", confirm: "" }); }
  };

  const tzs = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];

  return (
    <>
      <PageTitle title="Profile" description="Your personal details and preferences." />
      <Section title="Picture & name">
        <div className="flex items-center gap-4">
          <Avatar name={form.full_name || email} src={form.avatar_url || null} size={56} />
          <div className="grid flex-1 grid-cols-2 gap-3">
            <Field label="Full name"><Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} /></Field>
            <Field label="Email"><Input value={email} disabled /></Field>
            <Field label="Phone" hint="Used as your callback number and in merge tags."><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 555-5555" /></Field>
            <Field label="Avatar URL"><Input value={form.avatar_url} onChange={(e) => set("avatar_url", e.target.value)} placeholder="https://…" /></Field>
          </div>
        </div>
      </Section>
      <Section title="Preferences">
        <div className="space-y-4">
          <Field label="Timezone" className="max-w-xs">
            <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {tzs.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </Select>
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <div className="text-[13px] font-medium">Available for new leads</div>
              <div className="text-xs text-fg-3">When off, round robin skips you (e.g. vacation or full calendar).</div>
            </div>
            <Switch checked={form.available_for_rr} onChange={(v) => set("available_for_rr", v)} />
          </div>
        </div>
      </Section>
      <div className="mb-10 flex justify-end"><Button variant="primary" loading={pending} onClick={save}>Save profile</Button></div>

      <Section title="Role & compensation" description="Set by an admin.">
        <div className="flex flex-wrap gap-2 text-[13px]">
          <Tag color="blue">{profile.role.replace("_", " ")}</Tag>
          <Tag>Setup/one-time commission {pct(Number(profile.commission_rate_setup))}</Tag>
          <Tag>Recurring commission {pct(Number(profile.commission_rate_recurring))}{profile.commission_recurring_months ? ` for ${profile.commission_recurring_months} mo` : ""}</Tag>
        </div>
      </Section>

      <Section title="Password" description="Change the password you use to sign in.">
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label="New password"><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Confirm"><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        </div>
        <Button className="mt-3" onClick={changePassword} loading={pwLoading} disabled={!pw.next}>Update password</Button>
      </Section>
    </>
  );
}
