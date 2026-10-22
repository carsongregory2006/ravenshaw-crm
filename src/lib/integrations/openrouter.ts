import "server-only";
import { need } from "@/lib/env";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";

/** Model configured in Settings → General (falls back to env/default). */
async function workspaceModel() {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data } = await createAdminClient().from("workspace_settings").select("ai_model").eq("id", 1).single();
    return (data?.ai_model as string) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** One-shot chat completion through OpenRouter. Returns the assistant text. */
export async function chat(messages: ChatMessage[], opts: { model?: string; temperature?: number; maxTokens?: number; json?: boolean } = {}) {
  const key = need("OPENROUTER_API_KEY", "OpenRouter");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://ravenshaw.ai",
      "X-Title": "Ravenshaw AI CRM",
    },
    body: JSON.stringify({
      model: opts.model || (await workspaceModel()),
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 1200,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content as string) ?? "";
}

/** Chat expecting a JSON object back; tolerant of ```json fences. */
export async function chatJson<T = Record<string, unknown>>(messages: ChatMessage[], opts: { model?: string; maxTokens?: number } = {}): Promise<T> {
  const text = await chat(messages, { ...opts, json: true, temperature: 0.2 });
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned) as T;
}
