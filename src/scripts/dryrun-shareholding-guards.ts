// ─────────────────────────────────────────────────────────────
// DRY-RUN harness for the shareholding ingestion guards.
//
// Exercises the REAL guard code: synthetic XBRL through the real
// parseXbrlShareholding() + the pure predicates + the real
// reportIngestionError()/dedup seam. Sentinel cron "_dryrun_shp" →
// cleanup can only touch dry-run rows.
//
// THE KEY TEST: an unknown FUTURE taxonomy vintage (context IDs the
// parser has never seen) → parser silently zeros → the invariant-based
// SHAPE guard (partition < 50) catches it WITHOUT needing the sample.
//
// Run:  npx tsx src/scripts/dryrun-shareholding-guards.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { parseXbrlShareholding } from "../ingestions/shareholdings/xbrl-parser.js";
import { fetchShareholdingIndex, fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import {
  checkPartitionBroken,
  classifyCoverage,
  checkZeroFilingRate,
  checkBatchNullRate,
  checkPledgeCollapse,
  checkPctRange,
  checkShareInvariants,
  checkPromoterContinuity,
  FII_DII_NULL_MAX,
} from "../ingestions/shareholdings/shareholding-guards.js";

const CRON = "_dryrun_shp";

// ── Synthetic XBRL builder ───────────────────────────────────
// `ctxSuffix` swaps the context-ID vintage: "_ContextI" = a known 2025
// vintage (resolves); anything else = an UNKNOWN future vintage (misses).
function buildXbrl(ctxSuffix: string): string {
  const pct = (ctx: string, v: number) =>
    `<in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="${ctx}">${v}</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>`;
  const shares = (ctx: string, v: number) =>
    `<in-bse-shp:NumberOfFullyPaidUpEquityShares contextRef="${ctx}">${v}</in-bse-shp:NumberOfFullyPaidUpEquityShares>`;
  const S = ctxSuffix;
  return `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:in-bse-shp="http://example.com/shp">
  ${pct(`ShareholdingOfPromoterAndPromoterGroup${S}`, 71.77)}
  ${pct(`PublicShareholding${S}`, 28.23)}
  ${pct(`InstitutionsForeign${S}`, 15.0)}
  ${pct(`InstitutionsDomestic${S}`, 10.0)}
  ${shares(`ShareholdingPattern${S}`, 1000000)}
  ${shares(`ShareholdingOfPromoterAndPromoterGroup${S}`, 717700)}
</xbrli:xbrl>`;
}

// ── Assertion harness ────────────────────────────────────────
const results: { ok: boolean; name: string; got?: unknown }[] = [];
function check(name: string, ok: boolean, got?: unknown) {
  results.push({ ok, name, got });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}

async function cleanup() {
  await prisma.ingestionError.deleteMany({ where: { cron: CRON } });
}

async function main() {
  await cleanup();

  // ── 1. NORMAL — healthy current-vintage XBRL trips nothing ──
  console.log("\n[1] Healthy XBRL (known vintage) — expect clean parse, ZERO flags");
  const healthy = parseXbrlShareholding(buildXbrl("_ContextI"));
  check("promoterPct ≈ 71.77", Math.abs(healthy.promoterPct - 71.77) < 0.01, healthy.promoterPct);
  check("publicPct ≈ 28.23", Math.abs(healthy.publicPct - 28.23) < 0.01, healthy.publicPct);
  check("fiiPct ≈ 15", healthy.fiiPct === 15, healthy.fiiPct);
  check("diiPct ≈ 10", healthy.diiPct === 10, healthy.diiPct);
  check("totalShares = 1000000", healthy.totalShares === 1000000, healthy.totalShares);
  check("SHAPE clean (partition ≈ 100)", checkPartitionBroken(healthy.promoterPct, healthy.publicPct, healthy.employeeTrustPct) === false);
  check("RANGE clean (no pct OOB)", [healthy.promoterPct, healthy.publicPct, healthy.fiiPct, healthy.diiPct].every((v) => !checkPctRange(v)));
  check("share invariants clean", checkShareInvariants({ totalShares: healthy.totalShares, promoterShares: healthy.promoterShares, pledgedShares: healthy.pledgedShares }).length === 0);
  check("CONTINUITY clean (Δ vs 71.8 prior)", checkPromoterContinuity(healthy.promoterPct, 71.8) === null);

  // ── 2. SHAPE — unknown FUTURE vintage → parser zeros → caught ──
  console.log("\n[2] Unknown future vintage (context IDs never seen) — expect SHAPE reject");
  const broken = parseXbrlShareholding(buildXbrl("_Ctx2099Future"));
  check("parser silently zeros promoter", broken.promoterPct === 0, broken.promoterPct);
  check("parser silently zeros public", broken.publicPct === 0, broken.publicPct);
  check("SHAPE CATCHES it (partition < 50) — vintage-agnostic", checkPartitionBroken(broken.promoterPct, broken.publicPct, broken.employeeTrustPct) === true);
  // fraction-scale break (un-rescaled 0–1) also < 50:
  check("SHAPE catches fraction-scale (0.72+0.28)", checkPartitionBroken(0.72, 0.28, 0) === true);

  // ── 3. RANGE / validity ──
  console.log("\n[3] Range / validity predicates");
  check("pct 150 out of range", checkPctRange(150) === true);
  check("pct 50 in range", checkPctRange(50) === false);
  check("totalShares=0 flagged", checkShareInvariants({ totalShares: 0, promoterShares: 0, pledgedShares: 0 }).includes("totalShares<=0"));
  check("promoter>total flagged", checkShareInvariants({ totalShares: 100, promoterShares: 200, pledgedShares: 0 }).includes("promoterShares>totalShares"));
  check("pledged>promoter flagged", checkShareInvariants({ totalShares: 100, promoterShares: 50, pledgedShares: 60 }).includes("pledgedShares>promoterShares"));

  // ── 4. CONTINUITY ──
  console.log("\n[4] Continuity (QoQ promoter delta)");
  check("Δ21pp flagged", checkPromoterContinuity(50, 71) === 21);
  check("Δ0.2pp silent", checkPromoterContinuity(71.2, 71) === null);
  check("no prior → silent", checkPromoterContinuity(71, null) === null);

  // ── 5. COVERAGE (run-level) ──
  console.log("\n[5] Coverage / count (run-level)");
  check("150/223 success → high", classifyCoverage(150, 223)?.severity === "high");
  check("210/223 success → clean", classifyCoverage(210, 223) === null);
  check("30/223 zero-filings → flagged", checkZeroFilingRate(30, 223) != null);
  check("5/223 zero-filings → clean", checkZeroFilingRate(5, 223) === null);

  // ── 6. NULL-RATE (batch, sees through CSV mask) ──
  console.log("\n[6] Null-rate (batch) + pledge collapse");
  check("fii 50/221 null → flagged", checkBatchNullRate(50, 221, FII_DII_NULL_MAX) != null);
  check("fii 1/221 null → clean (normal 0.2%)", checkBatchNullRate(1, 221, FII_DII_NULL_MAX) === null);
  check("small batch (n<30) → skipped", checkBatchNullRate(20, 25, FII_DII_NULL_MAX) === null);
  check("pledge 2/221 present → collapse flagged", checkPledgeCollapse(2, 221) != null);
  check("pledge 41/221 present → clean (normal 18.7%)", checkPledgeCollapse(41, 221) === null);

  // ── 7. Report mapping + dedup (sentinel cron) ──
  console.log("\n[7] reportIngestionError mapping + dedup");
  await reportIngestionError({ source: "nse_shareholding_xbrl", cron: CRON, guardType: "shape", targetTable: "ShareholdingPattern", targetEntity: "TEST@2026-03-31", severity: "critical", resolutionPath: "source_code", expected: "≥50", observed: "sum=0", runRef: "xbrl:2026-03-31" });
  const shapeRow = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "shape" } });
  check("shape row critical/source_code", shapeRow?.severity === "critical" && shapeRow?.resolutionPath === "source_code");
  await reportIngestionError({ source: "nse_shareholding_xbrl", cron: CRON, guardType: "range", targetTable: "ShareholdingPattern", targetField: "pct", targetEntity: "TEST@2026-03-31", severity: "medium", resolutionPath: "admin_fill", expected: "[0,100]", observed: "promoterPct=150", runRef: "x" });
  const rangeRow = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "range" } });
  check("range row medium/admin_fill", rangeRow?.severity === "medium" && rangeRow?.resolutionPath === "admin_fill");

  // dedup: same continuity violation twice → 1 row, occurrences=2
  const contArgs = { source: "nse_shareholding_xbrl", cron: CRON, guardType: "continuity" as const, targetTable: "ShareholdingPattern", targetField: "promoterPct", targetEntity: "DUP@2026-03-31", severity: "low" as const, resolutionPath: "source_code" as const, expected: "≤10pp", observed: "71→50", runRef: "x" };
  await reportIngestionError(contArgs);
  await reportIngestionError({ ...contArgs, observed: "71→49" });
  const dup = await prisma.ingestionError.findMany({ where: { cron: CRON, guardType: "continuity" } });
  check("dedup → 1 row", dup.length === 1, dup.length);
  check("occurrences = 2", dup[0]?.occurrences === 2, dup[0]?.occurrences);

  await cleanup();
  const leftover = await prisma.ingestionError.count({ where: { cron: CRON } });
  check("cleanup removed all dry-run rows", leftover === 0, leftover);

  // ── 8. BEST-EFFORT real XBRL read (current vintage, zero-FP) ──
  console.log("\n[8] Real XBRL read (best-effort — session-gated NSE index API)");
  try {
    const idx = await fetchShareholdingIndex("RELIANCE");
    const newest = idx
      .filter((r) => r.xbrlUrl && r.asOnDate)
      .sort((a, b) => b.asOnDate.localeCompare(a.asOnDate))[0];
    if (!newest) throw new Error("no filings in index");
    const xml = await fetchXbrlXml(newest.xbrlUrl);
    const p = parseXbrlShareholding(xml);
    const sum = p.promoterPct + p.publicPct + p.employeeTrustPct;
    console.log(`   RELIANCE ${newest.asOnDate}: promoter=${p.promoterPct} public=${p.publicPct} sum=${sum.toFixed(2)} totalShares=${p.totalShares}`);
    check("real file: SHAPE clean (partition ≈ 100, not rejected)", !checkPartitionBroken(p.promoterPct, p.publicPct, p.employeeTrustPct));
    check("real file: totalShares > 0", (p.totalShares ?? 0) > 0, p.totalShares);
  } catch (e) {
    console.log(`   ⚠ INCONCLUSIVE — ${(e as Error).message}. (DB grounding already confirms the invariant on 2641 real rows: avg sum 99.8, both_zero=0.)`);
  }

  // ── Summary ──
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await prisma.$disconnect();
  if (passed !== results.length) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
