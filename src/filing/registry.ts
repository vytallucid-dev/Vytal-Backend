// File: src/filing/registry.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FILING REGISTRY — the ONE table that names all 22 rules with their catalogue key, their finding
// kind, and the filing grain their rows are keyed on.
//
// ── WHY THIS TABLE HAS TO EXIST, AND WHY IT IS ONE TABLE ─────────────────────────────────────────
// The scoring pass only ever persists findings that FIRED, so a fired finding carries its own key and
// nothing else is needed. The filing pass writes a row for every rule that EVALUATED — including the
// ones that ran and found nothing. A not_fired rule returns `null`: no key, no kind, no evidence. The
// row still needs `rule_key` (it is part of the unique constraint) and `kind`.
//
// Three parallel maps would drift. One entry per rule, with a length assertion against FILING_RULES,
// cannot: adding a rule to the pass without naming its key and grain does not compile.
//
// ── THE GRAINS ────────────────────────────────────────────────────────────────────────────────────
// Step 1's period_key convention: "<grain>:<period>", with period_end carrying the real ordering.
//   A:FY26    ANNUAL           — the rule read `annualFundamentals`. Keyed on the fiscal year.
//   Q:FY26Q3  RESULTS QUARTER  — the rule read `quarterlyResults` / `quarterlyOpm`.
//   S:FY26Q3  SHAREHOLDING Q   — the rule read `shareholding`.
//
// P6 and H read the INSIDER and BLOCK-DEAL feeds, which are dated event streams with no filing
// period of their own. They take grain S because both already ANCHOR their trailing window on the
// latest shareholding filing's as-on date (see those rule files) — the shareholding quarter is
// genuinely the period they evaluated over, not a convenience. A dated grain would be a fourth
// convention invented for a window that is already quarter-bounded.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import {
  FILING_RULES,
  SHAREHOLDING_RULES,
  ANNUAL_RULES,
  QUARTERLY_RULES,
  FEED_RULES,
  ruleRefOf,
} from "../scoring/findings/engine.js";
import type { FilingRule } from "../scoring/findings/types.js";
import type { FilingGrain } from "./period.js";
import type { StockFindingKey } from "../catalogue/stock-findings.js";
import { ruleR1 } from "../scoring/findings/rules/r1-pledging.js";
import { ruleR2 } from "../scoring/findings/rules/r2-promoter-exit.js";
import { ruleR3 } from "../scoring/findings/rules/r3-earnings-quality.js";
import { ruleR4 } from "../scoring/findings/rules/r4-debt-explosion.js";
import { ruleR5 } from "../scoring/findings/rules/r5-interest-coverage.js";
import { ruleR6 } from "../scoring/findings/rules/r6-distribution.js";
import { ruleN1 } from "../scoring/findings/rules/n1-cash-backed-earnings.js";
import { ruleN2 } from "../scoring/findings/rules/n2-working-capital.js";
import { ruleN3 } from "../scoring/findings/rules/n3-deleveraging.js";
import { ruleN4 } from "../scoring/findings/rules/n4-coverage-strengthening.js";
import { ruleN5 } from "../scoring/findings/rules/n5-dual-institutional-build.js";
import { ruleN6 } from "../scoring/findings/rules/n6-promoter-accumulation.js";
import { ruleN7 } from "../scoring/findings/rules/n7-pledge-release.js";
import { ruleP1 } from "../scoring/findings/rules/p1-clean-rotation.js";
import { ruleP4 } from "../scoring/findings/rules/p4-dual-exit.js";
import { ruleP6 } from "../scoring/findings/rules/p6-insider-conviction.js";
import { ruleP7 } from "../scoring/findings/rules/p7-accruals.js";
import { ruleP8 } from "../scoring/findings/rules/p8-receivables.js";
import { ruleP11 } from "../scoring/findings/rules/p11-margin-compression.js";
import { ruleP12 } from "../scoring/findings/rules/p12-margin-recovery.js";
import { ruleP13 } from "../scoring/findings/rules/p13-revenue-inflection.js";
import { ruleH } from "../scoring/findings/rules/h-ownership-events.js";

// The grain union is declared in period.ts (which has no imports) and re-exported here so existing
// callers are unaffected — see the note on FilingGrain for why it cannot live in this file.
export type { FilingGrain } from "./period.js";

/**
 * ★ WHICH INGESTION MOVING SHOULD RECOMPUTE THIS RULE (step 6).
 *
 * The GRAIN says which period a row is keyed on. The FEED says what has to change for the row to be
 * worth recomputing. They are not the same axis and conflating them is what step 6 exists to undo:
 * P6 and H used to be grain S because they anchored on the shareholding filing, but they are driven
 * by the daily insider and block-deal feeds and have nothing to do with a shareholding upload.
 *
 * A trigger recomputes exactly the rules whose feed moved. Everything else on the stock keeps the row
 * it already has — a shareholding upload has no business rewriting a receivables verdict.
 */
export type FilingFeed = "shareholding" | "annual" | "quarterly" | "insider" | "blocks";

export interface FilingRuleEntry {
  rule: FilingRule;
  /** The engine's stable short ref ("P8"), from RULE_REFS. Denormalised onto every row. */
  ruleRef: string;
  /** The catalogue key — part of the (stock, rule, period) identity, present on not_fired rows too. */
  ruleKey: StockFindingKey;
  /** A rule property, true whether or not it fired this period. */
  kind: "red_flag" | "pattern";
  grain: FilingGrain;
  /** The ingestion whose arrival makes this rule worth re-running. See {@link FilingFeed}. */
  feed: FilingFeed;
}

const entry = (
  rule: FilingRule,
  ruleKey: StockFindingKey,
  kind: "red_flag" | "pattern",
  grain: FilingGrain,
  feed: FilingFeed,
): FilingRuleEntry => ({
  rule,
  ruleRef: ruleRefOf(rule),
  ruleKey,
  kind,
  grain,
  feed,
});

export const FILING_REGISTRY: readonly FilingRuleEntry[] = [
  // ── SHAREHOLDING FILING ──────────────────────────────────────────────────────────────────────
  entry(ruleR1, "ownership_R1_pledge", "red_flag", "S", "shareholding"),
  entry(ruleR2, "ownership_R2_promoter_exit", "red_flag", "S", "shareholding"),
  entry(ruleR6, "ownership_R6_distribution", "red_flag", "S", "shareholding"),
  entry(ruleP1, "ownership_P1_clean_rotation", "pattern", "S", "shareholding"),
  entry(ruleP4, "ownership_P4_dual_exit", "pattern", "S", "shareholding"),
  entry(ruleN5, "ownership_N5_dual_institutional_build", "pattern", "S", "shareholding"),
  entry(ruleN6, "ownership_N6_promoter_accumulation", "pattern", "S", "shareholding"),
  entry(ruleN7, "ownership_N7_pledge_release", "pattern", "S", "shareholding"),
  // ── ANNUAL ACCOUNTS ──────────────────────────────────────────────────────────────────────────
  entry(ruleR3, "foundation_R3_earnings_quality", "red_flag", "A", "annual"),
  entry(ruleR4, "foundation_R4_debt_explosion", "red_flag", "A", "annual"),
  entry(ruleP7, "foundation_P7_accruals", "pattern", "A", "annual"),
  entry(ruleP8, "foundation_P8_receivables", "pattern", "A", "annual"),
  entry(ruleN1, "foundation_N1_cash_backed_earnings", "pattern", "A", "annual"),
  entry(ruleN2, "foundation_N2_working_capital", "pattern", "A", "annual"),
  entry(ruleN3, "foundation_N3_deleveraging", "pattern", "A", "annual"),
  // ── QUARTERLY RESULTS ────────────────────────────────────────────────────────────────────────
  entry(ruleR5, "foundation_R5_interest_coverage", "red_flag", "Q", "quarterly"),
  entry(ruleN4, "foundation_N4_coverage_strengthening", "pattern", "Q", "quarterly"),
  entry(ruleP11, "momentum_P11_margin_compression", "pattern", "Q", "quarterly"),
  entry(ruleP12, "momentum_P12_margin_recovery", "pattern", "Q", "quarterly"),
  entry(ruleP13, "momentum_P13_revenue_inflection", "pattern", "Q", "quarterly"),
  // ── FEED-DRIVEN · ROLLING WINDOW (grain W — see the note on FilingGrain) ─────────────────────
  // These two moved off grain S in step 6. They read DATED EVENT STREAMS, their windows end at the
  // evaluation date rather than at a filing, and each is driven by its own daily feed — so a
  // shareholding upload no longer recomputes them and a deal no longer recomputes the pledging rules.
  entry(ruleP6, "ownership_P6_insider_conviction", "pattern", "W", "insider"),
  entry(ruleH, "ownership_H_block_events", "pattern", "W", "blocks"),
];

/** The rules one feed drives. The trigger's whole job, expressed against the registry. */
export const filingRulesForFeeds = (feeds: readonly FilingFeed[]): FilingRuleEntry[] => {
  const want = new Set(feeds);
  return FILING_REGISTRY.filter((e) => want.has(e.feed));
};

/** ★ THE ROLLING-WINDOW RULES — the ones that can stop being true with no new data at all, because
 *  their window moves under them. They are the reason a daily pass exists; see filing/pass.ts. */
export const ROLLING_WINDOW_FEEDS: readonly FilingFeed[] = ["insider", "blocks"];

// ── ★ THE COMPLETENESS GATE ───────────────────────────────────────────────────────────────────────
// A rule added to FILING_RULES but not to the table above would run and then have nowhere to write —
// it would silently vanish from every stock's row set. These assertions run at module load, so that
// is a boot failure, not a quiet gap discovered months later in a backfill.
const REGISTERED = new Set(FILING_REGISTRY.map((e) => e.rule));
const missing = FILING_RULES.filter((r) => !REGISTERED.has(r)).map(ruleRefOf);
if (missing.length) {
  throw new Error(
    `filing/registry.ts: ${missing.length} rule(s) in FILING_RULES have no registry entry [${missing.join(", ")}] — ` +
    `each needs its catalogue key, kind and period grain before the pass can write its rows.`,
  );
}
if (FILING_REGISTRY.length !== FILING_RULES.length) {
  throw new Error(
    `filing/registry.ts: ${FILING_REGISTRY.length} entries vs ${FILING_RULES.length} rules in FILING_RULES — an entry names a rule that is not registered to run.`,
  );
}
const dupKeys = FILING_REGISTRY.map((e) => e.ruleKey).filter((k, i, a) => a.indexOf(k) !== i);
if (dupKeys.length) {
  throw new Error(`filing/registry.ts: duplicate ruleKey(s) [${[...new Set(dupKeys)].join(", ")}] — the (stock, rule_key, period_key) identity would collide.`);
}
const unknownRefs = FILING_REGISTRY.filter((e) => e.ruleRef === "unknown_rule").map((e) => e.ruleKey);
if (unknownRefs.length) {
  throw new Error(`filing/registry.ts: no RULE_REFS entry for [${unknownRefs.join(", ")}] — add it in findings/engine.ts.`);
}

/** Grain membership, cross-checked against the engine's own grouping so the two cannot drift.
 *  ⚠ FEED_RULES maps to W, not S (step 6) — the group is P6 + H, whose windows end at the evaluation
 *  date and therefore belong to no filing period. SHAREHOLDING_RULES still contains them in the
 *  engine's grouping (they read the shareholding series for nothing now), so they are excluded there
 *  by the FEED_RULES pass running last and by the explicit exemption below. */
const FEED_RULE_SET = new Set<FilingRule>(FEED_RULES);
const GRAIN_BY_GROUP: [FilingRule[], FilingGrain][] = [
  [SHAREHOLDING_RULES.filter((r) => !FEED_RULE_SET.has(r)), "S"],
  [ANNUAL_RULES, "A"],
  [QUARTERLY_RULES, "Q"],
  [FEED_RULES, "W"],
];
for (const [group, grain] of GRAIN_BY_GROUP) {
  for (const r of group) {
    const e = FILING_REGISTRY.find((x) => x.rule === r);
    if (e && e.grain !== grain) {
      throw new Error(`filing/registry.ts: ${e.ruleRef} is grouped as grain ${grain} in engine.ts but registered as ${e.grain} here.`);
    }
  }
}

export const filingEntryByRef = (ref: string): FilingRuleEntry | undefined =>
  FILING_REGISTRY.find((e) => e.ruleRef === ref);
