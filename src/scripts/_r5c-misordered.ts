// ═══════════════════════════════════════════════════════════════
// R5-C — MIS-ORDERED QUARTERLY LABELS, AS ITS OWN FINDING. READ-ONLY.
//   npx tsx src/scripts/_r5c-misordered.ts
//
// loadMomentumStandalone orders by (fiscalYear, quarter) and builds
//   qOrdinal = fyOrdinal*4 + (Qn-1)
// consecutiveTail then sorts by qOrdinal, takes the LAST element, and walks
// backwards while qOrdinal decrements by exactly 1.
//
// That is correct only if the LABEL advances with TIME. Where it does not, three
// distinct things break, and this script demonstrates each on real rows:
//   1. the "latest quarter" the engine picks is NOT the chronologically newest
//   2. the tail it walks is contiguous in LABEL space but not in TIME
//   3. a TTM summed over that tail adds quarters that are not four consecutive
//      real quarters — it can skip a period and double-count another
//
// ⚠ PRE-EXISTING AND LIVE. Two of the four known violations are on v3-sourced
//   rows, so this is not a legacy-backfill artefact; it is today's behaviour.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const qOrd = (fy: string, q: string) => parseInt(fy.slice(2), 10) * 4 + (Number(q.slice(1)) - 1);
const cq = (rd: string) => { const y = +rd.slice(0, 4), m = +rd.slice(5, 7); return y * 4 + Math.floor((m - 1) / 3); };
const cqLabel = (i: number) => `${Math.floor(i / 4)}${["Mar", "Jun", "Sep", "Dec"][i % 4]}`;
const TTM = 4;

/** the engine's own algorithm, verbatim in shape */
function consecutiveTail<T extends { qOrdinal: number }>(qs: T[]): T[] {
  if (!qs.length) return [];
  const sorted = [...qs].sort((a, b) => a.qOrdinal - b.qOrdinal);
  const run: T[] = [sorted[sorted.length - 1]];
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i].qOrdinal === run[0].qOrdinal - 1) run.unshift(sorted[i]);
    else break;
  }
  return run;
}

async function main() {
  const cohort = await loadCohort();
  const byId = new Map(cohort.map((c) => [c.id, c]));
  const ids = cohort.map((c) => c.id);

  const rows = await raw<any>(
    `SELECT "stock_id" sid,"fiscal_year" fy,"quarter" q,"report_date"::text rd,"source" src
       FROM quarterly_results WHERE "stock_id"=ANY($1::text[]) AND "result_type"='standalone'
      UNION ALL
     SELECT "stock_id","fiscal_year","quarter","report_date"::text,"source"
       FROM banking_quarterly_results WHERE "stock_id"=ANY($1::text[]) AND "result_type"='standalone'`, ids);

  const per = new Map<string, any[]>();
  for (const r of rows) {
    const sym = byId.get(r.sid)!.symbol;
    if (!per.has(sym)) per.set(sym, []);
    per.get(sym)!.push({ fy: r.fy, q: r.q, rd: String(r.rd).slice(0, 10), src: r.src, qOrdinal: qOrd(r.fy, r.q), cqi: cq(String(r.rd).slice(0, 10)) });
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5-C — QUARTERLY LABELS THAT DO NOT ADVANCE WITH TIME                      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  scanned ${per.size} stocks holding STANDALONE quarterly rows\n`);

  interface Bad {
    sym: string; n: number; viol: number; srcMix: string;
    engineNewest: string; trueNewest: string; wrongNewest: boolean;
    engineTail: number; trueTail: number; tailContiguousInTime: boolean;
    ttmSkips: string[];
  }
  const bad: Bad[] = [];
  let clean = 0;

  for (const [sym, qsRaw] of per) {
    const byRd = new Map<string, any>();
    for (const r of qsRaw) if (!byRd.has(r.rd)) byRd.set(r.rd, r);
    const qs = [...byRd.values()];
    const chrono = [...qs].sort((a, b) => a.rd.localeCompare(b.rd));
    let viol = 0;
    for (let i = 1; i < chrono.length; i++) if (chrono[i].qOrdinal < chrono[i - 1].qOrdinal) viol++;
    if (!viol) { clean++; continue; }

    const tail = consecutiveTail(qs);
    const engineNewest = tail.at(-1)!;
    const trueNewest = chrono.at(-1)!;
    // is the engine's tail contiguous in CALENDAR time?
    const tailCq = tail.map((t) => t.cqi).sort((a, b) => a - b);
    let contig = true; const skips: string[] = [];
    for (let i = 1; i < tailCq.length; i++) {
      if (tailCq[i] - tailCq[i - 1] !== 1) {
        contig = false;
        for (let k = tailCq[i - 1] + 1; k < tailCq[i]; k++) skips.push(cqLabel(k));
      }
    }
    // the TRUE tail: consecutive calendar quarters back from the newest
    const allCq = [...new Set(qs.map((x) => x.cqi))].sort((a, b) => a - b);
    let tRun = 1;
    for (let i = allCq.length - 1; i > 0; i--) { if (allCq[i] - allCq[i - 1] === 1) tRun++; else break; }

    bad.push({
      sym, n: qs.length, viol,
      srcMix: [...new Set(qs.map((x) => (String(x.src).includes("legacy") ? "legacy" : "v3")))].sort().join("+"),
      engineNewest: `${engineNewest.fy}${engineNewest.q} (${engineNewest.rd})`,
      trueNewest: `${trueNewest.fy}${trueNewest.q} (${trueNewest.rd})`,
      wrongNewest: engineNewest.rd !== trueNewest.rd,
      engineTail: tail.length, trueTail: tRun,
      tailContiguousInTime: contig, ttmSkips: skips,
    });
  }

  console.log(`  labels advance with time            : ${clean}  ✓`);
  console.log(`  labels go BACKWARDS at least once   : ${bad.length}  ${bad.length ? "⚠" : "✓"}\n`);
  console.log(`  ${pad("symbol", 13)}${lp("qtrs", 5)}${lp("viol", 6)}${pad("  sources", 16)}${lp("engine tail", 13)}${lp("true tail", 11)}  newest row`);
  for (const b of bad.sort((a, b2) => b2.viol - a.viol)) {
    console.log(`  ${pad(b.sym, 13)}${lp(b.n, 5)}${lp(b.viol, 6)}${pad("  " + b.srcMix, 16)}${lp(b.engineTail, 13)}${lp(b.trueTail, 11)}  ${b.wrongNewest ? "⚠ WRONG — engine picks " + b.engineNewest + ", newest is " + b.trueNewest : "correct"}`);
  }

  console.log(`\n  ── WHAT consecutiveTail ACTUALLY DOES on these series ──`);
  for (const b of bad.sort((a, b2) => b2.viol - a.viol)) {
    console.log(`\n  ${b.sym}:`);
    console.log(`    engine's tail length ${b.engineTail} quarter(s); true consecutive tail ${b.trueTail}`);
    console.log(`    engine's "latest quarter" : ${b.engineNewest}${b.wrongNewest ? "   ⚠ NOT the newest row" : ""}`);
    console.log(`    chronologically newest    : ${b.trueNewest}`);
    console.log(`    tail contiguous in TIME?  : ${b.tailContiguousInTime ? "yes" : "⚠ NO — it skips " + b.ttmSkips.join(", ")}`);
    if (b.engineTail >= TTM && !b.tailContiguousInTime) {
      console.log(`    ⚠⚠ a ${TTM}-quarter TTM over this tail sums quarters that are NOT four consecutive`);
      console.log(`        real quarters — the TTM is arithmetically valid and factually wrong.`);
    }
    if (b.engineTail < TTM) console.log(`    ⇒ tail < ${TTM}, so M1/M2 (TTM) return null for this stock: it scores as data-poor.`);
  }

  // SIEMENS in full — the worst case, row by row, so the mechanism is visible
  const worst = bad.sort((a, b2) => b2.viol - a.viol)[0];
  if (worst) {
    console.log(`\n  ── ${worst.sym} row by row (chronological), showing the label the engine sorts on ──`);
    const byRd = new Map<string, any>();
    for (const r of per.get(worst.sym)!) if (!byRd.has(r.rd)) byRd.set(r.rd, r);
    const chrono = [...byRd.values()].sort((a, b2) => a.rd.localeCompare(b2.rd));
    const tailSet = new Set(consecutiveTail([...byRd.values()]).map((t) => t.rd));
    console.log(`     ${pad("report_date", 13)}${pad("label", 9)}${lp("qOrdinal", 10)}  in engine tail?`);
    for (const r of chrono) {
      console.log(`     ${pad(r.rd, 13)}${pad(r.fy + r.q, 9)}${lp(r.qOrdinal, 10)}  ${tailSet.has(r.rd) ? "◀ YES" : ""}`);
    }
  }

  writeFileSync(`${DIR}/_r5c-misordered.json`, JSON.stringify({ scanned: per.size, clean, bad }, null, 1));
  console.log(`\n  → ${DIR}/_r5c-misordered.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
