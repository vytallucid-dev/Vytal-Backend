// READ-ONLY Pass-3 verification.
//   A) 281 price coverage: full(~5yr) / partial(listing-bounded) / none; spot-checks.
//   B) index depth: earliest date per Yahoo-backfilled index (~5yr target).
//   C) failures visible in /settings/ingestion-errors (count + realness).
//   D) existing 224 untouched (new price rows only on the 281; indices separate).
//   npx tsx src/scripts/verify-nifty500-pass3.ts
import { prisma } from "../db/prisma.js";
import fs from "fs";

const FULL_CUTOFF = "2021-10-01"; // min(date) on-or-before this ⇒ "full ~5yr"; later ⇒ listing-bounded

async function main() {
  const original = new Set(fs.readFileSync("docs/original224_symbols.txt", "utf8").trim().split(",").map((s) => s.trim()));
  const all = await prisma.stock.findMany({ select: { id: true, symbol: true } });
  const newSyms = all.filter((s) => !original.has(s.symbol)).map((s) => s.symbol);

  // ── A) price coverage on the 281 ──
  const span = await prisma.$queryRawUnsafe<any[]>(`
    SELECT s.symbol, MIN(dp.date)::date mn, MAX(dp.date)::date mx, COUNT(*)::int n
    FROM stocks s JOIN daily_prices dp ON dp.stock_id = s.id
    WHERE s.symbol = ANY($1::text[]) GROUP BY s.symbol`, newSyms);
  const spanBySym = new Map(span.map((r) => [r.symbol, r]));
  let full = 0, partial = 0, none = 0;
  const noneList: string[] = [];
  for (const sym of newSyms) {
    const r = spanBySym.get(sym);
    if (!r || r.n === 0) { none++; noneList.push(sym); }
    else if (new Date(r.mn) <= new Date(FULL_CUTOFF)) full++;
    else partial++;
  }
  const withSnap = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int n FROM stock_prices sp JOIN stocks s ON s.id=sp.stock_id WHERE s.symbol = ANY($1::text[])`, newSyms);
  console.log("=== A) PRICE COVERAGE (281 new) ===");
  console.log(`  full ~5yr (min date ≤ ${FULL_CUTOFF}) : ${full}`);
  console.log(`  partial (listing-bounded)            : ${partial}`);
  console.log(`  no prices (→ should be in error UI)  : ${none}${none ? " — " + noneList.join(", ") : ""}`);
  console.log(`  stock_prices snapshot rows           : ${withSnap[0].n}/281`);

  // spot-checks: 2 recent IPOs (listing-bounded) + 2 older names (~5yr)
  console.log("  spot-checks:");
  for (const sym of ["LENSKART", "SWIGGY", "CRISIL", "SUNTV", "TATACAP", "ATUL"]) {
    const r = spanBySym.get(sym);
    if (r) console.log(`    ${sym.padEnd(12)} ${r.mn?.toISOString?.().slice(0,10) ?? r.mn} .. ${r.mx?.toISOString?.().slice(0,10) ?? r.mx}  (${r.n} rows)`);
  }

  // ── B) index depth ──
  const idxNames = ["Nifty 50","Sensex","Nifty Auto","Nifty Bank","Nifty FMCG","Nifty IT","Nifty Metal","Nifty Pharma","Nifty Realty"];
  const idx = await prisma.$queryRawUnsafe<any[]>(`
    SELECT index_name, MIN(date)::date mn, MAX(date)::date mx, COUNT(*)::int n
    FROM index_prices WHERE index_name = ANY($1::text[]) GROUP BY index_name ORDER BY index_name`, idxNames);
  console.log("\n=== B) INDEX DEPTH (Yahoo-backfilled) ===");
  for (const r of idx) console.log(`  ${r.index_name.padEnd(14)} ${r.mn?.toISOString?.().slice(0,10) ?? r.mn} .. ${r.mx?.toISOString?.().slice(0,10) ?? r.mx}  (${r.n} rows)`);

  // ── C) error-UI surface ──
  const priceErrOpen = await prisma.ingestionError.count({ where: { status: "open", cron: "yahoo_price_backfill" } });
  const idxErrOpen = await prisma.ingestionError.count({ where: { status: "open", cron: "yahoo_index_backfill" } });
  const openAll = await prisma.ingestionError.count({ where: { status: "open" } });
  console.log("\n=== C) INGESTION-ERROR SURFACE ===");
  console.log(`  open yahoo_price_backfill : ${priceErrOpen}`);
  console.log(`  open yahoo_index_backfill : ${idxErrOpen}`);
  console.log(`  open (all crons)          : ${openAll}`);
  if (priceErrOpen + idxErrOpen > 0) {
    const rows = await prisma.ingestionError.findMany({
      where: { status: "open", cron: { in: ["yahoo_price_backfill", "yahoo_index_backfill"] } },
      select: { cron: true, targetEntity: true, observed: true }, take: 30 });
    for (const r of rows) console.log(`    [${r.cron}] ${r.targetEntity} — ${r.observed}`);
  }

  // ── D) existing 224 untouched ──
  // The 281 target list excludes original224 by construction; confirm 0 overlap and
  // that a sample of original-224 stocks still hold their pre-existing price history.
  const overlap = newSyms.filter((s) => original.has(s));
  const sample224 = await prisma.$queryRawUnsafe<any[]>(`
    SELECT s.symbol, COUNT(*)::int n, MAX(dp.date)::date mx
    FROM stocks s JOIN daily_prices dp ON dp.stock_id=s.id
    WHERE s.symbol = ANY($1::text[]) GROUP BY s.symbol ORDER BY s.symbol LIMIT 5`,
    ["RELIANCE","TCS","HDFCBANK","INFY","ITC"]);
  console.log("\n=== D) EXISTING 224 UNTOUCHED ===");
  console.log(`  new∩original224 overlap (MUST 0): ${overlap.length}`);
  console.log(`  sample original-224 price history intact:`);
  for (const r of sample224) console.log(`    ${r.symbol.padEnd(12)} ${r.n} rows, latest ${r.mx?.toISOString?.().slice(0,10) ?? r.mx}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
