// STAGE 0 — verify the banking XBRL fields the 12 metrics need actually RESOLVE
// (non-null, sane sample value) from the stored banking tables, for the 12 banks.
//
//   npx tsx src/scripts/bank-stage0-xbrl-probe.ts
//
// The reliable handle is the STORED column (BankingFundamental annual /
// BankingQuarterlyResult quarterly), not the parser concept string. Reports per
// field: resolves (sample value from a real bank) or absent — STANDALONE basis only.
// CRITICAL: cet1Ratio + additionalTier1Ratio (F1's XBRL-primary path).

import { prisma } from "../db/prisma.js";

const BANKS = [
  "HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "INDUSINDBK", "FEDERALBNK",
  "SBIN", "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "INDIANB",
];

// Fields each metric needs from the ANNUAL banking row.
const ANNUAL_FIELDS = [
  "gnpaPct", "nnpaPct", "gnpaAbsolute", "nnpaAbsolute", "advances",
  "netProfit", "profitAfterTax", "totalAssets", "operatingExpenses",
  "interestEarned", "interestExpended", "otherIncome", "ppop",
  "cet1Ratio", "additionalTier1Ratio", "tier1Ratio", "roaDisclosed",
  "investments", "cashAndBalancesWithRbi", "balancesWithBanks",
] as const;

// Fields each metric needs from the QUARTERLY banking row.
const QUARTERLY_FIELDS = [
  "gnpaPct", "nnpaPct", "gnpaAbsolute", "nnpaAbsolute",
  "netProfit", "profitAfterTax", "ppop",
  "interestEarned", "interestExpended", "otherIncome", "operatingExpenses",
  "cet1Ratio", "additionalTier1Ratio", "roaQuarterly",
] as const;

const num = (d: unknown): number | null =>
  d === null || d === undefined ? null : Number(d as never);

function fmt(v: number | null): string {
  if (v === null) return "    —    ";
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0).padStart(9);
  return v.toFixed(2).padStart(9);
}

const stocks = await prisma.stock.findMany({
  where: { symbol: { in: BANKS } },
  select: { id: true, symbol: true, industryType: true },
});
const byId = new Map(stocks.map((s) => [s.symbol, s]));

console.log("\n═══ STAGE 0 — XBRL FIELD RESOLUTION (12 banks, STANDALONE) ═══\n");

// ── Symbol resolution + industryType ──
console.log("── Symbol resolution ──");
const unresolved: string[] = [];
const notBanking: string[] = [];
for (const sym of BANKS) {
  const s = byId.get(sym);
  if (!s) { unresolved.push(sym); console.log(`  ✗ ${sym}: NO Stock row`); continue; }
  if (s.industryType !== "banking") { notBanking.push(sym); console.log(`  ✗ ${sym}: industryType=${s.industryType} (not banking)`); continue; }
  console.log(`  ✓ ${sym}: resolved, banking`);
}
console.log("");

// ── Row footprint per bank (how many standalone annual / quarterly rows) ──
console.log("── Banking-row footprint (STANDALONE) ──");
console.log(`  ${"BANK".padEnd(12)}  annualFY  quarters  latestFY  latestQ`);
const annualByBank = new Map<string, any[]>();
const quarterlyByBank = new Map<string, any[]>();
for (const sym of BANKS) {
  const s = byId.get(sym);
  if (!s) continue;
  const annual = await prisma.bankingFundamental.findMany({
    where: { stockId: s.id, resultType: "standalone" },
    orderBy: { fiscalYear: "asc" },
  });
  const quarterly = await prisma.bankingQuarterlyResult.findMany({
    where: { stockId: s.id, resultType: "standalone" },
    orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
  });
  annualByBank.set(sym, annual);
  quarterlyByBank.set(sym, quarterly);
  const lastA = annual[annual.length - 1];
  const lastQ = quarterly[quarterly.length - 1];
  console.log(`  ${sym.padEnd(12)}  ${String(annual.length).padStart(8)}  ${String(quarterly.length).padStart(8)}  ${(lastA?.fiscalYear ?? "—").padStart(8)}  ${(lastQ ? lastQ.fiscalYear + lastQ.quarter : "—").padStart(7)}`);
}
console.log("");

// ── ANNUAL field resolution: latest standalone FY per bank ──
console.log("── ANNUAL field resolution (latest standalone FY) ──");
console.log(`  field                       resolved/12   sample (HDFCBANK latest)`);
for (const f of ANNUAL_FIELDS) {
  let resolved = 0;
  let sample: number | null = null;
  for (const sym of BANKS) {
    const rows = annualByBank.get(sym) ?? [];
    const last = rows[rows.length - 1];
    if (last && num(last[f]) !== null) {
      resolved++;
      if (sym === "HDFCBANK") sample = num(last[f]);
    }
  }
  const flag = resolved === 0 ? "  ✗ ABSENT" : resolved < 12 ? "  ⚠ partial" : "";
  console.log(`  ${f.padEnd(26)}  ${String(resolved).padStart(8)}/12   ${fmt(sample)}${flag}`);
}
console.log("");

// ── QUARTERLY field resolution: latest standalone quarter per bank ──
console.log("── QUARTERLY field resolution (latest standalone quarter) ──");
console.log(`  field                       resolved/12   sample (HDFCBANK latest)`);
for (const f of QUARTERLY_FIELDS) {
  let resolved = 0;
  let sample: number | null = null;
  for (const sym of BANKS) {
    const rows = quarterlyByBank.get(sym) ?? [];
    const last = rows[rows.length - 1];
    if (last && num(last[f]) !== null) {
      resolved++;
      if (sym === "HDFCBANK") sample = num(last[f]);
    }
  }
  const flag = resolved === 0 ? "  ✗ ABSENT" : resolved < 12 ? "  ⚠ partial" : "";
  console.log(`  ${f.padEnd(26)}  ${String(resolved).padStart(8)}/12   ${fmt(sample)}${flag}`);
}
console.log("");

// ── CRITICAL: cet1 + at1 resolution per bank (F1 XBRL-primary path) ──
console.log("── CRITICAL — F1 Tier-1 XBRL path: cet1Ratio + additionalTier1Ratio ──");
console.log(`  (latest ANNUAL + latest QUARTERLY standalone; tier1 = cet1+at1)`);
console.log(`  ${"BANK".padEnd(12)}  A:cet1   A:at1    A:t1sum  A:tier1col  Q:cet1   Q:at1    Q:t1sum`);
for (const sym of BANKS) {
  const a = (annualByBank.get(sym) ?? []).slice(-1)[0];
  const q = (quarterlyByBank.get(sym) ?? []).slice(-1)[0];
  const aCet = num(a?.cet1Ratio), aAt1 = num(a?.additionalTier1Ratio), aT1col = num(a?.tier1Ratio);
  const qCet = num(q?.cet1Ratio), qAt1 = num(q?.additionalTier1Ratio);
  const aSum = aCet !== null && aAt1 !== null ? aCet + aAt1 : null;
  const qSum = qCet !== null && qAt1 !== null ? qCet + qAt1 : null;
  console.log(`  ${sym.padEnd(12)}  ${fmt(aCet)} ${fmt(aAt1)} ${fmt(aSum)} ${fmt(aT1col)}   ${fmt(qCet)} ${fmt(qAt1)} ${fmt(qSum)}`);
}
console.log("");

// ── Sample full snapshot for HDFCBANK / SBIN / ICICIBANK latest annual ──
console.log("── Sample latest-annual snapshots (sanity) ──");
for (const sym of ["HDFCBANK", "SBIN", "ICICIBANK"]) {
  const a = (annualByBank.get(sym) ?? []).slice(-1)[0];
  if (!a) { console.log(`  ${sym}: no annual row`); continue; }
  console.log(`  ${sym} ${a.fiscalYear}: gnpaPct=${fmt(num(a.gnpaPct))} nnpaPct=${fmt(num(a.nnpaPct))} roaDisc=${fmt(num(a.roaDisclosed))} cet1=${fmt(num(a.cet1Ratio))} at1=${fmt(num(a.additionalTier1Ratio))}`);
  console.log(`  ${" ".repeat(sym.length)}    advances=${fmt(num(a.advances))} totAssets=${fmt(num(a.totalAssets))} netProfit=${fmt(num(a.netProfit))} ppop=${fmt(num(a.ppop))}`);
}
console.log("");

await prisma.$disconnect();
