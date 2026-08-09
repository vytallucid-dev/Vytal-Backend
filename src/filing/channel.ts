// File: src/filing/channel.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CHANNEL OWNERSHIP — "which channel is this finding key served from?", asked at each read boundary.
//
// ── ★ THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────────
// score_patterns / score_red_flags are APPEND-ONLY and version WITH the snapshot. The rows the 21
// filing rules wrote while they still ran inside computePgScores are frozen on each stock's current
// head: 86 of them, across 58 of the 95 scored stocks. Step 2 stopped writing new ones. It could not
// un-write the old ones, and a fingerprint-gated rescore may not come for a stock whose inputs sit
// still — one head has been stale since 2025-09-30.
//
// Step 3 then opened the filing channel on the same surfaces. So every one of those 86 findings is now
// served TWICE on the same page, from two tables, with two different periods: the score card carries
// the SNAPSHOT's quarter and the filing card carries the FILING's own. Same company, same rule, one
// screen, two dates.
//
// ── ★ THE PREDICATE IS THE REGISTRY. THERE IS NO LIST HERE. ───────────────────────────────────────
// A hardcoded key list would be a second source of truth and would be wrong the first time a rule
// moves between passes — silently, because a missed key does not error, it just renders twice again.
// FILING_REGISTRY is the one table naming the 22, and filing/pass.ts writes rows from that same table,
// so "what the filing pass owns" and "what the score channel must not serve" cannot drift apart.
//
// ── ★ SUPPRESSION IS AT READ. NO ROW IS DELETED. ─────────────────────────────────────────────────
// Exactly the stance catalogue/retired-findings.ts takes, for the same reasons: history stays intact
// and auditable, a point-in-time reconstruction of "what did we say about this stock in FY26Q4" still
// works, and the change is reversible. What changes is only what a READER is shown today.
//
// ── ⚠ WHERE THIS IS APPLIED, AND — MORE IMPORTANTLY — WHERE IT IS NOT ─────────────────────────────
// It is applied ONLY at boundaries that serve BOTH channels, because only there does removing a row
// remove a DUPLICATE rather than a fact:
//
//   health-view.service.ts     the stock page (and through it get-stock-facts + the AI grounding block)
//   symbol-findings.service.ts the chat's batch findings read
//   watchlist-enrich.ts        the watchlist rows
//   alerts/eval-pass.ts        the finding-alert diff — see the note there; the filing channel now
//                              supplies these keys, so a frozen snapshot row must not also.
//
// It is deliberately NOT applied to universe-view, peer-group-view, the screener, tool-scan or
// reader-context. Those are SCORE-POPULATION aggregates: they serve the score channel and do not serve
// the filing channel at all, so a filing key filtered there disappears from BOTH and the surface is
// left claiming the finding fires nowhere. Measured on live data, not assumed — filtering them would
// take the universe pathology census from 31 rows to 17, remove ALL FOUR of its red-flag rows, and
// drop the screener's `redFlags: "any"` result set from 6 members to 0. Those surfaces get the filing
// channel when they get a 504-stock denominator to put it in, which is step 5's base rates.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { FILING_REGISTRY } from "./registry.js";

/** The 22 catalogue keys the filing pass owns, projected from the registry — never transcribed. */
const FILING_CHANNEL_KEYS: ReadonlySet<string> = new Set(FILING_REGISTRY.map((e) => e.ruleKey));

/**
 * Is this key served by the FILING channel — i.e. must a persisted score_patterns / score_red_flags
 * row carrying it be dropped before a reader sees it, because the filing channel is already showing
 * the same finding on the same surface?
 */
export const isFilingChannelKey = (key: string): boolean => FILING_CHANNEL_KEYS.has(key);

/**
 * Drop filing-owned rows from a score-channel fired set. Generic over the caller's row type, so a
 * stock-page finding, a watchlist row and an alert key all use the same predicate without adopting a
 * shared shape — the same design as `dropRetired`, and for the same reason.
 *
 * `keyOf` is required rather than defaulted so every call site names the field it filters on
 * (patternKey / flagKey / key), which keeps the boundary greppable.
 */
export function dropFilingKeys<T>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  return rows.filter((r) => !isFilingChannelKey(keyOf(r)));
}

/** Convenience for the sites holding `{ flagKey }` rows. */
export const dropFilingFlags = <T extends { flagKey: string }>(rows: readonly T[]): T[] =>
  dropFilingKeys(rows, (r) => r.flagKey);

/** Convenience for the sites holding `{ patternKey }` rows. */
export const dropFilingPatterns = <T extends { patternKey: string }>(rows: readonly T[]): T[] =>
  dropFilingKeys(rows, (r) => r.patternKey);

/** The keys themselves, for the verification scripts and the census tooling. Not for filtering —
 *  use the predicate, so a call site cannot accidentally hold a stale copy of the set. */
export const filingChannelKeys = (): string[] => [...FILING_CHANNEL_KEYS].sort();
