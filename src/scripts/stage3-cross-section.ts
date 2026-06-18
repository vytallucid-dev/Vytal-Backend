// STAGE 3 — CROSS-SECTION PROOF (read-only; commits nothing).
// For each of the 4 corrected PGs, score metric F1 (ROCE) cross-sectionally under the
// OLD roster vs the NEW (corrected) roster, proving:
//   (a) the NEW peer μ/σ/N is computed over the corrected roster INCLUDING the
//       newly-ingested stock (PETRONET/HONAUT/RAMCOCEM/GRSE) — it contributes to the mean;
//   (b) a RETAINED stock's raw value is byte-identical old↔new, but its L2 (peer-relative)
//       score SHIFTS — the only thing that changed is the peer set (CN-8: roster, not compute);
//   (c) the newly-ingested stock itself SCORES (raw→L1→L2→metric), or honestly hits a floor.
//
//   npx tsx src/scripts/stage3-cross-section.ts

import { prisma } from "../db/prisma.js";
import { readFileSync } from "node:fs";
import { VYTAL_BARS_PATH } from "../scoring/bars-loader/source.js";
import { loadVytalBars } from "../scoring/bars-loader/load-vytal-bars.js";
import { indexRows, resolveBars } from "../scoring/bars-loader/resolve.js";
import type { SourceDocument } from "../scoring/bars-loader/types.js";
import { loadFoundationStandalone } from "../scoring/metrics/load.js";
import { dispatchLiveValues } from "../scoring/metric-scoring/live-dispatch.js";
import { scoreMetricCrossSection, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { NO_SUPPRESSION, type WiringConfig } from "../scoring/metric-scoring/types.js";
import type { FoundationAnnual } from "../scoring/metrics/types.js";

const CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const f2 = (x: number | null | undefined, d = 2) => (x == null ? "—" : x.toFixed(d));
const KEY = "F1"; // ROCE — point-in-time foundation metric, available on FY25/FY26

const PGS = [
  { pgId: "PG10", seedKey: "pg10_oil_gas", newStock: "PETRONET", retained: "RELIANCE",
    old: ["RELIANCE", "ONGC", "IOC", "BPCL", "HINDPETRO", "GAIL"] },
  { pgId: "PG11", seedKey: "pg11_capital_goods", newStock: "HONAUT", retained: "LT",
    old: ["LT", "SIEMENS", "ABB", "BEL", "HAL", "CUMMINSIND", "THERMAX", "BOSCHLTD"] },
  { pgId: "PG12", seedKey: "pg12_cement", newStock: "RAMCOCEM", retained: "ULTRACEMCO",
    old: ["ULTRACEMCO", "GRASIM", "SHREECEM", "AMBUJACEM", "ACC", "DALBHARAT", "JKCEMENT"] },
  { pgId: "PG14", seedKey: "pg14_defense", newStock: "GRSE", retained: "BEL",
    old: ["HAL", "BEL", "BDL", "MAZDOCK", "COCHINSHIP"] }, // old = the alt-A7 Defense 5
];

import { PEER_GROUPS } from "./peer-groups.seed.js";

interface M { stockId: string; symbol: string; fRows: FoundationAnnual[] }
const cache = new Map<string, M>();
async function load(sym: string): Promise<M | null> {
  if (cache.has(sym)) return cache.get(sym)!;
  const s = await prisma.stock.findUnique({ where: { symbol: sym }, select: { id: true } });
  if (!s) return null;
  const m: M = { stockId: s.id, symbol: sym, fRows: await loadFoundationStandalone(s.id) };
  cache.set(sym, m); return m;
}

function seriesF1(m: M): number[] {
  const out: number[] = [];
  const sorted = [...m.fRows].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  for (let i = 0; i < sorted.length; i++) {
    const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [KEY], momentumKeys: [], foundationRows: sorted.slice(0, i + 1), momentumQuarters: [] });
    if (d.status === "computed" && d.foundation[0]?.available && d.foundation[0].value !== null) out.push(d.foundation[0].value);
  }
  return out;
}

function xsFor(members: M[], bars: any, direction: any, note: string) {
  const xsMembers: CrossSectionMember[] = members.map((m) => {
    const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [KEY], momentumKeys: [], foundationRows: m.fRows, momentumQuarters: [] });
    const mv = d.status === "computed" ? d.foundation.find((x) => x.key === KEY) : undefined;
    const avail = !!mv && mv.available && mv.value !== null;
    return { stockId: m.stockId, symbol: m.symbol, rawValue: avail ? mv!.value : null, available: avail, unavailableReason: avail ? null : (mv?.reason ?? "no value"), ownHistoryValues: seriesF1(m) };
  });
  return scoreMetricCrossSection({ pillar: "foundation", metricKey: KEY, label: KEY, snapshot: "FY", direction, bars, barNote: note, sscu: null, members: xsMembers, suppression: NO_SUPPRESSION, config: CFG });
}

async function main() {
  const doc = JSON.parse(readFileSync(VYTAL_BARS_PATH, "utf8")) as SourceDocument;
  const report = loadVytalBars(doc, { mode: "validate_only", sourcePath: VYTAL_BARS_PATH });
  const idx = indexRows(report.wouldWrite);

  console.log("STAGE 3 — CROSS-SECTION PROOF (metric F1 = ROCE; old roster vs new corrected roster)\n");

  for (const pg of PGS) {
    const seed = PEER_GROUPS.find((p) => p.key === pg.seedKey)!;
    const newSyms = [...seed.stocks];
    const rb = resolveBars(idx, pg.pgId, KEY);
    if (!rb) { console.log(`${pg.pgId}: no F1 bars — skip`); continue; }

    const newMembers = (await Promise.all(newSyms.map(load))).filter((x): x is M => !!x);
    const oldMembers = (await Promise.all(pg.old.map(load))).filter((x): x is M => !!x);

    const xsNew = xsFor(newMembers, rb.bars, rb.direction, rb.note);
    const xsOld = xsFor(oldMembers, rb.bars, rb.direction, rb.note);

    console.log("═".repeat(96));
    console.log(`${pg.pgId}  ${seed.name}  — F1 ROCE  (bars E${rb.bars.excellent}/G${rb.bars.good}/A${rb.bars.acceptable}/C${rb.bars.concerning}/D${rb.bars.distress})`);
    console.log(`  OLD roster (n=${pg.old.length}): [${pg.old.join(", ")}]`);
    console.log(`  NEW roster (n=${newSyms.length}): [${newSyms.join(", ")}]   ✦=newly-ingested  ←=retained-probe`);
    console.log(`  peer μ/σ/N:   OLD μ=${f2(xsOld.peerStats.mean)} σ=${f2(xsOld.peerStats.stdDev)} N=${xsOld.peerStats.sampleN}   →   NEW μ=${f2(xsNew.peerStats.mean)} σ=${f2(xsNew.peerStats.stdDev)} N=${xsNew.peerStats.sampleN}`);

    // (a)+(c): NEW roster table, flag the new stock
    console.log(`\n  NEW-roster F1 scores:`);
    for (const s of xsNew.scored) {
      const mark = s.symbol === pg.newStock ? " ✦" : s.symbol === pg.retained ? " ←" : "  ";
      if (s.scoreState !== "scored") { console.log(`   ${mark} ${s.symbol.padEnd(11)} ${s.scoreState} (${s.unavailableReason})`); continue; }
      console.log(`   ${mark} ${s.symbol.padEnd(11)} raw=${f2(s.rawValue).padStart(8)} L1=${f2(s.l1Score).padStart(6)}/${(s.l1Band ?? "").padEnd(10)} L2=${f2(s.l2Score).padStart(6)} → metric=${f2(s.metricScore).padStart(6)}`);
    }
    const ns = xsNew.scored.find((s) => s.symbol === pg.newStock);
    const inMean = ns?.scoreState === "scored" && ns.rawValue !== null;
    console.log(`\n  (a) newly-ingested ${pg.newStock} contributes to the NEW peer mean: ${inMean ? `YES (raw ROCE=${f2(ns!.rawValue)}, in N=${xsNew.peerStats.sampleN})` : `NO — ${ns?.scoreState}/${ns?.unavailableReason}`}`);
    console.log(`  (c) ${pg.newStock} itself scores: ${ns?.scoreState === "scored" ? `YES — L1=${f2(ns.l1Score)}/${ns.l1Band}, L2=${f2(ns.l2Score)}, metric=${f2(ns.metricScore)}` : `floored/unavailable (${ns?.unavailableReason})`}`);

    // (b): retained stock — raw identical, L2 shifts
    const rNew = xsNew.scored.find((s) => s.symbol === pg.retained);
    const rOld = xsOld.scored.find((s) => s.symbol === pg.retained);
    if (rNew?.scoreState === "scored" && rOld?.scoreState === "scored") {
      const rawSame = Math.abs((rNew.rawValue ?? NaN) - (rOld.rawValue ?? NaN)) < 1e-9;
      const l1Same = Math.abs((rNew.l1Score ?? NaN) - (rOld.l1Score ?? NaN)) < 1e-9;
      console.log(`  (b) retained ${pg.retained}: raw ROCE ${f2(rOld.rawValue)} → ${f2(rNew.rawValue)} (${rawSame ? "UNCHANGED ✓" : "CHANGED ✗"}); ` +
        `L1 ${f2(rOld.l1Score)} → ${f2(rNew.l1Score)} (${l1Same ? "unchanged — same bars" : "changed"}); ` +
        `L2 ${f2(rOld.l2Score)} → ${f2(rNew.l2Score)} (Δ=${f2((rNew.l2Score ?? 0) - (rOld.l2Score ?? 0))} — PEER-SET-CHANGED proof); ` +
        `metric ${f2(rOld.metricScore)} → ${f2(rNew.metricScore)}`);
    } else {
      console.log(`  (b) retained ${pg.retained}: not scored in one of the rosters (old=${rOld?.scoreState}, new=${rNew?.scoreState})`);
    }
    console.log(`  N(new) == corrected roster: ${xsNew.scored.length === newSyms.length ? `YES (${newSyms.length})` : `MISMATCH (${xsNew.scored.length} vs ${newSyms.length})`}\n`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
