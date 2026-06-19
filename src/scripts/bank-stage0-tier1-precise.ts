// Precise tier-1 cross-check: XBRL (cet1+at1, unrounded) vs BankSupplementary, latest FY.
import { prisma } from "../db/prisma.js";

const BANKS = ["HDFCBANK","ICICIBANK","AXISBANK","KOTAKBANK","INDUSINDBK","FEDERALBNK","SBIN","BANKBARODA","PNB","CANBK","UNIONBANK","INDIANB"];
const n = (d: unknown): number | null => d === null || d === undefined ? null : Number(d as never);
const p = (v: number | null, d = 4) => v === null ? "—".padStart(10) : v.toFixed(d).padStart(10);

const stocks = await prisma.stock.findMany({ where: { symbol: { in: BANKS } }, select: { id: true, symbol: true } });
const byId = new Map(stocks.map(s => [s.symbol, s.id]));

console.log("\nXBRL cet1/at1 (RAW fraction) vs BankSupplementary tier1_pct (PERCENT), latest annual FY26 + LIVE\n");
console.log(`${"BANK".padEnd(12)} ${"cet1(frac)".padStart(10)} ${"at1(frac)".padStart(10)} ${"sum×100".padStart(10)} ${"BankSupp-FY26".padStart(13)} ${"BankSupp-LIVE".padStart(13)}`);
for (const sym of BANKS) {
  const id = byId.get(sym)!;
  const a = await prisma.bankingFundamental.findFirst({ where: { stockId: id, resultType: "standalone" }, orderBy: { fiscalYear: "desc" } });
  const cet1 = n(a?.cet1Ratio), at1 = n(a?.additionalTier1Ratio);
  const sum100 = cet1 !== null && at1 !== null ? (cet1 + at1) * 100 : null;
  const bsFy26 = await prisma.bankSupplementary.findFirst({ where: { symbol: sym, metric: "tier1_pct", fiscalYear: "FY26" }, orderBy: { version: "desc" } });
  const bsLive = await prisma.bankSupplementary.findFirst({ where: { symbol: sym, metric: "tier1_pct", fiscalYear: "LIVE" }, orderBy: { version: "desc" } });
  console.log(`${sym.padEnd(12)} ${p(cet1)} ${p(at1)} ${p(sum100,2)} ${p(n(bsFy26?.value),2)} ${p(n(bsLive?.value),2)}`);
}

// CASA spot from BankSupplementary
console.log("\nBankSupplementary CASA (casa_pct) — LIVE per bank:");
for (const sym of BANKS) {
  const bs = await prisma.bankSupplementary.findFirst({ where: { symbol: sym, metric: "casa_pct", fiscalYear: "LIVE" }, orderBy: { version: "desc" } });
  console.log(`  ${sym.padEnd(12)} casa LIVE = ${p(n(bs?.value),2)}  (status ${bs?.status})`);
}

await prisma.$disconnect();
