// STAGE 2 — compute all 12 banking metrics and check vs known/reported bank figures.
// The CORRECTNESS GATE: a units bug (GNPA 0.012 not 1.2; Tier-1 0.13 not 13) or a
// wrong formula shows up here as an implausible value.
//   npx tsx src/scripts/bank-stage2-reality-check.ts

import { loadBankingCtx } from "../scoring/metrics/banking-load.js";
import { computeBankingLiveValues } from "../scoring/metrics/banking.js";
import { prisma } from "../db/prisma.js";

const F_KEYS = ["Tier1", "GNPA", "NNPA", "PCR", "ROA", "CI", "CASA"];
const M_KEYS = ["NIM", "PPOP", "NII", "NPyoy", "GNPAttm"];

// Rough real-world reference bands (recent FY25/FY26) for plausibility — NOT targets.
const REF: Record<string, Record<string, string>> = {
  HDFCBANK:  { Tier1: "~19.7", GNPA: "~1.2–1.4", NNPA: "~0.4", PCR: "~67(exTWO)", ROA: "~1.8–2.0", CI: "~40", CASA: "34.0(live)", NIM: "~3.4", GNPAttm: "~1.2–1.4" },
  SBIN:      { Tier1: "~13.3", GNPA: "~1.8–2.2", NNPA: "~0.5–0.6", PCR: "~73(exTWO)", ROA: "~1.0–1.1", CI: "~48–52", CASA: "39.1(live)", NIM: "~3.0", GNPAttm: "~1.8–2.2" },
  ICICIBANK: { Tier1: "~16.3", GNPA: "~1.7–2.0", NNPA: "~0.4", PCR: "~78(exTWO)", ROA: "~2.2–2.4", CI: "~38–40", CASA: "missing→§5.8", NIM: "~4.3", GNPAttm: "~1.7–2.0" },
  AXISBANK:  { Tier1: "~14.4(at1 corrupt)", GNPA: "~1.3–1.6", NNPA: "~0.3–0.4", PCR: "~75(exTWO)", ROA: "~1.6–1.8", CI: "~47–49", CASA: "missing→§5.8", NIM: "~3.9", GNPAttm: "~1.3–1.6" },
};

const TEST_BANKS = ["HDFCBANK", "SBIN", "ICICIBANK", "AXISBANK"];

const fv = (v: number | null) => v === null ? "  NA   " : v.toFixed(2).padStart(8);

console.log("\n═══ STAGE 2 — COMPUTED vs REALITY (correctness gate) ═══\n");

const stocks = await prisma.stock.findMany({ where: { symbol: { in: TEST_BANKS } }, select: { id: true, symbol: true } });
const idBy = new Map(stocks.map((s) => [s.symbol, s.id]));

for (const sym of TEST_BANKS) {
  const ctx = await loadBankingCtx(sym, idBy.get(sym)!);
  const out = computeBankingLiveValues(ctx, F_KEYS, M_KEYS);
  const all = [...out.foundation, ...out.momentum];
  console.log(`── ${sym}  (Foundation FY=${out.snapshotFy}, Momentum Q=${out.snapshotQuarter}) ──`);
  console.log(`  ${"metric".padEnd(9)} ${"computed".padStart(8)}   ${"reality".padEnd(18)} status / flags`);
  for (const m of all) {
    const ref = REF[sym]?.[m.key] ?? "—";
    const status = m.available ? "ok" : `UNAVAIL: ${m.reason}`;
    const flagStr = m.flags.length ? "  ⚑ " + m.flags.join(" | ") : "";
    console.log(`  ${m.key.padEnd(9)} ${fv(m.value)}   ${ref.padEnd(18)} ${status}${flagStr}`);
  }
  console.log("");
}

// Detail dump of formulas for HDFCBANK + SBIN (manual verification trail)
for (const sym of ["HDFCBANK", "SBIN"]) {
  const ctx = await loadBankingCtx(sym, idBy.get(sym)!);
  const out = computeBankingLiveValues(ctx, F_KEYS, M_KEYS);
  console.log(`── ${sym} formula trail ──`);
  for (const m of [...out.foundation, ...out.momentum]) console.log(`  ${m.key.padEnd(9)} ${m.formula}`);
  console.log("");
}

await prisma.$disconnect();
