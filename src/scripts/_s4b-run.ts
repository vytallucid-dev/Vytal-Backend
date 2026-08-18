// ═══════════════════════════════════════════════════════════════
// STAGE 4b RUNNER — targeted re-ingest. ⚠ WRITES DATA to the four results tables.
//   npx tsx src/scripts/_s4b-run.ts --task T1 --symbols A,B,C [--chunk 8]
//
// Same contract as the Stage 3b runner, reduced to an explicit symbol list:
//   · fromDate 2017-04-01 · toDate 2025-01-31 on EVERY invocation (the v3 fence
//     has no code guard — the date is the only protection)
//   · production spacing, unchanged: BATCH_SIZE=3, SESSION_RESET_EVERY_N=3, 1500ms
//   · ledger per task, so a re-run resumes rather than repeats
//   · ⚠ SOURCE-BASED FENCE after every chunk. Concurrent crons legitimately move
//     updated_at on v3 rows, so only these are disqualifying:
//         a *_legacy source above the floor · a moved report_date ·
//         a vanished row · a row that appeared above the floor
//     updated_at movement with the v3 source intact is COUNTED, not fatal.
//   · stop for the day at 21:10 UTC (RETENTION_PRUNE at 21:30 is destructive)
//
// ⚠ NO SCORING. Calls backfillLegacySymbol directly; never goes through
//   jobs/worker.ts, so maybeEnqueueRescoresForJob is unreachable.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { nseClient } from "../lib/client.js";
import { backfillLegacySymbol } from "../ingestions/quaterly-results/legacy/backfill-legacy.js";
import { FROM_DATE, TO_DATE } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
const TASK = arg("--task") ?? "T?";
const SYMBOLS = (arg("--symbols") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const CHUNK = Number(arg("--chunk") ?? 8);
const RESET = process.argv.includes("--reset");
const DRY = process.argv.includes("--dry");
const LEDGER = `${DIR}/_s4b-${TASK}-ledger.json`;
const LOG = `${DIR}/_s4b-progress.log`;
const V3_BASE = `${DIR}/_r1d-v3-before.json`;

const BATCH_SIZE = 3, SESSION_RESET_EVERY_N = 3, BATCH_PAUSE_MS = 1500;
const STOP_FOR_DAY_UTC = 21 * 60 + 10;

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const say = (l: string) => { console.log(l); try { appendFileSync(LOG, l + "\n"); } catch { /* never fatal */ } };

type FailKind = "404" | "timeout" | "403/429" | "session" | "overflow" | "parser" | "other";
function classify(m: string): FailKind {
  const s = String(m);
  if (/\b404\b|not found/i.test(s)) return "404";
  if (/\b(403|429)\b|forbidden|too many requests/i.test(s)) return "403/429";
  if (/timeout|ETIMEDOUT|ECONNRESET|socket hang up|EAI_AGAIN/i.test(s)) return "timeout";
  if (/\b401\b|unauthor|cookie|session|captcha/i.test(s)) return "session";
  if (/numeric field overflow|out of range for the type/i.test(s)) return "overflow";
  if (/Missing required date tags|Failed to extract|Invalid period|Unable to derive/i.test(s)) return "parser";
  return "other";
}

interface V3Row { t: string; sym: string; period: string; basis: string; rd: string; src: string; ua: string; id: string }
function loadFence(): Map<string, V3Row[]> {
  const j = JSON.parse(readFileSync(V3_BASE, "utf8"));
  const m = new Map<string, V3Row[]>();
  for (const r of j.rows as V3Row[]) { if (!m.has(r.sym)) m.set(r.sym, []); m.get(r.sym)!.push(r); }
  return m;
}
/** ⚠ SOURCE-BASED. updated_at movement is observed, never a breach. */
async function fenceCheck(symbols: string[], fence: Map<string, V3Row[]>) {
  const want = symbols.flatMap((s) => fence.get(s) ?? []);
  if (!want.length) return { breaches: [] as string[], observed: 0 };
  const ids = [...new Set(want.map((r) => r.id))];
  const now = new Map<string, { src: string; ua: string; rd: string }>();
  for (const t of ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"]) {
    for (const r of await raw<any>(
      `SELECT "id","source" src,"updated_at"::text ua,"report_date"::text rd FROM "${t}" WHERE "id"=ANY($1::text[])`, ids))
      now.set(r.id, r);
  }
  const breaches: string[] = []; let observed = 0;
  for (const b of want) {
    const c = now.get(b.id); const label = `${b.sym} ${b.t} ${b.period} ${b.basis}`;
    if (!c) { breaches.push(`${label} — ROW VANISHED`); continue; }
    if (c.src !== b.src) { breaches.push(`${label} — SOURCE ${b.src} → ${c.src}`); continue; }
    if (String(c.rd).slice(0, 10) !== String(b.rd).slice(0, 10)) { breaches.push(`${label} — REPORT_DATE ${b.rd} → ${c.rd}`); continue; }
    if (c.ua !== b.ua) observed++;
  }
  return { breaches, observed };
}

async function main() {
  if (!SYMBOLS.length) { console.error("need --symbols"); process.exit(1); }
  const ledger = !RESET && existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8"))
    : { task: TASK, done: [] as string[], filings: 0, ingested: 0, failed: 0, errors: [] as any[], startedAt: new Date().toISOString() };
  const fence = loadFence();
  const todo = SYMBOLS.filter((s) => !ledger.done.includes(s));

  say(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  say(`║ STAGE 4b · ${pad(TASK, 4)} · ⚠ WRITES DATA · ${pad(SYMBOLS.length + " symbol(s)", 16)}                     ║`);
  say(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  say(`  window fromDate=${FROM_DATE} toDate=${TO_DATE}  ⚠ toDate is the only v3 protection`);
  say(`  spacing BATCH_SIZE=${BATCH_SIZE} · SESSION_RESET_EVERY_N=${SESSION_RESET_EVERY_N} · ${BATCH_PAUSE_MS}ms (production, unchanged)`);
  say(`  fence: SOURCE-based · ${fence.size} symbols watched · ledger ${ledger.done.length}/${SYMBOLS.length} done`);

  const jobs = await raw<any>(`SELECT "type","status" FROM background_jobs WHERE "status" IN ('pending','running')`);
  if (jobs.length) say(`  ◇ running alongside (NOT blocking): ${jobs.map((j: any) => `${j.type}/${j.status}`).join(", ")}`);
  else say(`  ✓ background_jobs running/pending = 0`);
  if (!todo.length) { say(`  nothing to do.\n`); await prisma.$disconnect(); return; }
  if (DRY) { say(`  --dry: would process ${todo.join(" ")}\n`); await prisma.$disconnect(); return; }

  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  const t0 = Date.now(); let fenceSeen = 0;

  for (const [ci, chunk] of chunks.entries()) {
    const [clk] = await raw<any>(`SELECT date_part('hour',now() AT TIME ZONE 'UTC')::int h, date_part('minute',now() AT TIME ZONE 'UTC')::int m`);
    const mins = Number(clk.h) * 60 + Number(clk.m);
    if (mins >= STOP_FOR_DAY_UTC && mins < 23 * 60 + 30) {
      say(`\n  ⏹ STOP FOR THE DAY — ${clk.h}:${String(clk.m).padStart(2, "0")} UTC is past 21:10; RETENTION_PRUNE at 21:30 is destructive.`);
      say(`    Ledger holds ${ledger.done.length}/${SYMBOLS.length}. Re-run to resume.`); break;
    }
    const ct = Date.now();
    say(`\n  ── chunk ${ci + 1}/${chunks.length}: ${chunk.join(" ")}`);
    nseClient.resetSession();
    let b = 0; const errs: any[] = [];
    let f = 0, ing = 0, fail = 0;
    for (let i = 0; i < chunk.length; i += BATCH_SIZE) {
      if (b > 0 && b % SESSION_RESET_EVERY_N === 0) nseClient.resetSession();
      for (const sym of chunk.slice(i, i + BATCH_SIZE)) {
        const st = Date.now();
        try {
          const r = await backfillLegacySymbol(sym, { fromDate: FROM_DATE, toDate: TO_DATE });
          f += r.totalFilings; ing += r.ingested; fail += r.failed; errs.push(...r.errors);
          ledger.done.push(sym); ledger.filings += r.totalFilings; ledger.ingested += r.ingested;
          ledger.failed += r.failed; ledger.errors.push(...r.errors);
          writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
          say(`     ${pad(sym, 14)} filings=${lp(r.totalFilings, 4)} ingested=${lp(r.ingested, 4)} failed=${lp(r.failed, 3)} ${lp(((Date.now() - st) / 1000).toFixed(1), 6)}s`);
        } catch (e) {
          fail++; say(`     ${pad(sym, 14)} ✗ FATAL ${(e as Error).message.slice(0, 70)} — not ledgered`);
        }
      }
      b++;
      if (i + BATCH_SIZE < chunk.length) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
    const fc = await fenceCheck(chunk, fence);
    fenceSeen += fc.observed;
    if (fc.breaches.length) {
      say(`\n  ✗✗✗ FENCE BREACH — HALTING ✗✗✗`);
      for (const x of fc.breaches.slice(0, 30)) say(`      ${x}`);
      writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
      await prisma.$disconnect(); process.exit(9);
    }
    const cnt = new Map<FailKind, number>();
    for (const e of errs) { const k = classify(e.error); cnt.set(k, (cnt.get(k) ?? 0) + 1); }
    const mix = [...cnt.entries()].sort((a, b2) => b2[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(" ") || "none";
    say(`     chunk ${ci + 1}/${chunks.length} · done ${ledger.done.length}/${SYMBOLS.length} · ${((Date.now() - ct) / 60000).toFixed(1)}min · filings ${f} ingested ${ing} failed ${fail} · fence ✓${fenceSeen ? ` (${fenceSeen} pipeline refresh observed)` : ""}`);
    say(`       MIX: ${mix}`);
  }

  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  say(`\n  ${TASK} COMPLETE · wall ${((Date.now() - t0) / 60000).toFixed(1)} min · ${ledger.done.length}/${SYMBOLS.length} · filings ${ledger.filings} ingested ${ledger.ingested} failed ${ledger.failed}`);
  const byK = new Map<FailKind, number>();
  for (const e of ledger.errors) { const k = classify(e.error); byK.set(k, (byK.get(k) ?? 0) + 1); }
  say(`  cumulative MIX: ${[...byK.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(" ") || "none"}`);
  const [sc] = await raw<any>(
    `SELECT count(*)::int n FROM background_jobs WHERE "created_at" > TIMESTAMP '${ledger.startedAt.slice(0, 19).replace("T", " ")}' AND ("type" ILIKE '%rescore%' OR "type" ILIKE '%scor%')`);
  say(`  ⚠ scoring/rescore jobs since this task began: ${sc.n === 0 ? "✓ 0" : "⚠ " + sc.n}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { say(`FATAL ${(e as Error).message}`); console.error(e); await prisma.$disconnect(); process.exit(1); });
