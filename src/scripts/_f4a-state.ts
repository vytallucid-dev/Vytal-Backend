// ═══════════════════════════════════════════════════════════════
// F4a/F4c — THE EMPTY-STOCK STATE + THE SWEEP FOR OTHERS. READ-ONLY.
//   npx tsx src/scripts/_f4a-state.ts
//
// Two questions, one pass:
//   (1) what is the exact state of ABBOTINDIA / BAYERCROP / MCX — identity,
//       row counts in EVERY result table, the whole result_fetch_logs history,
//       corporate events, shareholding reach, price reach;
//   (2) F4c — is anything ELSE in the same state? Sweep all 442 for
//       zero-rows and for a stale last-successful discovery.
//
// ⚠ result_fetch_logs columns are (fetched_at, status, error, source, quarter,
//   fiscal_year, result_type, filing_date) — NOT (created_at, message, qe_date).
//   The earlier probe queried the wrong names behind a .catch(()=>[]) and
//   silently reported "0 recent entries" for all three.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

const SYMS = ["ABBOTINDIA", "BAYERCROP", "MCX", "RELIANCE"];

/** Every result table, keyed by the industryType that owns it. */
const TABLES: Record<string, { q: string; f: string }> = {
  non_financial: { q: "quarterly_results", f: "fundamentals" },
  banking: { q: "banking_quarterly_results", f: "banking_fundamentals" },
  nbfc: { q: "nbfc_quarterly_results", f: "nbfc_fundamentals" },
  life_insurance: { q: "life_insurance_quarterly_results", f: "life_insurance_fundamentals" },
  general_insurance: { q: "general_insurance_quarterly_results", f: "general_insurance_fundamentals" },
};
const ALL_Q = Object.values(TABLES).map((t) => t.q);
const ALL_F = Object.values(TABLES).map((t) => t.f);

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F4 — THE EMPTY STOCKS: exact state, and the sweep for others like them     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  // ── PART 1 — the three (+ control), in full ──────────────────────────────
  const deep: any[] = [];
  for (const sym of SYMS) {
    const [st] = await raw(
      `SELECT "id","symbol","name","isin","industryType"::text ind,"fiscalYearEnd"::text fye,
              "is_active" active,"sector_id" sec,"created_at"::text created,"updated_at"::text updated
         FROM stocks WHERE "symbol"=$1`,
      sym,
    );
    console.log(`\n  ══ ${sym} ═════════════════════════════════════════════════════`);
    if (!st) {
      console.log(`     ⚠ NOT IN stocks AT ALL`);
      continue;
    }
    console.log(`     name    ${st.name}`);
    console.log(`     isin    ${st.isin}`);
    console.log(`     id      ${st.id}`);
    console.log(`     ind     ${st.ind}   fye ${st.fye}   active ${st.active}`);
    console.log(`     created ${String(st.created).slice(0, 19)}   updated ${String(st.updated).slice(0, 19)}`);

    const counts: Record<string, number> = {};
    for (const t of [...ALL_Q, ...ALL_F]) {
      const [c] = await raw(`SELECT count(*)::int n FROM "${t}" WHERE "stock_id"=$1`, st.id);
      counts[t] = c.n;
    }
    const nonZero = Object.entries(counts).filter(([, n]) => n > 0);
    console.log(`     result rows: ${nonZero.length === 0 ? "ZERO in ALL 10 result tables" : nonZero.map(([t, n]) => `${t}=${n}`).join("  ")}`);

    // adjacent data — does the rest of the pipeline see this stock at all?
    const [sh] = await raw(
      `SELECT count(*)::int n, min("as_on_date")::text lo, max("as_on_date")::text hi
         FROM shareholding_patterns WHERE "stock_id"=$1`, st.id);
    const [dp] = await raw(
      `SELECT count(*)::int n, min("date")::text lo, max("date")::text hi
         FROM daily_prices WHERE "stock_id"=$1`, st.id);
    const [ce] = await raw(
      `SELECT count(*)::int n, min("event_date")::text lo, max("event_date")::text hi
         FROM corporate_events WHERE "stock_id"=$1`, st.id);
    console.log(`     shareholding    ${lp(sh.n, 5)} rows  ${sh.lo ?? "-"} .. ${sh.hi ?? "-"}`);
    console.log(`     daily_prices    ${lp(dp.n, 5)} rows  ${dp.lo ?? "-"} .. ${dp.hi ?? "-"}`);
    console.log(`     corporate_events${lp(ce.n, 5)} rows  ${ce.lo ?? "-"} .. ${ce.hi ?? "-"}`);

    // the WHOLE fetch-log history — this is the defect's own audit trail
    const logs = await raw(
      `SELECT "fetched_at"::text ts,"status","source","quarter" q,"fiscal_year" fy,
              "result_type" rt,"filing_date"::text fd,"error"
         FROM result_fetch_logs WHERE "stock_id"=$1 ORDER BY "fetched_at" DESC`, st.id);
    console.log(`     result_fetch_logs: ${logs.length} row(s) TOTAL`);
    for (const l of logs.slice(0, 14)) {
      console.log(
        `        ${pad(String(l.ts).slice(0, 19), 20)}${pad(l.status, 18)}${pad(l.source, 18)}` +
          `${pad((l.fy ?? "") + (l.q ?? ""), 8)}${String(l.error ?? "").slice(0, 60)}`,
      );
    }
    if (logs.length > 14) console.log(`        … ${logs.length - 14} more`);

    // symbol-change / renaming evidence
    const evs = await raw(
      `SELECT "event_type" et,"event_date"::text ed, left(coalesce("purpose",''),100) p
         FROM corporate_events WHERE "stock_id"=$1 ORDER BY "event_date" DESC LIMIT 8`, st.id);
    if (evs.length) {
      console.log(`     recent corporate events:`);
      for (const e of evs) console.log(`        ${pad(String(e.ed).slice(0, 10), 12)}${pad(e.et, 18)}${e.p}`);
    }

    deep.push({ sym, st, counts, sh, dp, ce, logs: logs.length, logRows: logs });
  }

  // ── PART 2 — F4c: THE SWEEP ──────────────────────────────────────────────
  console.log(`\n\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F4c — SWEEP: is anything ELSE in this state?                               ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const cohort = await loadCohort();
  console.log(`  cohort (active · non_financial|banking) : ${cohort.length}`);

  // row counts per stock across EVERY result table, in one pass each
  const qUnion = ALL_Q.map((t) => `SELECT "stock_id" sid, max("report_date")::text rd FROM "${t}" GROUP BY 1`).join(" UNION ALL ");
  const fUnion = ALL_F.map((t) => `SELECT "stock_id" sid FROM "${t}"`).join(" UNION ALL ");
  const qAgg = await raw(`SELECT sid, count(*)::int n, max(rd) rd FROM (${qUnion}) x GROUP BY sid`);
  const fAgg = await raw(`SELECT sid, count(*)::int n FROM (${fUnion}) x GROUP BY sid`);
  const qCount = new Map<string, { n: number; rd: string }>();
  for (const r of qAgg) qCount.set(r.sid, { n: r.n, rd: r.rd });
  const fCount = new Map<string, number>();
  for (const r of fAgg) fCount.set(r.sid, r.n);

  // per-stock quarterly row totals (not the grouped max) — need a real count
  const qRowsUnion = ALL_Q.map((t) => `SELECT "stock_id" sid FROM "${t}"`).join(" UNION ALL ");
  const qRows = await raw(`SELECT sid, count(*)::int n FROM (${qRowsUnion}) x GROUP BY sid`);
  const qRowCount = new Map<string, number>();
  for (const r of qRows) qRowCount.set(r.sid, r.n);

  // last discovery attempt + last time a discovery reported > 0 filings
  const lastLog = await raw(
    `SELECT "stock_id" sid, max("fetched_at")::text ts FROM result_fetch_logs GROUP BY 1`);
  const lastLogMap = new Map<string, string>();
  for (const r of lastLog) lastLogMap.set(r.sid, r.ts);

  const discovery = await raw(
    `SELECT "stock_id" sid, "fetched_at"::text ts, "status", coalesce("error",'') err
       FROM result_fetch_logs WHERE "source"='nse_filings_api'`);
  const discByStock = new Map<string, any[]>();
  for (const r of discovery) {
    if (!discByStock.has(r.sid)) discByStock.set(r.sid, []);
    discByStock.get(r.sid)!.push(r);
  }

  const zeroAll: any[] = [];
  const zeroQuarterly: any[] = [];
  const staleTail: any[] = [];
  const zeroDiscovery: any[] = [];

  const NOW = new Date();
  for (const c of cohort) {
    const q = qRowCount.get(c.id) ?? 0;
    const f = fCount.get(c.id) ?? 0;
    const rd = qCount.get(c.id)?.rd ?? null;
    const d = (discByStock.get(c.id) ?? []).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const lastDisc = d[0] ?? null;
    const zeroFilingDisc = d.filter((x) => /^0 filings discovered/.test(x.err));

    if (q === 0 && f === 0) {
      zeroAll.push({ sym: c.symbol, ind: c.industryType, lastDisc: lastDisc?.ts ?? null, err: lastDisc?.err ?? null });
    } else if (q === 0) {
      zeroQuarterly.push({ sym: c.symbol, ind: c.industryType, f });
    }
    if (zeroFilingDisc.length) {
      zeroDiscovery.push({
        sym: c.symbol, ind: c.industryType, q, f,
        n: zeroFilingDisc.length,
        latest: zeroFilingDisc[0].ts,
        status: zeroFilingDisc[0].status,
      });
    }
    if (rd) {
      const ageDays = Math.floor((NOW.getTime() - new Date(rd).getTime()) / 86_400_000);
      if (ageDays > 210) staleTail.push({ sym: c.symbol, ind: c.industryType, lastReport: rd, ageDays, q });
    }
  }

  console.log(`\n  ── A · ZERO ROWS IN EVERY RESULT TABLE (quarterly AND fundamentals) ──`);
  console.log(`  ${zeroAll.length} stock(s)`);
  console.log(`  ${pad("symbol", 14)}${pad("industry", 15)}${pad("last discovery", 22)}note`);
  for (const z of zeroAll.sort((a, b) => a.sym.localeCompare(b.sym)))
    console.log(`  ${pad(z.sym, 14)}${pad(z.ind, 15)}${pad(String(z.lastDisc ?? "(never)").slice(0, 19), 22)}${String(z.err ?? "").slice(0, 44)}`);

  console.log(`\n  ── B · ZERO QUARTERLY ROWS but SOME fundamentals ──`);
  console.log(`  ${zeroQuarterly.length} stock(s)`);
  for (const z of zeroQuarterly) console.log(`  ${pad(z.sym, 14)}${pad(z.ind, 15)}fundamentals=${z.f}`);

  console.log(`\n  ── C · A DISCOVERY THAT RETURNED ZERO FILINGS, EVER (the silent-success class) ──`);
  console.log(`  ${zeroDiscovery.length} stock(s) carry at least one "0 filings discovered" log row`);
  console.log(`  ${pad("symbol", 14)}${pad("industry", 15)}${lp("qrows", 6)}${lp("frows", 6)}${lp("n", 4)}  ${pad("latest", 21)}status`);
  for (const z of zeroDiscovery.sort((a, b) => a.q - b.q || a.sym.localeCompare(b.sym)))
    console.log(`  ${pad(z.sym, 14)}${pad(z.ind, 15)}${lp(z.q, 6)}${lp(z.f, 6)}${lp(z.n, 4)}  ${pad(String(z.latest).slice(0, 19), 21)}${z.status}`);

  console.log(`\n  ── D · STALE TAIL: newest report_date older than 210 days ──`);
  console.log(`  ${staleTail.length} stock(s)`);
  console.log(`  ${pad("symbol", 14)}${pad("industry", 15)}${pad("last report_date", 18)}${lp("age(d)", 8)}${lp("rows", 6)}`);
  for (const z of staleTail.sort((a, b) => b.ageDays - a.ageDays).slice(0, 40))
    console.log(`  ${pad(z.sym, 14)}${pad(z.ind, 15)}${pad(String(z.lastReport).slice(0, 10), 18)}${lp(z.ageDays, 8)}${lp(z.q, 6)}`);
  if (staleTail.length > 40) console.log(`  … ${staleTail.length - 40} more`);

  // ── the status distribution of every discovery log, so the defect's blast radius is visible
  const dist = await raw(
    `SELECT "status", count(*)::int n,
            count(*) FILTER (WHERE "error" LIKE '0 filings discovered%')::int zero
       FROM result_fetch_logs WHERE "source"='nse_filings_api' GROUP BY 1 ORDER BY 2 DESC`);
  console.log(`\n  ── E · every nse_filings_api discovery log, by status ──`);
  console.log(`  ${pad("status", 20)}${lp("rows", 8)}${lp("of which 0-filings", 22)}`);
  for (const d of dist) console.log(`  ${pad(d.status, 20)}${lp(d.n, 8)}${lp(d.zero, 22)}`);

  writeFileSync(`${DIR}/_f4a-state.json`, JSON.stringify({ deep, zeroAll, zeroQuarterly, zeroDiscovery, staleTail, dist }, null, 1));
  console.log(`\n  → ${DIR}/_f4a-state.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
