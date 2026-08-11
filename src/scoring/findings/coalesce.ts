// File: src/scoring/findings/coalesce.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// COALESCING — ONE MOVE, ONE ENTRY. (Master Spec Ruling · Coalescing Crossings from a Single Move)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// The governing fact: THE BUSINESS EXPERIENCED ONE EVENT. Momentum fell from exceptional to weak in a
// single reading. That it passed two marks on the way is a property of where WE placed our marks, not
// of what happened to the company. A card describes the stock; the stock had one thing happen to it.
//
// Rendering that move as two or three entries would report our RULE STRUCTURE to the reader — three
// findings describing one quarter's change is a statement about how many gates we built, not about the
// business. It would also inflate the claim: three cards read as three findings, presenting one
// observation as three pieces of evidence.
//
// ── ★ CONSOLIDATE, NEVER SUPPRESS ────────────────────────────────────────────────────────────────
// The constituent crossings are still NAMED AS FACTS inside the single entry — `evidence.constituents`
// carries every one, and the copy layer states the non-speaking constituent in its own clause
// (`constituentFact`). Nothing becomes invisible. What is removed is the DUPLICATION of one event into
// several entries.
//
// ── ★ AT MOST ONE CLAIM PER ENTRY ────────────────────────────────────────────────────────────────
// From the constituent with the strongest evidence WHOSE REGIME MAP PERMITS SPEECH IN THE CURRENT
// PHASE. Every other constituent is named as a fact with no claim attached. Where the combined
// configuration falls outside the observed range of every constituent, the entry speaks NO claim and
// is marked `described` — see `claimSourceFor` below, which is the single place that is decided.
//
// ── ★ WHERE THIS RUNS, AND WHY HERE ──────────────────────────────────────────────────────────────
// Inside the ENGINE's runner, on the fired set, BEFORE anything downstream sees it. Three reasons:
//   1. `persistFindings` is a 1:1 loop whose only dedup silently DROPS a second row for the same key —
//      coalescing after it would be too late, and coalescing "by merging rows" would lose evidence.
//   2. It is called from three places (the score pass and two backfill scripts). Coalescing in the
//      runner covers all three; coalescing in score-pass.ts would leave the backfills uncoalesced.
//   3. The runner is pure and DB-free, so this is fixture-testable — which is what the gate does.
//
// It runs BEFORE the fire-time regime stamp and PG dampening (score-pass.ts), so the merged entry is
// stamped and dampened as ONE unit, which is what it now is.
//
// ⚠ ONE EXCEPTION, AND IT IS DELIBERATE: the T2+T3 claim depends on the phase, but the phase is stamped
//   LATER (score-pass.ts, post-fire). So the merged evidence carries `claimSourceResolvesOnPhase: true`
//   and the copy layer selects the variant from the stamp at render time — see verdicts.ts's
//   `trajectory_B_T2_T3_deterioration_out_of_top_band`, which reads `firedInPhase(ev)` exactly as T3's
//   own copy does. Resolving it here would require a phase this module cannot see.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE REACHABLE SET (ruling §5). Six cases; four are pattern coalescings and live here. The other
//   two are NOT coalescings and live elsewhere, recorded here so the set is legible in one place:
//     · D5 + S2   — S2 DEMOTES beside D5 (it is a persistence qualifier, not a shape). Not a merge:
//                   two distinct entries, one of which is rendered as a badge + context line. See
//                   demotion.ts.
//     · NC3 + NC4 — registry notes, coalesced by the same trigger-shape rule but on the not-covered
//                   path, which never produces a FiredFinding. See catalogue/not-covered.ts.
//
// ⚠ THE UNREACHABLE COMBINATIONS, RECORDED SO THEY ARE NOT RE-CHECKED (ruling §5):
//     T3+T4, T1+T2  — require opposite directions on the composite.
//     T5+T9, T8+T9  — mutually exclusive by zone (weak-and-falling against the two rising reads).
//     T6+T7         — require Momentum both falling and rising.
//     D3+D4         — opposite ownership movements, and F<60 against F>=72 legs.
//     D5 vs D6/D7   — requires Momentum both rising (D5's +5 floor) and falling (the crossings).
//   Market↔Foundation (D1) and Market↔Momentum (D2) each carry a single pattern, so neither pair can
//   produce a combination at all.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { PATTERN_FACTS, type PatternKey } from "../../catalogue/pattern-facts.js";
// ⚠ THE FiredFinding TYPE IS IMPORTED FROM ITS OWN MODULE, NOT FROM `./types.js`.
//   `types.js` carries a type-only import of the generated Prisma client, and
//   verify-build-gate-hygiene.ts walks the import graph WITHOUT distinguishing type-only edges — by
//   design, since a `import type` that someone later makes a value import would silently pull the DB
//   client into a build gate. Importing the fired-finding shape from a leaf module keeps this module
//   (and therefore verify-coalescing.ts and verify-copy-register.ts, which import it) genuinely free of
//   the env and DB modules, so no allowance has to be declared for a dependency that does not exist at
//   runtime. See fired-finding.types.ts.
import type { FiredFinding } from "./fired-finding.types.js";

/**
 * One coalescing case: the constituents that must ALL have fired, and the entry they become.
 *
 * ⚠ KEYED ON CONSTITUENTS, NOT ON A SHAPE TEST. The rules have already done the shape test — a
 * constituent is in the fired set precisely because its trigger was satisfied. Re-deriving "did this
 * move cross two marks" here would be a second, drifting copy of gates that already ran.
 */
interface CoalesceCase {
  readonly entry: PatternKey;
  readonly constituents: readonly PatternKey[];
}

/**
 * ★ THE FOUR PATTERN COALESCINGS. Order matters only for determinism, not for precedence — the
 * constituent sets are disjoint, so no fired set can match two cases on the same key.
 */
const CASES: readonly CoalesceCase[] = [
  {
    entry: "divergence_D6_D7_trajectory_collapse",
    constituents: ["divergence_D6_quality_rolling_over", "divergence_D7_trajectory_breaking_base_holds"],
  },
  {
    entry: "trajectory_B_T2_T3_deterioration_out_of_top_band",
    constituents: ["trajectory_B_T2_deterioration_high_base", "trajectory_B_T3_falling_out_of_pristine"],
  },
  {
    entry: "trajectory_D_T1_T4_recovery_out_of_low_zone",
    constituents: ["trajectory_D_T1_recovery_low_zone", "trajectory_D_T4_recovering_out_of_below_par"],
  },
  {
    entry: "trajectory_D_T5_T8_foundation_weak_to_strong",
    constituents: ["trajectory_D_T5_foundation_out_of_weak", "trajectory_D_T8_foundation_strong_improving"],
  },
];

/**
 * ★ THE CLAIM COMPARATOR — `confidence`, with the regime map as a VETO rather than a tiebreak.
 *
 * ⚠⚠ THIS IS AN INFERENCE, FLAGGED AS ONE. The coalescing ruling requires "the constituent with the
 * strongest evidence whose regime map permits speech" but does NOT define what makes evidence
 * strongest. It was implemented against the existing `confidence` field on the instruction that no
 * comparator be invented, and the ruling's own T1+T4 case supports that reading: T1 speaks because
 * T4's n "was not preserved", which is a CONFIDENCE judgement rather than an effect-size comparison.
 *
 * If a later ruling defines the comparator differently — by n, by hit-rate, by effect size — THIS
 * FUNCTION IS THE ONLY PLACE THAT CHANGES. That is why it is one function and not a sort spread across
 * the case table.
 *
 * The order is the declared register, strongest first:
 *   robust       a measured regularity
 *   directional  a direction, sample-starved
 *   described    nothing was measured — may never speak (and is the entry-level marking for exactly
 *                that state), so it is not merely last, it is excluded below.
 */
const CONFIDENCE_RANK: Readonly<Record<string, number>> = { robust: 0, directional: 1, described: 2 };

/**
 * Which constituent's claim may be spoken, or null when none may.
 *
 * The veto runs FIRST and is absolute: a constituent whose regime map does not read true in the phase
 * may not speak however strong its evidence, because that is precisely what `masked` and
 * `no_directional_read` mean. Only among the survivors does confidence decide.
 *
 * ⚠ THE RECORD'S OWN `claimSource` WINS WHERE IT IS DECLARED NULL. `claimSource: null` on the record is
 * a RULING (D6+D7 and T5+T8 — the combined configuration was never observed), not a computation, and it
 * must not be recomputed into a claim by a comparator that cannot see that reasoning.
 *
 * @param phase the stamped regime, or null when it could not be established. Null vetoes EVERY
 *              constituent: with no phase we cannot tell which map permits speech, and guessing would
 *              speak a masked claim. Same discipline as T3's own copy, which refuses the calm variant
 *              on an unknown phase.
 */
export function claimSourceFor(entry: PatternKey, phase: string | null): PatternKey | null {
  const facts = PATTERN_FACTS[entry];
  const coalesced = "coalesced" in facts ? facts.coalesced : undefined;
  if (!coalesced) return null;
  // ★ A RULED `described` ENTRY NEVER SPEAKS — see the note above.
  if (coalesced.claimSource === null) return null;
  if (phase === null) return null;

  const permitted = coalesced.coalescedFrom.filter((k) => {
    const map = PATTERN_FACTS[k].regimeMap as Readonly<Record<string, string>>;
    // ★ THE VETO, AND IT IS ABSOLUTE. `masked` and `no_directional_read` are the two ways a record
    //   says "not in this phase"; only `reads_true` licenses speech, however strong the evidence.
    if (map[phase] !== "reads_true") return false;
    // ★ AND A `described` CONSTITUENT MAY NEVER SPEAK — it has no measured population to speak from.
    //   `confidence` is widened to string here on purpose: today no coalesced constituent carries
    //   `described` (tsc can prove it), but this function must stay correct if one ever does, and a
    //   direct comparison against the narrowed literal type is rejected as impossible.
    return (PATTERN_FACTS[k].confidence as string) !== "described";
  });
  if (!permitted.length) return null;

  return (
    [...permitted].sort((a, b) => {
      const ra = CONFIDENCE_RANK[PATTERN_FACTS[a].confidence] ?? 9;
      const rb = CONFIDENCE_RANK[PATTERN_FACTS[b].confidence] ?? 9;
      // Ties broken by key so the choice is deterministic rather than fired-order dependent.
      return ra - rb || a.localeCompare(b);
    })[0] ?? null
  );
}

/**
 * ★★ WHO SPEAKS THIS ENTRY'S CLAIM — the ONE resolver, for coalesced and single patterns alike. ★★
 *
 * RULED: the register belongs to the CLAIM, not to the entry. `confidence` therefore travels with
 * `claimSource`, always. This function is where that is expressed once:
 *
 *   · a single pattern            → itself. It is its own claimant; its record's `confidence` governs.
 *   · a coalesced entry           → `claimSourceFor` (regime veto, then the confidence comparator).
 *   · anything with no claimant   → null. No claim is spoken, so there is no register question — the
 *                                   `described` state, whether ruled onto the record (D6+D7, T5+T8)
 *                                   or reached because no constituent's map permits speech this phase.
 *
 * ⚠ WRITTEN AS THE GENERAL RULE, NOT AS A CARVE-OUT. Treating "coalesced entries follow their speaker"
 * as a special case invites the next coalesced entry to need a second one. A single pattern is simply
 * the case where the speaker is the entry, so both go through one path and the rule holds by shape
 * rather than by enumeration.
 */
export function claimantOf(entry: PatternKey, phase: string | null): PatternKey | null {
  const facts = PATTERN_FACTS[entry];
  const isCoalesced = "coalesced" in facts && facts.coalesced !== undefined;
  if (isCoalesced) return claimSourceFor(entry, phase);
  // A single pattern that speaks no claim (`described`) has no claimant — the same answer, reached
  // from the record rather than from a constituent set. T4 is the live case.
  return (facts.confidence as string) === "described" ? null : entry;
}

/** The severity a coalesced entry carries: the strongest of its constituents', by the display scale. */
const SEVERITY_RANK: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2, recovery: 3, green: 4 };
const strongestSeverity = (parts: FiredFinding[]): string =>
  [...parts].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))[0]?.severity ?? "low";

/**
 * ★ COALESCE A FIRED SET. Pure; returns a NEW array and never mutates the input.
 *
 * For each case whose constituents ALL fired, the constituents are replaced by ONE entry carrying:
 *   · every constituent's evidence, merged under `constituents` — the "named as facts" guarantee
 *   · `coalescedFrom` / `claimSource` mirrored onto evidence so the wire can show both without the
 *     consumer having to reach into the catalogue
 *   · the constituents' own defining quantities hoisted to the top level, because the lifecycle service
 *     reads them there (`VALUE_SPEC`) and a coalesced entry must have a value series like any other
 *
 * The merged entry takes the POSITION of its first constituent, so registry order is preserved and the
 * downstream sort sees a stable set.
 */
export function coalesceFindings(fired: readonly FiredFinding[]): FiredFinding[] {
  const byKey = new Map<string, FiredFinding>();
  for (const f of fired) if (!byKey.has(f.key)) byKey.set(f.key, f);

  const out: FiredFinding[] = [];
  const consumed = new Set<string>();
  const emitted = new Set<string>();

  for (const f of fired) {
    if (consumed.has(f.key)) continue;

    const hit = CASES.find(
      (c) => c.constituents.includes(f.key as PatternKey) && c.constituents.every((k) => byKey.has(k)),
    );

    if (!hit) {
      out.push(f);
      continue;
    }
    if (emitted.has(hit.entry)) continue;

    const parts = hit.constituents.map((k) => byKey.get(k)!);
    for (const k of hit.constituents) consumed.add(k);
    emitted.add(hit.entry);

    const facts = PATTERN_FACTS[hit.entry];
    const coalesced = "coalesced" in facts ? facts.coalesced : undefined;

    // ★ EVERY CONSTITUENT, NAMED. This is the anti-suppression guarantee in data form: whatever the
    //   card chooses to say, the payload can always answer "which rules produced this entry?"
    const constituents = parts.map((p) => ({
      patternKey: p.key,
      severity: p.severity,
      direction: p.direction ?? null,
      evidence: p.evidence,
    }));

    // The defining quantities the lifecycle service and the card read. Taken from the constituents'
    // own evidence — never recomputed here, which would be a second derivation of a number a rule
    // already stamped.
    const hoisted: Record<string, unknown> = {};
    for (const p of parts) {
      for (const field of ["momentum", "foundation", "compositeNow", "foundationNow", "momentumNow", "crossedBelow", "crossedAbove", "gapPp"]) {
        const v = (p.evidence as Record<string, unknown>)[field];
        if (v !== undefined && hoisted[field] === undefined) hoisted[field] = v;
      }
    }
    // ⚠ THE MARK MUST BE THE SPAN'S FAR SIDE, not whichever constituent happened to be first. The
    //   entry is about the whole move, so the boundary it reports is the one that COMPLETES it: the
    //   lowest mark crossed downward, the highest crossed upward.
    const marksDown = parts.map((p) => (p.evidence as Record<string, unknown>).crossedBelow).filter((v): v is number => typeof v === "number");
    const marksUp = parts.map((p) => (p.evidence as Record<string, unknown>).crossedAbove).filter((v): v is number => typeof v === "number");
    if (marksDown.length) hoisted.crossedBelow = Math.min(...marksDown);
    if (marksUp.length) hoisted.crossedAbove = Math.max(...marksUp);

    out.push({
      kind: "pattern",
      key: hit.entry,
      severity: strongestSeverity(parts),
      direction: parts[0].direction ?? null,
      polarity: parts[0].polarity,
      temporalClass: "EVENT", // a coalesced crossing is always a dated occurrence
      magnitude: null,
      displayState: "active",
      evidence: {
        ...hoisted,
        card: cardLabel(hit.entry),
        name: entryName(hit.entry),
        isCrossing: true,
        isCoalesced: true,
        // ★ BOTH FIELDS, BOTH INSPECTABLE (ruling §6). `coalescedFrom` records WHAT FIRED;
        //   `claimSource` records WHAT WAS MEASURED. A reader of the payload can always see that
        //   several rules produced one entry and whether any of them earned the right to speak.
        coalescedFrom: coalesced?.coalescedFrom ?? hit.constituents,
        claimSource: coalesced?.claimSource ?? null,
        evidenceBasis: facts.evidenceStats.basis,
        // ⚠ T2+T3 ONLY — the claim depends on a phase stamped after this runs, so the copy layer
        //   resolves it. Declared on the wire so the resolution is visible rather than implicit.
        ...(coalesced?.claimSource !== null && needsPhaseResolution(hit.entry)
          ? { claimSourceResolvesOnPhase: true }
          : {}),
        marksCrossed: [...marksDown, ...marksUp].sort((a, b) => a - b),
        constituents,
      },
    });
  }

  return out;
}

/** Entries whose speaking constituent is decided by the fire-time phase rather than by the record. */
const needsPhaseResolution = (entry: PatternKey): boolean =>
  entry === "trajectory_B_T2_T3_deterioration_out_of_top_band";

/** The short card label, matching the constituents' own `card` convention ("D6", "T2"). */
function cardLabel(entry: PatternKey): string {
  switch (entry) {
    case "divergence_D6_D7_trajectory_collapse": return "D6+D7";
    case "trajectory_B_T2_T3_deterioration_out_of_top_band": return "T2+T3";
    case "trajectory_D_T1_T4_recovery_out_of_low_zone": return "T1+T4";
    case "trajectory_D_T5_T8_foundation_weak_to_strong": return "T5+T8";
    default: return entry;
  }
}

/** The display name, mirroring the catalogue's `name` so evidence and catalogue cannot disagree. */
function entryName(entry: PatternKey): string {
  switch (entry) {
    case "divergence_D6_D7_trajectory_collapse": return "Trajectory Collapse";
    case "trajectory_B_T2_T3_deterioration_out_of_top_band": return "Deterioration out of the top band";
    case "trajectory_D_T1_T4_recovery_out_of_low_zone": return "Recovery out of the low zone";
    case "trajectory_D_T5_T8_foundation_weak_to_strong": return "Balance-sheet reading crossed from weak to strong";
    default: return entry;
  }
}

/** The cases, exported for the gate so it enumerates from the source rather than a hand-kept list. */
export const COALESCE_CASES = CASES;
