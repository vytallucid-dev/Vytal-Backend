// File: src/scoring/findings/evidence.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE EVIDENCE BAG — the payload column every fired finding carries, typed ONCE.
//
// ── ★ WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
// `evidence` / `triggeringValues` reach the wire as Prisma `JsonValue`, and every served shape typed
// them `unknown`. That is not a neutral choice: it pushes the narrowing onto each consumer, so
// `asObj(...)`, `(p.evidence as { leg?: string } | null)` and `evidence as R1Vals` are all
// hand-written re-derivations of the same fact, in different files, with no shared answer for what a
// malformed row should do. Two channels × six queued consumers is where that stops scaling.
//
// So the narrowing happens at the READ layer, once, and both channels serve the narrowed type.
//
// Measured across the live tables (11,040 score_patterns + 215 score_red_flags + 481 fired
// stock_findings rows): evidence / triggeringValues are ALWAYS a plain JSON object — 0 arrays, 0
// scalars, 0 exceptions. Nullable: a not_fired / not_evaluable filing row carries none.
//
// ⚠ A MALFORMED VALUE NARROWS TO `null`, NEVER TO `{}`. An empty bag reads as "the rule fired and had
// nothing to say"; null reads as "there is no bag here". A row we cannot parse is the second
// statement, and collapsing it into the first is how an unreadable record becomes a positive claim.
//
// ── ⚠ THERE WAS A SECOND COLUMN HERE: `metricRefs` (removed 2026-08-10) ───────────────────────────
// It was an ARRAY OF STRINGS, not a bag, and this file carried `MetricRefs` / `asMetricRefs` to say
// so. The shape claim was right and the column was still dead: 53 rules stamped one, four read sites
// narrowed and served it, and NOTHING ever read a value back. It also held three unrelated
// vocabularies under one name — pillar names, raw camelCase source fields, and the lens metric-slot
// codes — which is why its one live consumer (the grounding block) printed raw identifiers at the
// model. Narrowing a field correctly is not the same as the field earning its place.
//
// ⚠ KEEP THIS FILE IMPORT-FREE. Both wire-contract modules (health-view.types.ts, filing/read.types.ts)
// import the TYPES from here, and both are walked by verify-build-gate-hygiene's transitive-import
// check — a single runtime import added here would hand a live Prisma client to every build gate that
// reads a finding contract.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A fired finding's own numbers — the object a rule stamped at fire time, which `renderVerdict`
 * interpolates and a card renders as pips. `null` when the row carries none (a not_fired row) or
 * when the stored value is not an object.
 */
export type EvidenceBag = Record<string, unknown> | null;

/** Narrow a stored JSON value to an {@link EvidenceBag}. An array or a scalar is not a bag → null. */
export function asEvidenceBag(v: unknown): EvidenceBag {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
