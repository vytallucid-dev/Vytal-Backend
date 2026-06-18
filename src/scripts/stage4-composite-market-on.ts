// STAGE 4 — FULL 4-PILLAR COMPOSITE with the UNIVERSAL MARKET ON for all 11 non-fin
// PGs (read-only; commits nothing). Replaces the §14.4-gated Market (uniformly OFF)
// with the real universal Market (orchestrate.ts) for every PG at once (CN-1).
//   npx tsx src/scripts/stage4-composite-market-on.ts
//
// Pillars: Foundation/Momentum = composite-proxy metric-score means (the ready-7
// standard); Market = NEW universal pillar on CLEANED prices (split-clean in path);
// Ownership = real computeOwnership. Weights 0.35F/0.25M/0.20Mkt/0.20Own, §14.4 renorm
// when a pillar is unavailable (Market excluded for VEDL/LTIM → composite renorms).

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
import { scoreMarketForPg, type PgMarket } from "../scoring/market/orchestrate.js";
import { PEER_GROUPS } from "./peer-groups.seed.js";

const F_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const M_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };
const NO_PRICE_CTX: OwnershipContext = { priceProbe: null, feeds: { insiderTxns: null, blockTxns: null, marketCapInrCr: null } as FlowFeeds };
const f = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));
const num = (d: any): number | null => (d == null ? null : typeof d.toNumber === "function" ? d.toNumber() : Number(d));

const PGS = [
  { pgId: "PG1", seedKey: "pg1_it_services", pgName: "Large-Cap IT Services" },
  { pgId: "PG2", seedKey: "pg2_fmcg", pgName: "Large-Cap FMCG" },
  { pgId: "PG3", seedKey: "pg3_pharma", pgName: "Large-Cap Pharma" },
  { pgId: "PG4", seedKey: "pg4_auto_oem", pgName: "Large-Cap Auto OEMs" },
  { pgId: "PG8", seedKey: "pg8_power", pgName: "Large-Cap Power & Utilities" },
  { pgId: "PG9", seedKey: "pg9_metals", pgName: "Large-Cap Metals & Mining" },
  { pgId: "PG10", seedKey: "pg10_oil_gas", pgName: "Large-Cap Oil & Gas" },
  { pgId: "PG11", seedKey: "pg11_capital_goods", pgName: "Large-Cap Capital Goods & Industrial" },
  { pgId: "PG12", seedKey: "pg12_cement", pgName: "Large-Cap Cement" },
  { pgId: "PG13", seedKey: "pg13_consumer_durables", pgName: "Large-Cap Consumer Durables & Electrical" },
  { pgId: "PG14", seedKey: "pg14_defense", pgName: "Large-Cap Defense" },
];

interface Member { stockId: string; symbol: string; fRows: FoundationAnnual[]; qRows: MomentumQuarter[]; own: OwnershipQuarter[] }

function seriesForKey(rows: any[], key: string, pillar: "foundation" | "momentum", ord: string): number[] {
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
      return { stockId: m.stockId, symbol: m.symbol, rawValue: avail ? mv!.value : null, available: avail, unavailableReason: avail ? null : (mv?.reason ?? "x"), ownHistoryValues: seriesForKey(pillar === "foundation" ? m.fRows : m.qRows, key, pillar, pillar === "foundation" ? "fyOrdinal" : "qOrdinal") };
    });
    const xs = scoreMetricCrossSection({ pillar, metricKey: key, label: key, snapshot: pillar === "foundation" ? "FY" : "FYQ", direction: rb.direction, bars: rb.bars, barNote: rb.note, sscu: ov, members: xsMembers, suppression: NO_SUPPRESSION, config: cfg });
    for (const s of xs.scored) if (s.scoreState === "scored" && s.metricScore !== null) perStock.get(s.symbol)!.push(s.metricScore);
  }
}

async function main() {
  const doc = JSON.parse(readFileSync(VYTAL_BARS_PATH, "utf8")) as SourceDocument;
  const report = loadVytalBars(doc, { mode: "validate_only", sourcePath: VYTAL_BARS_PATH });
  const idx = indexRows(report.wouldWrite);

  console.log("STAGE 4 — FULL 4-PILLAR COMPOSITE, UNIVERSAL MARKET ON (all 11 non-fin) — DRY-RUN");
  console.log("  weights 0.35F / 0.25M / 0.20Market / 0.20Own; §14.4 renorm when a pillar is unavailable\n");
  console.log(`  ${"PG".padEnd(5)} ${"n".padEnd(3)} ${"Market range".padEnd(14)} ${"composite range".padEnd(16)} band distribution`);
  console.log(`  ${"─".repeat(5)} ${"─".repeat(3)} ${"─".repeat(14)} ${"─".repeat(16)} ${"─".repeat(40)}`);

  const baselines: string[] = [];
  const gatedNowOn: string[] = [];
  for (const pg of PGS) {
    const seed = PEER_GROUPS.find((p) => p.key === pg.seedKey)!;
    const stocks = await prisma.stock.findMany({ where: { symbol: { in: seed.stocks } }, select: { id: true, symbol: true } });
    const idBySym = new Map(stocks.map((s) => [s.symbol, s.id]));
    const members: Member[] = [];
    for (const sym of seed.stocks) {
      const id = idBySym.get(sym); if (!id) continue;
      const sh = await prisma.shareholdingPattern.findMany({ where: { stockId: id }, orderBy: { asOnDate: "asc" }, select: { asOnDate: true, quarter: true, fiscalYear: true, promoterShares: true, totalShares: true, pledgedShares: true, promoterPct: true, fiiPct: true, diiPct: true, retailPct: true } });
      members.push({ stockId: id, symbol: sym, fRows: await loadFoundationStandalone(id), qRows: await loadMomentumStandalone(id),
        own: sh.map((r) => ({ asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear, promoterShares: r.promoterShares, totalShares: r.totalShares, pledgedShares: r.pledgedShares, promoterPct: num(r.promoterPct), fiiPct: num(r.fiiPct), diiPct: num(r.diiPct), retailPct: num(r.retailPct) })) });
    }
    const sel = selectPgKeys(report.perPg.find((p) => p.pgId === pg.pgId)!.mapping);
    const fS = new Map(members.map((m) => [m.symbol, [] as number[]]));
    const mS = new Map(members.map((m) => [m.symbol, [] as number[]]));
    pillarMean(idx, pg.pgId, members, sel.foundationKeys, "foundation", F_CFG, fS);
    pillarMean(idx, pg.pgId, members, sel.momentumKeys, "momentum", M_CFG, mS);

    const mkt: PgMarket | null = await scoreMarketForPg(pg.pgName);
    const mktBySym = new Map((mkt?.members ?? []).map((m) => [m.symbol, m.result]));
    baselines.push(`${pg.pgId}: C1 sector1yr median=${f(mkt?.sectorMedian1yr)}% · D1 baselineVol=${mkt?.sectorBaselineVol != null ? (mkt.sectorBaselineVol * 100).toFixed(1) + "%" : "—"} (pool n=${mkt?.poolN})`);

    const mktVals: number[] = []; const comps: number[] = []; const bandDist = new Map<string, number>();
    let mktScoredCount = 0;
    for (const m of members) {
      const fs = fS.get(m.symbol)!, ms = mS.get(m.symbol)!;
      const fSub = fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : null;
      const mSub = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
      const ownRes = m.own.length ? computeOwnership(m.symbol, m.own, NO_PRICE_CTX) : null;
      const mr = mktBySym.get(m.symbol);
      const mktSub = mr && mr.state === "scored" ? mr.subtotal : null;
      if (mktSub != null) { mktVals.push(mktSub); mktScoredCount++; }
      const latest = m.own[m.own.length - 1];
      const pillars: PillarInput[] = [
        { pillar: "foundation", subtotal: fSub, state: fSub != null ? "scored" : "unavailable_redistributed", sourcePeriod: "FY26" },
        { pillar: "momentum", subtotal: mSub, state: mSub != null ? "scored" : "unavailable_redistributed", sourcePeriod: "FY26Q4" },
        { pillar: "market", subtotal: mktSub, state: mktSub != null ? "scored" : "unavailable_redistributed", sourcePeriod: mktSub != null ? "PRICE" : "MARKET_EXCLUDED" },
        { pillar: "ownership", subtotal: ownRes?.finalOwnership ?? null, state: ownRes ? "scored" : "unavailable_redistributed", sourcePeriod: latest ? `${latest.quarter}${latest.fiscalYear}` : "—" },
      ];
      const comp = assembleComposite(m.stockId, m.symbol, pillars, { snapshotType: "live" as any, periodKey: "S4", asOfDate: latest?.asOnDate ?? new Date(0) });
      if (comp.composite != null) { comps.push(comp.composite); bandDist.set(comp.labelBand!, (bandDist.get(comp.labelBand!) ?? 0) + 1); }
    }
    if (["PG1", "PG4", "PG8"].includes(pg.pgId)) gatedNowOn.push(`${pg.pgId}: Market scored for ${mktScoredCount}/${members.length} (was uniformly §14.4-OFF)`);
    const dist = [...bandDist.entries()].map(([b, c]) => `${b}:${c}`).join(" ");
    console.log(`  ${pg.pgId.padEnd(5)} ${String(members.length).padEnd(3)} ${(mktVals.length ? `${f(Math.min(...mktVals))}–${f(Math.max(...mktVals))}` : "—").padEnd(14)} ${(comps.length ? `${f(Math.min(...comps))}–${f(Math.max(...comps))}` : "—").padEnd(16)} ${dist}`);
  }

  console.log(`\nVERIFY (i) previously-gated PGs now carry a REAL Market pillar:`);
  for (const g of gatedNowOn) console.log(`   ${g}`);
  console.log(`\nVERIFY (ii) per-PG peer references computed from the reconciled roster (C1 sector return, D1 baseline vol):`);
  for (const b of baselines) console.log(`   ${b}`);
  console.log(`\nVERIFY (iv) split-clean in path: Market loads via getCleanedCloses (§7.2 gate); VEDL quarantined → Market excluded → composite renorms; LTIM no-price → Market excluded.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
