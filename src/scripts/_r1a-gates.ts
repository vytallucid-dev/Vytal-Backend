// ═══════════════════════════════════════════════════════════════
// R1a / R1b / R1e — COHORT + GATES + LEDGER. READ-ONLY.
//   npx tsx src/scripts/_r1a-gates.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort, FROM_DATE, TO_DATE, IN_SCOPE } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const LEDGER = `${DIR}/_r2-ledger.json`;
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  // ── R1b — DB clock, jobs, window ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1b — GATES (against the DB clock, not the local clock)                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const [clk] = await raw<any>(
    `SELECT now()::text db_now, (now() AT TIME ZONE 'UTC')::text utc_now,
            date_part('hour', now() AT TIME ZONE 'UTC')::int h,
            date_part('minute', now() AT TIME ZONE 'UTC')::int m`);
  const mins = Number(clk.h) * 60 + Number(clk.m);
  const blackout = mins >= 13 * 60 && mins <= 14 * 60 + 10;
  const nightly = mins >= 21 * 60 && mins <= 22 * 60;
  console.log(`  DB now()          : ${clk.db_now}`);
  console.log(`  DB now() at UTC   : ${clk.utc_now}   (${lp(clk.h, 2)}:${String(clk.m).padStart(2, "0")} UTC)`);
  console.log(`  local process time: ${new Date().toISOString()}`);
  console.log(`  blackout 13:00-14:10 UTC : ${blackout ? "⚠ INSIDE" : "✓ outside"}`);
  console.log(`  nightly  21:30-22:00 UTC : ${nightly ? "⚠ NEAR" : "✓ clear"}`);
  const minsToNightly = (21 * 60 + 30) - mins;
  console.log(`  minutes until 21:30 UTC prune: ${minsToNightly > 0 ? minsToNightly : minsToNightly + 1440} min`);

  const jobs = await raw<any>(
    `SELECT "id","type","status","created_at"::text ca FROM background_jobs
      WHERE "status" IN ('pending','running') ORDER BY "created_at"`);
  console.log(`  background_jobs running/pending: ${jobs.length}`);
  for (const j of jobs) console.log(`    ⚠ ${j.id} ${j.type} ${j.status} ${j.ca}`);
  const jobHist = await raw<any>(
    `SELECT "type", "status", count(*)::int n, max("created_at")::text last
       FROM background_jobs GROUP BY 1,2 ORDER BY 4 DESC NULLS LAST LIMIT 12`);
  console.log(`  recent background_jobs by (type,status):`);
  for (const j of jobHist) console.log(`    ${pad(j.type, 34)}${pad(j.status, 11)}${lp(j.n, 6)}  last ${String(j.last).slice(0, 19)}`);

  // ── R1a — the cohort ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1a — THE COHORT                                                          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const universe = await raw<any>(
    `SELECT "industryType"::text it, "is_active" act, count(*)::int n
       FROM stocks GROUP BY 1,2 ORDER BY 1,2`);
  console.log(`  FULL stocks table by (industryType, is_active):`);
  let allTotal = 0;
  for (const u of universe) { allTotal += u.n; console.log(`    ${pad(u.it, 20)} is_active=${pad(u.act, 6)}${lp(u.n, 6)}`); }
  console.log(`    ${pad("TOTAL", 20)}${lp("", 15)}${lp(allTotal, 6)}`);

  const cohort = await loadCohort();
  const split = new Map<string, number>();
  for (const c of cohort) split.set(c.industryType, (split.get(c.industryType) ?? 0) + 1);
  console.log(`\n  COHORT (is_active AND industryType IN ${JSON.stringify(IN_SCOPE)}):`);
  for (const [k, v] of [...split.entries()].sort()) console.log(`    ${pad(k, 20)}${lp(v, 6)}`);
  console.log(`    ${pad("TOTAL", 20)}${lp(cohort.length, 6)}   target 442 → ${cohort.length === 442 ? "✓ MATCH" : "⚠ MISMATCH"}`);
  console.log(`    expected split: non_financial 416 · banking 26`);
  console.log(`    measured split: non_financial ${split.get("non_financial") ?? 0} · banking ${split.get("banking") ?? 0}`);

  // R1a — any cohort member NOT in scope (would be a selection bug)
  const offScope = cohort.filter((c) => !(IN_SCOPE as readonly string[]).includes(c.industryType));
  console.log(`\n  members outside {non_financial, banking}: ${offScope.length === 0 ? "✓ none" : "⚠ " + offScope.length}`);
  for (const o of offScope) console.log(`    ⚠ ${o.symbol} → ${o.industryType}`);

  // the excluded 62
  const excl = await raw<any>(
    `SELECT "industryType"::text it, count(*)::int n, count(*) FILTER (WHERE "is_active")::int act
       FROM stocks WHERE "industryType"::text <> ALL($1::text[]) GROUP BY 1 ORDER BY 1`,
    IN_SCOPE as unknown as string[]);
  let exclN = 0, exclA = 0;
  console.log(`\n  DELIBERATELY EXCLUDED (no live scoring consumer):`);
  for (const e of excl) { exclN += e.n; exclA += e.act; console.log(`    ${pad(e.it, 20)}${lp(e.n, 6)} total · ${lp(e.act, 4)} active`); }
  console.log(`    ${pad("TOTAL EXCLUDED", 20)}${lp(exclN, 6)} total · ${lp(exclA, 4)} active   (target 62)`);

  // inactive in-scope stocks — visible so the exclusion is a stated decision
  const inactive = await raw<any>(
    `SELECT "symbol","industryType"::text it FROM stocks
      WHERE "is_active" = false AND "industryType"::text = ANY($1::text[]) ORDER BY 1`,
    IN_SCOPE as unknown as string[]);
  console.log(`\n  in-scope but is_active=false (excluded by the is_active filter): ${inactive.length}`);
  for (const i of inactive) console.log(`    · ${pad(i.symbol, 14)} ${i.it}`);

  // fiscal-year-end spread — affects period keying
  const fye = new Map<string, number>();
  for (const c of cohort) fye.set(c.fiscalYearEnd, (fye.get(c.fiscalYearEnd) ?? 0) + 1);
  console.log(`\n  fiscalYearEnd spread across the 442: ${[...fye.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" · ")}`);

  // banking members named in full — small enough to list, and the fix has thin history there
  console.log(`\n  the ${split.get("banking") ?? 0} banking members:`);
  const banks = cohort.filter((c) => c.industryType === "banking").map((c) => c.symbol);
  for (let i = 0; i < banks.length; i += 6) console.log(`    ${banks.slice(i, i + 6).map((b) => pad(b, 14)).join("")}`);

  // ── R1e — ledger ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1e — LEDGER                                                              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  path: ${LEDGER}`);
  if (!existsSync(LEDGER)) console.log(`  ✓ ABSENT — a fresh run starts with an empty ledger (0 symbols done).`);
  else {
    const l = JSON.parse(readFileSync(LEDGER, "utf8"));
    console.log(`  ⚠ EXISTS — ${l.done?.length ?? 0} symbols already recorded, startedAt ${l.startedAt}, runs ${l.runs}`);
  }
  // the pilot ledger is a DIFFERENT file and does not gate this run
  console.log(`  (the T5 pilot ledger is a separate file and does not suppress any symbol here)`);

  console.log(`\n  window that will be passed on EVERY invocation: fromDate=${FROM_DATE}  toDate=${TO_DATE}`);
  console.log(`  ⚠ toDate is the only guard against overwriting v3-era rows.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
