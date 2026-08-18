// ═══════════════════════════════════════════════════════════════
// T2 EXECUTE — the approved 6-row stocks.fiscalYearEnd correction.
// ⚠ WRITES DATA (stocks table only, 6 rows). One transaction.
//   npx tsx src/scripts/_s4b-t2exec.ts --confirm
//
// Rolls back if the affected count is not exactly 6.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const CONFIRM = process.argv.includes("--confirm");
const TO_MARCH = ["NESTLEIND"];
const TO_DECEMBER = ["CASTROLIND", "CIEINDIA", "CRISIL", "HEXT", "SCHAEFFLER"];
const EXPECTED = TO_MARCH.length + TO_DECEMBER.length; // 6
const ALL = [...TO_MARCH, ...TO_DECEMBER];

const pad = (s: unknown, n: number) => String(s).padEnd(n);
/** discovery.ts inferFilingType, verbatim in shape */
const inferFilingType = (qeDate: string, fye: string) =>
  qeDate.toUpperCase().includes(fye === "december" ? "-DEC-" : "-MAR-") ? "annual" : "quarterly";

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T2 EXECUTE — stocks.fiscalYearEnd · ${EXPECTED} rows · ONE TRANSACTION            ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const before = (await prisma.$queryRawUnsafe(
    `SELECT "symbol","fiscalYearEnd"::text fye FROM stocks WHERE "symbol"=ANY($1::text[]) ORDER BY 1`, ALL)) as any[];
  console.log(`\n  BEFORE:`);
  for (const r of before) console.log(`    ${pad(r.symbol, 14)}${r.fye}`);

  if (!CONFIRM) { console.log(`\n  (no --confirm — nothing written)\n`); await prisma.$disconnect(); return; }

  let affected = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const a = await tx.$executeRawUnsafe(
        `UPDATE stocks SET "fiscalYearEnd"='march'::"FiscalYearEnd", "updated_at"=now() WHERE "symbol"=ANY($1::text[])`, TO_MARCH);
      const b = await tx.$executeRawUnsafe(
        `UPDATE stocks SET "fiscalYearEnd"='december'::"FiscalYearEnd", "updated_at"=now() WHERE "symbol"=ANY($1::text[])`, TO_DECEMBER);
      affected = a + b;
      console.log(`\n  → march   : ${a} row(s)`);
      console.log(`  → december: ${b} row(s)`);
      console.log(`  total     : ${affected}`);
      if (affected !== EXPECTED) {
        throw new Error(`affected ${affected} != expected ${EXPECTED} — ROLLING BACK`);
      }
    });
    console.log(`  ✓ COMMITTED — exactly ${EXPECTED} rows`);
  } catch (e) {
    console.log(`\n  ✗ ROLLED BACK: ${(e as Error).message}`);
    await prisma.$disconnect(); process.exit(3);
  }

  const after = (await prisma.$queryRawUnsafe(
    `SELECT "symbol","fiscalYearEnd"::text fye,"updated_at"::text ua FROM stocks WHERE "symbol"=ANY($1::text[]) ORDER BY 1`, ALL)) as any[];
  const bmap = new Map(before.map((r: any) => [r.symbol, r.fye]));
  console.log(`\n  ── BEFORE / AFTER, per stock ──`);
  console.log(`  ${pad("symbol", 14)}${pad("before", 11)}${pad("after", 11)}${pad("changed", 9)}updated_at`);
  let changed = 0;
  for (const r of after) {
    const b = bmap.get(r.symbol);
    if (b !== r.fye) changed++;
    console.log(`  ${pad(r.symbol, 14)}${pad(b, 11)}${pad(r.fye, 11)}${pad(b !== r.fye ? "✓ yes" : "no", 9)}${String(r.ua).slice(0, 19)}`);
  }
  console.log(`  rows whose value actually changed: ${changed}/${EXPECTED}`);

  // ── VERIFY THE EFFECT, don't assume it ──
  console.log(`\n  ── THE DEFECT BEING CLOSED: inferFilingType on each stock's REAL annual filing ──`);
  console.log(`  ${pad("symbol", 14)}${pad("real annual qe_Date", 21)}${pad("BEFORE", 12)}${pad("AFTER", 12)}verdict`);
  let closed = 0;
  for (const r of after) {
    const [latest] = (await prisma.$queryRawUnsafe(
      `SELECT to_char(f."report_date",'DD-MON-YYYY') qe, f."report_date"::text rd
         FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
        WHERE st."symbol"=$1 ORDER BY f."report_date" DESC LIMIT 1`, r.symbol)) as any[];
    if (!latest) { console.log(`  ${pad(r.symbol, 14)}(no annual row)`); continue; }
    const qe = String(latest.qe).toUpperCase();
    const bef = inferFilingType(qe, bmap.get(r.symbol)!);
    const aft = inferFilingType(qe, r.fye);
    if (bef === "quarterly" && aft === "annual") closed++;
    console.log(`  ${pad(r.symbol, 14)}${pad(qe, 21)}${pad(bef, 12)}${pad(aft, 12)}${bef !== aft ? "✓ annual filing no longer mis-read as quarterly" : "no change"}`);
  }
  console.log(`\n  ⇒ stocks whose annual filing is now correctly classified: ${closed}/${EXPECTED}`);

  // nothing else may have moved
  const [n] = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int n FROM stocks WHERE "updated_at" > now() - interval '2 minutes'`)) as any[];
  console.log(`  stocks rows touched in the last 2 min: ${n.n} ${n.n === EXPECTED ? "✓ exactly the six" : "⚠ unexpected"}`);
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
