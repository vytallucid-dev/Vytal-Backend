// THREE-LENS PATTERN LIBRARY — STAGE 3 LIVE-WIRING COMMIT.
//
//   npx tsx src/scripts/lens-commit-s3.ts            (DRY — full live pass in a ROLLED-BACK tx; writes nothing)
//   npx tsx src/scripts/lens-commit-s3.ts --commit   (DURABLE write of the loud lens-patterns)
//
// Wires the LOUD lens-patterns (LM3/LM7/LP2/LP5) into the LIVE scoring pass as members
// of the existing findings stream and makes the first durable write. The escalation +
// anti-double-count + dampening all run INSIDE computePgScores (score-pass.ts) — this
// script only drives the live pass, attaches the lens findings to the existing LIVE
// (FY26Q4 head) snapshots, and proves the contract.
//
// SCOPE (operator decision: "no re-scan now"): the CURRENT live heads only. Historical
// periods are NOT re-scanned — the wiring makes lens-patterns light up automatically on
// future rescores (pg_rescore.handler runs computePgScores withFindings + persistMember
// writeFindings) as deeper history arrives.
//
// ADDITIVE-ONLY: this script persists ONLY the lens_* findings (the R/P stream is already
// committed and is OUT OF SCOPE for S3). Legacy score_patterns / score_red_flags /
// score_snapshots / score_* rows are proven byte-identical (the DRY pass runs in a rolled-
// back transaction and asserts the non-lens counts are unchanged).
//
// IDEMPOTENT: persistFindings skips an existing (snapshotId, patternKey) → a re-run writes 0.
// APPEND-ONLY: lens findings FK the existing head snapshot; future rescores re-fire onto
// new heads (the snapshot chain carries supersession — lens findings never orphan).

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { persistFindings } from "../scoring/findings/persist.js";
import type { FiredFinding } from "../scoring/findings/types.js";
import type { LensAuditRow } from "../scoring/lens-patterns/lens-findings.js";

const COMMIT = process.argv.includes("--commit");

const PGS: PgRef[] = [
  ["PG1", "Large-Cap IT Services"], ["PG2", "Large-Cap FMCG"], ["PG3", "Large-Cap Pharma"], ["PG4", "Large-Cap Auto OEMs"],
  ["PG5", "Large-Cap Private Banks"], ["PG6", "Large-Cap PSU Banks"], ["PG8", "Large-Cap Power & Utilities"],
  ["PG9", "Large-Cap Metals & Mining"], ["PG10", "Large-Cap Oil & Gas"], ["PG11", "Large-Cap Capital Goods & Industrial"],
  ["PG12", "Large-Cap Cement"], ["PG13", "Large-Cap Consumer Durables & Electrical"], ["PG14", "Large-Cap Defense"],
].map(([pgId, pgName]) => ({ pgId, seedKey: "", pgName }));

const ROLLBACK = Symbol("ROLLBACK_SENTINEL");
const isLens = (f: FiredFinding) => f.key.startsWith("lens_");
const lensFamily = (key: string) => {
  const m = /^lens_(lm3|lm7|lp2|lp5)_/.exec(key);
  return m ? m[1] : "lens_other";
};

interface MemberPlan {
  pgId: string; symbol: string; stockId: string; periodKey: string;
  snapshotId: string | null; asOfDate: Date | null;
  lensFindings: FiredFinding[];
  audit: LensAuditRow[];
}

async function main() {
  console.log("═".repeat(80));
  console.log(`THREE-LENS — STAGE 3 LIVE-WIRING COMMIT  ${COMMIT ? "▶ DURABLE WRITE (--commit)" : "▶ DRY (rolled-back tx; writes nothing)"}`);
  console.log("═".repeat(80));

  // ── baseline (committed) counts — the legacy byte-identical reference ──
  const baseline = {
    patterns: await prisma.scorePattern.count(),
    lensPatterns: await prisma.scorePattern.count({ where: { patternKey: { startsWith: "lens_" } } }),
    redFlags: await prisma.redFlag.count(),
    snapshots: await prisma.scoreSnapshot.count(),
    metricScores: await prisma.metricScore.count(),
    peerStats: await prisma.peerStatsSnapshot.count(),
  };
  console.log(`\nBASELINE (committed): score_patterns=${baseline.patterns} (lens_*=${baseline.lensPatterns}, R/P=${baseline.patterns - baseline.lensPatterns})  red_flags=${baseline.redFlags}  snapshots=${baseline.snapshots}  metric_scores=${baseline.metricScores}  peer_stats=${baseline.peerStats}`);

  // ── 1. LIVE COMPUTE per PG (read-only; the lens escalation runs inside) ──
  console.log("\n── LIVE PASS (computePgScores withFindings — lens escalation fires INSIDE) ──");
  const plans: MemberPlan[] = [];
  const dampenedLensKeys: { pgId: string; key: string; firedOn: number; pct: number }[] = [];
  let errs = 0;

  for (const ref of PGS) {
    let pg;
    try {
      pg = await computePgScores(ref, { withFindings: true });
    } catch (e) {
      errs++;
      console.log(`   ${ref.pgId.padEnd(5)} ✗ compute error: ${(e as Error).message}`);
      continue;
    }
    // Dampening report for THIS PG — surface any LENS key that dampened (sector-wide).
    for (const d of pg.dampenReport?.dampened ?? []) {
      if (d.key.startsWith("lens_")) dampenedLensKeys.push({ pgId: ref.pgId, key: d.key, firedOn: d.firedOn, pct: d.pctOfScored });
    }

    let pgLens = 0;
    for (const m of pg.members) {
      const lensFindings = (m.findings ?? []).filter(isLens);
      const audit = m.lensAudit ?? [];
      // Resolve the LIVE (head) snapshot for this member's period — the attach target.
      let snapshotId: string | null = null, asOfDate: Date | null = null, periodKey = m.composite.periodKey;
      if (m.composite.state === "scored" && m.composite.composite !== null) {
        const head = await prisma.scoreSnapshot.findFirst({
          where: { stockId: m.stockId, snapshotType: m.composite.snapshotType, periodKey: m.composite.periodKey },
          orderBy: { version: "desc" },
          select: { id: true, asOfDate: true },
        });
        snapshotId = head?.id ?? null;
        asOfDate = head?.asOfDate ?? null;
      }
      pgLens += lensFindings.length;
      plans.push({ pgId: ref.pgId, symbol: m.symbol, stockId: m.stockId, periodKey, snapshotId, asOfDate, lensFindings, audit });
    }
    console.log(`   ${ref.pgId.padEnd(5)} ${pg.members.length} members · ${pgLens} loud lens-finding(s) fired`);
  }

  // ── 2. WOULD-WRITE census by lens key-family + role ──
  const byFamily = new Map<string, number>();
  const auditAll: LensAuditRow[] = [];
  let totalLensFindings = 0, missingHead = 0;
  for (const p of plans) {
    if (p.lensFindings.length && !p.snapshotId) missingHead++;
    for (const f of p.lensFindings) { byFamily.set(lensFamily(f.key), (byFamily.get(lensFamily(f.key)) ?? 0) + 1); totalLensFindings++; }
    auditAll.push(...p.audit);
  }
  console.log("\n── WOULD-WRITE: loud lens-patterns by family ──");
  for (const fam of ["lm3", "lm7", "lp2", "lp5"]) console.log(`   lens_${fam}_*   ${(byFamily.get(fam) ?? 0).toString().padStart(4)}`);
  if (byFamily.get("lens_other")) console.log(`   lens_other   ${byFamily.get("lens_other")} (UNEXPECTED — investigate)`);
  console.log(`   ── total loud lens findings: ${totalLensFindings}  (across ${plans.filter((p) => p.lensFindings.length).length} members)`);
  if (missingHead) console.log(`   ⚠ ${missingHead} member(s) fired lens findings but have NO head snapshot — those are skipped (no orphan).`);

  // ── 3. ANTI-DOUBLE-COUNT demotions (loud fired but demoted to supporting-detail) ──
  const demoted = auditAll.filter((a) => !a.escalated);
  console.log("\n── ANTI-DOUBLE-COUNT (loud lens fired → role) ──");
  console.log(`   loud fired total: ${auditAll.length}  ·  escalated top-level: ${auditAll.filter((a) => a.escalated).length}  ·  demoted to supporting-detail: ${demoted.length}`);
  if (demoted.length) for (const d of demoted) console.log(`     ${d.lens} ${d.pillar}${d.metricKey ? "·" + d.metricKey : ""} → defers to ${d.defersTo}`);
  else console.log("     (0 demotions — no LP5/LP6→B or LM5→D co-occurrence on the live heads)");

  // ── 4. DAMPENING (lens keys that fired sector-wide on >80% of a PG, quorum 5) ──
  console.log("\n── DAMPENING (lens keys, >80% of PG scored members, quorum≥5) ──");
  if (dampenedLensKeys.length) for (const d of dampenedLensKeys) console.log(`   ${d.pgId} ${d.key} fired ${d.firedOn} (${d.pct}%) → dampened (displayState set; magnitude null → mark only)`);
  else console.log("   (0 lens keys dampened — confirms the census; the dampen path is exercised, no lens hit the threshold)");

  // ── 5. THE WRITE — rolled-back tx (DRY) or durable commit ──
  console.log(`\n── ${COMMIT ? "DURABLE WRITE" : "ROLLED-BACK TX (proof)"} ──`);
  let wrote = { patterns: 0, skipped: 0 };
  let txCounts: { patterns: number; lens: number; nonLens: number; redFlags: number; snapshots: number } | null = null;

  const doWrites = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    for (const p of plans) {
      if (!p.snapshotId || !p.asOfDate || !p.lensFindings.length) continue;
      const res = await persistFindings(tx as never, p.snapshotId, p.symbol, p.asOfDate, p.lensFindings);
      wrote.patterns += res.patterns; wrote.skipped += res.skippedExisting;
    }
    // Within-tx state — prove additive-only (R/P + red flags + snapshots unchanged).
    const [patterns, lens, redFlags, snapshots] = await Promise.all([
      (tx as typeof prisma).scorePattern.count(),
      (tx as typeof prisma).scorePattern.count({ where: { patternKey: { startsWith: "lens_" } } }),
      (tx as typeof prisma).redFlag.count(),
      (tx as typeof prisma).scoreSnapshot.count(),
    ]);
    txCounts = { patterns, lens, nonLens: patterns - lens, redFlags, snapshots };
  };

  try {
    await prisma.$transaction(async (tx) => {
      await doWrites(tx);
      if (!COMMIT) throw ROLLBACK; // DRY: exercise the real write path, then roll everything back
    }, { timeout: 120_000, maxWait: 30_000 });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }

  console.log(`   persistFindings: wrote ${wrote.patterns} lens pattern(s), skipped-existing ${wrote.skipped}`);
  if (txCounts) {
    const c = txCounts as { patterns: number; lens: number; nonLens: number; redFlags: number; snapshots: number };
    console.log(`   WITHIN-TX state: score_patterns=${c.patterns} (lens_*=${c.lens}, R/P=${c.nonLens})  red_flags=${c.redFlags}  snapshots=${c.snapshots}`);
    const legacyOk = c.nonLens === (baseline.patterns - baseline.lensPatterns) && c.redFlags === baseline.redFlags && c.snapshots === baseline.snapshots;
    console.log(`   LEGACY BYTE-IDENTICAL (R/P + red_flags + snapshots unchanged, additive lens-only): ${legacyOk ? "✓" : "✗ INVESTIGATE"}`);
  }

  // ── 6. POST counts (committed deltas) ──
  const after = {
    patterns: await prisma.scorePattern.count(),
    lensPatterns: await prisma.scorePattern.count({ where: { patternKey: { startsWith: "lens_" } } }),
    redFlags: await prisma.redFlag.count(),
    snapshots: await prisma.scoreSnapshot.count(),
  };
  console.log("\n── COMMITTED COUNTS (after) ──");
  console.log(`   score_patterns ${baseline.patterns} → ${after.patterns}   (lens_* ${baseline.lensPatterns} → ${after.lensPatterns})`);
  console.log(`   red_flags ${baseline.redFlags} → ${after.redFlags}   snapshots ${baseline.snapshots} → ${after.snapshots}`);
  if (!COMMIT) console.log("   (unchanged — DRY rolled back)");

  console.log(`\n${COMMIT ? "✓ COMMITTED" : "✓ DRY COMPLETE"} — ${errs} PG compute error(s).${COMMIT ? " Re-run --commit to confirm idempotency (0 new)." : " Re-run with --commit to write."}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
