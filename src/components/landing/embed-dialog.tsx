"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/misc";
import type { LandingPageVariant } from "@/lib/types";

function snippet(origin: string, slug: string) {
  return `<!-- Ravenshaw AI lead form: submits to the CRM, runs round robin + automations -->
<form id="rs-lead-form" style="display:grid;gap:8px;max-width:420px">
  <input name="first_name" placeholder="First name" required>
  <input name="last_name" placeholder="Last name">
  <input name="email" type="email" placeholder="Email" required>
  <input name="phone" type="tel" placeholder="Phone">
  <input name="company" placeholder="Company">
  <input name="company_url_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
  <button type="submit">Submit</button>
  <p id="rs-lead-msg" style="display:none">Thanks! We'll be in touch shortly.</p>
</form>
<script>
(function () {
  var f = document.getElementById("rs-lead-form");
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData(f).entries());
    d.hp = d.company_url_hp; delete d.company_url_hp;
    d.page_slug = ${JSON.stringify(slug)};
    d.referrer = document.referrer || location.href;
    var q = new URLSearchParams(location.search); d.utm = {};
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content"].forEach(function (k) { if (q.get(k)) d.utm[k] = q.get(k); });
    fetch(${JSON.stringify(origin + "/api/public/lead")}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (!r.ok) throw new Error(r.error); f.reset(); document.getElementById("rs-lead-msg").style.display = "block"; })
      .catch(function (err) { alert(err.message || "Something went wrong"); });
  });
})();
</script>`;
}

export function EmbedDialog({ open, onOpenChange, slug, variants }: { open: boolean; onOpenChange: (o: boolean) => void; slug: string; variants: LandingPageVariant[] }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const code = snippet(origin, slug);
  const copy = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copied"); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Share & embed"
      description="Use the hosted page, force a specific variant for QA or ads, or drop the form onto any external site.">
      <div className="space-y-4 pb-2">
        <div>
          <SectionTitle>Links</SectionTitle>
          <div className="space-y-1">
            {[{ label: "Split test (recommended)", url: `${origin}/p/${slug}` }, ...variants.map((v) => ({ label: `Force ${v.name}`, url: `${origin}/p/${slug}?variant=${v.id}` }))].map((l) => (
              <div key={l.url} className="flex items-center gap-2 rounded-md border border-border-light px-2 py-1">
                <span className="w-40 shrink-0 text-xs text-fg-3">{l.label}</span>
                <code className="min-w-0 flex-1 truncate text-xs">{l.url}</code>
                <Button size="xs" variant="ghost" icon={Copy} onClick={() => copy(l.url)} aria-label="Copy" />
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-fg-3">Append <code>?utm_source=…&amp;utm_campaign=…</code> to track ad sources. Forced-variant links still record views and leads against that variant.</p>
        </div>
        <div>
          <SectionTitle actions={<Button size="xs" icon={Copy} onClick={() => copy(code)}>Copy code</Button>}>Embed form on another site</SectionTitle>
          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-bg-2 p-3 text-[11px] leading-relaxed">{code}</pre>
          <p className="mt-1 text-xs text-fg-3">Leads from the embed are attributed to this page, assigned via its round robin, and enrolled in automations.</p>
        </div>
      </div>
    </Dialog>
  );
}
