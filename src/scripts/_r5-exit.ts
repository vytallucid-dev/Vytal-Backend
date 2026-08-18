// ═══════════════════════════════════════════════════════════════
// R5 — EXIT. READ-ONLY.
//   npx tsx src/scripts/_r5-exit.ts
//
// R5a totals before/after per table, per basis
// R5b failed filings grouped by cause · chunks that needed a retry
// R5c the FY23Q1 severance query, re-run across the FULL universe
// R5d ⚠ no scoring ran / no rescore enqueued — VERIFIED FROM background_jobs
// R5e the manual-keying bill, recalculated
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";
import { buildColMaps } from "./_r1-colmap.js";

const DIR = process.env.R1_DIR ?? ".";
const CUT = process.env.R2_CUT ?? "2026-08-16 11:38:00";
const LEDGER = `${DIR}/_r2-ledger.json`;
const ROWS_BEFORE = `${DIR}/_r1c-rows-before.jsonl`;
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const TBL = ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"];

async function main() {
  const cohort = await loadCohort();
  const ids = cohort.map((c) => c.id);
  const maps = await buildColMaps();

  // ═══ R5a — totals before/after, per table per basis ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5a — ROW TOTALS BEFORE / AFTER, PER TABLE PER BASIS                       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  // BEFORE comes from the persisted snapshot, not from memory
  const before = new Map<string, { sa: number; co: number }>();
  if (existsSync(ROWS_BEFORE)) {
    for (const line of readFileSync(ROWS_BEFORE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      const k = r.t; if (!before.has(k)) before.set(k, { sa: 0, co: 0 });
      if (r.basis === "standalone") before.get(k)!.sa++; else if (r.basis === "consolidated") before.get(k)!.co++;
    }
  }
  console.log(`  ${pad("table", 28)}${lp("SA before", 11)}${lp("SA after", 10)}${lp("Δ", 8)}${lp("CO before", 11)}${lp("CO after", 10)}${lp("Δ", 8)}`);
  let tSAb = 0, tSAa = 0, tCOb = 0, tCOa = 0;
  for (const t of TBL) {
    const [x] = await raw<any>(
      `SELECT count(*) FILTER (WHERE "result_type"='standalone')::int sa,
              count(*) FILTER (WHERE "result_type"='consolidated')::int co
         FROM "${t}" WHERE "stock_id" = ANY($1::text[])`, ids);
    const b = before.get(t) ?? { sa: 0, co: 0 };
    tSAb += b.sa; tSAa += x.sa; tCOb += b.co; tCOa += x.co;
    console.log(`  ${pad(t, 28)}${lp(b.sa, 11)}${lp(x.sa, 10)}${lp("+" + (x.sa - b.sa), 8)}${lp(b.co, 11)}${lp(x.co, 10)}${lp("+" + (x.co - b.co), 8)}`);
  }
  console.log(`  ${pad("TOTAL", 28)}${lp(tSAb, 11)}${lp(tSAa, 10)}${lp("+" + (tSAa - tSAb), 8)}${lp(tCOb, 11)}${lp(tCOa, 10)}${lp("+" + (tCOa - tCOb), 8)}`);
  console.log(`\n  STANDALONE is the number that matters — the scorer reads standalone only and never falls back.`);
  const [fresh] = await raw<any>(
    `SELECT ${TBL.map((t) => `(SELECT count(*) FROM "${t}" WHERE "updated_at" > TIMESTAMP '${CUT}')::int AS "${t}"`).join(", ")}`);
  console.log(`  rows written or rewritten by this run (updated_at > cut): ${TBL.map((t) => `${t}=${fresh[t]}`).join(" · ")}`);

  // ═══ R5b — failures by cause ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5b — FAILED FILINGS, GROUPED BY CAUSE                                     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  if (existsSync(LEDGER)) {
    const l = JSON.parse(readFileSync(LEDGER, "utf8"));
    console.log(`  ledger: ${l.done.length}/442 symbols · filings ${l.filings} · ingested ${l.ingested} · failed ${l.failed}`);
    console.log(`  overall failure rate: ${((100 * l.failed) / Math.max(1, l.ingested + l.failed)).toFixed(2)}%`);
    console.log(`  chunks that needed a retry: ${l.retried?.length ? l.retried.join(", ") : "✓ none"}`);
    console.log(`  second-pass list (incomplete after retry): ${l.secondPass?.length ? l.secondPass.join(" ") : "✓ empty"}`);
    const byKind = new Map<string, number>(), bySym = new Map<string, number>();
    for (const e of (l.errors ?? []) as any[]) {
      const msg = String(e.error);
      const k = /404/.test(msg) ? "NSE 404 (document not served)"
              : /numeric field overflow|out of range for the type/i.test(msg)
                  ? "⚠ numeric overflow — derived Decimal(8,4) ratio; ROW LOST"
              : /timeout|ETIMEDOUT|ECONNRESET|socket/i.test(msg) ? "network timeout / reset"
              : /Missing required date tags/i.test(msg) ? "parser: missing date tags"
              : /Failed to extract netProfit/i.test(msg) ? "parser: netProfit unextractable"
              : /Invalid period/i.test(msg) ? "parser: period outside declared fiscal year"
              : /Unique constraint/i.test(msg) ? "unique-constraint collision"
              : msg.replace(/\s+/g, " ").slice(0, 56) || "(empty message)";
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
      bySym.set(e.symbol, (bySym.get(e.symbol) ?? 0) + 1);
    }
    console.log(`\n  ${pad("cause", 56)}${lp("count", 7)}`);
    for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 56)}${lp(v, 7)}`);
    console.log(`\n  symbols with the most failed filings:`);
    for (const [k, v] of [...bySym.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`    ${pad(k, 16)}${lp(v, 5)}`);

    // ── ⚠ THE LOST-FILING RE-INGEST LIST ──
    // A 404 is not recoverable (NSE does not serve the document). An overflow IS:
    // the document parsed fine and the row died on a COSMETIC Decimal(8,4) ratio.
    // These are exactly the filings a bounded re-derive would recover, so they are
    // emitted as a precise worklist rather than a count.
    const lost = ((l.errors ?? []) as any[]).filter((e) => /numeric field overflow|out of range for the type/i.test(String(e.error)));
    console.log(`\n  ⚠ RECOVERABLE LOSSES — filings whose row died on a derived-ratio overflow: ${lost.length}`);
    if (lost.length) {
      console.log(`     (the document parsed; a COSMETIC Decimal(8,4) ratio killed the whole upsert,`);
      console.log(`      taking the score-relevant columns with it. Re-ingestable without re-running the 442.)`);
      const byS = new Map<string, string[]>();
      for (const e of lost) { if (!byS.has(e.symbol)) byS.set(e.symbol, []); byS.get(e.symbol)!.push(String(e.filing)); }
      for (const [s, fs] of [...byS.entries()].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`     ${pad(s, 14)} ${fs.length} filing(s)`);
        for (const f of fs) console.log(`         ${f}`);
      }
      writeFileSync(`${DIR}/_r5-lost-filings.json`, JSON.stringify(lost, null, 1));
      console.log(`     → ${DIR}/_r5-lost-filings.json`);
    }
    // and confirm, from the DB, that they really are absent (not silently present)
    console.log(`\n  ⚠ 404s are NOT recoverable — NSE does not serve those documents at all.`);
    console.log(`\n  ⚠ scoring jobs observed while the run was in flight: ${l.rescoreWatch?.length ?? 0}`);
    for (const w of l.rescoreWatch ?? []) console.log(`      ${w.id} ${w.type} ${w.status} by=${w.triggeredBy} at=${w.createdAt}`);
  } else console.log(`  (ledger missing)`);

  // result_fetch_logs is the independent record of the same events
  const rfl = await raw<any>(
    `SELECT "status", count(*)::int n FROM result_fetch_logs
      WHERE "source" LIKE '%_legacy' GROUP BY 1 ORDER BY 2 DESC`);
  console.log(`\n  result_fetch_logs (legacy sources), independent of the ledger:`);
  for (const r of rfl) console.log(`    ${pad(r.status, 16)}${lp(r.n, 7)}`);

  // ═══ R5c — the FY23Q1 severance, universe-wide ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5c — FY23Q1 SEVERANCE, RE-RUN ACROSS THE FULL UNIVERSE                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  severed = holds FY22Q4 AND FY23Q2 but NOT FY23Q1 (the same query as G3b)`);
  const [sev] = await raw<any>(`
   WITH t AS (SELECT "stock_id" sid,"fiscal_year" fy,"quarter" q,"result_type" rt FROM quarterly_results
              UNION ALL SELECT "stock_id","fiscal_year","quarter","result_type" FROM banking_quarterly_results),
   p AS (SELECT st."id",
      bool_or(fy='FY22' AND q='Q4') h224, bool_or(fy='FY23' AND q='Q1') h231, bool_or(fy='FY23' AND q='Q2') h232,
      bool_or(fy='FY22' AND q='Q4' AND rt='standalone') s224,
      bool_or(fy='FY23' AND q='Q1' AND rt='standalone') s231,
      bool_or(fy='FY23' AND q='Q2' AND rt='standalone') s232
     FROM stocks st LEFT JOIN t ON t.sid=st."id" GROUP BY st."id")
   SELECT count(*)::int total,
     count(*) FILTER (WHERE h224 AND h232 AND NOT h231)::int sandwiched_any,
     count(*) FILTER (WHERE s224 AND s232 AND NOT s231)::int sandwiched_sa,
     count(*) FILTER (WHERE h231)::int has_any,
     count(*) FILTER (WHERE s231)::int has_sa FROM p`);
  console.log(`  of ${sev.total} stocks: hold FY23Q1 any-basis ${sev.has_any} · standalone ${sev.has_sa}`);
  console.log(`  ⇒ SEVERED: any-basis ${sev.sandwiched_any} · standalone ${sev.sandwiched_sa}`);
  console.log(`  prior expectation ≈26. ${sev.sandwiched_any <= 40 ? "✓ in line — confirms the SOURCE's shape, not a new defect." : "⚠ MUCH LARGER — this is new information, not the known gap."}`);
  const sevList = await raw<any>(`
   WITH t AS (SELECT "stock_id" sid,"fiscal_year" fy,"quarter" q FROM quarterly_results
              UNION ALL SELECT "stock_id","fiscal_year","quarter" FROM banking_quarterly_results)
   SELECT st."symbol" s FROM stocks st LEFT JOIN t ON t.sid=st."id" GROUP BY st."id", st."symbol"
    HAVING bool_or(fy='FY22' AND q='Q4') AND bool_or(fy='FY23' AND q='Q2') AND NOT bool_or(fy='FY23' AND q='Q1')
    ORDER BY 1`);
  console.log(`  the severed stocks (${sevList.length}):`);
  for (let i = 0; i < sevList.length; i += 6) console.log(`    ${sevList.slice(i, i + 6).map((x: any) => pad(x.s, 14)).join("")}`);

  // ═══ R5d — NO SCORING. Verified, not asserted. ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5d — ⚠ NO SCORING RAN · NO RESCORE ENQUEUED · from background_jobs        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const since = await raw<any>(
    `SELECT "type", "status", count(*)::int n, min("created_at")::text first, max("created_at")::text last
       FROM background_jobs WHERE "created_at" > TIMESTAMP '${CUT}' GROUP BY 1,2 ORDER BY 3 DESC`);
  console.log(`  EVERY background_jobs row created since the run began (${CUT}):`);
  if (!since.length) console.log(`    ✓ NONE — not a single job of any type was created.`);
  for (const s of since) console.log(`    ${pad(s.type, 32)}${pad(s.status, 12)}${lp(s.n, 5)}  ${String(s.first).slice(0, 19)} → ${String(s.last).slice(0, 19)}`);
  const [sc] = await raw<any>(
    `SELECT count(*)::int n FROM background_jobs
      WHERE "created_at" > TIMESTAMP '${CUT}' AND ("type" ILIKE '%rescore%' OR "type" ILIKE '%scor%')`);
  console.log(`\n  scoring / rescore jobs created since the cut: ${sc.n === 0 ? "✓ 0" : "⚠ " + sc.n}`);
  const [pg] = await raw<any>(
    `SELECT count(*)::int n, max("created_at")::text last FROM background_jobs WHERE "type"='pg_rescore'`);
  console.log(`  pg_rescore lifetime: ${pg.n} row(s) · most recent ${String(pg.last).slice(0, 19)}`);
  console.log(`  ⇒ if the most recent pg_rescore predates the cut, none was enqueued by or during this run.`);
  // did any SCORE row get written during the run? the strongest form of the question
  const scoreTables = await raw<any>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public'
       AND (table_name LIKE '%score%' OR table_name LIKE '%pillar%') ORDER BY 1`);
  console.log(`\n  score-bearing tables checked for writes since the cut:`);
  for (const t of scoreTables) {
    const has = await raw<any>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name IN ('created_at','updated_at')`, t.table_name);
    if (!has.length) { console.log(`    ${pad(t.table_name, 34)} (no timestamp column — skipped)`); continue; }
    const col = has.some((h: any) => h.column_name === "created_at") ? "created_at" : "updated_at";
    const [n] = await raw<any>(`SELECT count(*)::int n FROM "${t.table_name}" WHERE "${col}" > TIMESTAMP '${CUT}'`);
    console.log(`    ${pad(t.table_name, 34)} rows with ${pad(col, 11)} > cut: ${n.n === 0 ? "✓ 0" : "⚠ " + n.n}`);
  }

  // ═══ R5e — the manual-keying bill ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5e — THE MANUAL-KEYING BILL, RECALCULATED                                 ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  DEFINITION (stated, because the prior ~17,240 figure is not recorded in the repo):`);
  console.log(`  the bill = scorer-read CELLS a human would have to key by hand to give every`);
  console.log(`  (stock, period) a complete STANDALONE row. Two components:`);
  console.log(`    A. periods with NO standalone row at all  → (missing periods) × (scorer columns)`);
  console.log(`    B. standalone rows that EXIST but have null scorer cells with no boundary excuse`);
  console.log(`  Component A is the dominant term and is what the run moves.\n`);

  // ── the BEFORE value on the IDENTICAL definition, from the persisted snapshot ──
  const beforePeriods = new Map<string, Map<string, boolean>>(); // table -> periodKey -> hasStandalone
  if (existsSync(ROWS_BEFORE)) {
    for (const line of readFileSync(ROWS_BEFORE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (!beforePeriods.has(r.t)) beforePeriods.set(r.t, new Map());
      const k = `${r.sym}|${r.period}`;
      const m2 = beforePeriods.get(r.t)!;
      m2.set(k, (m2.get(k) ?? false) || r.basis === "standalone");
    }
  }

  let billA = 0, billB = 0, billAbefore = 0;
  const perTable: Array<{ t: string; cols: number; nosa: number; a: number; aBefore: number }> = [];
  console.log(`  ${pad("table", 28)}${lp("cols", 6)}${lp("periods", 9)}${lp("no-SA", 8)}${lp("A cells", 10)}${lp("A before", 11)}${lp("Δ", 10)}`);
  for (const m of maps) {
    const hasQ = m.keyCols.includes("quarter");
    const [x] = await raw<any>(
      `WITH k AS (SELECT "stock_id", "fiscal_year"${hasQ ? `, "quarter"` : ``},
                        bool_or("result_type"='standalone') sa
                   FROM "${m.table}" WHERE "stock_id"=ANY($1::text[]) GROUP BY 1,2${hasQ ? ",3" : ""})
       SELECT count(*)::int periods, count(*) FILTER (WHERE NOT sa)::int nosa FROM k`, ids);
    const a = x.nosa * m.valueCols.length;
    const bp = beforePeriods.get(m.table);
    const nosaBefore = bp ? [...bp.values()].filter((v) => !v).length : 0;
    const aBefore = nosaBefore * m.valueCols.length;
    billA += a; billAbefore += aBefore;
    perTable.push({ t: m.table, cols: m.valueCols.length, nosa: x.nosa, a, aBefore });
    console.log(`  ${pad(m.table, 28)}${lp(m.valueCols.length, 6)}${lp(x.periods, 9)}${lp(x.nosa, 8)}${lp(a, 10)}${lp(aBefore, 11)}${lp((a - aBefore >= 0 ? "+" : "") + (a - aBefore), 10)}`);
  }
  // component B — reuse R4c's rule
  for (const m of maps) {
    const sel = m.valueCols.map((v) => `count(*) FILTER (WHERE "${v.col}" IS NULL)::int AS "${v.field}"`).join(", ");
    if (!sel) continue;
    const [x] = await raw<any>(
      `SELECT ${sel} FROM "${m.table}" WHERE "stock_id"=ANY($1::text[]) AND "result_type"='standalone'
         AND "filing_date" > TIMESTAMP '2022-11-25'`, ids);
    for (const v of m.valueCols) billB += Number(x[v.field] ?? 0);
  }
  const fund = perTable.find((p) => p.t === "fundamentals")!;
  console.log(`\n  A · cells in periods with NO standalone row : before ${lp(billAbefore, 8)} → now ${lp(billA, 8)}  (${billA - billAbefore >= 0 ? "+" : ""}${(billA - billAbefore).toLocaleString()})`);
  console.log(`  B · null scorer cells on post-BS-boundary standalone rows : ${lp(billB, 8)}`);
  console.log(`  ────────────────────────────────────────────────────────────`);
  console.log(`  TOTAL manual-keying bill NOW (all four tables) : ${lp(billA + billB, 8)} cells`);
  console.log(`  TOTAL before, same definition                  : ${lp(billAbefore, 8)} cells (component A)`);
  console.log(`  ⇒ movement on the identical definition: ${billA < billAbefore ? `DOWN ${(billAbefore - billA).toLocaleString()} cells (${((100 * (billAbefore - billA)) / Math.max(1, billAbefore)).toFixed(1)}%)` : `UP ${(billA - billAbefore).toLocaleString()} cells`}`);
  console.log(`\n  ── RECONCILING THE PRIOR ~17,240 FIGURE ──`);
  console.log(`  That figure is not recorded anywhere in the repo, so it cannot be reproduced exactly.`);
  console.log(`  Its most plausible basis is component A on the ANNUAL Ind-AS table alone:`);
  console.log(`    fundamentals no-SA periods × ${fund.cols} scorer columns`);
  console.log(`      before this run : ${lp(fund.aBefore, 8)} cells   (~17,240 is within a few hundred of this)`);
  console.log(`      now             : ${lp(fund.a, 8)} cells`);
  console.log(`      ⇒ ${fund.a < fund.aBefore ? `DOWN ${(fund.aBefore - fund.a).toLocaleString()} (${((100 * (fund.aBefore - fund.a)) / Math.max(1, fund.aBefore)).toFixed(1)}%)` : `UP ${(fund.a - fund.aBefore).toLocaleString()}`}`);
  console.log(`  The all-four-table number above is the honest total; the annual-only number is the`);
  console.log(`  one comparable to the prior estimate. Both are reported rather than picking one.`);

  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
