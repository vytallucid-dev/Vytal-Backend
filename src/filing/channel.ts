// File: src/filing/channel.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CHANNEL OWNERSHIP — "which channel is this finding key served from?", asked at each read boundary.
//
// ── ★ THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────────
// score_patterns is APPEND-ONLY and versions WITH the snapshot. (score_red_flags sat beside it under
// the same rule and was dropped 2026-08-11 — no red-flag row is frozen anywhere now.) The rows the 21
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
// reader-context. Those are SCORE-POPULATION aggregates, and for PATTERNS they still serve the score
// channel alone — so a filing pattern key filtered there disappears from BOTH and the surface is left
// claiming the finding fires nowhere. Measured on live data, not assumed: filtering them would take
// the universe pathology census from 31 rows to 17.
//
// ★ THE RED-FLAG HALF OF THAT PARAGRAPH IS NOW OBSOLETE (2026-08-11). It used to add that filtering
//   would "remove ALL FOUR of its red-flag rows and drop the screener's `redFlags: \"any\"` set from 6
//   members to 0" — true while those surfaces read frozen score_red_flags rows. They now read the LIVE
//   filing channel directly (readStandingRedFlags), scoped to their own population, so there is no
//   frozen red-flag row anywhere for a filter to remove. The 504-stock denominator is still future
//   work: these surfaces see the ~94 scored members, not the 51 stocks with a standing red flag.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { FILING_REGISTRY } from "./registry.js";

/** The 22 catalogue keys the filing pass owns, projected from the registry — never transcribed. */
const FILING_CHANNEL_KEYS: ReadonlySet<string> = new Set(FILING_REGISTRY.map((e) => e.ruleKey));

/**
 * Is this key served by the FILING channel — i.e. must a persisted score_patterns row carrying it be
 * dropped before a reader sees it, because the filing channel is already showing the same finding on
 * the same surface?
 *
 * ⚠ Also read INVERTED by screen.service.ts — "the keys the live side owns" — so that what the filing
 * pass writes and what the screener unions in cannot drift apart.
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

// ⚠ `dropFilingFlags` LIVED HERE AND WAS REMOVED 2026-08-11, with score_red_flags. It existed to keep
//   frozen filing-rule RED-FLAG rows out of the score channel; there is no score channel red flag left
//   to keep out, because the table it filtered is gone and no rule writes one. The PATTERN half below
//   is untouched and still load-bearing: score_patterns DOES still carry frozen filing-rule rows.

/** Convenience for the sites holding `{ patternKey }` rows. */
export const dropFilingPatterns = <T extends { patternKey: string }>(rows: readonly T[]): T[] =>
  dropFilingKeys(rows, (r) => r.patternKey);

/** The keys themselves, for the verification scripts and the census tooling. Not for filtering —
 *  use the predicate, so a call site cannot accidentally hold a stale copy of the set. */
export const filingChannelKeys = (): string[] => [...FILING_CHANNEL_KEYS].sort();
