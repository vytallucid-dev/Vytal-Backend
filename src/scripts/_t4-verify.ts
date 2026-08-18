// ═══════════════════════════════════════════════════════════════
// T4d — VERIFY, IN ORDER. READ-ONLY.
//   npx tsx src/scripts/_t4-verify.ts
// Check 1 is DISQUALIFYING: if any v3-era row moved, everything else is moot.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { COHORT } from "./_t4-cohort-def.js";

const DIR = process.env.T4_DIR ?? ".";
const V3_FLOOR = "2025-03-31";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const TABLES = ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"];

interface Row { fiscal_year: string; quarter?: string; result_type: string; source: string; report_date: string; updated_at: string; id: string }

function keyOf(t: string, r: Row) { return `${t}|${r.fiscal_year}|${r.quarter ?? "Y"}|${r.result_type}`; }

async function main() {
  const before = JSON.parse(readFileSync(`${DIR}/_t4-before.json`, "utf8"));
  const after = JSON.parse(readFileSync(`${DIR}/_t4-after.json`, "utf8"));
  let fail = 0;

  // ═══ CHECK 1 — DISQUALIFYING ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4d.1 — ⚠ WAS ANY v3-ERA ROW TOUCHED?  (period >= ${V3_FLOOR})           ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  let v3Checked = 0, v3Moved = 0; const violations: string[] = [];
  for (const sym of Object.keys(before.stocks)) {
    for (const t of TABLES) {
      const b: Row[] = before.stocks[sym][t].rows, a: Row[] = after.stocks[sym][t].rows;
      const aMap = new Map(a.map((r) => [keyOf(t, r), r]));
      for (const br of b) {
        if (br.report_date < V3_FLOOR) continue;
        v3Checked++;
        const ar = aMap.get(keyOf(t, br));
        if (!ar) { v3Moved++; violations.push(`${sym} ${t} ${keyOf(t, br)} — ROW DISAPPEARED`); continue; }
        if (ar.source !== br.source || ar.updated_at !== br.updated_at || ar.id !== br.id) {
          v3Moved++;
          violations.push(`${sym} ${t} ${keyOf(t, br)} — source ${br.source}→${ar.source} · updated_at ${br.updated_at}→${ar.updated_at} · id ${br.id === ar.id ? "same" : "CHANGED"}`);
        }
      }
    }
  }
  console.log(`  v3-era rows checked (source + updated_at + id): ${v3Checked}`);
  console.log(`  rows that MOVED: ${v3Moved}   ${v3Moved === 0 ? "✓ NONE — the toDate guard held" : "✗ VIOLATION"}`);
  for (const v of violations.slice(0, 20)) console.log(`    ✗ ${v}`);
  if (v3Moved > 0) {
    fail++;
    console.log(`\n  ✗✗✗ DISQUALIFYING FAILURE — STOP. Do not proceed to the other checks. ✗✗✗\n`);
    await prisma.$disconnect(); process.exit(1);
  }
  // Independent confirmation straight from the DB.
  const [v3db] = await raw<{ n: number }>(
    `SELECT (SELECT count(*)::int FROM fundamentals WHERE "report_date" >= DATE '${V3_FLOOR}' AND "source" LIKE '%legacy%')
          + (SELECT count(*)::int FROM quarterly_results WHERE "report_date" >= DATE '${V3_FLOOR}' AND "source" LIKE '%legacy%')
          + (SELECT count(*)::int FROM banking_fundamentals WHERE "report_date" >= DATE '${V3_FLOOR}' AND "source" LIKE '%legacy%')
          + (SELECT count(*)::int FROM banking_quarterly_results WHERE "report_date" >= DATE '${V3_FLOOR}' AND "source" LIKE '%legacy%') AS n`);
  console.log(`  DB cross-check — rows at/after ${V3_FLOOR} carrying a *_legacy source, WHOLE DB: ${v3db.n} ${Number(v3db.n) === 0 ? "✓" : "✗"}`);
  if (Number(v3db.n) !== 0) fail++;

  // ═══ CHECK 2 — standalone coverage ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4d.2 — STANDALONE COVERAGE, before → after                               ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("symbol", 13)}${pad("annual SA", 20)}${pad("quarterly SA", 20)}  annual FYs gained`);
  let saGainA = 0, saGainQ = 0;
  for (const c of COHORT) {
    const sym = c.symbol; if (!before.stocks[sym]) continue;
    const cnt = (snap: any, t: string, basis: string) => (snap.stocks[sym][t].rows as Row[]).filter((r) => r.result_type === basis).length;
    const aB = cnt(before, "fundamentals", "standalone") + cnt(before, "banking_fundamentals", "standalone");
    const aA = cnt(after, "fundamentals", "standalone") + cnt(after, "banking_fundamentals", "standalone");
    const qB = cnt(before, "quarterly_results", "standalone") + cnt(before, "banking_quarterly_results", "standalone");
    const qA = cnt(after, "quarterly_results", "standalone") + cnt(after, "banking_quarterly_results", "standalone");
    saGainA += aA - aB; saGainQ += qA - qB;
    const fysB = new Set([...(before.stocks[sym].fundamentals.rows as Row[]), ...(before.stocks[sym].banking_fundamentals.rows as Row[])].filter((r) => r.result_type === "standalone").map((r) => r.fiscal_year));
    const fysA = [...(after.stocks[sym].fundamentals.rows as Row[]), ...(after.stocks[sym].banking_fundamentals.rows as Row[])].filter((r) => r.result_type === "standalone").map((r) => r.fiscal_year);
    const gained = [...new Set(fysA.filter((f) => !fysB.has(f)))].sort();
    console.log(`  ${pad(sym, 13)}${pad(`${aB} → ${aA}  (+${aA - aB})`, 20)}${pad(`${qB} → ${qA}  (+${qA - qB})`, 20)}  ${gained.join(",") || "—"}`);
  }
  console.log(`  ── cohort total: annual standalone +${saGainA} · quarterly standalone +${saGainQ}`);

  // ═══ CHECK 3 — consolidated VALUES unchanged ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4d.3 — EXISTING CONSOLIDATED ROWS: unchanged in VALUE, not just count     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  let coCompared = 0, coChanged = 0; const coDiffs: string[] = [];
  for (const sym of Object.keys(before.stocks)) {
    for (const t of ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"]) {
      const bv: any[] = before.stocks[sym][t].values ?? [], av: any[] = after.stocks[sym][t].values ?? [];
      if (!bv.length) continue;
      const k = (r: any) => `${r.fiscal_year}|${r.quarter ?? "Y"}|${r.result_type}`;
      const aMap = new Map(av.map((r) => [k(r), r]));
      for (const b of bv) {
        if (b.result_type !== "consolidated") continue;
        const a = aMap.get(k(b));
        coCompared++;
        if (!a) { coChanged++; coDiffs.push(`${sym} ${t} ${k(b)} — DISAPPEARED`); continue; }
        for (const col of Object.keys(b)) {
          if (["fiscal_year", "quarter", "result_type"].includes(col)) continue;
          if (JSON.stringify(b[col]) !== JSON.stringify(a[col])) {
            coChanged++;
            coDiffs.push(`${sym} ${t} ${k(b)} ${col}: ${JSON.stringify(b[col])} → ${JSON.stringify(a[col])}`);
            break;
          }
        }
      }
    }
  }
  console.log(`  consolidated rows compared field-by-field: ${coCompared}`);
  console.log(`  rows whose VALUES changed: ${coChanged}`);
  for (const d of coDiffs.slice(0, 15)) console.log(`    · ${d}`);
  if (coDiffs.length > 15) console.log(`    … ${coDiffs.length - 15} more`);
  console.log(`  ${coChanged === 0 ? "✓ every pre-existing consolidated row is byte-identical" : "⚠ some consolidated rows were refreshed — see above (a re-parse of the SAME basis is expected on a re-ingest)"}`);

  // ═══ CHECK 4 — banking routing ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4d.4 — BANKING stocks landed in banking_* tables                         ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const banks = COHORT.filter((c) => before.stocks[c.symbol]?.industryType === "banking");
  for (const b of banks) {
    const s = after.stocks[b.symbol];
    const nf = (s.fundamentals.rows as Row[]).length + (s.quarterly_results.rows as Row[]).length;
    const bk = (s.banking_fundamentals.rows as Row[]).length + (s.banking_quarterly_results.rows as Row[]).length;
    const ok = nf === 0 && bk > 0;
    if (!ok) fail++;
    console.log(`  ${pad(b.symbol, 13)} banking_* rows=${lp(bk, 4)}   non-financial rows=${lp(nf, 4)}   ${ok ? "✓ correctly routed" : "✗ LEAKED into the non-financial tables"}`);
  }

  // ═══ CHECK 5 — dry-run predictions ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4d.5 — DID THE T2d PREDICTIONS HOLD?                                     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const sym of ["SIEMENS", "COLPAL", "SUNPHARMA"]) {
    const rows = after.stocks[sym].fundamentals.rows as Row[];
    const byFy = new Map<string, Set<string>>();
    for (const r of rows) { if (!byFy.has(r.fiscal_year)) byFy.set(r.fiscal_year, new Set()); byFy.get(r.fiscal_year)!.add(r.result_type); }
    const detail = [...byFy.entries()].sort().map(([fy, s]) => `${fy}:${s.size}`).join(" ");
    console.log(`  ${pad(sym, 13)} annual bases per FY → ${detail}`);
  }

  // ═══ CHECK 6 — depth achieved ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4d.6 — DEPTH ACHIEVED (oldest STANDALONE annual / oldest STANDALONE qtr)  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  target: annual FY18 (2018 period-end) · quarterly Dec-2018`);
  console.log(`  ${pad("symbol", 13)}${pad("oldest SA annual", 22)}${pad("oldest SA quarter", 22)}${lp("SA ann", 7)}${lp("SA qtr", 7)}`);
  for (const c of COHORT) {
    const s = after.stocks[c.symbol]; if (!s) continue;
    const ann = [...(s.fundamentals.rows as Row[]), ...(s.banking_fundamentals.rows as Row[])].filter((r) => r.result_type === "standalone");
    const qtr = [...(s.quarterly_results.rows as Row[]), ...(s.banking_quarterly_results.rows as Row[])].filter((r) => r.result_type === "standalone");
    const oa = ann.map((r) => r.report_date).sort()[0] ?? "—";
    const oq = qtr.map((r) => r.report_date).sort()[0] ?? "—";
    console.log(`  ${pad(c.symbol, 13)}${pad(oa.slice(0, 10), 22)}${pad(oq.slice(0, 10), 22)}${lp(ann.length, 7)}${lp(qtr.length, 7)}`);
  }

  console.log(`\n═══ T4d: ${fail === 0 ? "✓ ALL CHECKS PASS" : `✗ ${fail} FAILURE(S)`} ═══\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
