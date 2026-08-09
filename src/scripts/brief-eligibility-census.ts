// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ELIGIBILITY CENSUS — WHICH CONDITION ACTUALLY EXCLUDES A STOCK, ONE STOCK AT A TIME.
//
// Answers the question the backfill's own eligibility count cannot: for every stock that does NOT
// produce a fact block, WHY. And for every one that does, whether it is carrying the states that are
// honest-but-thin — no score, no prior quarter, no year-ago quarter — because none of those are
// exclusions and a count that conflated them with "no data" would be reporting a bug that isn't one.
//
// ⚠ IT RE-DERIVES THE PREDICATE FROM ITS PARTS rather than trusting the builder's null. The builder
// returns ONE null for four different reasons (no stock, no basis, no rows, unknown periodKey), so
// calling it alone can only say "excluded", never "excluded because". The parts are called directly,
// in the builder's own order, and the builder is then called too — so a disagreement between the two
// would show up as a mismatch rather than hiding.
//
//   npx tsx src/scripts/brief-eligibility-census.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { fetchFamilyQuarters, resolveFamilyBasis } from "../insight/quarter-brief/family-rows.js";
import type { Basis, Family } from "../insight/quarter-brief/types.js";

const priorFy = (fy: string): string => `FY${String(Number(fy.slice(2)) - 1).padStart(2, "0")}`;

interface Row {
  symbol: string;
  family: Family;
  /** Rows on the PREFERRED basis and on the other one — so "no rows" and "no rows on this basis"
   *  are never confused. */
  rowsConsolidated: number;
  rowsStandalone: number;
  basis: Basis | null;
  rowsOnBasis: number;
  latest: string | null;
  hasPriorQuarter: boolean;
  hasYearAgoQuarter: boolean;
  hasAnyComparison: boolean;
  snapshotsAnyPeriod: number;
  snapshotForLatest: boolean;
  blockBuilt: boolean;
  verdictNull: boolean;
}

async function main(): Promise<void> {
  const stocks = await prisma.stock.findMany({
    select: { id: true, symbol: true, industryType: true },
    orderBy: { symbol: "asc" },
  });

  const rows: Row[] = [];
  let n = 0;
  for (const s of stocks) {
    const family = s.industryType as Family;

    // The predicate's parts, in the builder's own order.
    const cons = await fetchFamilyQuarters(family, s.id, "consolidated");
    const stand = await fetchFamilyQuarters(family, s.id, "standalone");
    const basis = await resolveFamilyBasis(family, s.id);
    const onBasis = basis === "consolidated" ? cons : basis === "standalone" ? stand : [];

    const current = onBasis.length > 0 ? onBasis[onBasis.length - 1] : null;
    const prior = onBasis.length > 1 ? onBasis[onBasis.length - 2] : null;
    const yearAgo = current
      ? (onBasis.find((r) => r.quarter === current.quarter && r.fiscalYear === priorFy(current.fiscalYear)) ?? null)
      : null;

    const snaps = await prisma.scoreSnapshot.findMany({
      where: { stockId: s.id, snapshotType: "quarterly" },
      select: { periodKey: true },
    });
    const snapPeriods = new Set(snaps.map((x) => x.periodKey));

    const block = await buildQuarterBriefFactBlock(s.symbol);

    rows.push({
      symbol: s.symbol,
      family,
      rowsConsolidated: cons.length,
      rowsStandalone: stand.length,
      basis,
      rowsOnBasis: onBasis.length,
      latest: current?.periodKey ?? null,
      hasPriorQuarter: prior !== null,
      hasYearAgoQuarter: yearAgo !== null,
      hasAnyComparison: prior !== null || yearAgo !== null,
      snapshotsAnyPeriod: snapPeriods.size,
      snapshotForLatest: current ? snapPeriods.has(current.periodKey) : false,
      blockBuilt: block !== null,
      verdictNull: block !== null && block.verdict === null,
    });

    if (++n % 100 === 0) process.stderr.write(`    …${n}/${stocks.length}\n`);
  }

  const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));
  const list = (xs: Row[], k = 8) => xs.slice(0, k).map((r) => r.symbol).join(", ") + (xs.length > k ? `, …(+${xs.length - k})` : "");

  // ── 4 · THE REAL CEILING ────────────────────────────────────────────────────────────────────────
  rule("4 · HOW MANY OF THE 504 HAVE A QUARTERLY ROW AT ALL — the real ceiling on this feature");
  const anyRow = rows.filter((r) => r.rowsConsolidated + r.rowsStandalone > 0);
  const noRow = rows.filter((r) => r.rowsConsolidated + r.rowsStandalone === 0);
  console.log(`  stocks                                     : ${rows.length}`);
  console.log(`  with ≥1 quarterly row (either basis)       : ${anyRow.length}`);
  console.log(`  with NO quarterly row on either basis      : ${noRow.length}   ${noRow.length ? `→ ${list(noRow, 20)}` : ""}`);
  console.log(`  fact block builds                          : ${rows.filter((r) => r.blockBuilt).length}`);
  const mismatch = rows.filter((r) => r.blockBuilt !== r.rowsOnBasis > 0);
  console.log(`  predicate mismatch (parts vs builder)      : ${mismatch.length}   ${mismatch.length ? list(mismatch) : "— the parts and the builder agree exactly"}`);

  // ── 2 · SCORE vs QUARTERLY ROW, FOR EVERY EXCLUSION ─────────────────────────────────────────────
  rule("2 · THE EXCLUDED — is it a missing SCORE SNAPSHOT or a missing QUARTERLY ROW?");
  const excluded = rows.filter((r) => !r.blockBuilt);
  console.log(`  excluded total                             : ${excluded.length}`);
  const exclNoRow = excluded.filter((r) => r.rowsConsolidated + r.rowsStandalone === 0);
  const exclHasRow = excluded.filter((r) => r.rowsConsolidated + r.rowsStandalone > 0);
  console.log(`    · lack a QUARTERLY ROW (correctly out)   : ${exclNoRow.length}`);
  console.log(`    · have rows but still excluded (SUSPECT) : ${exclHasRow.length}`);
  for (const r of excluded) {
    console.log(
      `      ${r.symbol.padEnd(14)} ${r.family.padEnd(18)} cons=${String(r.rowsConsolidated).padStart(3)} ` +
        `stand=${String(r.rowsStandalone).padStart(3)}  snapshots=${String(r.snapshotsAnyPeriod).padStart(2)}  ` +
        `basis=${r.basis ?? "null"}`,
    );
  }
  const excludedWithScore = excluded.filter((r) => r.snapshotsAnyPeriod > 0);
  console.log(`\n  ⚠ excluded DESPITE having a score snapshot : ${excludedWithScore.length}  ${excludedWithScore.length ? list(excludedWithScore) : ""}`);

  // ── THE SCORE GATE, TESTED AS A HYPOTHESIS ──────────────────────────────────────────────────────
  rule("2b · IS ELIGIBILITY SCORE-GATED? — tested against the data, not read off the code");
  const built = rows.filter((r) => r.blockBuilt);
  const builtUnscored = built.filter((r) => !r.snapshotForLatest);
  const builtNoSnapsAtAll = built.filter((r) => r.snapshotsAnyPeriod === 0);
  console.log(`  blocks built                               : ${built.length}`);
  console.log(`  …of those, NO snapshot for the latest period: ${builtUnscored.length}   ${list(builtUnscored)}`);
  console.log(`  …of those, NO snapshot in ANY period       : ${builtNoSnapsAtAll.length}   ${list(builtNoSnapsAtAll)}`);
  console.log(`  ⇒ a score-gated predicate would have excluded these ${builtUnscored.length}. It did not.`);

  // ── 3 · COMPARISON PERIODS ──────────────────────────────────────────────────────────────────────
  rule("3 · COMPARISON PERIODS — a prior quarter and a year-ago quarter, among the ELIGIBLE");
  console.log(`  eligible with a year-ago quarter           : ${built.filter((r) => r.hasYearAgoQuarter).length}`);
  console.log(`  eligible with a prior quarter (QoQ only)   : ${built.filter((r) => r.hasPriorQuarter && !r.hasYearAgoQuarter).length}`);
  const noCmp = built.filter((r) => !r.hasAnyComparison);
  console.log(`  eligible with NEITHER (single row on file) : ${noCmp.length}   ${noCmp.length ? list(noCmp, 20) : ""}`);
  console.log(`  …and of those, verdict is null (no badge)  : ${noCmp.filter((r) => r.verdictNull).length} / ${noCmp.length}`);
  console.log(`  eligible with a NULL verdict overall       : ${built.filter((r) => r.verdictNull).length}   ${list(built.filter((r) => r.verdictNull), 20)}`);
  console.log(`  ⇒ NONE of these are excluded — a missing comparison renders as an absent badge.`);

  // ── PERIOD SPREAD — is anything cut by date? ────────────────────────────────────────────────────
  rule("3b · PERIOD SPREAD OF THE ELIGIBLE — testing for a date floor");
  const byPeriod = new Map<string, number>();
  for (const r of built) byPeriod.set(r.latest!, (byPeriod.get(r.latest!) ?? 0) + 1);
  const sorted = [...byPeriod.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [p, c] of sorted) console.log(`  ${p}  ${String(c).padStart(4)}`);
  console.log(`  oldest latest-period among ELIGIBLE stocks : ${sorted[0][0]}`);
  console.log(`  ⇒ eligible stocks exist BELOW FY26Q1 (${built.filter((r) => r.latest! < "FY26Q1").length} of them), so no FY26Q1 floor is in force.`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
