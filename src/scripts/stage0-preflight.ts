// STAGE 0 — PRE-FLIGHT (READ-ONLY). Confirms the block premise for the 4
// data-blocked PGs (PG10/11/12/14) before any ingestion:
//   (A) the 4 target stocks are genuinely ABSENT from the Stock table,
//   (B) the supporting roster peers claimed "already in DB" actually resolve,
//   (C) the target sectors exist + industryType derives to non_financial,
//   (D) NSE source data is reachable for each target (financials filings list
//       + shareholding index) — the same live inputs every other stock used.
//
//   npx tsx src/scripts/stage0-preflight.ts
//
// WRITES NOTHING. NSE calls are read-only GETs. If NSE is unreachable the
// probe short-circuits (reports "unreachable") instead of hanging on retries.

import { prisma } from "../db/prisma.js";
import { deriveIndustryType } from "./industry-type-utils.js";
import { fetchFilingsList } from "../ingestions/quaterly-results/results/discovery.js";
import { fetchShareholdingIndex } from "../ingestions/shareholdings/shareholding-fetch.js";

const TARGETS = [
  { symbol: "PETRONET", name: "Petronet LNG Ltd", sectorKey: "oil_gas_energy", pg: "PG10" },
  { symbol: "RAMCOCEM", name: "The Ramco Cements Ltd", sectorKey: "cement_construction", pg: "PG12" },
  { symbol: "HONAUT", name: "Honeywell Automation India Ltd", sectorKey: "capital_goods_engineering", pg: "PG11" },
  { symbol: "GRSE", name: "Garden Reach Shipbuilders & Engineers Ltd", sectorKey: "capital_goods_engineering", pg: "PG14" },
];

// Peers the gated rosters claim are "already in DB" — must resolve for Stage 2.
const SUPPORTING = [
  "OIL", "BHEL", "POWERINDIA", "HAL", "BEL", "BDL", "MAZDOCK", "COCHINSHIP",
  "SOLARINDS", "GRASIM", "BOSCHLTD",
];

const TARGET_SECTORS = ["oil_gas_energy", "cement_construction", "capital_goods_engineering"];

async function main() {
  console.log("=".repeat(76));
  console.log("STAGE 0 — PRE-FLIGHT (read-only): absence + supporting peers + NSE source");
  console.log("=".repeat(76));

  // ── (A) Target stocks absent? ───────────────────────────────────────────
  console.log("\n(A) TARGET STOCKS — expected ABSENT (the block premise)");
  const targetSyms = TARGETS.map((t) => t.symbol);
  const foundTargets = await prisma.stock.findMany({
    where: { symbol: { in: targetSyms } },
    select: { id: true, symbol: true, name: true, isActive: true, industryType: true },
  });
  const foundSet = new Map(foundTargets.map((s) => [s.symbol, s]));
  let anyPresent = false;
  for (const t of TARGETS) {
    const hit = foundSet.get(t.symbol);
    if (hit) {
      anyPresent = true;
      console.log(`  ⚠ ${t.symbol.padEnd(10)} ${t.pg.padEnd(5)} PRESENT — id=${hit.id} active=${hit.isActive} industryType=${hit.industryType}  → BLOCK PREMISE WRONG`);
    } else {
      console.log(`  ✅ ${t.symbol.padEnd(10)} ${t.pg.padEnd(5)} absent (as expected)`);
    }
  }

  // Defensive: any orphan financials / shareholding rows for the 4 (by symbol)?
  console.log("\n    orphan-data check (should be 0 each if truly absent):");
  for (const t of TARGETS) {
    const sh = await prisma.shareholdingPattern.count({ where: { symbol: t.symbol } });
    const rfl = await prisma.resultFetchLog.count({ where: { symbol: t.symbol } });
    console.log(`      ${t.symbol.padEnd(10)} shareholding_patterns=${sh}  result_fetch_logs=${rfl}`);
  }

  // ── (B) Supporting peers resolve? ───────────────────────────────────────
  console.log("\n(B) SUPPORTING PEERS (gated rosters claim 'already in DB')");
  const sup = await prisma.stock.findMany({
    where: { symbol: { in: SUPPORTING } },
    select: { symbol: true, isActive: true, industryType: true },
  });
  const supSet = new Map(sup.map((s) => [s.symbol, s]));
  for (const sym of SUPPORTING) {
    const hit = supSet.get(sym);
    console.log(`  ${hit ? "✅" : "❌"} ${sym.padEnd(12)} ${hit ? `present (active=${hit.isActive}, ${hit.industryType})` : "MISSING — would block its roster"}`);
  }

  // ── (C) Sectors + industryType ──────────────────────────────────────────
  console.log("\n(C) TARGET SECTORS + derived industryType");
  const sectors = await prisma.sector.findMany({
    where: { name: { in: TARGET_SECTORS } },
    select: { id: true, name: true, displayName: true },
  });
  const sectorByName = new Map(sectors.map((s) => [s.name, s]));
  for (const key of TARGET_SECTORS) {
    const s = sectorByName.get(key);
    console.log(`  ${s ? "✅" : "❌"} ${key.padEnd(30)} ${s ? `id=${s.id} (${s.displayName})` : "MISSING"}`);
  }
  console.log("    industryType each target would receive:");
  for (const t of TARGETS) {
    console.log(`      ${t.symbol.padEnd(10)} → ${deriveIndustryType(t.symbol, t.sectorKey)}`);
  }

  // ── (D) NSE source availability ─────────────────────────────────────────
  console.log("\n(D) NSE SOURCE AVAILABILITY (live read-only GETs)");
  let nseUnreachable = false;
  for (const t of TARGETS) {
    if (nseUnreachable) {
      console.log(`  ⏭  ${t.symbol.padEnd(10)} skipped (NSE already unreachable this run)`);
      continue;
    }
    // Financials filings list
    let finStr = "";
    try {
      const filings = await fetchFilingsList(t.symbol);
      const years = [...new Set(filings.map((f) => f.qeDate))].sort();
      finStr = `financials filings=${filings.length}  qeDates=[${years.join(", ")}]`;
    } catch (e) {
      finStr = `financials FAILED: ${String((e as Error).message).slice(0, 140)}`;
      if (/timed out|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|getaddrinfo|network|socket/i.test(String(e))) {
        nseUnreachable = true;
      }
    }
    console.log(`  • ${t.symbol.padEnd(10)} ${finStr}`);

    if (nseUnreachable) {
      console.log(`      → NSE appears unreachable from this environment; skipping remaining probes.`);
      continue;
    }

    // Shareholding index
    let shStr = "";
    try {
      const idx = await fetchShareholdingIndex(t.symbol);
      const dates = idx.map((r) => r.asOnDate).filter(Boolean);
      shStr = `shareholding quarters=${idx.length}  range=[${dates[dates.length - 1] ?? "?"} … ${dates[0] ?? "?"}]`;
    } catch (e) {
      shStr = `shareholding FAILED: ${String((e as Error).message).slice(0, 140)}`;
      if (/timed out|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|getaddrinfo|network|socket/i.test(String(e))) {
        nseUnreachable = true;
      }
    }
    console.log(`      ${shStr}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(76));
  console.log(`SUMMARY:`);
  console.log(`  targets absent  : ${anyPresent ? "NO ⚠ (some present — STOP)" : "yes (all 4 absent — premise holds)"}`);
  console.log(`  supporting peers: ${SUPPORTING.filter((s) => supSet.has(s)).length}/${SUPPORTING.length} present`);
  console.log(`  sectors present : ${TARGET_SECTORS.filter((s) => sectorByName.has(s)).length}/${TARGET_SECTORS.length}`);
  console.log(`  NSE reachable   : ${nseUnreachable ? "NO ⚠ — Stage 1 ingestion BLOCKED (source unreachable)" : "yes (probed)"}`);
  console.log("─".repeat(76));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
