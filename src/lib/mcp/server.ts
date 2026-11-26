import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TOOLS } from "./tools";

const KEY = "mcp_connector";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface ConnectorInfo { last4: string; created_at: string; created_by: string }

/** New connector key: only its hash is stored. Returns the plaintext once. */
export async function rotateConnectorKey(userId: string) {
  const token = `rav_${randomBytes(24).toString("base64url")}`;
  const db = createAdminClient();
  const { error } = await db.from("app_kv").upsert({ key: KEY, value: { hash: sha(token), last4: token.slice(-4), created_at: new Date().toISOString(), created_by: userId }, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return token;
}

export async function connectorInfo(): Promise<ConnectorInfo | null> {
  const { data } = await createAdminClient().from("app_kv").select("value").eq("key", KEY).maybeSingle();
  const v = data?.value as (ConnectorInfo & { hash?: string }) | undefined;
  return v?.hash ? { last4: v.last4, created_at: v.created_at, created_by: v.created_by } : null;
}

export async function revokeConnectorKey() {
  await createAdminClient().from("app_kv").delete().eq("key", KEY);
}

async function authorize(token: string | null): Promise<string | null> {
  if (!token) return null;
  const { data } = await createAdminClient().from("app_kv").select("value").eq("key", KEY).maybeSingle();
  const v = data?.value as { hash?: string; created_by?: string } | undefined;
  if (!v?.hash || !v.created_by) return null;
  const a = Buffer.from(sha(token)), b = Buffer.from(v.hash);
  return a.length === b.length && timingSafeEqual(a, b) ? v.created_by : null;
}

type RpcReq = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
const ok = (id: RpcReq["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: RpcReq["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: RpcReq, userId: string) {
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ravenshaw-crm", version: "1.0.0" },
        instructions: "Ravenshaw AI CRM. Use crm_overview first for a snapshot. People = contacts; setting a person's status to client creates their client account. Daily inputs reset every day (Montreal time). Projects have todo/doing/done task boards.",
      });
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await tool.run((msg.params?.arguments as Record<string, unknown>) ?? {}, { db: createAdminClient(), userId });
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: Array.isArray(result) ? { items: result } : (result as object) ?? {} });
      } catch (e) {
        return ok(msg.id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      if (msg.id === undefined) return null; // notification (e.g. notifications/initialized)
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Stateless Streamable-HTTP MCP endpoint. Auth: key in the URL path, or Authorization: Bearer <key>. */
export async function mcpHandler(req: NextRequest, pathToken: string | null) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const userId = await authorize(pathToken ?? bearer);
  if (!userId) return NextResponse.json(fail(null, -32001, "Unauthorized: invalid or missing connector key"), { status: 401 });
  if (req.method === "GET") return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
  if (req.method === "DELETE") return new NextResponse(null, { status: 204 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json(fail(null, -32700, "Parse error"), { status: 400 }); }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as RpcReq[];
  const out = (await Promise.all(msgs.map((m) => handle(m, userId)))).filter(Boolean);
  if (!out.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? out : out[0]);
}
