// PG-AWARE METRIC-SELECTION DISPATCH — verification harness (dry-run, commits nothing).
//
//   npx tsx src/scripts/pg-aware-dispatch-check.ts
//
// Proves the generic dispatch layer:
//   1. prints the metric-key → live-value-function MAPPING TABLE (reviewable artifact)
//   2. prints each PG's JSON-driven metric SELECTION (industry + actual keys)
//   3. REGRESSION: a standard non-financial PG (pharma) produces metric values
//      IDENTICAL to the pre-dispatch computeFoundation/computeMomentum path
//   4. PG8 end-to-end: 11 Foundation (incl NEW F1_OPM) + 4 Momentum (incl
//      M1_OPM_TTM) live values, scored against PG8's loaded bars; SSCU fires for
//      scope stocks (TataPower) and not for others (NTPC)
//   5. SSCU stockId resolution report (do TataPower/TorrentPower resolve + are
//      they in PG8?)
//   6. banking (PG5/PG6) returns the LABELED deferred state, never a score

import { prisma } from "../db/prisma.js";
import { PEER_GROUPS } from "./peer-groups.seed.js";
import { readFileSync } from "node:fs";
import { VYTAL_BARS_PATH, VYTAL_BARS_FILENAME } from "../scoring/bars-loader/source.js";
import { loadVytalBars } from "../scoring/bars-loader/load-vytal-bars.js";
import { indexRows, resolveBars } from "../scoring/bars-loader/resolve.js";
import type { SourceDocument } from "../scoring/bars-loader/types.js";
import { loadFoundationStandalone, loadMomentumStandalone } from "../scoring/metrics/load.js";
import { computeFoundation } from "../scoring/metrics/foundation.js";
import { computeMomentum } from "../scoring/metrics/momentum.js";
import type { FoundationAnnual, MomentumQuarter, MetricValue } from "../scoring/metrics/types.js";
import {
  dispatchLiveValues, selectPgKeys, printDispatchTable, type DispatchOutput,
} from "../scoring/metric-scoring/live-dispatch.js";
import { scoreL1 } from "../scoring/lenses/lens-bars.js";
import { scoreMetricCrossSection, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { NO_SUPPRESSION, type WiringConfig } from "../scoring/metric-scoring/types.js";

const H = (s: string) => console.log("\n" + "═".repeat(96) + "\n  " + s + "\n" + "═".repeat(96));
const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));

// pgId → DB peer-group name (only the PGs this harness exercises).
const PG_DB_NAME: Record<string, string> = {
  PG3: "Large-Cap Pharma",
  PG8: "Large-Cap Power & Utilities",
  PG5: "Large-Cap Private Banks",
  PG6: "Large-Cap PSU Banks",
};

const FOUNDATION_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const MOMENTUM_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };

interface Assert { name: string; pass: boolean; detail: string }
const asserts: Assert[] = [];
const check = (name: string, pass: boolean, detail = "") => asserts.push({ name, pass, detail });

async function memberData(dbName: string) {
  // Membership is resolved from the CORRECTED seed (peer-groups.seed.ts) via a read-only
  // symbol→stockId lookup — NOT the stockPeerGroup join, which still reflects the pre-fix
  // PG8 roster (ADANIGREEN) until the authorized re-seed (fix-pg8-roster.ts --commit) runs.
  const seed = PEER_GROUPS.find((p) => p.name === dbName);
  if (!seed) return null;
  const industryType: "non_financial" | "banking" = /bank/i.test(dbName) ? "banking" : "non_financial";
  const stocks = await prisma.stock.findMany({ where: { symbol: { in: seed.stocks } }, select: { id: true, symbol: true } });
  const idBySym = new Map(stocks.map((s) => [s.symbol, s.id]));
  const out: { stockId: string; symbol: string; fRows: FoundationAnnual[]; qRows: MomentumQuarter[] }[] = [];
  for (const sym of seed.stocks) {
    const id = idBySym.get(sym);
    if (!id) continue;
    out.push({
      stockId: id, symbol: sym,
      fRows: await loadFoundationStandalone(id),
      qRows: await loadMomentumStandalone(id),
    });
  }
  return { industryType, members: out };
}

/** Own-history series for a single key via truncated recompute through the dispatch. */
function seriesForKey(fRows: FoundationAnnual[], qRows: MomentumQuarter[], key: string, pillar: "foundation" | "momentum"): number[] {
  const out: number[] = [];
  if (pillar === "foundation") {
    const sorted = [...fRows].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
    for (let i = 0; i < sorted.length; i++) {
      const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [key], momentumKeys: [], foundationRows: sorted.slice(0, i + 1), momentumQuarters: [] });
      if (d.status === "computed" && d.foundation[0]?.available && d.foundation[0].value !== null) out.push(d.foundation[0].value);
    }
  } else {
    const sorted = [...qRows].sort((a, b) => a.qOrdinal - b.qOrdinal);
    for (let i = 0; i < sorted.length; i++) {
      const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [], momentumKeys: [key], foundationRows: [], momentumQuarters: sorted.slice(0, i + 1) });
      if (d.status === "computed" && d.momentum[0]?.available && d.momentum[0].value !== null) out.push(d.momentum[0].value);
    }
  }
  return out;
}

async function main() {
  const doc = JSON.parse(readFileSync(VYTAL_BARS_PATH, "utf8")) as SourceDocument;
  const report = loadVytalBars(doc, { mode: "validate_only", sourcePath: VYTAL_BARS_PATH });
  const idx = indexRows(report.wouldWrite);

  console.log(`PG-AWARE DISPATCH — DRY RUN (commits nothing)`);
  console.log(`  source: ${VYTAL_BARS_FILENAME}  (framework ${report.specVersionFramework}, ${report.totalMapped}/${report.totalMetrics} mapped, ${report.totalWouldWriteRows} would-write)`);
  check("REDERIVE_FINAL validates (188 mapped, 176 would-write)", report.pass && report.totalMapped === 188 && report.totalWouldWriteRows === 176, `mapped=${report.totalMapped} wouldWrite=${report.totalWouldWriteRows} pass=${report.pass}`);

  // ── 1. THE MAPPING TABLE ARTIFACT ──
  H("1. METRIC-KEY → LIVE-VALUE-FUNCTION MAPPING TABLE  (the reviewable artifact; the dispatch reads THIS)");
  printDispatchTable();

  // ── 2. PER-PG JSON-DRIVEN SELECTION ──
  H("2. PER-PG METRIC SELECTION  (from the loaded bar-set — NOT a hardcoded F1..F10/M1..M5 list)");
  for (const pg of report.perPg) {
    const { foundationKeys, momentumKeys } = selectPgKeys(pg.mapping);
    console.log(`  ${pg.pgId.padEnd(5)} ${pg.industry.padEnd(13)} F[${foundationKeys.length}]: ${foundationKeys.join(",")}   M[${momentumKeys.length}]: ${momentumKeys.join(",")}`);
  }
  // PG8 must select F1_OPM + M1_OPM_TTM and NOT M1/M5.
  {
    const pg8 = report.perPg.find((p) => p.pgId === "PG8")!;
    const { foundationKeys, momentumKeys } = selectPgKeys(pg8.mapping);
    check("PG8 selects 11 Foundation incl F1_OPM", foundationKeys.length === 11 && foundationKeys.includes("F1_OPM"), foundationKeys.join(","));
    check("PG8 selects 4 Momentum = {M1_OPM_TTM,M2,M3,M4} (NO M1, NO M5)", momentumKeys.length === 4 && momentumKeys.includes("M1_OPM_TTM") && !momentumKeys.includes("M1") && !momentumKeys.includes("M5"), momentumKeys.join(","));
  }

  // ── 3. REGRESSION: pharma (PG3) dispatch == pre-dispatch path ──
  H("3. REGRESSION — standard non-financial PG (PG3 Pharma): dispatch == pre-dispatch computeFoundation/computeMomentum");
  {
    const pg3map = report.perPg.find((p) => p.pgId === "PG3")!;
    const sel = selectPgKeys(pg3map.mapping);
    const data = await memberData(PG_DB_NAME.PG3);
    if (!data) { console.log("  PG3 not in DB — SKIPPED"); check("PG3 regression ran", false, "PG3 DB peer group not found"); }
    else {
      let compared = 0, mismatches = 0;
      const diffs: string[] = [];
      for (const m of data.members) {
        const disp = dispatchLiveValues({ industryType: "non_financial", foundationKeys: sel.foundationKeys, momentumKeys: sel.momentumKeys, foundationRows: m.fRows, momentumQuarters: m.qRows });
        if (disp.status !== "computed") { mismatches++; diffs.push(`${m.symbol}: dispatch returned ${disp.status}`); continue; }
        const fRef = computeFoundation(m.fRows);
        const mRef = computeMomentum(m.qRows);
        const refMap = new Map<string, MetricValue>();
        for (const v of fRef?.metrics ?? []) refMap.set(v.key, v);
        for (const v of mRef?.metrics ?? []) refMap.set(v.key, v);
        for (const dv of [...disp.foundation, ...disp.momentum]) {
          const rv = refMap.get(dv.key);
          compared++;
          const same = !!rv && rv.available === dv.available && rv.reason === dv.reason &&
            ((rv.value === null && dv.value === null) || (rv.value !== null && dv.value !== null && Math.abs(rv.value - dv.value) < 1e-9));
          if (!same) { mismatches++; diffs.push(`${m.symbol} ${dv.key}: dispatch(${dv.available},${f2(dv.value, 4)}) vs ref(${rv?.available},${f2(rv?.value ?? null, 4)})`); }
        }
      }
      console.log(`  ${data.members.length} pharma stocks × ${sel.foundationKeys.length + sel.momentumKeys.length} metrics → ${compared} value comparisons, ${mismatches} mismatch(es)`);
      if (diffs.length) diffs.slice(0, 8).forEach((d) => console.log(`     ✗ ${d}`));
      else console.log(`     ✓ every dispatched metric value is byte-identical to the pre-dispatch path`);
      check("PG3 pharma: dispatch values IDENTICAL to pre-dispatch (regression)", mismatches === 0 && compared > 0, `${compared} compared, ${mismatches} mismatch`);
    }
  }

  // ── 4. PG8 END-TO-END ──
  H("4. PG8 END-TO-END — 11 Foundation (incl F1_OPM) + 4 Momentum (incl M1_OPM_TTM), scored vs PG8 bars + SSCU");
  const pg8sel = selectPgKeys(report.perPg.find((p) => p.pgId === "PG8")!.mapping);
  const pg8data = await memberData(PG_DB_NAME.PG8);
  if (!pg8data) { console.log("  PG8 not in DB — SKIPPED"); check("PG8 end-to-end ran", false, "PG8 DB peer group not found"); }
  else {
    // compute every member's live values
    const live = new Map<string, DispatchOutput>();
    for (const m of pg8data.members) {
      live.set(m.symbol, dispatchLiveValues({ industryType: "non_financial", foundationKeys: pg8sel.foundationKeys, momentumKeys: pg8sel.momentumKeys, foundationRows: m.fRows, momentumQuarters: m.qRows }));
    }

    // Per-metric DECOMPOSITION (L1 vs PG8 bars + SSCU) for a scope stock + a non-scope stock.
    const decompFor = (symbol: string) => {
      const d = live.get(symbol);
      console.log(`\n  ── ${symbol} ── (live values → L1 vs PG8 loaded bars; SSCU applies for scope stocks)`);
      if (!d || d.status !== "computed") { console.log("    (no computed values)"); return; }
      const rowOut = (mv: MetricValue, pillar: "foundation" | "momentum") => {
        const rb = resolveBars(idx, "PG8", mv.key);
        if (!rb) { console.log(`    ${mv.key.padEnd(10)} ${pillar === "foundation" ? "[F]" : "[M]"} NO BARS LOADED`); return; }
        if (!mv.available || mv.value === null) {
          console.log(`    ${mv.key.padEnd(10)} ${pillar === "foundation" ? "[F]" : "[M]"} live=UNAVAILABLE (${mv.reason})`);
          return;
        }
        const ov = rb.sscu ? { bars: rb.sscu.bars, scope: rb.sscu.scope } : null;
        const l1 = scoreL1(mv.value, rb.bars, rb.direction, { stock: symbol, override: ov });
        const wNom = pillar === "foundation" ? `1/${pg8sel.foundationKeys.length}=${(100 / pg8sel.foundationKeys.length).toFixed(2)}%` : `1/${pg8sel.momentumKeys.length}=${(100 / pg8sel.momentumKeys.length).toFixed(2)}%`;
        console.log(`    ${mv.key.padEnd(10)} ${pillar === "foundation" ? "[F]" : "[M]"} live=${f2(mv.value).padStart(9)} ${rb.unit?.padEnd(5) ?? "     "} → L1=${f2(l1.score).padStart(6)}/${(l1.band ?? "").padEnd(10)} barSet=${l1.barSetUsed.padEnd(8)} w=${wNom}`);
      };
      for (const mv of d.foundation) rowOut(mv, "foundation");
      for (const mv of d.momentum) rowOut(mv, "momentum");
    };
    decompFor("TATAPOWER"); // in sscuScope
    decompFor("TORNTPOWER"); // in sscuScope (re-keyed) — now a PG8 member #7
    decompFor("NTPC"); // NOT in sscuScope

    // Full cross-section for the two OPM metrics — proves the WIRE applies SSCU (l1BarSetUsed).
    console.log(`\n  ── PG8 cross-section (wire) for the two OPM keys — SSCU routed by the scorer ──`);
    for (const key of ["F1_OPM", "M1_OPM_TTM"]) {
      const pillar = key === "F1_OPM" ? "foundation" : "momentum";
      const rb = resolveBars(idx, "PG8", key)!;
      const ov = rb.sscu ? { bars: rb.sscu.bars, scope: rb.sscu.scope } : null;
      const members: CrossSectionMember[] = pg8data.members.map((m) => {
        const d = live.get(m.symbol)!;
        const mv = (d.status === "computed" ? (pillar === "foundation" ? d.foundation : d.momentum) : []).find((x) => x.key === key);
        const avail = !!mv && mv.available && mv.value !== null;
        return { stockId: m.stockId, symbol: m.symbol, rawValue: avail ? mv!.value : null, available: avail, unavailableReason: avail ? null : (mv?.reason ?? "no value"), ownHistoryValues: seriesForKey(m.fRows, m.qRows, key, pillar) };
      });
      const xs = scoreMetricCrossSection({
        pillar, metricKey: key, label: key, snapshot: pillar === "foundation" ? "FY26" : "FY26Q?",
        direction: rb.direction, bars: rb.bars, barNote: rb.note, liveUnit: "%", barUnit: rb.unit, sscu: ov,
        members, suppression: NO_SUPPRESSION, config: pillar === "foundation" ? FOUNDATION_CFG : MOMENTUM_CFG,
      });
      console.log(`\n    ${key}  peer μ=${f2(xs.peerStats.mean, 2)} σ=${f2(xs.peerStats.stdDev, 2)} N=${xs.peerStats.sampleN}  | bars E${rb.bars.excellent}/G${rb.bars.good}/A${rb.bars.acceptable}/C${rb.bars.concerning}/D${rb.bars.distress}  sscuScope=${JSON.stringify(rb.sscu?.scope ?? [])}`);
      for (const s of xs.scored) {
        if (s.scoreState !== "scored") { console.log(`      ${s.symbol.padEnd(11)} ${s.scoreState} (${s.unavailableReason})`); continue; }
        console.log(`      ${s.symbol.padEnd(11)} raw=${f2(s.rawValue).padStart(8)}  L1=${f2(s.l1Score).padStart(6)}/${(s.l1Band ?? "").padEnd(10)} barSet=${(s.l1BarSetUsed ?? "—").padEnd(8)}  L2=${f2(s.l2Score).padStart(6)}  → metric=${f2(s.metricScore).padStart(6)}`);
      }
      const tata = xs.scored.find((s) => s.symbol === "TATAPOWER");
      const ntpc = xs.scored.find((s) => s.symbol === "NTPC");
      check(`PG8 ${key}: TATAPOWER (scope) scored via SSCU bar-set`, tata?.l1BarSetUsed === "sscu", `barSet=${tata?.l1BarSetUsed}`);
      check(`PG8 ${key}: NTPC (non-scope) scored via STANDARD bar-set`, ntpc?.l1BarSetUsed === "standard", `barSet=${ntpc?.l1BarSetUsed}`);
      check(`PG8 ${key}: live value produced + scored (was a wiring gap)`, tata?.scoreState === "scored" && ntpc?.scoreState === "scored", `tata=${tata?.scoreState} ntpc=${ntpc?.scoreState}`);
    }
    // F1_OPM present in TATAPOWER's foundation set @ 1/11
    const tDisp = live.get("TATAPOWER")!;
    if (tDisp.status === "computed") {
      const f1opm = tDisp.foundation.find((m) => m.key === "F1_OPM");
      check("PG8 F1_OPM live value produced for TATAPOWER (from stored.operatingMargin)", !!f1opm && f1opm.available && f1opm.value !== null, `value=${f2(f1opm?.value ?? null)} source=${f1opm?.source}`);
      check("PG8 Foundation assembles on 11 metrics @ 1/11 (9.09%)", tDisp.foundation.length === 11, `count=${tDisp.foundation.length}`);
    }
  }

  // ── 5. SSCU STOCKID RESOLUTION ──
  H("5. SSCU STOCKID RESOLUTION — does sscuScope resolve to real PG8 Stock rows?");
  {
    const rb = resolveBars(idx, "PG8", "F1_OPM")!;
    const scope = rb.sscu?.scope ?? [];
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const pg8syms = pg8data ? pg8data.members.map((m) => m.symbol) : [];
    const allStocks = await prisma.stock.findMany({ select: { symbol: true, name: true } });
    console.log(`  sscuScope (spec names): ${JSON.stringify(scope)}    PG8 members: ${pg8syms.join(",")}`);
    console.log(`  SSCU fires (scoreL1.inScope) IFF a PG8 member's NORMALIZED SYMBOL == the scope name's normalized form.\n`);
    for (const name of scope) {
      const nn = norm(name);
      // (a) identity: a stock whose NAME matches the scope name (real-world resolution)
      const byName = allStocks.find((s) => norm(s.name).includes(nn));
      // (b) firing: a PG8 member whose SYMBOL normalizes to the scope name (what inScope needs)
      const firingSym = pg8syms.find((sym) => norm(sym) === nn) ?? null;
      const inPg8 = byName ? pg8syms.includes(byName.symbol) : false;
      console.log(`  • "${name}":`);
      console.log(`      identity   : ${byName ? `Stock ${byName.symbol} ("${byName.name}")` : "NO Stock row by name"}`);
      console.log(`      in PG8?    : ${inPg8 ? "YES" : "NO"}${byName && !inPg8 ? ` (exists as ${byName.symbol} but not a PG8 member)` : ""}`);
      console.log(`      scope fires: ${firingSym ? `YES → matches PG8 symbol ${firingSym}` : `NO — scope-norm "${nn}" ≠ any PG8 symbol-norm ${byName ? `(stock symbol norm = "${norm(byName.symbol)}")` : ""} → SSCU would SILENTLY NOT FIRE`}`);
      if (name.toLowerCase().includes("tata")) check("SSCU: TataPower resolves to a PG8 member & scope FIRES", inPg8 && !!firingSym, `inPg8=${inPg8} firingSymbol=${firingSym}`);
      if (name.toLowerCase().includes("tornt") || name.toLowerCase().includes("torrent")) check("SSCU: TORNTPOWER (re-keyed scope) now FIRES as PG8 member #7", !!firingSym, `firingSymbol=${firingSym} inPg8=${inPg8}`);
    }
  }

  // ── 6. BANKING GATED STATE ──
  H("6. BANKING — gated deferred state (PG5/PG6 load but are NOT scored; never a fake score)");
  for (const pgId of ["PG5", "PG6"]) {
    const pgmap = report.perPg.find((p) => p.pgId === pgId)!;
    const sel = selectPgKeys(pgmap.mapping);
    const out = dispatchLiveValues({ industryType: "banking", foundationKeys: sel.foundationKeys, momentumKeys: sel.momentumKeys, foundationRows: [], momentumQuarters: [] });
    console.log(`  ${pgId} (${pgmap.industry}): status="${out.status}"`);
    if (out.status === "scoring_pending_bank_data_pipeline") console.log(`        ${out.note}\n        keys gated: F[${out.foundationKeys.join(",")}]  M[${out.momentumKeys.join(",")}]`);
    check(`${pgId} banking → labeled deferred state (not a score)`, out.status === "scoring_pending_bank_data_pipeline", `status=${out.status}`);
  }

  // ── RESULT ──
  H("ASSERTIONS");
  const nameW = Math.max(...asserts.map((a) => a.name.length));
  let pass = 0, fail = 0;
  for (const a of asserts) { a.pass ? pass++ : fail++; console.log(`  ${a.pass ? "PASS" : "FAIL"}  ${a.name.padEnd(nameW)}  ${a.detail}`); }
  console.log(`\n  TOTAL: ${asserts.length}   PASS: ${pass}   FAIL: ${fail}`);
  console.log(fail === 0 ? "  ✓ DISPATCH LAYER VERIFIED.\n" : "  ✗ SOME CHECKS FAILED.\n");

  await prisma.$disconnect();
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
