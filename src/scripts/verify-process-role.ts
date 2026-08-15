// ═══════════════════════════════════════════════════════════════════════════════════
// PROCESS-ROLE GATE PROOF
//
//   npx tsx src/scripts/verify-process-role.ts
//
// Boots the REAL server four ways and asserts what actually starts in each. Nothing is
// stubbed — this spawns `src/server.ts` as a child process and reads its startup output.
//
// ── ⚠ THE PRODUCTION DATABASE IS NEVER TOUCHED ─────────────────────────────────────
// Two mechanisms, both necessary:
//   1. Each child is spawned with cwd = a temp directory, so `dotenv.config()` (which
//      resolves `.env` relative to cwd) finds NOTHING. The repo's .env — which carries
//      NODE_ENV=development AND the production DATABASE_URL — is therefore never loaded.
//      Every variable the child sees is set explicitly below.
//   2. DATABASE_URL is set to either the Part 2 throwaway container on 127.0.0.1:55432,
//      an unreachable local port, or a deliberately invalid host. Never the real one.
// The parent process never opens a Prisma client at all.
// ═══════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";

const CONTAINER = "vytal-process-role-harness";
const PORT_DB = 55433;
const HARNESS_DB = `postgresql://postgres:harness@127.0.0.1:${PORT_DB}/postgres`;
// Never resolves, never connects — proves API-only mode needs no database at boot.
const DEAD_DB = "postgresql://nobody:nobody@127.0.0.1:1/postgres";
// A syntactically valid but non-local host, to exercise the "not local" warning.
const FAKE_REMOTE_DB = "postgresql://u:p@db.example.invalid:5432/postgres";
const SUPABASE = "https://example.supabase.co";

const SERVER = path.resolve(process.cwd(), "src/server.ts");
const TSX = path.resolve(process.cwd(), "node_modules/.bin/tsx");

let passed = 0, failed = 0;
const failures: string[] = [];
const ok = (l: string, c: boolean, d = "") => {
  if (c) { passed++; console.log(`   ✅ ${l}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(l); console.log(`   ❌ ${l}${d ? ` — ${d}` : ""}`); }
};
const head = (n: string) => console.log(`\n${"─".repeat(78)}\n${n}\n${"─".repeat(78)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const docker = (...a: string[]) =>
  execFileSync("docker", a, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

const DDL = `
CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 100, payload JSONB NOT NULL, result JSONB,
  "errorMessage" TEXT, "errorStack" TEXT, progress INTEGER NOT NULL DEFAULT 0,
  "progressNote" TEXT, cancel_requested BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at TIMESTAMP(3),
  finished_at TIMESTAMP(3), duration_ms INTEGER, last_heartbeat_at TIMESTAMP(3),
  reclaim_count INTEGER NOT NULL DEFAULT 0, "triggeredBy" TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 1);
CREATE INDEX bj_a ON background_jobs (status, priority, created_at);
CREATE INDEX bj_b ON background_jobs (status, last_heartbeat_at);
`;

async function startDb() {
  try { docker("rm", "-f", CONTAINER); } catch { /* not running */ }
  docker("run", "-d", "--rm", "--name", CONTAINER, "-e", "POSTGRES_PASSWORD=harness",
    "-p", `${PORT_DB}:5432`, "postgres:16-alpine");
  const until = Date.now() + 90_000;
  for (;;) {
    try {
      const c = new Client({ connectionString: HARNESS_DB });
      await c.connect(); await c.query("SELECT 1"); await c.end();
      break;
    } catch (e) {
      if (Date.now() > until) throw new Error(`harness db never ready: ${(e as Error).message}`);
      await sleep(500);
    }
  }
  const c = new Client({ connectionString: HARNESS_DB });
  await c.connect(); await c.query(DDL); await c.end();
  console.log(`✓ throwaway postgres up on :${PORT_DB} (the ONLY database this proof writes to)`);
}
const stopDb = () => { try { docker("rm", "-f", CONTAINER); console.log("✓ container removed"); } catch { /* gone */ } };

/** Spawn the real server with an explicitly-built env and a cwd that has no .env. */
async function boot(label: string, envOverrides: Record<string, string>, port: number, ms = 6000) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vytal-role-"));
  const child = spawn(TSX, [SERVER], {
    cwd: tmp, // ← dotenv finds no .env here; the repo's production URL is unreachable
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,      // node needs this on Windows
      HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
      PORT: String(port),
      SUPABASE_URL: SUPABASE,
      ...envOverrides,
    } as NodeJS.ProcessEnv,
    shell: process.platform === "win32",
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d.toString(); });
  child.stderr.on("data", (d) => { out += d.toString(); });

  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !out.includes("Server running on")) await sleep(150);
  await sleep(600); // let any post-listen background logs land

  // Prove it actually serves while we still have it up.
  let healthOk = false;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    healthOk = r.ok && (await r.json())?.status === "ok";
  } catch { /* recorded as false */ }

  child.kill("SIGKILL"); // SIGKILL, not SIGTERM — we are testing boot, not shutdown
  await sleep(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n──── STARTUP OUTPUT · ${label} ────\n${out.trim()}\n──── end ────`);
  return { out, healthOk };
}

async function main() {
  await startDb();

  // ── CASE A ───────────────────────────────────────────────────────────────────────
  head("CASE A — NODE_ENV unset (and an UNREACHABLE database) → API only");
  const a = await boot("A · NODE_ENV unset", { DATABASE_URL: DEAD_DB }, 4801);
  ok("★ banner says API ONLY", a.out.includes("PROCESS ROLE: API ONLY"));
  ok("★ worker OFF", /worker\s+: OFF/.test(a.out));
  ok("★ scheduler OFF", /scheduler\s+: OFF/.test(a.out));
  ok("★ reaper OFF (boot pass AND timer)", /reaper\s+: OFF/.test(a.out));
  ok("★ inline sweeps OFF", /sweeps\s+: OFF/.test(a.out));
  ok("the worker never announced itself", !a.out.includes("[worker] starting"));
  ok("no cron was registered", !a.out.includes("[Scheduler] Registered"));
  ok("the banner says WHY", a.out.includes("Decided by: NODE_ENV=(unset)"));
  ok("…and how to override on purpose", a.out.includes("ENABLE_WORKER=true"));
  ok("★ the API still starts", a.out.includes("Server running on"));
  ok("★ …and still SERVES — with a database it cannot even reach", a.healthOk,
     "GET /health → {status:'ok'} against an unreachable DATABASE_URL");

  // ── CASE B ───────────────────────────────────────────────────────────────────────
  head("CASE B — NODE_ENV=production → everything starts, as before");
  const b = await boot("B · NODE_ENV=production", { NODE_ENV: "production", DATABASE_URL: HARNESS_DB }, 4802);
  ok("★ banner says API + BACKGROUND WORK", b.out.includes("PROCESS ROLE: API + BACKGROUND WORK"));
  ok("★ worker ON", /worker\s+: ON/.test(b.out));
  ok("★ scheduler ON", /scheduler\s+: ON/.test(b.out));
  ok("★ reaper ON", /reaper\s+: ON/.test(b.out));
  ok("★ sweeps ON", /sweeps\s+: ON/.test(b.out));
  ok("the banner names the deciding env", b.out.includes("Decided by: NODE_ENV=production"));
  ok("★ the worker actually started", b.out.includes("[worker] starting"));
  const registered = (b.out.match(/\[Scheduler\] Registered/g) ?? []).length;
  ok("★ the full cron registry was registered — NOTHING REGRESSED", registered >= 30, `${registered} cron(s) registered`);
  ok("…including the 2-minute job reaper", b.out.includes('"job-reaper" → */2 * * * *'));
  ok("…including the nightly health check", b.out.includes('"daily-job-health-check"'));
  ok("…and the retention prune is ARMED, not held", b.out.includes('"nightly-retention-prune"') && !b.out.includes("HELD (disabled)"));
  ok("no override warning on a clean production boot", !b.out.includes("ENABLE_WORKER is set on a production process"));
  ok("the API serves", b.healthOk);

  // ── CASE C ───────────────────────────────────────────────────────────────────────
  head("CASE C — development + ENABLE_WORKER=true (local DB) → worker starts, log says so");
  const c = await boot("C · dev + ENABLE_WORKER=true", { NODE_ENV: "development", ENABLE_WORKER: "true", DATABASE_URL: HARNESS_DB }, 4803);
  ok("★ banner says API + BACKGROUND WORK", c.out.includes("PROCESS ROLE: API + BACKGROUND WORK"));
  ok("★ the banner names the OVERRIDE plainly, not just the env",
     c.out.includes("Decided by: NODE_ENV=development with ENABLE_WORKER override"));
  ok("★ worker ON", /worker\s+: ON/.test(c.out));
  ok("★ the worker actually started", c.out.includes("[worker] starting"));
  ok("scheduler ON too — one role, no half-configured process", /scheduler\s+: ON/.test(c.out));
  ok("★ NO remote-database warning, because DATABASE_URL is local",
     !c.out.includes("DATABASE_URL is NOT local"), "127.0.0.1 recognised as local");
  ok("the API serves", c.healthOk);

  // ── CASE D ───────────────────────────────────────────────────────────────────────
  head("CASE D — the measured incident's exact shape: override ON + NON-LOCAL database");
  const d = await boot("D · dev + ENABLE_WORKER=true + remote DB", { NODE_ENV: "development", ENABLE_WORKER: "true", DATABASE_URL: FAKE_REMOTE_DB }, 4804, 8000);
  ok("★ the loud warning fires", d.out.includes("DATABASE_URL is NOT local"));
  ok("★ it names the actual consequence, not a generic caution",
     d.out.includes("ran retention_prune twice") && d.out.includes("34 overlapping executions"));

  // ── CASE E ───────────────────────────────────────────────────────────────────────
  head("CASE E — ENABLE_WORKER=false in PRODUCTION must NOT disable the worker");
  const e = await boot("E · production + ENABLE_WORKER=false", { NODE_ENV: "production", ENABLE_WORKER: "false", DATABASE_URL: HARNESS_DB }, 4805);
  ok("★ worker STILL ON — the override can never switch production off", /worker\s+: ON/.test(e.out));
  ok("★ scheduler STILL ON", /scheduler\s+: ON/.test(e.out));
  ok("the worker really started", e.out.includes("[worker] starting"));

  // ── CASE F ───────────────────────────────────────────────────────────────────────
  head("CASE F — ENABLE_WORKER set on production is called out as redundant");
  const f = await boot("F · production + ENABLE_WORKER=true", { NODE_ENV: "production", ENABLE_WORKER: "true", DATABASE_URL: HARNESS_DB }, 4806);
  ok("★ warns that the flag is redundant and cannot switch it off",
     f.out.includes("ENABLE_WORKER is set on a production process") && f.out.includes("cannot switch it off"));
  ok("worker ON regardless", /worker\s+: ON/.test(f.out));
}

main()
  .catch((e) => { failed++; failures.push(`HARNESS ERROR: ${(e as Error).message}`); console.error("\n❌ threw:", e); })
  .finally(() => {
    stopDb();
    console.log(`\n${"═".repeat(78)}\nRESULT: ${passed} passed, ${failed} failed`);
    if (failures.length) { console.log("\nFailures:"); for (const x of failures) console.log(`  · ${x}`); }
    console.log("═".repeat(78));
    process.exit(failed === 0 ? 0 : 1);
  });
