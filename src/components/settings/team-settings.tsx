"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MailPlus, MoreHorizontal, Plus, RotateCcw, Send, Trash2, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { inviteMember, resendInvite, setGlobalPool, updateMember } from "@/lib/actions/settings";
import type { Profile, RrMember, UserRole } from "@/lib/types";
import { PageTitle, Section } from "./section";

const ROLES: { id: UserRole; label: string }[] = [
  { id: "admin", label: "Admin" },
  { id: "sales_rep", label: "Sales rep" },
  { id: "ops", label: "Ops / Fulfillment" },
];

/** Percent input that commits on blur (stores fraction). */
function RateInput({ value, onCommit, disabled }: { value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [v, setV] = useState(String(+(value * 100).toFixed(2)));
  return (
    <div className="relative w-[72px]">
      <Input type="number" min={0} max={100} step="0.5" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)}
        onBlur={() => { const n = Math.min(100, Math.max(0, Number(v) || 0)); if (n / 100 !== value) onCommit(n / 100); }}
        className="h-7 pr-5 text-right" />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-3">%</span>
    </div>
  );
}

function MonthsInput({ value, onCommit }: { value: number | null; onCommit: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  return (
    <Input type="number" min={1} placeholder="∞" value={v} onChange={(e) => setV(e.target.value)} className="h-7 w-[64px] text-right"
      onBlur={() => { const n = v.trim() ? Math.max(1, parseInt(v) || 1) : null; if (n !== value) onCommit(n); }} />
  );
}

export function TeamSettings({ me, members, pool, pending }: { me: string; members: Profile[]; pool: RrMember[]; pending: Record<string, boolean> }) {
  const [busy, start] = useTransition();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inv, setInv] = useState({ email: "", full_name: "", role: "sales_rep" as UserRole, setup: "10", recurring: "10", months: "" });
  const [poolState, setPoolState] = useState(() => pool.map((p) => ({ rep_id: p.rep_id, weight: p.weight, active: p.active })));
  const [addRep, setAddRep] = useState("");

  const upd = (id: string, patch: Parameters<typeof updateMember>[1], msg = "Saved") => start(async () => {
    const r = await updateMember(id, patch);
    if (r.ok) toast.success(msg); else toast.error(r.error);
  });

  const invite = () => start(async () => {
    if (!/\S+@\S+\.\S+/.test(inv.email)) return void toast.error("Enter a valid email");
    const r = await inviteMember({
      email: inv.email, full_name: inv.full_name, role: inv.role,
      setup: (Number(inv.setup) || 0) / 100, recurring: (Number(inv.recurring) || 0) / 100,
      months: inv.months ? parseInt(inv.months) : null,
    });
    if (r.ok) { toast.success(`Invite sent to ${inv.email}`); setInviteOpen(false); setInv({ email: "", full_name: "", role: "sales_rep", setup: "10", recurring: "10", months: "" }); }
    else toast.error(r.error);
  });

  const savePool = () => start(async () => {
    const r = await setGlobalPool(poolState);
    if (r.ok) toast.success("Round robin pool saved"); else toast.error(r.error);
  });

  const active = members.filter((m) => m.is_active);
  const notInPool = active.filter((m) => !poolState.some((p) => p.rep_id === m.id));
  const totalWeight = poolState.filter((p) => p.active).reduce((a, p) => a + p.weight, 0);
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));

  return (
    <>
      <PageTitle title="Team" description="Members, roles, commission terms and lead distribution." />
      <Section title="Members" description="Admins see everything. Ops see all records and finance. Sales reps see their own leads, deals and commissions."
        actions={<Button variant="primary" icon={MailPlus} onClick={() => setInviteOpen(true)}>Invite member</Button>}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-3">
                <th className="px-3 py-2 font-normal">Member</th>
                <th className="px-2 py-2 font-normal">Role</th>
                <th className="px-2 py-2 font-normal" title="Commission on one-time & milestone cash collected">Setup</th>
                <th className="px-2 py-2 font-normal" title="Commission on recurring cash collected">Recurring</th>
                <th className="px-2 py-2 font-normal" title="Months of recurring commission (blank = forever)">Months</th>
                <th className="px-2 py-2 font-normal" title="Eligible for round robin">RR</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={`border-b border-border-light last:border-0 ${m.is_active ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={m.full_name || m.email} src={m.avatar_url} size={24} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 truncate font-medium">
                          {m.full_name || m.email.split("@")[0]}
                          {m.id === me && <Tag color="gray">You</Tag>}
                          {pending[m.id] && <Tag color="yellow">Invited</Tag>}
                          {!m.is_active && <Tag color="red">Deactivated</Tag>}
                        </div>
                        <div className="truncate text-xs text-fg-3">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <Select value={m.role} disabled={m.id === me || busy} onChange={(e) => upd(m.id, { role: e.target.value as UserRole }, "Role updated")} className="h-7 w-[130px]">
                      {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-2"><RateInput value={Number(m.commission_rate_setup)} onCommit={(v) => upd(m.id, { commission_rate_setup: v }, "Commission updated")} /></td>
                  <td className="px-2 py-2"><RateInput value={Number(m.commission_rate_recurring)} onCommit={(v) => upd(m.id, { commission_rate_recurring: v }, "Commission updated")} /></td>
                  <td className="px-2 py-2"><MonthsInput value={m.commission_recurring_months} onCommit={(v) => upd(m.id, { commission_recurring_months: v }, "Commission updated")} /></td>
                  <td className="px-2 py-2"><Switch checked={m.available_for_rr} disabled={busy} onChange={(v) => upd(m.id, { available_for_rr: v }, v ? "Receiving leads" : "Paused from round robin")} /></td>
                  <td className="px-1 py-2">
                    <Menu>
                      <MenuTrigger asChild><Button size="xs" variant="ghost" icon={MoreHorizontal} aria-label="Member actions" /></MenuTrigger>
                      <MenuContent align="end">
                        {pending[m.id] && <MenuItem icon={Send} onSelect={() => start(async () => { const r = await resendInvite(m.email); if (r.ok) toast.success("Invite re-sent"); else toast.error(r.error); })}>Resend invite</MenuItem>}
                        {m.is_active
                          ? <MenuItem icon={UserX} danger disabled={m.id === me} onSelect={() => { if (confirm(`Deactivate ${m.email}? They will be signed out and can't log in.`)) upd(m.id, { is_active: false }, "Member deactivated"); }}>Deactivate</MenuItem>
                          : <MenuItem icon={UserCheck} onSelect={() => upd(m.id, { is_active: true }, "Member reactivated")}>Reactivate</MenuItem>}
                      </MenuContent>
                    </Menu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Default round robin pool" description="Used for leads that don't come from a landing page, and as a fallback when a page's own pool has no available reps. Leads are split in proportion to weight."
        actions={<Button variant="primary" onClick={savePool} loading={busy}>Save pool</Button>}>
        <div className="rounded-lg border border-border">
          {poolState.length === 0 && <div className="px-3 py-4 text-[13px] text-fg-3">No reps in the pool. Leads without a landing page won&apos;t be auto-assigned.</div>}
          {poolState.map((p, i) => {
            const rep = byId[p.rep_id];
            const share = p.active && totalWeight ? Math.round((p.weight / totalWeight) * 100) : 0;
            return (
              <div key={p.rep_id} className="flex items-center gap-3 border-b border-border-light px-3 py-2 last:border-0">
                <Avatar name={rep?.full_name || rep?.email} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{rep?.full_name || rep?.email || "Unknown"}</div>
                  {rep && !rep.available_for_rr && <div className="text-xs text-warning">Marked unavailable — skipped</div>}
                </div>
                <div className="w-28">
                  <div className="h-1.5 rounded-full bg-bg-3"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${share}%` }} /></div>
                  <div className="mt-0.5 text-right text-xs text-fg-3">{share}% of leads</div>
                </div>
                <Input type="number" min={0} value={p.weight} className="h-7 w-20 text-right" aria-label="Weight" title="Weight"
                  onChange={(e) => setPoolState((xs) => xs.map((x, j) => (j === i ? { ...x, weight: Math.max(0, parseInt(e.target.value) || 0) } : x)))} />
                <Switch checked={p.active} onChange={(v) => setPoolState((xs) => xs.map((x, j) => (j === i ? { ...x, active: v } : x)))} />
                <Button size="xs" variant="ghost" icon={Trash2} aria-label="Remove from pool" onClick={() => setPoolState((xs) => xs.filter((_, j) => j !== i))} />
              </div>
            );
          })}
        </div>
        {notInPool.length > 0 && (
          <div className="mt-2 flex gap-2">
            <Select value={addRep} onChange={(e) => setAddRep(e.target.value)} className="max-w-xs">
              <option value="">Add a member…</option>
              {notInPool.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
            </Select>
            <Button icon={Plus} disabled={!addRep} onClick={() => { setPoolState((xs) => [...xs, { rep_id: addRep, weight: 1, active: true }]); setAddRep(""); }}>Add</Button>
          </div>
        )}
        {poolState.length > 0 && (
          <Button size="xs" variant="ghost" icon={RotateCcw} className="mt-2" onClick={() => setPoolState(pool.map((p) => ({ rep_id: p.rep_id, weight: p.weight, active: p.active })))}>Discard changes</Button>
        )}
      </Section>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title="Invite a team member" description="They'll get an email with a link to set up their account."
        footer={<><Button onClick={() => setInviteOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={invite}>Send invite</Button></>}>
        <div className="grid grid-cols-2 gap-3 pb-2">
          <Field label="Email" className="col-span-2"><Input type="email" autoFocus value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} placeholder="rep@ravenshaw.ai" /></Field>
          <Field label="Full name"><Input value={inv.full_name} onChange={(e) => setInv({ ...inv, full_name: e.target.value })} /></Field>
          <Field label="Role">
            <Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as UserRole })}>
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Setup / one-time commission %"><Input type="number" min={0} max={100} value={inv.setup} onChange={(e) => setInv({ ...inv, setup: e.target.value })} /></Field>
          <Field label="Recurring commission %"><Input type="number" min={0} max={100} value={inv.recurring} onChange={(e) => setInv({ ...inv, recurring: e.target.value })} /></Field>
          <Field label="Recurring months cap" hint="Blank = paid on every recurring payment." className="col-span-2"><Input type="number" min={1} value={inv.months} onChange={(e) => setInv({ ...inv, months: e.target.value })} placeholder="∞" /></Field>
        </div>
      </Dialog>
    </>
  );
}
