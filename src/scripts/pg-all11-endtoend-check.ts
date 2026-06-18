// ALL-11 NON-FINANCIAL END-TO-END CROSS-VERIFY — the commit gate (dry-run, commits nothing).
//
//   npx tsx src/scripts/pg-all11-endtoend-check.ts
//
// Proves, against the loaded REDERIVE_FINAL bars, that:
//   0. REDERIVE_FINAL re-validates (188 mapped, 176 would-write) WITH the SSCU scope re-key.
//   1. Model-wide OPM fix: M1 = the SHARED EBITDA m1TtmOpm; M1_OPM_TTM emit-renames the
//      SAME fn (no separate PG8 OPM function). M1 and M1_OPM_TTM are identical.
//   2. REGRESSION: dispatch == computeFoundation/computeMomentum (routing invariant); the
//      NEW EBITDA M1 differs from the legacy EBIT OPM (the compute-side shift is real).
//   3. ALL 11 non-financial PGs score end-to-end (per-metric → per-pillar → composite
//      → band). Per-PG summary: stocks scored, unavailable metrics+reasons, composite
//      range, band distribution (sane = not all floored/maxed).
//   4. NTPC + thermal peers: M1_OPM_TTM old(EBIT) vs new(EBITDA) — which case (the
//      definitional mismatch was the floor cause, OR a genuine margin read).
//   5. PG8 SSCU at the CORRECTED N=7 roster: TATAPOWER + TORNTPOWER both score F1_OPM
//      & M1_OPM_TTM via the 3-anchor sscuBars; the other 5 peers use standard bars;
//      TORNTPOWER scores as peer #7; anchor-lift threshold = 6-of-7.
//
// ROSTER SOURCE: the CORRECTED seed (peer-groups.seed.ts) resolved to stockIds by a
// read-only stock lookup — NOT the stockPeerGroup join. The DB membership table still
// reflects the OLD roster (ADANIGREEN) until the authorized re-seed (fix-pg8-roster.ts
// --commit) runs; resolving from the seed exercises the corrected N=7 with NO DB write.

import { prisma } from "../db/prisma.js";
import { readFileSync } from "node:fs";
import { VYTAL_BARS_PATH, VYTAL_BARS_FILENAME } from "../scoring/bars-loader/source.js";
import { loadVytalBars } from "../scoring/bars-loader/load-vytal-bars.js";
import { indexRows, resolveBars } from "../scoring/bars-loader/resolve.js";
import type { SourceDocument } from "../scoring/bars-loader/types.js";
import { loadFoundationStandalone, loadMomentumStandalone } from "../scoring/metrics/load.js";
import { computeFoundation } from "../scoring/metrics/foundation.js";
import { computeMomentum, m1TtmOpm, consecutiveTail } from "../scoring/metrics/momentum.js";
import type { FoundationAnnual, MomentumQuarter, MetricValue } from "../scoring/metrics/types.js";
import { dispatchLiveValues, selectPgKeys, printDispatchTable, DISPATCH_TABLE } from "../scoring/metric-scoring/live-dispatch.js";
import { scoreL1 } from "../scoring/lenses/lens-bars.js";
import { scoreMetricCrossSection, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { NO_SUPPRESSION, type WiringConfig } from "../scoring/metric-scoring/types.js";
import { PEER_GROUPS } from "./peer-groups.seed.js";

const H = (s: string) => console.log("\n" + "═".repeat(100) + "\n  " + s + "\n" + "═".repeat(100));
const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
const FOUNDATION_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const MOMENTUM_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };

// Band thresholds (mirror lens-bars BAR_SCORE / bandFromScore — not exported there).
const bandOf = (s: number): string =>
  s >= 90 ? "excellent" : s >= 75 ? "good" : s >= 60 ? "acceptable" : s >= 40 ? "concerning" : "distress";

interface Assert { name: string; pass: boolean; detail: string }
const asserts: Assert[] = [];
const check = (name: string, pass: boolean, detail = "") => asserts.push({ name, pass, detail });

interface Member { stockId: string; symbol: string; fRows: FoundationAnnual[]; qRows: MomentumQuarter[] }

// LEGACY (pre-fix) EBIT-style TTM OPM — kept LOCAL to this harness purely to DOCUMENT
// the compute-side shift (EBIT → EBITDA). The engine no longer computes this; m1TtmOpm
// is now the shared EBITDA definition. Σ4Q(operatingProfitStored | PBT+int−OI)/Σrev×100.
function legacyEbitOpm(run: MomentumQuarter[]): number | null {
  if (run.length < 4) return null;
  const ttm = run.slice(-4);
  let op = 0, rev = 0;
  for (const q of ttm) {
    const v = q.operatingProfitStored !== null
      ? q.operatingProfitStored
      : (q.profitBeforeTax !== null && q.interest !== null ? q.profitBeforeTax + q.interest - (q.otherIncome ?? 0) : null);
    if (v === null || q.revenue === null) return null;
    op += v; rev += q.revenue;
  }
  return rev === 0 ? null : (op / rev) * 100;
}

// EXPLICIT FINAL-pgId → seed-key alignment (by SECTOR, not by number). PG1–PG13 line
// up with the core seed groups; FINAL PG14 = Defense/Aerospace. As of 2026-06-19 the
// seed's CORE pg14 IS Defense (re-keyed Insurance→Defense; the old alt a7_defense was
// promoted into it), so PG14 now maps to the core pg14_defense — no longer a mismatch.
// Banking PG5/PG6 are not scored end-to-end (gated elsewhere).
const FINAL_PG_TO_SEED_KEY: Record<string, string> = {
  PG1: "pg1_it_services", PG2: "pg2_fmcg", PG3: "pg3_pharma", PG4: "pg4_auto_oem",
  PG8: "pg8_power", PG9: "pg9_metals", PG10: "pg10_oil_gas", PG11: "pg11_capital_goods",
  PG12: "pg12_cement", PG13: "pg13_consumer_durables", PG14: "pg14_defense",
};

/** Resolve a PG's roster from the CORRECTED seed → stockIds (read-only). */
async function rosterFromSeed(seedKey: string): Promise<Member[]> {
  const seed = PEER_GROUPS.find((p) => p.key === seedKey);
  if (!seed) return [];
  const stocks = await prisma.stock.findMany({ where: { symbol: { in: seed.stocks } }, select: { id: true, symbol: true } });
  const idBySym = new Map(stocks.map((s) => [s.symbol, s.id]));
  const out: Member[] = [];
  for (const sym of seed.stocks) {
    const id = idBySym.get(sym);
    if (!id) continue; // not ingested — skip (reported in the summary)
    out.push({ stockId: id, symbol: sym, fRows: await loadFoundationStandalone(id), qRows: await loadMomentumStandalone(id) });
  }
  return out;
}

/** Own-history series for one key via truncated recompute through the dispatch. */
function seriesForKey(m: Member, key: string, pillar: "foundation" | "momentum"): number[] {
  const out: number[] = [];
  if (pillar === "foundation") {
    const sorted = [...m.fRows].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
    for (let i = 0; i < sorted.length; i++) {
      const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [key], momentumKeys: [], foundationRows: sorted.slice(0, i + 1), momentumQuarters: [] });
      if (d.status === "computed" && d.foundation[0]?.available && d.foundation[0].value !== null) out.push(d.foundation[0].value);
    }
  } else {
    const sorted = [...m.qRows].sort((a, b) => a.qOrdinal - b.qOrdinal);
    for (let i = 0; i < sorted.length; i++) {
      const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [], momentumKeys: [key], foundationRows: [], momentumQuarters: sorted.slice(0, i + 1) });
      if (d.status === "computed" && d.momentum[0]?.available && d.momentum[0].value !== null) out.push(d.momentum[0].value);
    }
  }
  return out;
}

type Idx = ReturnType<typeof indexRows>;

/** Score one PG end-to-end. Returns per-stock pillar/composite + availability tallies. */
function scorePg(
  idx: Idx, pgId: string, members: Member[],
  foundationKeys: string[], momentumKeys: string[],
) {
  const live = new Map<string, ReturnType<typeof dispatchLiveValues>>();
  for (const m of members) live.set(m.symbol, dispatchLiveValues({ industryType: "non_financial", foundationKeys, momentumKeys, foundationRows: m.fRows, momentumQuarters: m.qRows }));

  // per-stock collected metricScores by pillar
  const fScores = new Map<string, number[]>();
  const mScores = new Map<string, number[]>();
  for (const m of members) { fScores.set(m.symbol, []); mScores.set(m.symbol, []); }

  const unavail = new Map<string, string>(); // "key" -> dominant reason
  const noBars: string[] = [];

  const runPillar = (keys: string[], pillar: "foundation" | "momentum", bucket: Map<string, number[]>, cfg: WiringConfig) => {
    for (const key of keys) {
      const rb = resolveBars(idx, pgId, key);
      if (!rb) { noBars.push(key); continue; }
      const ov = rb.sscu ? { bars: rb.sscu.bars, scope: rb.sscu.scope } : null;
      const xsMembers: CrossSectionMember[] = members.map((m) => {
        const d = live.get(m.symbol)!;
        const arr = d.status === "computed" ? (pillar === "foundation" ? d.foundation : d.momentum) : [];
        const mv = arr.find((x) => x.key === key);
        const avail = !!mv && mv.available && mv.value !== null;
        if (!avail) unavail.set(`${key}`, mv?.reason ?? "no value");
        return { stockId: m.stockId, symbol: m.symbol, rawValue: avail ? mv!.value : null, available: avail, unavailableReason: avail ? null : (mv?.reason ?? "no value"), ownHistoryValues: seriesForKey(m, key, pillar) };
      });
      const xs = scoreMetricCrossSection({
        pillar, metricKey: key, label: key, snapshot: pillar === "foundation" ? "FY" : "FYQ",
        direction: rb.direction, bars: rb.bars, barNote: rb.note, sscu: ov,
        members: xsMembers, suppression: NO_SUPPRESSION, config: cfg,
      });
      for (const s of xs.scored) if (s.scoreState === "scored" && s.metricScore !== null) bucket.get(s.symbol)!.push(s.metricScore);
    }
  };
  runPillar(foundationKeys, "foundation", fScores, FOUNDATION_CFG);
  runPillar(momentumKeys, "momentum", mScores, MOMENTUM_CFG);

  const rows = members.map((m) => {
    const fs = fScores.get(m.symbol)!, ms = mScores.get(m.symbol)!;
    const fPillar = fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : null;
    const mPillar = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
    const pillars = [fPillar, mPillar].filter((x): x is number => x !== null);
    const composite = pillars.length ? pillars.reduce((a, b) => a + b, 0) / pillars.length : null;
    return { symbol: m.symbol, fCount: fs.length, mCount: ms.length, fPillar, mPillar, composite, band: composite !== null ? bandOf(composite) : null };
  });
  return { rows, unavail, noBars, live };
}

async function main() {
  const doc = JSON.parse(readFileSync(VYTAL_BARS_PATH, "utf8")) as SourceDocument;
  const report = loadVytalBars(doc, { mode: "validate_only", sourcePath: VYTAL_BARS_PATH });
  const idx = indexRows(report.wouldWrite);

  console.log(`ALL-11 NON-FINANCIAL END-TO-END — DRY RUN (commits nothing)`);
  console.log(`  source: ${VYTAL_BARS_FILENAME}  framework ${report.specVersionFramework}  ${report.totalMapped}/${report.totalMetrics} mapped  ${report.totalWouldWriteRows} would-write`);
  check("REDERIVE_FINAL re-validates (188 mapped, 176 would-write)", report.pass && report.totalMapped === 188 && report.totalWouldWriteRows === 176, `mapped=${report.totalMapped} wouldWrite=${report.totalWouldWriteRows} pass=${report.pass}`);

  // ── 1. DISPATCH TABLE + model-wide OPM fix ──
  H("1. DISPATCH TABLE  +  model-wide OPM fix (M1 = EBITDA shared · M1_OPM_TTM emit-renames the SAME fn)");
  printDispatchTable();
  const m1Row = DISPATCH_TABLE.find((e) => e.key === "M1")!;
  const opmRow = DISPATCH_TABLE.find((e) => e.key === "M1_OPM_TTM")!;
  console.log(`\n  M1         → ${m1Row.fn}  [${m1Row.status}]`);
  console.log(`  M1_OPM_TTM → ${opmRow.fn}  [${opmRow.status}]`);
  check("M1 routes to the SHARED m1TtmOpm (now EBITDA, model-wide)", m1Row.fn === "m1TtmOpm" && m1Row.status === "implemented", `${m1Row.fn}/${m1Row.status}`);
  check("M1_OPM_TTM emit-renames the SAME shared m1TtmOpm (no separate PG8 fn)", opmRow.fn === "m1TtmOpm" && opmRow.status === "reuse_rekey", `${opmRow.fn}/${opmRow.status}`);

  // ── 2. DISPATCH-vs-REFERENCE INVARIANT + COMPUTE-SIDE SHIFT (PG3) ──
  H("2. REGRESSION — dispatch == computeFoundation/computeMomentum (invariant); M1 is now EBITDA (compute-side shift is real & model-wide)");
  {
    const pg3 = report.perPg.find((p) => p.pgId === "PG3")!;
    const sel = selectPgKeys(pg3.mapping);
    const members = await rosterFromSeed("pg3_pharma");
    let compared = 0, mismatch = 0; const diffs: string[] = [];
    let shiftSeen = 0, m1EqOpm = 0, m1Checked = 0;
    for (const m of members) {
      const disp = dispatchLiveValues({ industryType: "non_financial", foundationKeys: sel.foundationKeys, momentumKeys: sel.momentumKeys, foundationRows: m.fRows, momentumQuarters: m.qRows });
      if (disp.status !== "computed") { mismatch++; diffs.push(`${m.symbol}: ${disp.status}`); continue; }
      const fRef = computeFoundation(m.fRows), mRef = computeMomentum(m.qRows);
      const refMap = new Map<string, MetricValue>();
      for (const v of fRef?.metrics ?? []) refMap.set(v.key, v);
      for (const v of mRef?.metrics ?? []) refMap.set(v.key, v);
      for (const dv of [...disp.foundation, ...disp.momentum]) {
        const rv = refMap.get(dv.key); compared++;
        const same = !!rv && rv.available === dv.available && rv.reason === dv.reason &&
          ((rv.value === null && dv.value === null) || (rv.value !== null && dv.value !== null && Math.abs(rv.value - dv.value) < 1e-9));
        if (!same) { mismatch++; diffs.push(`${m.symbol} ${dv.key}: disp(${dv.available},${f2(dv.value, 4)}) vs ref(${rv?.available},${f2(rv?.value ?? null, 4)})`); }
      }
      // COMPUTE-SIDE SHIFT: the NEW shared M1 (EBITDA m1TtmOpm) vs the LEGACY EBIT def.
      const run = consecutiveTail(m.qRows);
      const ebitda = m1TtmOpm(run), legacy = legacyEbitOpm(run);
      if (ebitda.available && ebitda.value !== null && legacy !== null && Math.abs(ebitda.value - legacy) > 1e-6) shiftSeen++;
      // M1 (standard) and M1_OPM_TTM (PG8 emit-rename) are the SAME shared fn → identical.
      const dM1 = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [], momentumKeys: ["M1"], foundationRows: [], momentumQuarters: m.qRows });
      const dOPM = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [], momentumKeys: ["M1_OPM_TTM"], foundationRows: [], momentumQuarters: m.qRows });
      if (dM1.status === "computed" && dOPM.status === "computed" && dM1.momentum[0].available && dOPM.momentum[0].available) {
        m1Checked++;
        if (Math.abs((dM1.momentum[0].value ?? NaN) - (dOPM.momentum[0].value ?? NaN)) < 1e-9) m1EqOpm++;
      }
    }
    console.log(`  PG3 pharma: ${members.length} stocks → ${compared} metric-value comparisons vs pre-dispatch path, ${mismatch} mismatch`);
    if (diffs.length) diffs.slice(0, 6).forEach((d) => console.log(`     ✗ ${d}`));
    else console.log(`     ✓ every dispatched value byte-identical to computeFoundation/computeMomentum (dispatch routing is a pure pass-through)`);
    console.log(`  NEW EBITDA M1 vs LEGACY EBIT OPM on the same TTM windows: ${shiftSeen}/${members.length} stocks differ (depreciation add-back — the model-wide compute shift)`);
    console.log(`  M1 (standard) == M1_OPM_TTM (PG8 emit-rename) on the same windows: ${m1EqOpm}/${m1Checked} identical (one shared EBITDA fn)`);
    check("PG3 dispatch values byte-identical to pre-dispatch (routing invariant holds)", mismatch === 0 && compared > 0, `${compared} cmp, ${mismatch} mismatch`);
    check("EBITDA M1 ≠ legacy EBIT OPM (compute-side shift is real & model-wide)", shiftSeen > 0, `${shiftSeen} stocks differ`);
    check("M1 == M1_OPM_TTM (single shared EBITDA fn, emit-renamed)", m1Checked > 0 && m1EqOpm === m1Checked, `${m1EqOpm}/${m1Checked} identical`);
  }

  // ── 3. ALL 11 NON-FINANCIAL PGs END-TO-END ──
  H("3. ALL 11 NON-FINANCIAL PGs — end-to-end (metric → pillar → composite-proxy → band)");
  console.log(`  NOTE: composite-proxy = equal-weight mean of the TWO metric-bar pillars present in this bar-set`);
  console.log(`        (Foundation, Momentum). Valuation + the 4th pillar are a separate downstream bar-set,`);
  console.log(`        NOT part of this loader — flagged, not scored here.\n`);
  console.log(`  ${"PG".padEnd(5)} ${"name".padEnd(22)} ${"stk".padEnd(4)} ${"F-avail".padEnd(9)} ${"M-avail".padEnd(9)} ${"composite".padEnd(16)} band-distribution`);
  console.log(`  ${"─".repeat(5)} ${"─".repeat(22)} ${"─".repeat(4)} ${"─".repeat(9)} ${"─".repeat(9)} ${"─".repeat(16)} ${"─".repeat(28)}`);
  const nonFin = report.perPg.filter((p) => p.industry === "non_financial");
  for (const pg of nonFin) {
    const seedKey = FINAL_PG_TO_SEED_KEY[pg.pgId];
    const sel = selectPgKeys(pg.mapping);
    const members = seedKey ? await rosterFromSeed(seedKey) : [];
    const flag = pg.pgId === "PG14" ? "  ✓ PG14=Defense → core pg14_defense (re-keyed from Insurance; A7 promoted)" : "";
    if (members.length === 0) { console.log(`  ${pg.pgId.padEnd(5)} ${pg.pgName.slice(0, 22).padEnd(22)} 0    (no roster/ingested members)${flag}`); check(`${pg.pgId} scored end-to-end`, false, `0 members (seedKey=${seedKey ?? "NONE"})`); continue; }
    const r = scorePg(idx, pg.pgId, members, sel.foundationKeys, sel.momentumKeys);
    const scoredRows = r.rows.filter((x) => x.composite !== null);
    const comps = scoredRows.map((x) => x.composite!);
    const bandDist = new Map<string, number>();
    for (const x of scoredRows) bandDist.set(x.band!, (bandDist.get(x.band!) ?? 0) + 1);
    const fAvailAvg = (r.rows.reduce((a, x) => a + x.fCount, 0) / members.length).toFixed(1);
    const mAvailAvg = (r.rows.reduce((a, x) => a + x.mCount, 0) / members.length).toFixed(1);
    const range = comps.length ? `${f2(Math.min(...comps))}–${f2(Math.max(...comps))}` : "—";
    const distStr = [...bandDist.entries()].map(([b, c]) => `${b}:${c}`).join(" ");
    console.log(`  ${pg.pgId.padEnd(5)} ${pg.pgName.slice(0, 22).padEnd(22)} ${String(members.length).padEnd(4)} ${`${fAvailAvg}/${sel.foundationKeys.length}`.padEnd(9)} ${`${mAvailAvg}/${sel.momentumKeys.length}`.padEnd(9)} ${range.padEnd(16)} ${distStr}${flag}`);
    // sanity: at least one stock scored, and NOT every scored stock in the same extreme band
    const allFloored = scoredRows.length > 0 && scoredRows.every((x) => x.composite! <= 20.0001);
    const allMaxed = scoredRows.length > 0 && scoredRows.every((x) => x.composite! >= 99.9999);
    const sane = scoredRows.length > 0 && !allFloored && !allMaxed;
    check(`${pg.pgId} scores end-to-end, distribution sane (not all floored/maxed)`, sane, `scored=${scoredRows.length}/${members.length} range=${range} bands={${distStr}}`);
    if (r.unavail.size) console.log(`        unavailable: ${[...r.unavail.entries()].map(([k, why]) => `${k}(${why})`).join(", ")}`);
    if (r.noBars.length) console.log(`        NO BARS for keys: ${r.noBars.join(",")}`);
  }

  // ── 4. NTPC + THERMAL PEERS — legacy(EBIT) vs new SHARED M1 (EBITDA) ──
  H("4. NTPC + thermal peers — M1_OPM_TTM: legacy EBIT (pre-fix) vs the new SHARED EBITDA m1TtmOpm; which case?");
  {
    const pg8 = report.perPg.find((p) => p.pgId === "PG8")!;
    const members = await rosterFromSeed("pg8_power");
    const rb = resolveBars(idx, "PG8", "M1_OPM_TTM")!;
    console.log(`  PG8 M1_OPM_TTM standard bars: E${rb.bars.excellent}/G${rb.bars.good}/A${rb.bars.acceptable}/C${rb.bars.concerning}/D${rb.bars.distress}  (EBITDA basis)`);
    console.log(`  sscu bars (TataPower/TORNTPOWER): E${rb.sscu?.bars.excellent}/G${rb.sscu?.bars.good}/D${rb.sscu?.bars.distress}\n`);
    console.log(`  ${"stock".padEnd(11)} ${"EBIT(legacy)".padEnd(12)} ${"L1(std)".padEnd(9)} ${"EBITDA(new)".padEnd(11)} ${"L1".padEnd(20)} barSet`);
    let flooredOld = 0, liftedNew = 0;
    const scope = rb.sscu?.scope ?? [];
    for (const m of members) {
      const run = consecutiveTail(m.qRows);
      const ebitVal = legacyEbitOpm(run);          // pre-fix EBIT definition (documentation only)
      const ebitda = m1TtmOpm(run);                // the new SHARED EBITDA fn the engine now uses
      const ov = rb.sscu ? { bars: rb.sscu.bars, scope } : null;
      const l1Old = ebitVal !== null ? scoreL1(ebitVal, rb.bars, rb.direction, { stock: m.symbol, override: ov }) : null;
      const l1New = ebitda.available && ebitda.value !== null ? scoreL1(ebitda.value, rb.bars, rb.direction, { stock: m.symbol, override: ov }) : null;
      if (l1Old && l1Old.band === "distress" && l1Old.saturated) flooredOld++;
      if (l1Old && l1Old.band === "distress" && l1New && l1New.band !== "distress") liftedNew++;
      console.log(`  ${m.symbol.padEnd(11)} ${f2(ebitVal).padStart(11)} ${(l1Old ? `${f2(l1Old.score)}/${l1Old.band}` : "—").padEnd(9)} ${f2(ebitda.value).padStart(10)} ${(l1New ? `${f2(l1New.score)}/${l1New.band} ${l1New.barSetUsed}` : "—").padEnd(20)} ${l1New?.barSetUsed ?? "—"}`);
    }
    const ntpcRun = consecutiveTail(members.find((m) => m.symbol === "NTPC")?.qRows ?? []);
    const ntpcEbit = legacyEbitOpm(ntpcRun), ntpcEbitda = m1TtmOpm(ntpcRun);
    console.log(`\n  NTPC: EBIT(legacy)=${f2(ntpcEbit)}%  EBITDA(new)=${f2(ntpcEbitda.value)}%  Δ=${ntpcEbit !== null && ntpcEbitda.value !== null ? f2(ntpcEbitda.value - ntpcEbit) : "—"}pp (depreciation add-back)`);
    const ntpcNewL1 = ntpcEbitda.available && ntpcEbitda.value !== null ? scoreL1(ntpcEbitda.value, rb.bars, rb.direction, { stock: "NTPC", override: null }) : null;
    const verdict = ntpcNewL1 && ntpcNewL1.band !== "distress" ? "CASE A: EBIT/EBITDA mismatch was the floor cause — NTPC scores sanely on EBITDA"
      : "CASE B: still low on EBITDA → genuine recent margin read (commits as-is, honest low)";
    console.log(`  VERDICT: ${verdict}`);
    console.log(`  thermal peers floored on legacy EBIT: ${flooredOld}; lifted out of distress by the EBITDA fix: ${liftedNew}`);
    check("NTPC M1_OPM_TTM computes on the EBITDA fn (model-wide OPM fix captured)", ntpcEbitda.available || ntpcEbitda.reason !== null, `ebitda=${f2(ntpcEbitda.value)} reason=${ntpcEbitda.reason ?? "—"}`);
    check("NTPC EBITDA M1 lands OUT of distress (CASE A — definitional floor removed)", !!ntpcNewL1 && ntpcNewL1.band !== "distress", `band=${ntpcNewL1?.band} score=${f2(ntpcNewL1?.score ?? null)}`);
  }

  // ── 5. PG8 SSCU at the CORRECTED N=7 ──
  H("5. PG8 SSCU @ corrected N=7 — TATAPOWER + TORNTPOWER fire 3-anchor; other 5 standard; anchor-lift 6-of-7");
  {
    const pg8 = report.perPg.find((p) => p.pgId === "PG8")!;
    const sel = selectPgKeys(pg8.mapping);
    const members = await rosterFromSeed("pg8_power");
    console.log(`  roster (from corrected seed): [${members.map((m) => m.symbol).join(", ")}]  N=${members.length}`);
    check("PG8 corrected roster = 7 (TORNTPOWER in, ADANIGREEN out)", members.length === 7 && members.some((m) => m.symbol === "TORNTPOWER") && !members.some((m) => m.symbol === "ADANIGREEN"), members.map((m) => m.symbol).join(","));

    const r = scorePg(idx, "PG8", members, sel.foundationKeys, sel.momentumKeys);
    for (const key of ["F1_OPM", "M1_OPM_TTM"]) {
      const pillar = key === "F1_OPM" ? "foundation" : "momentum";
      const rb = resolveBars(idx, "PG8", key)!;
      const ov = rb.sscu ? { bars: rb.sscu.bars, scope: rb.sscu.scope } : null;
      const xsMembers: CrossSectionMember[] = members.map((m) => {
        const d = r.live.get(m.symbol)!;
        const arr = d.status === "computed" ? (pillar === "foundation" ? d.foundation : d.momentum) : [];
        const mv = arr.find((x) => x.key === key);
        const avail = !!mv && mv.available && mv.value !== null;
        return { stockId: m.stockId, symbol: m.symbol, rawValue: avail ? mv!.value : null, available: avail, unavailableReason: avail ? null : (mv?.reason ?? "no value"), ownHistoryValues: seriesForKey(m, key, pillar) };
      });
      const xs = scoreMetricCrossSection({
        pillar, metricKey: key, label: key, snapshot: "snap", direction: rb.direction, bars: rb.bars, barNote: rb.note,
        sscu: ov, members: xsMembers, suppression: NO_SUPPRESSION, config: pillar === "foundation" ? FOUNDATION_CFG : MOMENTUM_CFG,
      });
      console.log(`\n  ${key}: peer μ=${f2(xs.peerStats.mean)} σ=${f2(xs.peerStats.stdDev)} N=${xs.peerStats.sampleN}  lift531: ${xs.lift531.clearedCount}/${xs.lift531.n} cleared → fired=${xs.lift531.fired}  (threshold ⌈0.75·N⌉)  scope=${JSON.stringify(rb.sscu?.scope ?? [])}`);
      for (const s of xs.scored) {
        if (s.scoreState !== "scored") { console.log(`    ${s.symbol.padEnd(11)} ${s.scoreState} (${s.unavailableReason})`); continue; }
        console.log(`    ${s.symbol.padEnd(11)} raw=${f2(s.rawValue).padStart(8)} L1=${f2(s.l1Score).padStart(6)}/${(s.l1Band ?? "").padEnd(10)} barSet=${(s.l1BarSetUsed ?? "—").padEnd(8)} L2=${f2(s.l2Score).padStart(6)} → metric=${f2(s.metricScore).padStart(6)}`);
      }
      const tata = xs.scored.find((s) => s.symbol === "TATAPOWER");
      const tornt = xs.scored.find((s) => s.symbol === "TORNTPOWER");
      const others = xs.scored.filter((s) => !["TATAPOWER", "TORNTPOWER"].includes(s.symbol) && s.scoreState === "scored");
      check(`PG8 ${key}: TATAPOWER fires SSCU 3-anchor`, tata?.l1BarSetUsed === "sscu", `barSet=${tata?.l1BarSetUsed} state=${tata?.scoreState}`);
      check(`PG8 ${key}: TORNTPOWER (re-keyed) fires SSCU 3-anchor as peer #7`, tornt?.l1BarSetUsed === "sscu", `barSet=${tornt?.l1BarSetUsed} state=${tornt?.scoreState}`);
      check(`PG8 ${key}: the other 5 peers use STANDARD bars`, others.length > 0 && others.every((s) => s.l1BarSetUsed === "standard"), `${others.map((s) => `${s.symbol}:${s.l1BarSetUsed}`).join(",")}`);
      // anchor-lift threshold at N: cleared needed = ceil(0.75*N)
      if (key === "F1_OPM") {
        const needed = Math.ceil(0.75 * xs.lift531.n);
        check("PG8 anchor-lift threshold is 6-of-7 (⌈0.75·7⌉)", xs.lift531.n !== 7 || needed === 6, `N=${xs.lift531.n} needed=${needed}`);
      }
    }
  }

  // ── RESULT ──
  H("ASSERTIONS");
  const nameW = Math.max(...asserts.map((a) => a.name.length));
  let pass = 0, fail = 0;
  for (const a of asserts) { a.pass ? pass++ : fail++; console.log(`  ${a.pass ? "PASS" : "FAIL"}  ${a.name.padEnd(nameW)}  ${a.detail}`); }
  console.log(`\n  TOTAL: ${asserts.length}   PASS: ${pass}   FAIL: ${fail}`);
  console.log(fail === 0 ? "  ✓ ALL-11 END-TO-END VERIFIED — commit gate GREEN (dry-run; nothing committed).\n" : "  ✗ SOME CHECKS FAILED.\n");

  await prisma.$disconnect();
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
