// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RETIRED FINDING KEYS — the suppression registry. NET-NEW; there was no such mechanism.
//
// ── ★ THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────────
// Deregistering a rule stops it FIRING. It does not stop it SHOWING. A persisted score_patterns row
// whose key no longer exists in the catalogue still renders, fully and confidently:
//     name         findingName() falls back to a humanised key → "C1 price ahead"
//     boundary     doesntMean() falls back to the family line via familyOf() → never blank
//     sentence     renderVerdict() falls through to the string the RULE ITSELF wrote into
//                  evidence.verdict at fire time → a complete, fluent, obsolete verdict
// So a retired finding degrades into a slightly-worse-looking finding, not into silence.
//
// And it does not age out on its own. Findings FK the snapshot, the read layer reads the HEAD, and
// rescore is FINGERPRINT-GATED: a stock whose scoring inputs have not moved writes no new snapshot
// and therefore keeps its old fired set indefinitely. One of the 95 heads has been stale since
// 2025-09-30. Without suppression, that stock would show retired C-family cards for as long as its
// inputs sit still — which could be forever.
//
// ── ★ WHY THERE IS NO COPY HERE, AND WHY THAT IS THE POINT ────────────────────────────────────────
// The catalogue's existing stance (types.ts, KeyStatus): "RETIRED keys are NOT a status: they are
// ABSENT. A deregistered rule cannot fire again, so carrying copy for it would be carrying a lie."
// That stance is right and is preserved. A retired key is REMOVED from STOCK_FINDING_KEYS — so it has
// no name, no description and no boundary — and listed here instead. The read layer's job is to drop
// the row, not to describe it. Authoring copy for a retired finding would be authoring an explanation
// for something we have decided is not true.
//
// ── ★ SUPPRESSION IS AT READ. PERSISTED ROWS ARE NEVER DELETED. ───────────────────────────────────
// History stays intact and auditable: the rows remain in score_patterns exactly as written, so a
// point-in-time reconstruction of "what did we say about this stock in FY25Q4" still works, and the
// retirement itself is reversible. What changes is only what a READER is shown today.
//
// ── ★ WHERE THE FILTER IS APPLIED, AND WHY NOT A PRISMA CLIENT EXTENSION ──────────────────────────
// A `prisma.$extends` query filter on scorePattern/redFlag would be one line and would cover every
// Prisma read automatically — but it was rejected for three concrete reasons:
//   1. It would NOT cover the raw-SQL readers (relational/base-rates.ts and relational/
//      reader-context.ts both hit score_patterns through $queryRaw), so it is not actually total —
//      it just LOOKS total, which is worse than a filter you can see.
//   2. alerts/finding-catalog.ts must still SEE retired keys in live data, precisely so it can refuse
//      an alert on them with "that is retired" instead of "unknown key". A global filter would blind
//      the one caller that needs sight.
//   3. It would hide the rows from audit and migration tooling, where the honest question "how many
//      stale retired rows are still out there" must remain answerable.
// So the predicate lives here, once, and is applied EXPLICITLY at each read boundary. The list of
// boundaries is enumerated in the build report and guarded by scripts/verify-sql-predicates.ts, which
// asserts the fragment's shape and checks that every raw-SQL caller splices it correctly.
// ⚠ An earlier version of this comment named `scripts/verify-retirement.ts`. That file was never
//   written, so the "guarded" claim was false for the whole life of this module — which is precisely
//   how the reader-context.ts parameter-binding defect survived undetected.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Keys that a rule once emitted and no longer does. Ordered by retirement wave.
 *
 * ⚠ ADDING A KEY HERE IS HALF THE JOB. The other half is removing it from STOCK_FINDING_KEYS (so it
 * carries no copy) and removing its rule from ALL_RULES (so it cannot fire again). verify-catalogue.ts
 * asserts the first; the engine's own registry is the second.
 */
export const RETIRED_FINDING_KEYS = [
  // ── Wave 1 · consolidated into other rules (pre-existing; files kept, never registered) ──
  "ownership_P2_distribution_retail", // → R6 (distribution)
  "ownership_P3_promoter_stress",     // → R1 (pledging)

  // ── Wave 2 · the C/G divergence rebuild. Each is superseded, not merely switched off. ──
  // C1: Market − mean(F,M) ≥ 25 with NO absolute-level test — a different instrument from D1/D2,
  //     which key on Market ≥ 74 against a fundamental pillar below 58.
  "divergence_C1_price_ahead",
  // C2: a STANDING Own↔F gap. §1.1 is explicit that "Ownership patterns use movement, not a standing
  //     gap". It also wrote direction "negative" on both legs, mis-signing the constructive one.
  //     → D3 (positive) / D4.
  "divergence_C2_ownership_vs_fundamentals",
  // C3: |F−M| ≥ 25, SINGLE-SNAPSHOT, direction "negative" in both directions, and a hardcoded
  //     `const wide = true` that pinned severity permanently high. → S2, which actually sustains.
  "divergence_C3_floor_trajectory_split",
  // C-over-time: a widening-spread pattern. EXCLUDED — generic widening spread reads −1.1%, 44%
  //     positive (n=365), and INVERTS in banks (+5.6%, 74% positive).
  "divergence_C_over_time_widening",
  // G: a narrowing-spread pattern. EXCLUDED — +0.2%, 51% positive (n=239), "indistinguishable from
  //     nothing". ⚠ Its RESOLUTION TYPING survives as findings/divergence/resolution.ts.
  "trajectory_G_convergence",

  // ── Wave 3 · the B/D/I trajectory rebuild (→ T1–T9). ──────────────────────────────────────────
  // These three are MULTI-LEG rules firing EXCLUDED conditions under one key. Between them they fire
  // five of the eight conditions on the Trajectory spec's Part-5 excluded list — every one
  // bull-masked, every one having tested POSITIVE:
  //
  //   composite ↓68   B's first-checked composite branch (the default path)  +11.3% (HOT +18.7%)
  //   composite ↓62   I (into_below_par)                                     +5.4%
  //   Foundation ↓72  B's pillar leg    "the starkest bull-masking in the set" +16.9% (HOT +24.9%)
  //   Momentum ↑54    D's pillar leg — as severity `recovery`, direction positive  +2.4%, 57%
  //   Momentum ↓75    B's pillar leg, BARE                                    −0.2%, 48% — flat
  //
  // The bare Momentum ↓75 is worth naming precisely: only the PAIRED form (with Foundation ≥72) is
  // meaningful, and that is D6, built in Phase 2. B fired the unpaired version.
  // Their remaining legs — Market ↓74, Ownership ↓72, Market ↑50, Ownership ↑60, composite ↑68 — are
  // on neither list: simply untested. They fail the spec's own admission test ("does it survive the
  // phase split, and can you say why it moves the way it does?"), so they go with the rules.
  //
  // ⚠ RETIRING D ALSO FIXES A LIVE DEFECT. Its pillar loop `break`s on first match inside the
  // composite branch's `else`, so a stock recovering on Foundation, Momentum AND Market persisted ONE
  // finding naming only Foundation — the other two left no trace anywhere. T5/T7/T8 are separate
  // per-pattern rules, so the defect cannot recur by construction.
  "trajectory_B_deterioration",
  "trajectory_D_recovery",
  "trajectory_I_band_transition",
] as const;

export type RetiredFindingKey = (typeof RETIRED_FINDING_KEYS)[number];

const RETIRED: ReadonlySet<string> = new Set(RETIRED_FINDING_KEYS);

/** Is this key retired — i.e. must a persisted row carrying it be dropped before a reader sees it? */
export const isRetiredFinding = (key: string): boolean => RETIRED.has(key);

/**
 * Drop retired rows from a fired set. Generic over the caller's row type so a per-stock finding, a
 * census row, a watchlist row and an alert key all use the same predicate without adopting a shared
 * shape.
 *
 * `keyOf` defaults to nothing on purpose — every call site names the field it is filtering on
 * (patternKey / flagKey / key), which keeps the filter greppable at each boundary.
 */
export function dropRetired<T>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  return rows.filter((r) => !isRetiredFinding(keyOf(r)));
}

/** Convenience for the many sites holding `{ patternKey }` rows. */
export const dropRetiredPatterns = <T extends { patternKey: string }>(rows: readonly T[]): T[] =>
  dropRetired(rows, (r) => r.patternKey);

// ⚠ `dropRetiredFlags` LIVED HERE AND WAS REMOVED 2026-08-11, with score_red_flags. Every persisted
//   red-flag row now comes from the filing pass, which writes one row per REGISTERED rule — and the
//   two retired flag keys (P2 → R6, P3 → R1) are unregistered by construction, so a retired key can
//   no longer reach a red-flag row at all. The suppression is enforced by the writer, not the reader.
//   `dropRetired` and `dropRetiredPatterns` are untouched: score_patterns DOES still carry retired rows.

/**
 * A SQL fragment for the two raw-SQL readers, so they enforce the same list rather than a copy of it.
 * Returns e.g. `p.pattern_key NOT IN ('a','b')`. Keys are compile-time literals from the array above
 * — no user input reaches this, and the quoting is asserted by scripts/verify-sql-predicates.ts.
 *
 * ⚠ THE RETURN IS SQL TEXT, AND `string` IS NOT SELF-ENFORCING. How a caller must splice it depends
 * entirely on which raw API it is feeding, and the two look identical on the page:
 *
 *   $queryRawUnsafe  — build a PLAIN template literal. `${predicate}` splices SQL text.   ✅
 *   $queryRaw / $executeRaw (TAGGED template) — `${predicate}` BINDS A PARAMETER. The statement
 *                      becomes `WHERE $1`, Postgres wants a boolean where a text value arrived, and
 *                      the query dies with 22P02. Wrap it: `${Prisma.raw(predicate)}`.              ⚠
 *
 * This is not hypothetical. relational/reader-context.ts shipped the unwrapped form on 2026-08-02 and
 * silently dropped the whole UE echo family for seven days — the census catches its own error and
 * returns null, so the card kept rendering and nothing surfaced. Callers are held to the rule by
 * scripts/verify-sql-predicates.ts, which statically checks every reference to this helper.
 */
export function retiredKeysSqlPredicate(column: string): string {
  const list = RETIRED_FINDING_KEYS.map((k) => `'${k}'`).join(", ");
  return `${column} NOT IN (${list})`;
}
