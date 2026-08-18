// ═══════════════════════════════════════════════════════════════
// R1c — FULL BEFORE-SNAPSHOT, PERSISTED TO DISK (not held in memory).
// R1d — v3-era row inventory (period >= 2025-03-31): source + updated_at.
// R1f — rescore-arming check: DB triggers / rules on the four write targets.
// READ-ONLY.
//   npx tsx src/scripts/_r1cd-snapshot.ts before|after
//
// WHAT IS PERSISTED, and why in this shape:
//   · _r1c-rows.jsonl   — ONE LINE PER ROW across all four tables: identity
//     (symbol, table, period, basis), provenance (source, report_date,
//     filing_date, updated_at) and EVERY scorer-read column's value. JSONL, not
//     one JSON blob, so the ~40k rows stream and the file stays diffable.
//     Null counts and value drift are both DERIVED from this — one artifact,
//     no chance of the two disagreeing.
//   · _r1c-cells.json   — pre-aggregated per (table, symbol, period, basis)
//     null counts, so R4 does not have to re-stream the JSONL to answer
//     "which cells were null before".
//   · _r1d-v3.json      — the fence baseline. Every row with period >= the v3
//     floor, keyed by a stable identity, carrying source + updated_at.
//     R3a compares this EXACTLY.
//
// ⚠ The column set is read from src/scoring/inputs/score-input-columns.ts — the
//   manifest the build guard already enforces — NOT hand-listed. The T4 pilot
//   snapshot passed [] for both banking tables and therefore captured no banking
//   null counts at all; that hole is closed here.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { createWriteStream, writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";
import { buildColMaps, TABLES } from "./_r1-colmap.js";

const label = process.argv[2];
if (label !== "before" && label !== "after") { console.error("usage: _r1cd-snapshot.ts before|after"); process.exit(1); }
const DIR = process.env.R1_DIR ?? ".";
const ROWS_OUT = `${DIR}/_r1c-rows-${label}.jsonl`;
const CELLS_OUT = `${DIR}/_r1c-cells-${label}.json`;
const V3_OUT = `${DIR}/_r1d-v3-${label}.json`;

const V3_FLOOR = "2025-03-31";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const S = (v: unknown) => (v === null || v === undefined ? null : String(v));

async function main() {
  const t0 = Date.now();
  const cohort = await loadCohort();
  const byId = new Map(cohort.map((c) => [c.id, c]));
  const ids = cohort.map((c) => c.id);
  const maps = await buildColMaps();

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1c/R1d — ${pad(label.toUpperCase() + "-SNAPSHOT", 20)} ${pad(cohort.length + " stocks", 14)}                     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  scorer-read VALUE columns resolved from the score-input manifest:`);
  let bad = false;
  for (const m of maps) {
    console.log(`    ${pad(m.table, 28)}${lp(m.valueCols.length, 4)} value cols · keys [${m.keyCols.join(",")}]`);
    if (m.unresolved.length) { bad = true; console.log(`      ⚠ UNRESOLVED: ${m.unresolved.join(", ")}`); }
  }
  if (bad) { console.log(`\n  ✗ ABORT — a scorer column could not be mapped to a DB column.\n`); await prisma.$disconnect(); process.exit(3); }

  // ── R1f — is anything at the DB layer armed to fire on these writes? ──
  console.log(`\n  ── R1f · DB-level triggers / rules on the four write targets ──`);
  const trg = await raw<any>(
    `SELECT c.relname tbl, t.tgname, p.proname fn, t.tgenabled::text tgenabled
       FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE NOT t.tgisinternal AND c.relname = ANY($1::text[]) ORDER BY 1,2`, TABLES as unknown as string[]);
  console.log(`    user triggers: ${trg.length === 0 ? "✓ none" : "⚠ " + trg.length}`);
  for (const t of trg) console.log(`      ⚠ ${t.tbl}.${t.tgname} → ${t.fn} (enabled=${t.tgenabled})`);
  const rules = await raw<any>(
    `SELECT tablename, rulename FROM pg_rules WHERE schemaname='public' AND tablename = ANY($1::text[])`,
    TABLES as unknown as string[]);
  console.log(`    rewrite rules: ${rules.length === 0 ? "✓ none" : "⚠ " + rules.length}`);
  for (const r of rules) console.log(`      ⚠ ${r.tablename}.${r.rulename}`);

  // ── R1c — stream every row ──
  const stream = createWriteStream(ROWS_OUT, { flags: "w" });
  const cells: Record<string, Record<string, number>> = {}; // "table|symbol|period|basis" -> {col: 1 if null}
  const perTable: Record<string, { rows: number; sa: number; co: number; nullCells: number; totalCells: number }> = {};
  const v3: Array<Record<string, unknown>> = [];
  const CHUNK = 40; // stocks per query — keeps each result set well under memory pressure

  for (const m of maps) {
    perTable[m.table] = { rows: 0, sa: 0, co: 0, nullCells: 0, totalCells: 0 };
    const hasQ = m.keyCols.includes("quarter");
    const cols = m.valueCols.map((v) => `"${v.col}"::text AS "${v.field}"`).join(", ");
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const rows = await raw<any>(
        `SELECT "id", "stock_id", "result_type", "fiscal_year"${hasQ ? `, "quarter"` : `, NULL::text AS "quarter"`},
                "report_date"::text rd, "filing_date"::text fd, "source", "updated_at"::text ua,
                "created_at"::text ca${cols ? ", " + cols : ""}
           FROM "${m.table}" WHERE "stock_id" = ANY($1::text[])`, slice);
      for (const r of rows) {
        const st = byId.get(r.stock_id)!;
        const period = hasQ ? `${r.fiscal_year}${r.quarter}` : r.fiscal_year;
        const vals: Record<string, string | null> = {};
        let nulls = 0;
        for (const v of m.valueCols) { const x = S(r[v.field]); vals[v.field] = x; if (x === null) nulls++; }
        const rec = {
          t: m.table, sym: st.symbol, ind: st.industryType, fye: st.fiscalYearEnd,
          fy: r.fiscal_year, q: r.quarter, period, basis: r.result_type,
          rd: r.rd, fd: r.fd, src: r.source, ua: r.ua, ca: r.ca, id: r.id, v: vals,
        };
        stream.write(JSON.stringify(rec) + "\n");
        const k = `${m.table}|${st.symbol}|${period}|${r.result_type}`;
        const cellRec: Record<string, number> = (cells[k] ??= {});
        for (const v of m.valueCols) if (vals[v.field] === null) cellRec[v.field] = 1;
        const pt = perTable[m.table];
        pt.rows++; if (r.result_type === "standalone") pt.sa++; else if (r.result_type === "consolidated") pt.co++;
        pt.nullCells += nulls; pt.totalCells += m.valueCols.length;
        // R1d — the fence baseline
        if (r.rd && r.rd >= V3_FLOOR) {
          v3.push({ t: m.table, sym: st.symbol, period, basis: r.result_type, rd: r.rd, src: r.source, ua: r.ua, id: r.id });
        }
      }
    }
    const pt = perTable[m.table];
    console.log(`\n  ${pad(m.table, 28)} rows ${lp(pt.rows, 6)} (SA ${lp(pt.sa, 5)} · CO ${lp(pt.co, 5)}) · null cells ${lp(pt.nullCells, 7)}/${lp(pt.totalCells, 7)} = ${((100 * pt.nullCells) / Math.max(1, pt.totalCells)).toFixed(1)}%`);
  }
  await new Promise<void>((res) => stream.end(res));
  writeFileSync(CELLS_OUT, JSON.stringify(cells));
  writeFileSync(V3_OUT, JSON.stringify({ label, capturedAt: new Date().toISOString(), v3Floor: V3_FLOOR, count: v3.length, rows: v3 }, null, 1));

  // ── R1d summary ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1d — v3-ERA ROW INVENTORY (report_date >= ${V3_FLOOR}) · FENCE BASELINE   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${v3.length} rows across the 442 cohort stocks`);
  const byT = new Map<string, number>(), bySrc = new Map<string, number>(), byP = new Map<string, number>();
  for (const r of v3) {
    byT.set(r.t as string, (byT.get(r.t as string) ?? 0) + 1);
    bySrc.set(String(r.src), (bySrc.get(String(r.src)) ?? 0) + 1);
    byP.set(String(r.period), (byP.get(String(r.period)) ?? 0) + 1);
  }
  console.log(`  by table : ${[...byT.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`  by period: ${[...byP.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`  by source:`);
  for (const [k, v] of [...bySrc.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${pad(k, 34)}${lp(v, 6)}`);
  const legacyAtV3 = v3.filter((r) => String(r.src).includes("_legacy"));
  console.log(`  rows at/after ${V3_FLOOR} already carrying a *_legacy source: ${legacyAtV3.length === 0 ? "✓ 0 (clean fence)" : "⚠ " + legacyAtV3.length}`);
  for (const r of legacyAtV3.slice(0, 20)) console.log(`    ⚠ ${r.sym} ${r.t} ${r.period} ${r.basis} ${r.src}`);

  // DB-WIDE (not just cohort) legacy-at-v3 — R3b's baseline
  console.log(`\n  DB-WIDE baseline for R3b (all stocks, all four tables):`);
  for (const t of TABLES) {
    const [x] = await raw<any>(
      `SELECT count(*)::int n, count(*) FILTER (WHERE "source" LIKE '%_legacy')::int legacy
         FROM "${t}" WHERE "report_date" >= DATE '${V3_FLOOR}'`);
    console.log(`    ${pad(t, 28)} rows >= ${V3_FLOOR}: ${lp(x.n, 6)} · of which *_legacy: ${x.legacy === 0 ? "✓ 0" : "⚠ " + x.legacy}`);
  }

  // ── R1c summary: presence + oldest depth, so R4a/R4h have a "before" ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1c — BEFORE-STATE SUMMARY (the detail is on disk, not in this console)    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const [ann] = await raw<any>(
    `WITH t AS (SELECT "stock_id" sid,"fiscal_year" fy,"result_type" rt FROM fundamentals WHERE "stock_id"=ANY($1::text[])
                UNION ALL SELECT "stock_id","fiscal_year","result_type" FROM banking_fundamentals WHERE "stock_id"=ANY($1::text[]))
     SELECT count(DISTINCT sid)::int stocks,
            count(DISTINCT sid) FILTER (WHERE rt='standalone')::int with_sa,
            count(DISTINCT sid) FILTER (WHERE rt='consolidated')::int with_co,
            count(DISTINCT (sid,fy))::int periods,
            count(DISTINCT (sid,fy)) FILTER (WHERE rt='standalone')::int sa_periods FROM t`, ids);
  const [qtr] = await raw<any>(
    `WITH t AS (SELECT "stock_id" sid,"fiscal_year" fy,"quarter" q,"result_type" rt FROM quarterly_results WHERE "stock_id"=ANY($1::text[])
                UNION ALL SELECT "stock_id","fiscal_year","quarter","result_type" FROM banking_quarterly_results WHERE "stock_id"=ANY($1::text[]))
     SELECT count(DISTINCT sid)::int stocks,
            count(DISTINCT sid) FILTER (WHERE rt='standalone')::int with_sa,
            count(DISTINCT (sid,fy,q))::int periods,
            count(DISTINCT (sid,fy,q)) FILTER (WHERE rt='standalone')::int sa_periods FROM t`, ids);
  console.log(`  ANNUAL    : ${ann.stocks}/442 stocks hold a row · ${ann.with_sa} hold ≥1 STANDALONE · ${ann.with_co} hold ≥1 consolidated`);
  console.log(`              ${ann.periods} (stock,FY) periods · ${ann.sa_periods} of them have standalone (${((100 * ann.sa_periods) / Math.max(1, ann.periods)).toFixed(1)}%)`);
  console.log(`  QUARTERLY : ${qtr.stocks}/442 stocks hold a row · ${qtr.with_sa} hold ≥1 STANDALONE`);
  console.log(`              ${qtr.periods} (stock,FY,Q) periods · ${qtr.sa_periods} of them have standalone (${((100 * qtr.sa_periods) / Math.max(1, qtr.periods)).toFixed(1)}%)`);
  const zero = await raw<any>(
    `SELECT st."symbol" s FROM stocks st WHERE st."id"=ANY($1::text[])
       AND NOT EXISTS (SELECT 1 FROM fundamentals f WHERE f."stock_id"=st."id")
       AND NOT EXISTS (SELECT 1 FROM banking_fundamentals bf WHERE bf."stock_id"=st."id")
       AND NOT EXISTS (SELECT 1 FROM quarterly_results q WHERE q."stock_id"=st."id")
       AND NOT EXISTS (SELECT 1 FROM banking_quarterly_results bq WHERE bq."stock_id"=st."id")
     ORDER BY 1`, ids);
  console.log(`  stocks with ZERO rows on all four tables today: ${zero.length}`);
  for (let i = 0; i < zero.length; i += 6) console.log(`    ${zero.slice(i, i + 6).map((z: any) => pad(z.s, 14)).join("")}`);

  console.log(`\n  → ${ROWS_OUT}`);
  console.log(`  → ${CELLS_OUT}`);
  console.log(`  → ${V3_OUT}`);
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s · READ-ONLY: SELECTs only, zero NSE calls)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
