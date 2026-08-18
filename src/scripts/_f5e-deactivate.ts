// ═══════════════════════════════════════════════════════════════
// F5a + F5e — VERIFY THE CONDITION, THEN DEACTIVATE. Plan by default; --commit writes.
//   npx tsx src/scripts/_f5e-deactivate.ts [--commit]
//
// ⚠ THE CONDITION IS CHECKED IN THIS PROCESS, IMMEDIATELY BEFORE THE WRITE.
//   Aman's ruling is REMOVE *conditional on* NSE being empty for the CURRENT period.
//   A condition verified in a different script an hour earlier is a condition
//   verified about a different moment, so F5a runs here, and a single filing
//   returned by any of the three ABORTS before the transaction opens.
//
// ⚠ NOTHING IS DELETED. This sets stocks.is_active = false and touches nothing else.
//   Every daily_price, corporate_event, shareholding_pattern, news row and finding
//   stays exactly where it is. Deactivation is a visibility + ingestion change.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { nseClient } from "../lib/client.js";

const COMMIT = process.argv.includes("--commit");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TARGETS = ["ABBOTINDIA", "BAYERCROP", "MCX"];
const CONTROL = "RELIANCE";
const out: any = {};

/** DD-MM-YYYY, NSE's window format. */
const nseDate = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F5a — THE CONDITION: does NSE serve ANYTHING for these three, right now?   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const to = new Date();
  const from = new Date(to.getTime() - 120 * 86_400_000); // 120 days back — covers the whole Q1 FY27 season
  console.log(`  integrated-filing window: ${nseDate(from)} → ${nseDate(to)}   (120 days, the current filing period)`);
  console.log(`\n  ${pad("symbol", 13)}${lp("totalCount", 12)}${lp("rows", 7)}   verdict`);

  const results: Record<string, number | null> = {};
  for (const sym of [...TARGETS, CONTROL]) {
    let tc: number | null = null, rows = 0, err: string | null = null;
    try {
      const r = await nseClient.get<any>(
        `/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(sym)}` +
          `&from_date=${nseDate(from)}&to_date=${nseDate(to)}&size=100&page=1`,
      );
      tc = typeof r?.totalCount === "number" ? r.totalCount : null;
      rows = Array.isArray(r?.data) ? r.data.length : 0;
    } catch (e) { err = (e as Error).message.slice(0, 90); }
    results[sym] = tc;
    const isCtl = sym === CONTROL;
    console.log(`  ${pad(sym, 13)}${lp(err ? `ERR` : tc ?? "?", 12)}${lp(rows, 7)}   ${err ? `⚠ ${err}` : isCtl ? (tc && tc > 0 ? "✓ control alive — a zero elsewhere is real" : "⚠ CONTROL IS EMPTY — the probe is not trustworthy") : tc === 0 ? "empty — condition holds" : "⚠ RETURNS DATA — condition BROKEN"}`);
    await sleep(1600);
  }
  out.f5a = { window: `${nseDate(from)}→${nseDate(to)}`, results };

  // ── the gate ────────────────────────────────────────────────────────────
  const controlAlive = (results[CONTROL] ?? 0) > 0;
  const nonEmpty = TARGETS.filter((s) => (results[s] ?? -1) !== 0);
  if (!controlAlive) {
    console.log(`\n  ✗ ABORT — the control returned nothing, so a zero for the other three proves nothing.`);
    await prisma.$disconnect(); process.exit(2);
  }
  if (nonEmpty.length) {
    console.log(`\n  ✗ ABORT — ${nonEmpty.join(", ")} returned data or failed. Aman's ruling does not apply to ${nonEmpty.length > 1 ? "these" : "this"}.`);
    await prisma.$disconnect(); process.exit(3);
  }
  console.log(`\n  ✓ CONDITION MET — all three return totalCount 0 while the control returns ${results[CONTROL]}.`);

  // ── F5e · the write ─────────────────────────────────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F5e — DEACTIVATE                                                          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const before = await raw(`SELECT "symbol","is_active" act FROM stocks WHERE "symbol"=ANY($1::text[]) ORDER BY "symbol"`, TARGETS);
  const [cBefore] = await raw(`SELECT count(*)::int n FROM stocks WHERE "is_active"=true`);
  const [cCohortBefore] = await raw(`SELECT count(*)::int n FROM stocks WHERE "is_active"=true AND "industryType"::text IN ('non_financial','banking')`);
  console.log(`  before: ${before.map((r: any) => `${r.symbol}=${r.act}`).join("  ")}`);
  console.log(`  active stocks (all industries) : ${cBefore.n}`);
  console.log(`  active cohort (nf + banking)   : ${cCohortBefore.n}`);
  console.log(`\n  THE STATEMENT:`);
  console.log(`     UPDATE stocks SET is_active = false WHERE symbol IN ('ABBOTINDIA','BAYERCROP','MCX') AND is_active = true;`);
  console.log(`     (is_active = true in the predicate so a re-run is a no-op rather than a silent 0-row "success")`);

  if (!COMMIT) {
    console.log(`\n  (plan only — nothing written. add --commit)\n`);
    await prisma.$disconnect(); return;
  }

  let affected = 0;
  await prisma.$transaction(async (tx) => {
    affected = await tx.$executeRawUnsafe(
      `UPDATE stocks SET "is_active" = false, "updated_at" = now()
        WHERE "symbol" = ANY($1::text[]) AND "is_active" = true`, TARGETS);
    console.log(`\n  rows affected: ${affected}`);
    if (affected !== 3) throw new Error(`expected exactly 3 rows, got ${affected} — ROLLBACK`);
    const after = await tx.$queryRawUnsafe<Array<{ symbol: string; act: boolean }>>(
      `SELECT "symbol","is_active" act FROM stocks WHERE "symbol"=ANY($1::text[])`, TARGETS);
    if (after.some((r) => r.act)) throw new Error(`a target is still active — ROLLBACK`);
    // Nothing else may have moved.
    const [n] = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int n FROM stocks WHERE "is_active"=true`);
    if (n.n !== cBefore.n - 3) throw new Error(`active count ${n.n} != ${cBefore.n - 3} — ROLLBACK`);
    console.log(`  ✓ assertions: exactly 3 deactivated · none still active · active total ${cBefore.n} → ${n.n}`);
  });
  console.log(`  ✓ COMMITTED`);

  // ── F5f · the new counts, and proof nothing was deleted ─────────────────
  const [cAfter] = await raw(`SELECT count(*)::int n FROM stocks WHERE "is_active"=true`);
  const [cCohortAfter] = await raw(`SELECT count(*)::int n FROM stocks WHERE "is_active"=true AND "industryType"::text IN ('non_financial','banking')`);
  console.log(`\n  ── F5f · counts after ──`);
  console.log(`  active stocks (all industries) : ${cBefore.n} → ${cAfter.n}`);
  console.log(`  active cohort (nf + banking)   : ${cCohortBefore.n} → ${cCohortAfter.n}   ${cCohortAfter.n === 439 ? "✓ 439" : "⚠ EXPECTED 439"}`);

  const kept = await raw(`
    SELECT s."symbol" sym, s."is_active" act,
      (SELECT count(*)::int FROM daily_prices d WHERE d."stock_id"=s."id") p,
      (SELECT count(*)::int FROM corporate_events e WHERE e."stock_id"=s."id") e,
      (SELECT count(*)::int FROM shareholding_patterns h WHERE h."stock_id"=s."id") h,
      (SELECT count(*)::int FROM stock_news n WHERE n."stock_id"=s."id") n,
      (SELECT count(*)::int FROM stock_findings f WHERE f."stock_id"=s."id") f,
      (SELECT count(*)::int FROM stock_peer_groups g WHERE g."stock_id"=s."id") g
    FROM stocks s WHERE s."symbol"=ANY($1::text[]) ORDER BY s."symbol"`, TARGETS);
  console.log(`\n  ── NOTHING WAS DELETED — every row is still there ──`);
  console.log(`  ${pad("symbol", 13)}${pad("active", 9)}${lp("prices", 8)}${lp("events", 8)}${lp("shp", 6)}${lp("news", 7)}${lp("findings", 10)}${lp("peer_grp", 10)}`);
  for (const r of kept) console.log(`  ${pad(r.sym, 13)}${pad(r.act, 9)}${lp(r.p, 8)}${lp(r.e, 8)}${lp(r.h, 6)}${lp(r.n, 7)}${lp(r.f, 10)}${lp(r.g, 10)}`);

  out.f5e = { affected, activeBefore: cBefore.n, activeAfter: cAfter.n, cohortBefore: cCohortBefore.n, cohortAfter: cCohortAfter.n, kept };
  writeFileSync("_f5e-deactivate.json", JSON.stringify(out, null, 1));
  console.log(`\n  → ./_f5e-deactivate.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", (e as Error).message); await prisma.$disconnect(); process.exit(1); });
