// File: src/filing/read.types.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FILING-FINDINGS READ SHAPES — types only, NO runtime imports, and that is the whole point.
//
// ── WHY THIS IS A SEPARATE FILE ───────────────────────────────────────────────────────────────────
// `health-view.types.ts` is the canonical wire contract, imported by build gates that are supposed to
// be pure — `scripts/verify-build-gate-hygiene.ts` walks each gate's TRANSITIVE import closure and
// fails any gate that reaches the env module or the Prisma client without a declared reason.
//
// When these interfaces lived in `filing/read.ts` beside the query, health-view.types.ts imported a
// module that imports `db/prisma.js`, and two gates (verify-not-covered, verify-lens-separation)
// silently acquired a live DB client through a types-only import. The gate caught it immediately,
// which is what it is for. Splitting the shapes out is the fix: a type import now costs nothing at
// runtime, and the query stays in read.ts where it belongs.
//
// ⚠ KEEP THIS FILE RUNTIME-FREE. No prisma, no env, no catalogue lookups — only `import type`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { FilingGrain } from "./period.js";
import type { EvidenceBag } from "../scoring/findings/evidence.js";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★ THIS ROW SPEAKS THE FINDING VOCABULARY THE REST OF THE CODEBASE ALREADY SPEAKS.
 *
 * It used to speak its own: `ruleKey` where every other finding shape says `key`, and `"red flag"`
 * where the DB enum, the engine's `FindingKind`, `ObjectFinding` (relational), `PathologyCensusItem`
 * (peer-group), `PreparedFinding` (frontend) and all 22 registry entries say `"red_flag"`.
 *
 * ── WHY THE FILING SIDE MOVED, AND NOT THE OTHER ONE ──────────────────────────────────────────────
 * `red_flag` is not a preference, it is the value in `stock_findings.kind` — the column THIS view
 * reads. The space form was introduced at the serialisation boundary and existed nowhere behind it,
 * which is why `peer-group-view.service.ts` had to translate it straight back (`f.kind === "red flag"
 * ? "red_flag" : "pattern"`) to build a census row. One channel inventing a second spelling for a
 * value it read from a column, so that the next consumer can spell it back — that is the whole defect.
 *
 * ⚠ AND THE UNDERSCORE IS LOAD-BEARING, NOT COSMETIC. Severity classification branches on it
 * (`relational/entries.ts` buildElevated / buildUD1: `f.kind === "red_flag" || sev === "critical"`,
 * which decides the CRITICAL rung). A filing row handed to that test with a space in it does not
 * throw and does not warn — it silently grades a red flag as ordinary. Nothing routes a filing row
 * there today; this closes the door before something does.
 *
 * ★ ONE CONSEQUENCE WORTH STATING: a consumer can now hand this row and a score-channel finding to
 * the SAME function. The frontend's `toFinding(key, kind, severity, displayState, magnitude,
 * evidence, pondHot, verdict)` takes this shape as-is, with no adapter — which is what lets the stock
 * page render both channels as one list.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface FilingFindingView {
  /** The catalogue key. ★ `key`, matching every other finding shape — see the note above. */
  key: string;
  ruleRef: string;
  /** Catalogue name. Never a key. */
  name: string;
  /** ★ `red_flag` — the DB enum's own value, not a re-spelling of it. */
  kind: "red_flag" | "pattern";
  severity: string | null;
  direction: string | null;
  magnitude: number | null;
  displayState: string;
  /** ★ THE FILING this is about — "FY26" / "FY27Q1", plus what kind of filing it was. */
  period: string;
  periodEnd: string; // YYYY-MM-DD
  grain: FilingGrain;
  grainLabel: string;
  /** newly_standing | continuing | resolved | not_standing — see the schema's constraint table. */
  standing: string | null;
  /** ★ NARROWED AT THE READ LAYER, not by each consumer — see scoring/findings/evidence.ts. */
  evidence: EvidenceBag;
  /** From renderVerdict — THE authority, the same function the stock page and watchlist go through. */
  verdict: string;
}

/** One capability we could not check, collapsed across the rules that share it. */
export interface FilingDeclinedView {
  /** "earnings quality", not "R3". A rule ref must never reach a surface. */
  capability: string;
  /** The machine token, for a consumer that wants to branch. */
  reason: string;
  /** ★ THE READER'S SENTENCE — a SCOPE statement, not a defect report. */
  phrase: string;
}

export interface FilingCoverage {
  /** Rules that produced a row for this stock at their filing period. */
  evaluated: number;
  fired: number;
  notFired: number;
  notEvaluable: number;
  /** Rules whose GRAIN has no filing for this stock at all, so no row exists. Distinct from
   *  not_evaluable: the rule was never run, rather than run and declined. */
  notRun: number;
  /**
   * ★ TRUE ONLY WHEN ALL 22 RULES RAN AND EVERY ONE OF THEM WAS EVALUABLE.
   *
   * ⚠ `notRun` IS PART OF THIS, and leaving it out was a real defect caught on 360ONE: that company
   * files a shareholding pattern but no annual accounts and no quarterly results, so 12 of the 22
   * rules produce no row at all. "Every rule that RAN was evaluable" was true and would have let a
   * surface state "nothing flagged" at full strength about a company we had checked 10 things on.
   * A rule that never ran is a gap in coverage exactly as much as one that declined.
   */
  fullyEvaluated: boolean;
  /**
   * ★ THE LINE A SURFACE RENDERS WHEN `fired` IS EMPTY, and the whole of Task 2.
   *
   * null when something IS firing (the findings speak for themselves). Otherwise a sentence that
   * distinguishes the two silences a reader would otherwise see identically: everything was checked
   * and is clean, versus we could not check.
   */
  quietNote: string | null;
}

export interface FilingFindingsSection {
  fired: FilingFindingView[];
  declined: FilingDeclinedView[];
  coverage: FilingCoverage;
  /** The filing period each grain resolved to, for a surface that wants to date the statement. */
  periods: Record<FilingGrain, { period: string; periodEnd: string } | null>;
}

/** Rule-level copy, emitted once per distinct key rather than per row (the symbol-findings pattern). */
export interface FilingFindingDefinition {
  name: string;
  description: string;
  doesntMean: string;
}
