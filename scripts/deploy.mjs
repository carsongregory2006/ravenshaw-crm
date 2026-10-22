#!/usr/bin/env node
/**
 * One-shot provisioning + deploy for Ravenshaw CRM.
 *
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_ORG_ID=... VERCEL_TOKEN=... [VERCEL_TEAM_ID=...] \
 *   node scripts/deploy.mjs [--project-ref <existing ref>] [--skip-vercel]
 *
 * 1. Creates (or reuses) a Supabase project, runs every SQL file in supabase/migrations in order,
 *    configures auth redirect URLs.
 * 2. Creates a Vercel project, sets all env vars (from .env.production.local + Supabase keys), deploys
 *    via the Vercel CLI, and enables the per-minute pg_cron scheduler pointing at the deployment.
 * State is cached in .deploy-state.json so the script is safely re-runnable.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const stateFile = path.join(root, ".deploy-state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] ?? true : undefined; };

const SB = "https://api.supabase.com/v1";
const sbToken = process.env.SUPABASE_ACCESS_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sb(pathname, init = {}) {
  const res = await fetch(SB + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${sbToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${pathname} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split("\n")
      .map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "")]; })
      .filter(([, v]) => v !== ""),
  );
}

async function supabase() {
  if (!sbToken) throw new Error("SUPABASE_ACCESS_TOKEN is required");
  let ref = flag("--project-ref") || state.projectRef;
  if (!ref) {
    const org = process.env.SUPABASE_ORG_ID || (await sb("/organizations"))[0]?.id;
    if (!org) throw new Error("No Supabase organization found; set SUPABASE_ORG_ID");
    state.dbPassword = state.dbPassword || crypto.randomBytes(18).toString("base64url");
    console.log("› Creating Supabase project ravenshaw-crm …");
    const p = await sb("/projects", {
      method: "POST",
      body: JSON.stringify({ name: "ravenshaw-crm", organization_id: org, region: process.env.SUPABASE_REGION || "us-east-1", db_pass: state.dbPassword }),
    });
    ref = p.id || p.ref;
    state.projectRef = ref; save();
  }
  console.log(`› Supabase project: ${ref} — waiting until healthy …`);
  for (let i = 0; i < 90; i++) {
    const p = await sb(`/projects/${ref}`);
    if (p.status === "ACTIVE_HEALTHY") break;
    await sleep(10_000);
  }

  const keys = await sb(`/projects/${ref}/api-keys?reveal=true`);
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  state.supabase = { url: `https://${ref}.supabase.co`, anon, service };
  save();

  const migDir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  state.applied = state.applied || [];
  for (const f of files) {
    if (state.applied.includes(f)) continue;
    console.log(`› Applying ${f}`);
    await sb(`/projects/${ref}/database/query`, { method: "POST", body: JSON.stringify({ query: fs.readFileSync(path.join(migDir, f), "utf8") }) });
    state.applied.push(f); save();
  }
  return ref;
}

async function vercel(env) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN is required");
  const team = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  const v = async (p, init = {}) => {
    const res = await fetch(`https://api.vercel.com${p}${p.includes("?") ? team.replace("?", "&") : team}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok && res.status !== 409) throw new Error(`Vercel ${p} → ${res.status}: ${text}`);
    return text ? JSON.parse(text) : {};
  };

  if (!state.vercelProjectId) {
    console.log("› Creating Vercel project ravenshaw-crm …");
    const p = await v("/v11/projects", { method: "POST", body: JSON.stringify({ name: "ravenshaw-crm", framework: "nextjs" }) });
    state.vercelProjectId = p.id || (await v("/v9/projects/ravenshaw-crm")).id;
    save();
  }
  const pid = state.vercelProjectId;
  const prodUrl = state.prodUrl || `https://ravenshaw-crm.vercel.app`;
  env.NEXT_PUBLIC_APP_URL = env.NEXT_PUBLIC_APP_URL || prodUrl;

  console.log(`› Setting ${Object.keys(env).length} environment variables`);
  await v(`/v10/projects/${pid}/env?upsert=true`, {
    method: "POST",
    body: JSON.stringify(Object.entries(env).map(([key, value]) => ({
      key, value, type: key.startsWith("NEXT_PUBLIC_") ? "plain" : "encrypted", target: ["production", "preview", "development"],
    }))),
  });

  console.log("› Deploying with Vercel CLI …");
  fs.mkdirSync(path.join(root, ".vercel"), { recursive: true });
  const me = await v("/v2/user");
  fs.writeFileSync(path.join(root, ".vercel/project.json"), JSON.stringify({ projectId: pid, orgId: process.env.VERCEL_TEAM_ID || me.user.id }));
  const out = execSync(`npx --yes vercel@latest deploy --prod --yes --token ${token}`, { cwd: root, stdio: ["ignore", "pipe", "inherit"] }).toString();
  const url = out.trim().split("\n").pop();
  const proj = await v(`/v9/projects/${pid}`);
  const alias = proj.targets?.production?.alias?.[0];
  state.prodUrl = alias ? `https://${alias}` : url;
  save();
  return state.prodUrl;
}

(async () => {
  const fileEnv = readEnvFile(path.join(root, ".env.production.local"));
  const ref = await supabase();
  state.cronSecret = fileEnv.CRON_SECRET || state.cronSecret || crypto.randomBytes(24).toString("hex");
  save();
  const env = {
    ...fileEnv,
    NEXT_PUBLIC_SUPABASE_URL: state.supabase.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: state.supabase.anon,
    SUPABASE_SERVICE_ROLE_KEY: state.supabase.service,
    CRON_SECRET: state.cronSecret,
  };
  if (args.includes("--skip-vercel")) { console.log("Skipped Vercel."); return; }
  const url = await vercel(env);
  console.log(`› Production URL: ${url}`);

  // auth redirects + scheduler
  await sb(`/projects/${ref}/config/auth`, {
    method: "PATCH",
    body: JSON.stringify({ site_url: url, uri_allow_list: `${url}/**,http://localhost:3000/**` }),
  });
  await sb(`/projects/${ref}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query: `select public.schedule_crm_tick('${url}', '${state.cronSecret}');` }),
  });
  console.log("✓ Deployed. Scheduler enabled (every minute).");
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
