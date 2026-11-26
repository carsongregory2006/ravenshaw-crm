"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, KeyRound, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rotateConnectorKeyAction, revokeConnectorKeyAction } from "@/lib/actions/workspace";
import { PageTitle, Section } from "./section";

export function AiConnectorSettings({ info, baseUrl }: { info: { last4: string; created_at: string } | null; baseUrl: string }) {
  const router = useRouter();
  const [key, setKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const link = key ? `${baseUrl}/${key}` : null;
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copied"); };
  return (
    <div className="space-y-6">
      <PageTitle title="Grok / AI connector" description="Lets Grok (or any AI app that supports MCP connectors) read and control your CRM: people, clients, deals, tasks, lead lists, daily inputs and projects." />
      <Section title="Connector link" description={info ? `Active · key ending …${info.last4} · created ${new Date(info.created_at).toLocaleDateString()}` : "No connector yet. Generate one, then paste the link into Grok."}>
        {link ? (
          <div className="space-y-2">
            <div className="flex gap-2"><Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} /><Button icon={Copy} onClick={() => copy(link)}>Copy</Button></div>
            <p className="text-xs text-warning">Copy it now — it&apos;s only shown once. Anyone with this link can control your CRM, so don&apos;t share it.</p>
          </div>
        ) : null}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" icon={KeyRound} loading={busy} onClick={async () => {
            if (info && !confirm("Make a new link? The old one stops working right away.")) return;
            setBusy(true);
            const r = await rotateConnectorKeyAction();
            setBusy(false);
            if (!r.ok) return toast.error(r.error);
            setKey(r.data.key);
            router.refresh();
          }}>{info ? "Generate new link" : "Generate connector link"}</Button>
          {info && <Button variant="ghost" icon={ShieldOff} onClick={async () => {
            if (!confirm("Turn off the connector? Grok will lose access until you generate a new link.")) return;
            const r = await revokeConnectorKeyAction();
            if (!r.ok) return toast.error(r.error);
            setKey(null);
            toast.success("Connector turned off");
            router.refresh();
          }}>Turn off</Button>}
        </div>
      </Section>
      <Section title="Add it to Grok">
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-fg-2">
          <li>Generate the link above and copy it.</li>
          <li>In Grok, open <b>Settings → Connectors</b> and add a custom connector (MCP server).</li>
          <li>Paste the link as the server URL and leave authentication empty — the key is inside the link.</li>
          <li>Ask Grok things like “what&apos;s left on my daily inputs?”, “add a task to the CRM project”, or “make Jordan Sacksner a client”.</li>
        </ol>
      </Section>
    </div>
  );
}
