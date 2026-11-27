"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Globe, Pencil, Plus, Trash2 } from "lucide-react";
import { Page, PageBody } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/input";
import { Tag } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { MarketingHeader, fmtInt, fmtMoney, fmtPct } from "@/components/marketing/header";
import { deleteLanderAction, saveLanderAction } from "@/lib/actions/marketing";

type Lander = { id: string; name: string; kind: "page" | "form"; url: string | null; landing_page_id: string | null; tracked: boolean; visits: number; leads: number; spend: number; ads: number };
type CrmPage = { id: string; name: string; slug: string; external_url: string | null };

export function LandersView({ landers, crmPages, days }: { landers: Lander[]; crmPages: CrmPage[]; days: number }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Lander | "new" | null>(null);
  return (
    <Page>
      <MarketingHeader active="landers" days={days} actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing("new")}>Add page or form</Button>} />
      <PageBody>
        {!landers.length ? (
          <EmptyState icon={Globe} title="No landers or forms yet" description="Add the landing pages and lead forms your ads send people to. Link a CRM landing page and its visits are tracked automatically."
            action={<Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>Add page or form</Button>} />
        ) : (
          <Card padded={false}>
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-fg-3">
                <tr className="border-b border-border-light">
                  <th className="px-3 py-2 font-medium">Page / form · last {days} days</th>
                  {["Visits", "Leads", "Conversion", "Ad spend", "Cost / lead"].map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {landers.map((l) => (
                  <tr key={l.id} className="border-b border-border-light last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium">{l.name}</span>
                      <Tag className="ml-2" color={l.kind === "form" ? "blue" : "purple"}>{l.kind === "form" ? "Lead form" : "Page"}</Tag>
                      {l.tracked && <Tag className="ml-1" color="green">Tracked</Tag>}
                      {l.url && <a href={l.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-fg-4 hover:text-fg"><ExternalLink className="size-3.5" /></a>}
                      <div className="text-xs text-fg-4">{l.ads ? `${l.ads} ad${l.ads === 1 ? "" : "s"} linked` : "No ads linked yet — link them on a campaign page"}{!l.tracked ? " · visits = link clicks" : ""}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(l.visits)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(l.leads)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(l.leads, l.visits)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.spend)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.leads && l.spend ? l.spend / l.leads : null)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="xs" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setEditing(l)} />
                      <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete" onClick={async () => {
                        if (!confirm(`Delete "${l.name}"? Ads linked to it are kept.`)) return;
                        const r = await deleteLanderAction(l.id); if (!r.ok) return toast.error(r.error); router.refresh();
                      }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </PageBody>
      {editing && <LanderDialog lander={editing === "new" ? null : editing} crmPages={crmPages} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />}
    </Page>
  );
}

function LanderDialog({ lander, crmPages, onClose, onSaved }: { lander: Lander | null; crmPages: CrmPage[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(lander?.name ?? "");
  const [kind, setKind] = React.useState<string>(lander?.kind ?? "page");
  const [url, setUrl] = React.useState(lander?.url ?? "");
  const [pageId, setPageId] = React.useState(lander?.landing_page_id ?? "");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={lander ? "Edit page or form" : "Add page or form"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={async () => {
        setBusy(true);
        const r = await saveLanderAction({ id: lander?.id, name, kind, url, landing_page_id: kind === "page" ? pageId || null : null });
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        onSaved();
      }}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="page">Landing page</option><option value="form">Lead form (e.g. Meta instant form)</option></Select></Field>
        {kind === "page" && crmPages.length > 0 && (
          <Field label="CRM landing page" hint="Pick one to track its visits and leads automatically. Leave empty for an outside page.">
            <Select value={pageId} onChange={(e) => { setPageId(e.target.value); const p = crmPages.find((x) => x.id === e.target.value); if (p && !name) setName(p.name); }}>
              <option value="">— Outside page —</option>
              {crmPages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "form" ? "e.g. Free quote form" : "e.g. Lawn care offer page"} /></Field>
        <Field label="URL (optional)"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
      </div>
    </Dialog>
  );
}
