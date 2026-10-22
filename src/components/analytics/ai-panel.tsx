"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import { RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, Spinner } from "@/components/ui/misc";
import { askAi, refreshBriefing } from "@/lib/actions/finance";
import { timeAgo } from "@/lib/utils";

const md = "text-[13px] leading-relaxed text-fg [&_h1]:text-sm [&_h2]:text-[13px] [&_h3]:text-[13px] [&_h1,&_h2,&_h3]:mt-3 [&_h1,&_h2,&_h3]:mb-1 [&_h1,&_h2,&_h3]:font-semibold [&_ul]:list-disc [&_ol]:list-decimal [&_ul,&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-1.5 [&_strong]:font-semibold";

/** Weekly AI briefing — regenerates automatically when older than 7 days. */
export function BriefingCard({ initial, aiReady }: { initial: { content: string; created_at: string } | null; aiReady: boolean }) {
  const [b, setB] = useState(initial);
  const [pending, start] = useTransition();
  const auto = useRef(false);
  const stale = !b || Date.now() - new Date(b.created_at).getTime() > 7 * 864e5;

  const refresh = () => start(async () => {
    const r = await refreshBriefing();
    if (r.ok) setB(r.data); else toast.error(r.error);
  });

  useEffect(() => {
    if (aiReady && stale && !auto.current) { auto.current = true; refresh(); }
  }, [aiReady, stale]);

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-accent" />Weekly AI briefing</span>}
      actions={<>
        {b && <span className="text-xs text-fg-3">{timeAgo(b.created_at)}</span>}
        <Button size="xs" variant="ghost" icon={RefreshCw} loading={pending} disabled={!aiReady} onClick={refresh}>Refresh</Button>
      </>}>
      {!aiReady ? (
        <p className="text-[13px] text-fg-3">Add <code>OPENROUTER_API_KEY</code> to enable AI briefings.</p>
      ) : pending && !b ? (
        <div className="flex items-center gap-2 text-[13px] text-fg-3"><Spinner /> Analyzing the last 30 days…</div>
      ) : b ? (
        <div className={md}><ReactMarkdown>{b.content}</ReactMarkdown></div>
      ) : null}
    </Card>
  );
}

const SUGGESTIONS = ["Where am I losing the most money?", "Which lead source should I spend more on?", "Which rep needs coaching and why?", "Am I on track vs last period?"];

export function AskAi({ range, aiReady }: { range: { range?: string; from?: string; to?: string }; aiReady: boolean }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [pending, start] = useTransition();
  const ask = (question: string) => {
    if (!question.trim()) return;
    start(async () => {
      const r = await askAi(question, range);
      if (r.ok) { setAnswer({ q: question, a: r.data }); setQ(""); } else toast.error(r.error);
    });
  };
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-4 text-accent" />Ask AI about your business</span>}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={aiReady ? "e.g. Why did net profit drop this month?" : "Configure OpenRouter to enable"} disabled={!aiReady || pending} />
        <Button type="submit" variant="primary" icon={Send} loading={pending} disabled={!aiReady || !q.trim()}>Ask</Button>
      </form>
      {!answer && aiReady && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={pending} className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-2 hover:bg-hover cursor-pointer disabled:opacity-50">{s}</button>
          ))}
        </div>
      )}
      {pending && <div className="mt-3 flex items-center gap-2 text-[13px] text-fg-3"><Spinner /> Crunching your numbers…</div>}
      {answer && !pending && (
        <div className="mt-3 rounded-md bg-bg-2 p-3">
          <div className="mb-1 text-xs text-fg-3">{answer.q}</div>
          <div className={md}><ReactMarkdown>{answer.a}</ReactMarkdown></div>
        </div>
      )}
    </Card>
  );
}
