"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Rocket } from "lucide-react";
import { differenceInCalendarDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Drawer } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/misc";
import { PageBody } from "@/components/ui/page";
import { cn, contactLabel } from "@/lib/utils";
import { completeOnboarding } from "@/lib/actions/billing";
import { OnboardingChecklist } from "./client-profile";
import { Progress } from "./clients-table";
import type { Client, Contact, Company, OnboardingStep, Profile } from "@/lib/types";

export type OnboardingCard = Client & {
  contact: Pick<Contact, "id" | "first_name" | "last_name" | "email"> | null;
  company: Pick<Company, "id" | "name"> | null;
  manager: Pick<Profile, "id" | "full_name" | "avatar_url"> | null;
  steps: OnboardingStep[];
};

const COLUMNS = [
  { id: "not_started", label: "Not started", color: "bg-fg-4", test: (p: number) => p === 0 },
  { id: "in_progress", label: "In progress", color: "bg-accent", test: (p: number) => p > 0 && p < 0.75 },
  { id: "almost", label: "Almost done", color: "bg-warning", test: (p: number) => p >= 0.75 && p < 1 },
  { id: "ready", label: "Ready to activate", color: "bg-success", test: (p: number) => p >= 1 },
];

export function OnboardingBoard({ cards, team, canManage }: { cards: OnboardingCard[]; team: Pick<Profile, "id" | "full_name" | "email">[]; canManage: boolean }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = cards.find((c) => c.id === openId) ?? null;
  const progress = (c: OnboardingCard) => (c.steps.length ? c.steps.filter((s) => s.completed_at).length / c.steps.length : 0);

  const activate = async (id: string) => {
    setBusy(id);
    const r = await completeOnboarding(id);
    setBusy(null);
    if (r.ok) { toast.success("Client is now active 🎉"); setOpenId(null); router.refresh(); } else toast.error(r.error);
  };

  if (!cards.length) {
    return <EmptyState icon={Rocket} title="No clients onboarding" description="New clients land here automatically when their contract is signed, with your onboarding checklist from Settings." className="h-full" />;
  }

  return (
    <PageBody className="bg-bg-2">
      <div className="flex h-full min-w-max gap-3 p-3">
        {COLUMNS.map((col) => {
          const items = cards.filter((c) => col.test(progress(c)));
          return (
            <div key={col.id} className="flex w-[290px] shrink-0 flex-col">
              <div className="mb-2 flex items-center gap-2 px-1 text-[13px] font-medium">
                <span className={cn("size-2 rounded-full", col.color)} /> {col.label}
                <span className="text-xs font-normal text-fg-3">{items.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto pb-4">
                {items.map((c) => {
                  const done = c.steps.filter((s) => s.completed_at).length;
                  const next = c.steps.find((s) => !s.completed_at);
                  const overdue = c.steps.filter((s) => !s.completed_at && s.due_date && new Date(s.due_date) < new Date()).length;
                  const days = differenceInCalendarDays(new Date(), new Date(c.start_date));
                  return (
                    <div key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer rounded-lg border border-border bg-bg p-3 shadow-sm transition-shadow hover:shadow-md">
                      <div className="flex items-center gap-2">
                        <Avatar name={contactLabel(c.contact)} size={20} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{contactLabel(c.contact)}</span>
                        {c.manager && <Avatar name={c.manager.full_name} src={c.manager.avatar_url} size={18} />}
                      </div>
                      {c.company && <div className="mt-0.5 truncate pl-7 text-xs text-fg-3">{c.company.name}</div>}
                      <Progress done={done} total={c.steps.length} className="mt-2" />
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-fg-3">
                        {next ? <><ArrowRight className="size-3 shrink-0" /><span className="truncate">{next.title}</span></> : <><CheckCircle2 className="size-3 text-success" /> All steps complete</>}
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-fg-4">
                        <span className="inline-flex items-center gap-1"><Clock className="size-3" /> Day {days + 1}</span>
                        {overdue > 0 && <span className="inline-flex items-center gap-1 text-danger"><AlertCircle className="size-3" /> {overdue} overdue</span>}
                      </div>
                      {col.id === "ready" && canManage && (
                        <Button size="sm" variant="primary" className="mt-2 w-full" loading={busy === c.id} onClick={(e) => { e.stopPropagation(); activate(c.id); }}>Mark active</Button>
                      )}
                    </div>
                  );
                })}
                {!items.length && <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-fg-4">Empty</div>}
              </div>
            </div>
          );
        })}
      </div>
      {open && (
        <Drawer open onOpenChange={(o) => !o && setOpenId(null)} title={contactLabel(open.contact)} width={420}
          actions={<Link href={`/clients/${open.id}`} className="mr-1 text-xs text-accent hover:underline">Open client →</Link>}>
          <div className="p-4">
            <OnboardingChecklist clientId={open.id} steps={open.steps} team={team} onChange={() => router.refresh()} />
            {canManage && (
              <Button variant={progress(open) >= 1 ? "primary" : "secondary"} className="mt-4 w-full" loading={busy === open.id}
                onClick={() => (progress(open) >= 1 || confirm("Some steps are still open. Mark this client active anyway?")) && activate(open.id)}>
                Mark active
              </Button>
            )}
          </div>
        </Drawer>
      )}
    </PageBody>
  );
}
