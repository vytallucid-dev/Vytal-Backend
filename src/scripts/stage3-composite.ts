// STAGE 3 — 3-PILLAR §14.4 COMPOSITE (F + M + Ownership; Market UNIFORMLY GATED).
// DRY-RUN, commits nothing. For each of the 4 corrected PGs, scores every member's
// three real pillars and assembles the §14.4 composite via the EXISTING machinery
// (assembleComposite + redistributeWeights):
//   • Foundation / Momentum subtotals = the composite-PROXY pillar means (equal-weight
//     mean of available metric scores) — the SAME standard the ready-7 went through in
//     the all-11 harness. (The real §14.4 pillar-assembly floor/F10-cap is the
//     next-milestone "built once for all"; not re-implemented here.)
//   • Ownership subtotal = REAL computeOwnership() over the ingested shareholding
//     (promoter/pledge BigInt + FII/DII flow; price-conditioned A1/A2 dormant under
//     NO_PRICE_CTX — deterministic).
//   • Market = GATED → state unavailable_redistributed → §14.4 renormalizes the
//     surviving three to F .4375 / M .3125 / Own .25.
//
//   npx tsx src/scripts/stage3-composite.ts

import { prisma } from "../db/prisma.js";
import { readFileSync } from "node:fs";
import { VYTAL_BARS_PATH } from "../scoring/bars-loader/source.js";
import { loadVytalBars } from "../scoring/bars-loader/load-vytal-bars.js";
import { indexRows, resolveBars } from "../scoring/bars-loader/resolve.js";
import type { SourceDocument } from "../scoring/bars-loader/types.js";
import { loadFoundationStandalone, loadMomentumStandalone } from "../scoring/metrics/load.js";
import { dispatchLiveValues, selectPgKeys } from "../scoring/metric-scoring/live-dispatch.js";
import { scoreMetricCrossSection, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { NO_SUPPRESSION, type WiringConfig } from "../scoring/metric-scoring/types.js";
import type { FoundationAnnual, MomentumQuarter } from "../scoring/metrics/types.js";
import { computeOwnership, type OwnershipContext } from "../scoring/ownership/ownership.js";
import type { OwnershipQuarter } from "../scoring/ownership/types.js";
import type { FlowFeeds } from "../scoring/ownership/flow.js";
import { assembleComposite } from "../scoring/composite/composite.js";
import type { PillarInput } from "../scoring/composite/types.js";
import { PEER_GROUPS } from "./peer-groups.seed.js";

const F_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const M_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };
const DORMANT_FEEDS: FlowFeeds = { insiderTxns: null, blockTxns: null, marketCapInrCr: null };
const NO_PRICE_CTX: OwnershipContext = { priceProbe: null, feeds: DORMANT_FEEDS };
const f2 = (x: number | null | undefined, d = 2) => (x == null ? "—" : x.toFixed(d));
const num = (d: any): number | null => d == null ? null : (typeof d.toNumber === "function" ? d.toNumber() : Number(d));

const PG_KEYS: Record<string, string> = {
  pg10_oil_gas: "PG10", pg11_capital_goods: "PG11", pg12_cement: "PG12", pg14_defense: "PG14",
};
const NEW_STOCK: Record<string, string> = { pg10_oil_gas: "PETRONET", pg11_capital_goods: "HONAUT", pg12_cement: "RAMCOCEM", pg14_defense: "GRSE" };

interface Member { stockId: string; symbol: string; fRows: FoundationAnnual[]; qRows: MomentumQuarter[]; own: OwnershipQuarter[] }

function seriesForKey(rows: any[], key: string, pillar: "foundation" | "momentum", ord: "fyOrdinal" | "qOrdinal"): number[] {
  const out: number[] = [];
  const sorted = [...rows].sort((a, b) => a[ord] - b[ord]);
  for (let i = 0; i < sorted.length; i++) {
    const slice = sorted.slice(0, i + 1);
    const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: pillar === "foundation" ? [key] : [], momentumKeys: pillar === "momentum" ? [key] : [], foundationRows: pillar === "foundation" ? slice : [], momentumQuarters: pillar === "momentum" ? slice : [] });
    const arr = d.status === "computed" ? (pillar === "foundation" ? d.foundation : d.momentum) : [];
    if (arr[0]?.available && arr[0].value !== null) out.push(arr[0].value);
  }
  return out;
}

function pillarMean(idx: any, pgId: string, members: Member[], keys: string[], pillar: "foundation" | "momentum", cfg: WiringConfig, perStock: Map<string, number[]>) {
  const live = new Map(members.map((m) => [m.symbol, dispatchLiveValues({ industryType: "non_financial", foundationKeys: pillar === "foundation" ? keys : [], momentumKeys: pillar === "momentum" ? keys : [], foundationRows: m.fRows, momentumQuarters: m.qRows })]));
  for (const key of keys) {
    const rb = resolveBars(idx, pgId, key);
    if (!rb) continue;
    const ov = rb.sscu ? { bars: rb.sscu.bars, scope: rb.sscu.scope } : null;
    const xsMembers: CrossSectionMember[] = members.map((m) => {
      const d = live.get(m.symbol)!;
      const arr = d.status === "computed" ? (pillar === "foundation" ? d.foundation : d.momentum) : [];
      const mv = arr.find((x) => x.key === key);
      const avail = !!mv && mv.available && mv.value !== null;
      return { stockId: m.stockId, symbol: m.symbol, rawValue: avail ? mv!.value : null, available: avail, unavailableReason: avail ? null : (mv?.reason ?? "no value"), ownHistoryValues: seriesForKey(pillar === "foundation" ? m.fRows : m.qRows, key, pillar, pillar === "foundation" ? "fyOrdinal" : "qOrdinal") };
    });
    const xs = scoreMetricCrossSection({ pillar, metricKey: key, label: key, snapshot: pillar === "foundation" ? "FY" : "FYQ", direction: rb.direction, bars: rb.bars, barNote: rb.note, sscu: ov, members: xsMembers, suppression: NO_SUPPRESSION, config: cfg });
    for (const s of xs.scored) if (s.scoreState === "scored" && s.metricScore !== null) perStock.get(s.symbol)!.push(s.metricScore);
  }
}

async function main() {
  const doc = JSON.parse(readFileSync(VYTAL_BARS_PATH, "utf8")) as SourceDocument;
  const report = loadVytalBars(doc, { mode: "validate_only", sourcePath: VYTAL_BARS_PATH });
  const idx = indexRows(report.wouldWrite);

  console.log("STAGE 3 — 3-PILLAR §14.4 COMPOSITE (F + M + Ownership; Market GATED)  — DRY-RUN\n");
  console.log("  weights: Foundation .35 / Momentum .25 / Market .20 / Ownership .20");
  console.log("  Market GATED → §14.4 renormalizes surviving three → F .4375 / M .3125 / Own .25\n");

  for (const seedKey of Object.keys(PG_KEYS)) {
    const pgId = PG_KEYS[seedKey];
    const seed = PEER_GROUPS.find((p) => p.key === seedKey)!;
    const stocks = await prisma.stock.findMany({ where: { symbol: { in: seed.stocks } }, select: { id: true, symbol: true } });
    const idBySym = new Map(stocks.map((s) => [s.symbol, s.id]));
    const members: Member[] = [];
    for (const sym of seed.stocks) {
      const id = idBySym.get(sym); if (!id) continue;
      const shRows = await prisma.shareholdingPattern.findMany({ where: { stockId: id }, orderBy: { asOnDate: "asc" }, select: { asOnDate: true, quarter: true, fiscalYear: true, promoterShares: true, totalShares: true, pledgedShares: true, promoterPct: true, fiiPct: true, diiPct: true, retailPct: true } });
      members.push({ stockId: id, symbol: sym, fRows: await loadFoundationStandalone(id), qRows: await loadMomentumStandalone(id),
        own: shRows.map((r) => ({ asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear, promoterShares: r.promoterShares, totalShares: r.totalShares, pledgedShares: r.pledgedShares, promoterPct: num(r.promoterPct), fiiPct: num(r.fiiPct), diiPct: num(r.diiPct), retailPct: num(r.retailPct) })) });
    }
    const sel = selectPgKeys(report.perPg.find((p) => p.pgId === pgId)!.mapping);
    const fScores = new Map(members.map((m) => [m.symbol, [] as number[]]));
    const mScores = new Map(members.map((m) => [m.symbol, [] as number[]]));
    pillarMean(idx, pgId, members, sel.foundationKeys, "foundation", F_CFG, fScores);
    pillarMean(idx, pgId, members, sel.momentumKeys, "momentum", M_CFG, mScores);

    console.log("═".repeat(104));
    console.log(`${pgId}  ${seed.name}  (n=${members.length})   ✦=newly-ingested`);
    console.log(`  ${"stock".padEnd(11)} ${"F".padStart(7)} ${"M".padStart(7)} ${"Own".padStart(7)}  ${"pledge%".padStart(8)} ${"FII/DII".padStart(11)}  ${"weights(F/M/Own)".padEnd(20)} ${"§14.4 comp".padStart(10)}  band`);
    const comps: number[] = []; const bandDist = new Map<string, number>();
    for (const m of members) {
      const fs = fScores.get(m.symbol)!, ms = mScores.get(m.symbol)!;
      const fSub = fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : null;
      const mSub = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
      const ownRes = m.own.length ? computeOwnership(m.symbol, m.own, NO_PRICE_CTX) : null;
      const ownSub = ownRes?.finalOwnership ?? null;
      const latest = m.own[m.own.length - 1];
      const pledgePct = latest && latest.promoterShares && Number(latest.promoterShares) > 0 && latest.pledgedShares != null ? (Number(latest.pledgedShares) / Number(latest.promoterShares)) * 100 : null;

      const pillars: PillarInput[] = [
        { pillar: "foundation", subtotal: fSub, state: fSub !== null ? "scored" : "unavailable_redistributed", sourcePeriod: "FY26" },
        { pillar: "momentum", subtotal: mSub, state: mSub !== null ? "scored" : "unavailable_redistributed", sourcePeriod: "FY26Q4" },
        { pillar: "market", subtotal: null, state: "unavailable_redistributed", sourcePeriod: "GATED(§Market-universal)" },
        { pillar: "ownership", subtotal: ownSub, state: ownSub !== null ? "scored" : "unavailable_redistributed", sourcePeriod: latest ? `${latest.quarter}${latest.fiscalYear}` : "—" },
      ];
      const comp = assembleComposite(m.stockId, m.symbol, pillars, { snapshotType: "live" as any, periodKey: "STAGE3-DRY", asOfDate: latest?.asOnDate ?? new Date(0) });
      const w = comp.appliedWeights;
      const mark = m.symbol === NEW_STOCK[seedKey] ? "✦" : " ";
      console.log(`  ${mark}${m.symbol.padEnd(10)} ${f2(fSub).padStart(7)} ${f2(mSub).padStart(7)} ${f2(ownSub).padStart(7)}  ${f2(pledgePct).padStart(8)} ${`${f2(latest?.fiiPct,1)}/${f2(latest?.diiPct,1)}`.padStart(11)}  ${`${(w.foundation*100).toFixed(1)}/${(w.momentum*100).toFixed(1)}/${(w.ownership*100).toFixed(1)}`.padEnd(20)} ${f2(comp.composite).padStart(10)}  ${comp.labelBand ?? comp.state}`);
      if (comp.composite !== null) { comps.push(comp.composite); bandDist.set(comp.labelBand!, (bandDist.get(comp.labelBand!) ?? 0) + 1); }
    }
    const dist = [...bandDist.entries()].map(([b, c]) => `${b}:${c}`).join(" ");
    console.log(`  → composite range ${comps.length ? `${f2(Math.min(...comps))}–${f2(Math.max(...comps))}` : "—"}  bands {${dist}}  (Market gated for all; surviving weights F .4375/M .3125/Own .25)\n`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
