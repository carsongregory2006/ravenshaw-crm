"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/input";
import { connectLanderAction, deleteLanderAction, updateLanderAction } from "@/lib/actions/landers";

type Existing = { id: string; name: string; external_url: string | null; has_vsl: boolean };

/** Connect a lander built elsewhere, or edit/delete one that's connected. */
export function LanderFormDialog({ open, onOpenChange, lander }: { open: boolean; onOpenChange: (o: boolean) => void; lander?: Existing }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [hasVsl, setHasVsl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(lander?.name ?? "");
    setUrl(lander?.external_url ?? "");
    setHasVsl(lander?.has_vsl ?? false);
    setConfirmDelete(false);
  }, [open, lander]);

  const save = async () => {
    setBusy(true);
    const input = { name, url, hasVsl };
    const r = lander ? await updateLanderAction(lander.id, input) : await connectLanderAction(input);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    onOpenChange(false);
    if (lander) { toast.success("Saved"); router.refresh(); }
    else { toast.success("Lander connected. Add the tracking code next."); router.push(`/landing-pages/${r.data}`); }
  };

  const remove = async () => {
    if (!lander) return;
    setBusy(true);
    const r = await deleteLanderAction(lander.id);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Lander removed");
    onOpenChange(false);
    router.push("/landing-pages");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md"
      title={lander ? "Lander settings" : "Connect a lander"}
      description={lander ? undefined : "Add a page you already built. You get one line of code to paste into it."}
      footer={confirmDelete ? (
        <>
          <span className="mr-auto text-xs text-danger">Deletes this lander&apos;s stats. Leads stay in the CRM.</span>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={remove}>Delete</Button>
        </>
      ) : (
        <>
          {lander && <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirmDelete(true)}>Delete lander</Button>}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>{lander ? "Save" : "Connect"}</Button>
        </>
      )}>
      <div className="space-y-3">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Landscaper VSL – v1" />
        </Field>
        <Field label="Page URL">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ravenshawai.com/landscapers" onKeyDown={(e) => e.key === "Enter" && save()} />
        </Field>
        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <span>
            <span className="block text-[13px] font-medium">Has a VSL</span>
            <span className="block text-xs text-fg-3">Shows watch time, drop-off and play rate. Works with YouTube, Vimeo, Wistia and regular video files.</span>
          </span>
          <Switch checked={hasVsl} onChange={setHasVsl} />
        </label>
      </div>
    </Dialog>
  );
}
