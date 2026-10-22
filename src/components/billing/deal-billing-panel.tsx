"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ExternalLink, FileSignature, Plus, RefreshCw, Send, Trophy, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Spinner } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { StatusTag, Tag } from "@/components/ui/badge";
import { cn, contactLabel, fmtDateTime, money } from "@/lib/utils";
import {
  getDealBilling, sendContract, resendContract, refreshContract, markContractSigned, markDealWonWithoutContract, type DealBillingData,
} from "@/lib/actions/billing";
import { InvoiceTable, CreateInvoiceDialog, ScheduleList, KIND_LABEL } from "./invoice-ui";
import type { Contract } from "@/lib/types";

const STEPS: { key: keyof Contract; label: string }[] = [
  { key: "sent_at", label: "Sent" },
  { key: "viewed_at", label: "Viewed" },
  { key: "completed_at", label: "Signed" },
];

function ContractTimeline({ c }: { c: Contract }) {
  return (
    <ol className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const at = c[s.key] as string | null;
        const reached = !!at || (s.key === "viewed_at" && !!c.completed_at);
        return (
          <li key={s.key} className="flex items-center gap-1">
            <span title={at ? fmtDateTime(at) : undefined}
              className={cn("flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium", reached ? "bg-success-soft text-success" : "bg-bg-3 text-fg-3")}>
              {reached && <Check className="size-3" />} {s.label}
            </span>
            {i < STEPS.length - 1 && <span className={cn("h-px w-4", reached ? "bg-success" : "bg-border-strong")} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Contract + invoices + billing schedule for a deal. Rendered on the deal record page. */
export function DealBillingPanel({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [data, setData] = useState<DealBillingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getDealBilling(dealId);
    if (r.ok) { setData(r.data); setError(null); } else setError(r.error);
  }, [dealId]);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, p: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(key);
    const r = await p();
    setBusy(null);
    if (r.ok) { toast.success(success); await load(); router.refresh(); } else toast.error((r as { error: string }).error);
    return r.ok;
  };

  if (error) return <Card title="Billing"><p className="text-[13px] text-danger">{error}</p></Card>;
  if (!data) return <Card title="Billing"><div className="flex justify-center py-6"><Spinner /></div></Card>;

  const contract = data.contracts[0] ?? null;
  const canSendNew = !contract || ["declined", "voided", "error"].includes(contract.status);
  const isWon = contract?.status === "completed";
  const contact = data.deal.contact;
  const total = data.lineItems.reduce((a, l) => a + Number(l.unit_price) * l.quantity, 0);

  return (
    <div className="space-y-3">
      <Card title={<span className="flex items-center gap-1.5"><FileSignature className="size-4 text-fg-3" /> Contract</span>}
        actions={contract?.pandadoc_document_id && (
          <Button size="xs" variant="ghost" icon={RefreshCw} loading={busy === "refresh"} onClick={() => act("refresh", () => refreshContract(contract.id), "Status refreshed")} aria-label="Refresh status" />
        )}>
        {contract ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[13px] font-medium">{contract.name}</span>
              <StatusTag status={contract.status} />
            </div>
            {contract.status === "error" && contract.error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">{contract.error}</p>}
            {!["error", "draft"].includes(contract.status) && <ContractTimeline c={contract} />}
            {contract.status === "draft" && <p className="text-xs text-fg-3">PandaDoc is still processing the document — it will be sent automatically within a minute.</p>}
            <div className="flex flex-wrap gap-1.5">
              {contract.document_url && <Button size="sm" icon={ExternalLink} onClick={() => window.open(contract.document_url!, "_blank")}>Open in PandaDoc</Button>}
              {["sent", "viewed", "draft"].includes(contract.status) && (
                <Button size="sm" icon={Send} loading={busy === "resend"} onClick={() => act("resend", () => resendContract(contract.id), "Reminder sent to client")}>Resend</Button>
              )}
              {data.isAdmin && ["sent", "viewed", "draft"].includes(contract.status) && (
                <Button size="sm" icon={BadgeCheck} loading={busy === "signed"}
                  onClick={() => confirm("Mark this contract as signed? This moves the deal to Won, creates the client, and sends the first invoice.") && act("signed", () => markContractSigned(contract.id), "Marked signed — client created & first invoice sent")}>
                  Mark as signed
                </Button>
              )}
              {canSendNew && <Button size="sm" variant="primary" icon={Send} onClick={() => setConfirmSend(true)}>Send new contract</Button>}
            </div>
            {isWon && data.clientId && (
              <Link href={`/clients/${data.clientId}`} className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline"><Trophy className="size-3.5" /> View client account →</Link>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-[13px] text-fg-3">Send a contract generated from your PandaDoc template, pre-filled with this deal&apos;s numbers. When it&apos;s signed, the deal is won, the client is created, and the first invoice goes out automatically.</p>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="primary" icon={Send} onClick={() => setConfirmSend(true)}>Send contract</Button>
              {data.isAdmin && (
                <Button icon={Trophy} loading={busy === "won"}
                  onClick={() => confirm("Close as won without a PandaDoc contract? The client will be created and the first invoice sent.") && act("won", () => markDealWonWithoutContract(dealId), "Deal won — client created")}>
                  Signed offline
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title="Invoices" padded={false}
        actions={data.canManage && <Button size="xs" variant="ghost" icon={Plus} onClick={() => setCreating(true)} disabled={!contact}>Create invoice</Button>}>
        <InvoiceTable invoices={data.invoices} canManage={data.canManage} onChange={load} compact />
      </Card>

      {data.canManage && (data.schedules.length > 0 || isWon) && (
        <Card title="Automatic billing" padded={false}>
          <div className="py-1"><ScheduleList schedules={data.schedules} canManage={data.canManage} onChange={load} clientId={data.clientId} /></div>
        </Card>
      )}

      <Dialog open={confirmSend} onOpenChange={setConfirmSend} title="Send contract for signature?"
        description="A PandaDoc document is generated from your template and emailed for e-signature."
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmSend(false)}>Cancel</Button>
          <Button variant="primary" icon={Send} loading={busy === "send"} disabled={!contact?.email}
            onClick={async () => { if (await act("send", () => sendContract(dealId), "Contract sent for signature")) setConfirmSend(false); }}>
            Send contract
          </Button>
        </>}>
        <div className="space-y-3 text-[13px]">
          <div className="rounded-md border border-border p-2">
            <div className="text-xs text-fg-3">Recipient</div>
            {contact ? (
              <div>{contactLabel(contact)} {contact.email ? <span className="text-fg-3">· {contact.email}</span> : <span className="text-danger">· no email on file</span>}</div>
            ) : <div className="text-danger">No contact linked to this deal</div>}
          </div>
          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border-light px-2 py-1.5 text-xs text-fg-3">
              <span>{data.deal.deal_number} · {data.deal.name}</span><span>{data.deal.term_months ?? 12}-month term</span>
            </div>
            {data.lineItems.length ? data.lineItems.map((l) => (
              <div key={l.id} className="flex items-center gap-2 px-2 py-1.5">
                <span className="flex-1 truncate">{l.name}{l.quantity > 1 && ` × ${l.quantity}`}</span>
                <Tag color={l.type === "recurring" ? "purple" : l.type === "milestone" ? "orange" : "blue"}>{KIND_LABEL[l.type]}{l.type === "recurring" && l.interval_months > 1 ? ` /${l.interval_months}mo` : ""}</Tag>
                <span className="w-24 text-right tabular-nums">{money(Number(l.unit_price) * l.quantity, { cents: true })}</span>
              </div>
            )) : (
              <div className="px-2 py-1.5 text-fg-2">Setup {money(data.deal.amount_one_time)} · {money(data.deal.amount_recurring)}/mo <span className="text-fg-3">(add line items for an itemized pricing table)</span></div>
            )}
            {data.lineItems.length > 0 && (
              <div className="flex justify-between border-t border-border-light px-2 py-1.5 text-xs">
                <span className="text-fg-3">Setup {money(data.deal.amount_one_time)} · MRR {money(data.deal.amount_recurring)}</span>
                <span className="font-medium">{money(total, { cents: true })}</span>
              </div>
            )}
          </div>
        </div>
      </Dialog>

      {creating && (
        <CreateInvoiceDialog open onClose={() => setCreating(false)} contactId={contact?.id ?? null} dealId={dealId} clientId={data.clientId} lineItems={data.lineItems} onDone={load} />
      )}
    </div>
  );
}
