// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE PHS STRUCTURAL CHECK — what a catalogue/analytics harness may legitimately assert about PHS.
//
// ── WHY THIS EXISTS (the ruling it implements) ────────────────────────────────────────────────
// verify-step9-amfi and verify-step10c-sharpe used to PIN A VALUE: "arman = 66, aman = 51". That
// was MIS-SPECIFIED, not merely stale. The PHS is a LIVE, MARKET-DRIVEN OUTPUT: the EOD price cron
// fires pg_rescore → new ScoreSnapshots → the PHS recomputes. Aman's own history oscillates
// 51→50→51→50 on price ticks alone. A pinned value is therefore STRUCTURALLY GUARANTEED to go red
// on the next tick, and re-baselining it to 67/50 just buys a green run that breaks tomorrow.
//
// The drift was traced and is RESOLVED (price-driven rescore — see probe-phs-drift-timeline.ts).
// It was never a bug. So the value pins are REMOVED, and replaced with the claim these harnesses
// are actually entitled to make:
//
//     THE PHS PIPELINE WORKS — it computes for the test users, yields a non-null score in the
//     valid range with a valid band, and is not silently degenerate.
//
// That asserts the machinery WITHOUT pinning the number the machinery is designed to move.
//
// ── WHY IT COMPUTES RATHER THAN READS BACK ────────────────────────────────────────────────────
// This does NOT read the latest persisted snapshot. Reading a stored row would prove only that a
// row exists — it would stay green even if the pipeline had rotted, because the row is a fossil of
// the last time it worked. So it EXERCISES the real thing: assemblePortfolio() → computePhs().
// Both are read-only and pure (grep-proven: zero create/update/upsert/delete in either), so this
// writes NOTHING — no snapshot row, no fingerprint churn, no trace.
//
// ── WHAT IT STILL CATCHES ─────────────────────────────────────────────────────────────────────
// A broken PHS COMPUTATION: no holdings assembled, coverage collapsed to zero, a null score, a
// score out of [0,100], an unrecognised band. verify-step9-mutation-test.ts (M6) proves this by
// zeroing the users' prices and confirming this check goes RED.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { prisma } from "../db/prisma.js";

/** The five bands constants.ts:bandOf() can return. Anything else is a broken mapping. */
export const VALID_BANDS = ["Strong", "Steady", "Mixed", "Fragile", "Weak"] as const;

/** The users whose books these harnesses exercise. Their SCORES are not asserted — only that the
 *  pipeline produces one. Identity is stable; the number is not, and that is the whole point. */
export const PHS_TEST_USERS = [
  "arman.shaikh01082003@gmail.com",
  "amankamaljain@gmail.com",
];

export interface PhsStructuralResult {
  email: string;
  ok: boolean;
  detail: string;
  /** The live value — REPORTED for the operator, never asserted. */
  health: number | null;
  band: string | null;
}

/**
 * Exercise the PHS pipeline for one user and assert it STRUCTURALLY.
 * Read-only: assemblePortfolio + computePhs write nothing.
 */
export async function checkPhsStructural(email: string): Promise<PhsStructuralResult> {
  const u = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (!u) return { email, ok: false, detail: "NO SUCH USER — the fixture itself is gone", health: null, band: null };

  const { holdings } = await assemblePortfolio(u.id);
  const r = computePhs(holdings);

  const health = r.health;
  const band = r.band;

  // Each failure below is a BROKEN PIPELINE, not a moved number.
  const fails: string[] = [];
  if (holdings.length === 0) fails.push("assembled ZERO holdings (the book did not load)");
  if (!r.evaluable) fails.push("evaluable=false (coverage collapsed to 0 — nothing scorable)");
  if (health === null) fails.push("health is NULL despite an evaluable book");
  if (health !== null && !Number.isFinite(health)) fails.push(`health is not finite (${health})`);
  if (health !== null && Number.isFinite(health) && (health < 0 || health > 100))
    fails.push(`health ${health} is OUTSIDE the valid range [0,100]`);
  if (band === null) fails.push("band is NULL despite an evaluable book");
  if (band !== null && !VALID_BANDS.includes(band as (typeof VALID_BANDS)[number]))
    fails.push(`band "${band}" is not one of ${VALID_BANDS.join("|")}`);
  if (!(r.coverage > 0 && r.coverage <= 1)) fails.push(`coverage ${r.coverage} outside (0,1]`);

  const ok = fails.length === 0;
  return {
    email,
    ok,
    health,
    band,
    detail: ok
      ? `PHS pipeline COMPUTES — ${holdings.length} holdings → health=${health} (in [0,100]), band=${band}, ` +
        `coverage=${r.coverage.toFixed(3)}. Value REPORTED, deliberately NOT asserted: it moves with the market.`
      : `BROKEN: ${fails.join("; ")}   [holdings=${holdings.length} health=${health} band=${band} coverage=${r.coverage}]`,
  };
}
