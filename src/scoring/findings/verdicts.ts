// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE VERDICT RENDERERS — File 1 §5's prescribed sentence for every fired finding, bound to the real
// breaching stat in that finding's own evidence JSON.
//
// ── ★ WHY THIS IS HERE AND NOT IN THE CATALOGUE ───────────────────────────────────────────────────
// A verdict is an (evidence) => string FUNCTION. It cannot be JSON, so it cannot be served from the
// catalogue endpoint — it has to be RENDERED, on the response that already carries the evidence it
// reads. That makes its home the read layer, beside the rules whose evidence it consumes, not beside
// the static copy. The two layers are:
//
//   description  static, rule-level.  "What this pattern means."          → catalogue, any surface.
//   VERDICT      dynamic, per-stock.  "What happened at THIS company."    → HERE, evidence surfaces.
//
// They compose. A verdict never substitutes for a description and vice versa.
//
// ── ★ THIS IS A MOVE FROM Vytal-Frontend/lib/findings/verdicts.ts, CHARACTER FOR CHARACTER ────────
// scripts/verify-verdicts.ts renders every key against fixture evidence through BOTH implementations
// and asserts the output strings are identical. A single changed character fails it.
//
// ── ⚠ THERE WERE TWO VERDICT AUTHORITIES, AND THAT IS THE DEFECT THIS CLOSES ──────────────────────
// Each rule already writes its own assembled sentence into `evidence.verdict` (or `evidence.verbatim`).
// The frontend's renderers then OVERRODE it on the stock page. So the same fired finding said one
// thing on the stock page and a different thing everywhere the backend spoke — the chat, the
// relational card, the grounding block. For some keys the two texts happen to agree verbatim (C2, C3);
// for others they do not (C1 carries an extra "mean 27.6"; R6 orders its three deltas differently;
// N1 says "earnings converting reliably to cash", which the amendment's own §4.2 register list would
// not permit in the authored copy). Agreement on some keys and not others is the worst shape of drift:
// it reads as consistent right up until it isn't.
//
// PRECEDENCE IS PRESERVED EXACTLY as the frontend's `renderVerdict` had it:
//     1. the File-1 authored renderer for the key      (this catalog)
//     2. the engine's own assembled evidence.verbatim / evidence.verdict
//     3. a generic last resort
// Moving it backend-side does not change which wins — it changes WHO CAN SEE the winner.
//
// RETIRED / UNBUILT: P2 (→ R6), P3 (→ R1) are consolidated and NOT registered by the engine; P9
// (capex) is unbuilt. They have NO display slot here — deliberately no entries.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { N_FAMILY_COPY, STOCK_FINDINGS, familyOf, findingDescription, findingName, isPatternKey, doesntMean, PATTERN_FACTS, type PatternKey } from "../../catalogue/index.js";
import { REGIME_EVIDENCE_KEY } from "../regime/regime.js";
import { DIFFERENCE_DISPLAY_PRECISION } from "./format.js";
import { NATIVE_ZONES } from "./thresholds.js";
import type { FindingLifecycle, MovementPhase, LifecycleValueBasis } from "../read/finding-lifecycle.types.js";

type Ev = Record<string, unknown>;

/** Pillar display names. The frontend keeps its own copy in lib/findings/classify.ts (which is
 *  ordering/accent logic and is NOT part of this migration); this is the renderers' local copy and
 *  is asserted identical in verify-verdicts.ts. */
export const PILLAR_LABEL: Record<string, string> = {
  foundation: "Foundation",
  momentum: "Momentum",
  market: "Market",
  ownership: "Ownership",
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const f = (v: unknown, d = 1): string => {
  const n = num(v);
  return n === null ? "—" : n.toFixed(d);
};
const signed = (v: unknown, d = 2): string => {
  const n = num(v);
  if (n === null) return "—";
  return n >= 0 ? `+${n.toFixed(d)}` : n.toFixed(d);
};
const abs1 = (v: unknown, d = 1): string => {
  const n = num(v);
  return n === null ? "—" : Math.abs(n).toFixed(d);
};
const pl = (k: unknown): string => PILLAR_LABEL[str(k)] ?? str(k);
/** "30.8 → 29.1 → 28.0" from an evidence opmSeries (P11/P12 locked copy). */
const opmArrow = (v: unknown): string =>
  Array.isArray(v) ? (v as { opm?: unknown }[]).map((p) => f(p.opm, 1)).join(" → ") : "";

/**
 * ★ A DIFFERENCE, IN PROSE — 0dp, from the ONE declared home (format.ts's
 * DIFFERENCE_DISPLAY_PRECISION). Gaps and deltas only; a pillar READING keeps its pattern's own
 * `displayPrecision` via the per-key formatters above. See format.ts for why two kinds of quantity
 * with one declared precision each is not the same thing as one quantity with two.
 */
const fDiff = (v: unknown): string => f(v, DIFFERENCE_DISPLAY_PRECISION);

// ── Family N (Notable) — instance verdicts, DERIVED from the spec copy templates
// (catalogue/n-family-copy.ts), never re-authored here. Each is guarded: the verdict interpolates a
// run length / delta from the fired instance, so if a required evidence key is missing at runtime we
// render the STATIC DESCRIPTION instead of a broken "undefined" sentence (amendment §8.3). The
// required keys per rule are exactly the §3 evidence keys the engine build writes. ──────────────────
const N_REQUIRED_KEYS: Record<string, string[]> = {
  foundation_N1_cash_backed_earnings: ["years"],
  foundation_N2_working_capital: ["years"],
  foundation_N3_deleveraging: ["years", "deFrom", "deTo"],
  foundation_N4_coverage_strengthening: ["quarters", "troughCoverage"],
  ownership_N5_dual_institutional_build: ["fiiDeltaPp", "diiDeltaPp"],
  ownership_N6_promoter_accumulation: ["quarters", "cumulativePp"],
  ownership_N7_pledge_release: ["pledgeFromPct", "pledgeToPct"],
};

const N_VERDICTS: Record<string, (ev: Ev) => string> = Object.fromEntries(
  Object.entries(N_FAMILY_COPY).map(([key, copy]) => [
    key,
    (ev: Ev): string => {
      const required = N_REQUIRED_KEYS[key] ?? [];
      // Guard: never interpolate a missing/undefined/null evidence value into user-facing text.
      const haveAll = required.every((k) => ev[k] != null);
      return haveAll ? copy.verdict(ev) : (findingDescription(key) ?? "");
    },
  ]),
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE CLAUSE SET — {clauses, text}, composeStory's shape, applied to a finding ★★
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Five clause types, FIXED ORDER, each independently included or omitted. The composer chooses by
// LOGIC, not by taste — the same property that makes the portfolio storyboard a statement rather than
// a generation (portfolio/phs/story.ts's header).
//
//   observation  evidence — what is true right now                              ALWAYS
//   movement     the value history — building / widening / narrowing / sticky    when history exists
//   size         severity — how large the tension is, and the study's claim      gap+movement basis,
//                                                                                AND at evidenced tier
//   phase        regimeMap × the fire-time regime                                only alongside a claim
//   boundary     the catalogue's doesntMean                                      ALWAYS
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE CLAIM RULE, AND THE INTERACTION THAT MATTERS MOST
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A pattern is AT ITS EVIDENCED TIER or it is RELAXED — the record says which (`relaxedTier`), and for
// the two patterns where it is live the RULE already stamped the answer (`evidence.strong`, D3/D4's
// ±8 register). At the evidenced tier the study's claim may be spoken. Relaxed, NO CLAIM CLAUSE IS
// EMITTED AT ALL — not a hedged one. The card describes and stops.
//
// ⚠ AND RELAXED SUPPRESSES THE PHASE CLAUSE TOO. This is the rule that kills a live class of bad card.
// A regime clause QUALIFIES A CLAIM: "the sector is running hot, which flatters the size of moves like
// this one" is only meaningful if something asserted a size worth flattering. Appended to a card that
// asserted nothing, it is false authority — it reads as though a measured reading is being carefully
// conditioned, when there is no reading. Generalising `regimeSentence` into the clause set is exactly
// what makes this expressible: as long as the phase append lived inside nine hand-written trajectory
// sentences, there was no single place a relaxed pattern could be refused one.
//
// ⚠ `size` IS NOT THE ONLY CLAIM. A CROSSING (D6/D7, T3–T6) emits no size clause — §1.2's severity
// gradient is a divergence-gap scale and does not apply to a boundary event (bands.ts says so, and
// Trajectory §1.3 inverts it outright). But a crossing still MAKES a claim when it is at its evidenced
// tier, and T3/T6's phase clause — "in calm markets this crossing has not historically carried a
// directional read" — is the most important thing on those two cards. So the phase clause is gated on
// AT-EVIDENCED-TIER, not on "a size clause was emitted". Gating it on `size` would silently delete the
// one clause §1.4 line 87 exists to guarantee.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export type ClauseType = "observation" | "band_context" | "movement" | "size" | "phase" | "boundary";

/** The fixed join order. Declared once; `composeVerdict` sorts by it rather than trusting push order. */
export const CLAUSE_ORDER: readonly ClauseType[] = ["observation", "band_context", "movement", "size", "phase", "boundary"];

export interface VerdictClause {
  type: ClauseType;
  text: string;
}

export interface ComposedVerdict {
  clauses: VerdictClause[];
  /**
   * The joined sentence — the string every existing consumer already reads (`verdict`).
   *
   * ⚠ THE BOUNDARY CLAUSE SHIPS IN `clauses` BUT IS NOT JOINED INTO `text`, DELIBERATELY. Every
   * surface that renders a finding ALREADY renders `doesntMean` in its own slot — the stock page's
   * finding card, the divergence tool's `note`, the relational card. Joining it here would print the
   * interpretive boundary twice on the same card. It travels as a clause so a consumer that wants the
   * complete set (or a surface with no boundary slot) can compose it, and so the gate can lint it.
   */
  text: string;
}

/**
 * ★ At its evidenced tier, or relaxed? Two questions, and BOTH are read rather than inferred.
 *
 *   1. Does a relaxed register EXIST for this pattern? The RECORD says (`relaxedTier`). Null ⇒ the
 *      pattern is STRICT — it fires at its evidenced tier or not at all — so a fired instance is at
 *      tier by construction. Thirteen of the seventeen are strict.
 *
 *   2. Is THIS firing in it? The RULE says, by stamping `strong` — the same ±8 discriminant D3/D4's
 *      own copy already branches on, not a second derivation of it.
 *
 * ⚠ A DECLARED RELAXED TIER IS NOT THE SAME AS A REACHABLE ONE, AND CONFLATING THEM SILENCED D1/D2.
 * D1 and D2 declare `relaxedTier: {threshold: 68, …}` — a true fact about the STUDY, which measured a
 * [68, 74) band. But their RULES gate at `market >= evidencedTier` (74), so no D1 row can ever be in
 * that band: the register is declared and unreachable. Reading rule 2 as "no `strong` stamp ⇒ relaxed"
 * therefore classified every D1/D2 firing as relaxed and deleted its size AND phase clauses — the
 * inheritance note that is the whole point of those two cards. Caught by the verdict gate, which is
 * why the fixture asserting that sentence exists.
 *
 * So: the stamp decides WHEN THE RULE MADE ONE. Absent a stamp, the rule gated at the evidenced tier
 * itself and the firing is at tier. `typeof === "boolean"` is the test, not truthiness — an absent
 * stamp and a `false` stamp are different states and must not collapse.
 */
function atEvidencedTier(key: string, ev: Ev): boolean {
  // ★ STATE WINS WHERE THE RULE STAMPED ONE. `building` means the shape holds but at least one leg
  //   has not crossed its evidenced threshold — so there IS no evidenced claim to speak, and the
  //   suppression the relaxed register already implements is exactly the behaviour Building needs.
  //   D1–D4 stamp `state`; the other patterns do not, and fall through to the register test below.
  //   ⚠ Building carries the `described` evidence basis — named and stated, measured by nobody.
  if (ev.state === "building") return false;
  if (ev.state === "formed") return true;
  if (!isPatternKey(key)) return true; // no record ⇒ no relaxed register to be in
  if (PATTERN_FACTS[key].relaxedTier === null) return true; // strict — see (1)
  return typeof ev.strong === "boolean" ? ev.strong : true; // see (2) and the D1/D2 note
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ BAND CONTEXT — WHERE THE TWO READINGS SIT, NOT WHAT THE GAP MEANS. (The TCS bug.) ★★
// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// TCS carries a sticky Foundation↔Momentum divergence with BOTH pillars above 75. GLENMARK carries
// the same pattern, the same two pillars, at 35 and 26. The cards read IDENTICALLY — same name, same
// sentence shape, same tier word — because every clause described the DISTANCE and none described
// the PLACEMENT. A gap between two strong pillars and a gap between two weak ones are different
// readings, and the copy has to say which one the reader is looking at.
//
// ⚠ NATIVE PILLAR ZONES, NEVER THE COMPOSITE BANDS. Foundation 60/72 · Momentum 54/75 · Market 50/74
// · Ownership 60/72, each read against ITS OWN marks. The Trajectory spec records what borrowing the
// composite's bands for a pillar does: on the borrowed threshold T6 showed a FALSE +3.2%, and at
// Momentum's own weak mark it is negative. A sign flip, from one wrong number.
//
// ⚠ IT MAKES NO CLAIM AND IS EXEMPT FROM THE TIER GATE. "Both readings sit in strong territory" is a
// statement about where two numbers are, not about what happens next — so a Building card gets it too.
// The claim rule suppresses `size` and `phase`; it has nothing to say about placement.
type BandPlacement = "strong" | "middle" | "weak";

const placementOf = (pillar: string, value: number): BandPlacement | null => {
  const z = (NATIVE_ZONES as Record<string, { weak: number; strong: number } | undefined>)[pillar];
  if (!z) return null; // the composite has no native zone — and must not borrow one
  return value >= z.strong ? "strong" : value < z.weak ? "weak" : "middle";
};

/**
 * The band-context clause for a GAP-BASIS divergence, or null.
 *
 * ★ STRADDLING EMITS NOTHING, DELIBERATELY. High pillar strong + low pillar weak IS the configuration
 * the evidence was measured on, so it is the unmarked case — adding "this is the normal one" to every
 * such card would be noise on the majority and would make the three genuinely-unusual placements
 * harder to notice, which is the opposite of the point.
 */
function bandContextClause(key: PatternKey, ev: Ev): string | null {
  // ★ THE PAIR COMES FROM THE RECORD + THE RULE'S OWN EVIDENCE, not from the read layer's resolved
  //   `pair`. Every gap-basis rule writes its two readings under the PILLAR'S OWN NAME (D1 writes
  //   `market`/`foundation`, S2 writes `foundation`/`momentum`), so the pair is reconstructable here
  //   — which keeps this clause available to a lifecycle-less caller (the chat, the relational card)
  //   rather than only on the surface that happens to resolve a pair.
  const names = PATTERN_FACTS[key].pillarPair;
  if (names.length !== 2) return null;
  const a = num(ev[names[0]]), b = num(ev[names[1]]);
  if (a === null || b === null) return null;
  // High/low by VALUE — the same rule `pairOf` uses, so the two can never disagree about which end
  // of the pair is which.
  const [hpName, hv, lpName, lv] = a >= b ? [names[0], a, names[1], b] : [names[1], b, names[0], a];
  const h = placementOf(hpName, hv), l = placementOf(lpName, lv);
  if (h === null || l === null) return null;

  if (h === "strong" && l === "strong") {
    return "Both readings sit in strong territory; the disagreement is between two healthy pillars, not a warning about either.";
  }
  if (h === "weak" && l === "weak") {
    return "Both readings sit in weak territory; the gap is between two struggling pillars.";
  }
  if (h === "strong" && l === "weak") return null; // straddling — the measured configuration, unmarked
  return "One reading sits in the middle band.";
}

/** True when the rule stamped Building. Used to select the Building observation. */
const isBuilding = (ev: Ev): boolean => ev.state === "building";

// ── the movement vocabulary (Part 3) ───────────────────────────────────────────────────────────────
//
// ⚠ PLAIN LANGUAGE ABOUT THE QUANTITY'S OWN PATH, NEVER A CLAIM ABOUT OUTCOMES. Every string below
// describes what a number did. None says what it means, what happens next, or what to do — those are
// the `size` clause's job (and only at the evidenced tier) and the boundary's.
//
// ★ APPROACHING A THRESHOLD IS A FACT ABOUT THE NUMBER AND MAY BE SAID. Crossing one changes WHICH
// clauses are emitted, not whether anything appears — a pattern under its floor still gets an
// observation and a boundary, and gets `closed` here rather than silence.

/**
 * ⚠ THE VOCABULARY IS PER BASIS, BECAUSE "this far apart" IS GAP LANGUAGE AND THREE OF THE BASES ARE
 * NOT GAPS. One shared phrasing produced "the first reading at which it has been this far apart" on
 * GLENMARK's T7 — a MOVEMENT pattern, whose quantity is the size of a step, not a distance between two
 * pillars. Nothing was apart. A crossing is a third thing again: its quantity is how far past a mark
 * the reading sits, and "converging" means nothing there.
 *
 * `sticky`'s gap wording is S2's OWN, which is good and stays — it is just no longer borrowed by
 * patterns S2's sentence was never about.
 */
type MovementCopy = Readonly<Record<MovementPhase, (n: number) => string>>;

const MOVEMENT_COPY_BY_BASIS: Readonly<Record<LifecycleValueBasis, MovementCopy>> = {
  gap: {
    // ⚠ "it is starting to build" WAS REMOVED. `building` here is a MOVEMENT PHASE (the quantity's
    //   first period past its floor); `building` is now also a pattern STATE (the shape is incomplete).
    //   Two different facts, and a card can carry one without the other — a FORMED pattern whose gap
    //   just crossed 12 would have read "starting to build" beside copy saying the shape is complete.
    building: () => "This is the first reading at which the two have been this far apart.",
    widening: (n) => `They have been this far apart for ${n} readings, and the gap is still widening.`,
    narrowing: (n) => `They have been this far apart for ${n} readings, and the gap is narrowing.`,
    // ★ S2's OWN LANGUAGE — the spec's structural finding, in the words it was written in.
    sticky: (n) => `They have sat at this distance for ${n} consecutive readings without converging.`,
    closed: () => "The gap has closed back under the level at which it carries meaning.",
  },
  delta: {
    // ⚠ "starting to build" removed here too — see the gap vocabulary above. A movement pattern can
    //   be FORMED (|Δ| ≥ 8) on its very first reading past the floor, and "starting to build" beside a
    //   complete shape reads as a contradiction.
    building: () => "This is the first reading with a move of this size.",
    widening: (n) => `It has moved this way for ${n} readings, and the steps are getting larger.`,
    narrowing: (n) => `It has moved this way for ${n} readings, and the steps are getting smaller.`,
    sticky: (n) => `It has moved this way, at about this pace, for ${n} consecutive readings.`,
    closed: () => "The move has fallen back under the size at which it carries meaning.",
  },
  distance_from_mark: {
    building: () => "This is the first reading on this side of the mark.",
    widening: (n) => `It has been on this side of the mark for ${n} readings, and it is moving further past it.`,
    narrowing: (n) => `It has been on this side of the mark for ${n} readings, and it is moving back toward it.`,
    sticky: (n) => `It has sat this far past the mark for ${n} consecutive readings.`,
    closed: () => "It has crossed back over the mark.",
  },
};

/**
 * The `movement` clause.
 *
 * ★ TWO SOURCES, IN PRIORITY ORDER, AND THE SECOND IS NOT A FALLBACK FOR ITS OWN SAKE. The value
 * series is preferred: it spans periods the fired rows cannot reach and knows which way the quantity
 * is going. But S2's RULE already walks its own sustain run and stamps `sustainedReadings` — a
 * declared fact that is available with no lifecycle at all. A caller without a lifecycle (the chat,
 * the relational card) would otherwise silently LOSE "it has sat here for three readings", which is
 * the entire content of S2. Reading the rule's own count in that case keeps the fact on every
 * surface, from the one home that already computes it.
 *
 * ⚠ THE TWO COUNTS CAN DISAGREE, AND NEITHER IS CORRECTED TO MATCH THE OTHER. `sustainedReadings` is
 * the rule's walk over the pillar series; `periodsPastFloor` is this layer's walk over the same
 * series; `runLength` is the ROW history and is a different question again. Where they differ, the
 * lifecycle carries all three and the sentence uses the one it was given.
 */
function movementClause(lc: FindingLifecycle | null, ev: Ev): string | null {
  if (lc && lc.movementPhase !== null && lc.valueBasis !== null) {
    const copy = MOVEMENT_COPY_BY_BASIS[lc.valueBasis];
    const n = lc.movementPhase === "closed" ? lc.periodsPastFloor : Math.max(lc.periodsPastFloor, 1);
    // `building` and `closed` take no count; the other three are about duration and need one.
    if (lc.movementPhase !== "building" && lc.movementPhase !== "closed" && n < 2) return null;
    return copy[lc.movementPhase](n);
  }
  // No lifecycle — the rule's own sustain count, where the pattern declares one. Only S2 does, and S2
  // is a gap, so the gap vocabulary is the right one and is named rather than defaulted to.
  const sustained = num(ev.sustainedReadings);
  if (sustained !== null && sustained >= 2) return MOVEMENT_COPY_BY_BASIS.gap.sticky(sustained);
  return null;
}

/**
 * ★ HOW AN ENDED DIVERGENCE CLOSED — three bodies, one per outcome. Null unless both the type and the
 * closure are established (see EndedResolution's note on why `resolved` is a separate question).
 *
 * ⚠ AN ENDED CARD DESCRIBES WHAT HAPPENED AND STOPS. No consequence clause reaches here — no such
 * claim was ever measured for a RESOLVED condition, only for a standing one, and `composeEndedVerdict`
 * emits no `size` and no `phase` for exactly that reason.
 *
 * ⚠ THE RULED COPY NAMES "the Market pillar" ON BOTH SIDES, WHICH IS TRUE OF D1/D2 AND OF NOTHING
 * ELSE. S2's pair is Foundation↔Momentum and D5's is Foundation↔Momentum — neither has a Market leg,
 * so rendering "the Market pillar came back toward the business" there would name a pillar that is not
 * in the pattern. The Market-led wording is therefore used verbatim where the leader IS Market, and
 * the same sentence with the actual lead pillar named is used where it is not. See the build report.
 */
function resolutionClause(lc: FindingLifecycle | null): string | null {
  const r = lc?.resolution;
  if (!r || !r.resolved) return null;
  const lead = PILLAR_LABEL[r.leadPillar] ?? r.leadPillar;
  const lag = PILLAR_LABEL[r.lagPillar] ?? r.lagPillar;
  const marketLed = r.leadPillar === "market";

  if (r.type === "mutual") {
    return "The gap has closed. The two readings met in the middle, neither giving way.";
  }
  if (r.type === "converged") {
    return marketLed
      ? `The gap has closed. The business grew into what the market was already paying: ${lag} rose to meet the Market pillar rather than the Market pillar falling back.`
      : `The gap has closed. ${lag} rose to meet ${lead} rather than ${lead} falling back.`;
  }
  return marketLed
    ? "The gap has closed. The Market pillar came back toward the business rather than the business growing into the price."
    : `The gap has closed. ${lead} came back toward ${lag} rather than ${lag} rising to meet it.`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE PER-PATTERN CLAUSE TABLE — observation and size, split at the sentence's own seam.
//
// The words are the EXISTING File-1 copy, cut where the description stops and the study starts. That
// seam is not stylistic: everything before it is true of THIS stock right now and may always be said;
// everything after it is a claim about a measured population and may only be said at the evidenced
// tier. Splitting on it is what makes the claim rule enforceable rather than aspirational.
//
// ⚠ `size` IS NULL FOR EVERY CROSSING (D6/D7, T3–T6) BY CONSTRUCTION, not by omission. §1.2's severity
// gradient is a divergence-GAP scale; a crossing is defined by the boundary, never by the size of the
// move (bands.ts, and Trajectory §1.3 inverts the scale outright). Those cards' interpretive lines
// stay in `observation`, where they belong: they describe the configuration, they quote no population.
//
// ⚠ AND IT IS NULL FOR T2, WHICH HAS NO MEASURED FIGURE IN ITS COPY. T2's authored sentence carries no
// population reading, so there is no claim to gate. A size clause invented to fill the slot would be
// authoring a claim the spec did not make — see the build report's "could not source" list.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

interface PatternClauseParts {
  observation: string;
  /** The study's claim. Null ⇒ this pattern makes none, so there is nothing for the tier to gate. */
  size: string | null;
  /**
   * ★ T3 AND T6 ONLY — the phase language now lives INSIDE the observation, so no separate `phase`
   * clause may be appended or the card says it twice. Their copy states the regime case in the same
   * breath as the crossing ("…while the sector is running hot", "…in a hot sector it has tended to be
   * masked"), which is how those two blocks were written, so splitting it back out would either
   * fabricate a seam or duplicate the sentence.
   */
  phaseInObservation?: boolean;
  /**
   * ★ COALESCED ENTRIES ONLY — the constituent that fired but does NOT speak, named as a fact.
   *
   * Coalescing consolidates; it does not suppress (Coalescing ruling §1). When one move crosses several
   * marks the entry speaks at most ONE claim, from one named constituent — but the others still fired,
   * and a reader must be able to see that they did. This carries that line.
   *
   * ⚠ IT IS NOT THE `movement` CLAUSE, THOUGH IT JOINS AT THE SAME POSITION. The real movement clause is
   * DERIVED from the value series (`MOVEMENT_COPY_BY_BASIS`) and states how the defining quantity moved
   * over the run. This is a statement about which OTHER RULE was satisfied by the same move. Routing it
   * through the derived slot would have the entry claim a measurement it did not make; giving it its own
   * field keeps "what else fired" separate from "how the number moved", which is the distinction
   * `coalescedFrom` vs `claimSource` exists to preserve on the record.
   *
   * Absent on every non-coalesced pattern — an optional key, for the reason PatternFacts.largeMoveCutPp
   * gives at length.
   */
  constituentFact?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ NO FIGURES ON A CARD. THE REGISTER CARRIES WHAT THE NUMBER USED TO. ★★
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Every n, hit-rate and effect size is gone from the copy below. `evidenceStats` still holds all three
// on each record and is still the truth — it feeds the education layer — but it no longer reaches a
// card, because a reader handed "+5.8%, 63% positive (n=19)" cannot tell whether that is a finding or
// a coincidence, and the figure lends an air of precision the sample does not support.
//
// What replaces it is the pattern's declared `confidence`. Robust patterns speak in "consistently" and
// "in most of these"; directional ones in "in the few cases of this we have" and "this has tended to".
// The reader gets the strength of the evidence in the only form that survives a small n honestly.
//
// ── ★ TWO COPY RULES GOVERN EVERY STRING BELOW ───────────────────────────────────────────────────
//  1. SPEAK IN PILLARS, NEVER IN PRICE. The model measures four pillars, so a claim may only be about
//     those. "The price fell" is a return claim this model never made and cannot support; "the Market
//     pillar came back toward Foundation" is what was actually observed.
//  2. THE TYPICAL CASE, NEVER THE AVERAGE. "More often than not", "in most of these", "has tended to"
//     are permitted; "on average" and every central-tendency phrasing is not. This supersedes T9's old
//     display note: its mean (+0.6%) is outlier-dragged and reads mildly POSITIVE while roughly
//     two-thirds of cases fell. Prose written from the hit-rate cannot express a mean, and should not.
//
// `scripts/verify-copy-register.ts` asserts both, plus the advisory ban, rather than trusting review.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ INTENSITY CARRIED BY THE SENTENCE, NOT BY AN ADVERB SLOT.
 *
 * ⚠ "ONLY SHARPLY" IS A CONTRADICTION, AND IT SHIPPED. The first version was one sentence with a
 * swapped adverb — "…though only ${modestly|moderately|sharply} so far" — which reads correctly at the
 * bottom of the range and breaks at the top: "only" is a diminisher, so pairing it with the strongest
 * word produced a card that hedged and shouted in the same breath. Three whole shapes instead, so the
 * strength of the reading is in the sentence's structure rather than in one interchangeable word.
 *
 * ⚠ IT STILL NAMES NO THRESHOLD. "Approaching the level where this fires" describes the MODEL, not the
 * company, and turns a reading into a countdown. The tier word the rule already stamped selects a
 * shape; where our bars sit is never stated.
 *
 * Defaults to the mildest shape: a Building card is by definition the least-developed state, so where
 * no tier was stamped the quiet reading is the safe one.
 */
const BUILDING_COPY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  divergence_D1_price_ahead_quality: {
    material: "The price is running ahead of what the balance sheet shows, though modestly so far.",
    stretched: "The price is running ahead of what the balance sheet shows, and by a moderate margin.",
    extreme: "The price is running well ahead of what the balance sheet shows.",
  },
  divergence_D2_price_ahead_trajectory: {
    material: "The Market pillar is moving ahead of the trajectory, though modestly so far.",
    stretched: "The Market pillar is moving ahead of the trajectory, and by a moderate margin.",
    extreme: "The Market pillar is moving well ahead of the trajectory.",
  },
};

const buildingCopy = (key: string, ev: Ev): string => {
  const shapes = BUILDING_COPY[key];
  return shapes[str(ev.tierWord)] ?? shapes.material;
};

/** The phase stamped on THIS firing, or null when it could not be established. Never the live phase. */
const firedInPhase = (ev: Ev): string | null => {
  const stamp = ev[REGIME_EVIDENCE_KEY] as { regime?: unknown } | undefined;
  return stamp && typeof stamp.regime === "string" ? stamp.regime : null;
};

const PATTERN_CLAUSES: Record<string, (ev: Ev) => PatternClauseParts> = {
  divergence_D1_price_ahead_quality: (ev) => ({
    // ★ TWO OBSERVATIONS, ONE PATTERN. Building is not a hedged Formed — it is a different sentence
    //   about a different fact: the shape is present, the configuration is not complete. It states the
    //   mechanism at the intensity present and stops; the consequence lives in `size`, which
    //   `atEvidencedTier` withholds from a Building card structurally.
    observation: isBuilding(ev)
      ? buildingCopy("divergence_D1_price_ahead_quality", ev)
      : "The price is running well ahead of what the balance sheet supports. Gaps like this close one of two ways: the business grows into the price, or the Market pillar comes back toward Foundation.",
    size: "More often than not it has been the Market pillar that moved.",
  }),

  divergence_D2_price_ahead_trajectory: (ev) => ({
    observation: isBuilding(ev)
      ? buildingCopy("divergence_D2_price_ahead_trajectory", ev)
      : "The Market pillar is running ahead of the trajectory — an improvement is being priced that the results have not delivered.",
    // ★ THE REGISTER RESTORED. D2 is declared `robust` and its claim carried no register at all — the
    //   reader got no signal of the evidence's strength on the one card where the field exists to
    //   supply it. The robust register ("in most cases of this") now closes the clause.
    size: "This can close quickly in either direction; a single set of results is enough to settle it. In most cases of this, it has been the Market pillar that moved.",
  }),

  divergence_D3_ownership_building_weak_foundation: (ev) => ({
    // ⚠ A MOVEMENT PATTERN'S BUILDING SENTENCE NAMES NO THRESHOLD. It used to say the move was "N
    //   points short of the 8 the evidenced population was selected on" — which describes our bar, not
    //   the company, and reads as a countdown to a firing.
    observation: isBuilding(ev)
      ? "Institutional ownership has risen, though by less than the movement we have measured cases of."
      : "Institutional ownership is rising while Foundation still reads as weak. Someone is adding to a position against what the published numbers show.",
    // ★ THE RELAXED BRANCH IS GONE, NOT REWORDED. Its old text named the evidenced pattern and then
    //   withheld it, which still borrows its authority. At the relaxed tier D3 emits observation +
    //   movement + boundary and stops; `atEvidencedTier` gates this, so no branch exists here.
    // ★ THE REGISTER FOLLOWS THE CONFIDENCE TIER. Register is the reader's only signal of sample
    //   strength, so it follows the pattern's confidence tier rather than being chosen per record. D3
    //   is robust (n=26) under the n≈20 boundary (CONFIDENCE_ROBUST_MIN_N) and speaks the robust form.
    size: "In most cases of this, the Market pillar has strengthened in the readings that followed.",
  }),

  divergence_D4_ownership_exiting_healthy: (ev) => ({
    observation: isBuilding(ev)
      ? "Institutional ownership has fallen, though by less than the movement we have measured cases of."
      : "Institutional ownership has fallen while Foundation still reads as sound. This may be profit-taking, a mandate change, or a view forming ahead of the accounts — the model cannot tell which.",
    size: "In the few cases of this we have, Foundation has tended to weaken in the readings that followed.",
  }),

  divergence_D5_laggard_catching_up: () => ({
    observation:
      "Foundation was already strong and the trajectory is now turning up toward it. The weaker pillar is moving toward the stronger one rather than away — the direction of travel is what separates this from the same rise on a deteriorating base.",
    size: "We have only a handful of cases; this has tended to be the more constructive version.",
  }),

  divergence_D6_quality_rolling_over: () => ({
    // ⚠ THE LAST SENTENCE IS AN EXPLICIT NON-CLAIM AND STAYS IN THE OBSERVATION. "The model cannot
    //   distinguish" is a statement about our own limits — it is never gated, because withholding it
    //   at the relaxed tier would leave the card sounding more certain than it is.
    observation:
      "Foundation is strong but Momentum has slowed and is now turning the other way. The business is not weak — it is no longer following its own stronger trend. Whether that is a seasonal dip, a one-off, or the start of something the model cannot distinguish.",
    size: null, // a crossing — no severity gradient (see the block header)
  }),

  divergence_D7_trajectory_breaking_base_holds: () => ({
    observation: "The balance sheet is still sound but the operating trajectory has broken into weak territory.",
    // ⚠ D7 IS A CROSSING AND STILL CARRIES A CLAIM. `size` is the CLAIM slot, not a gap-magnitude
    //   slot — the §1.2 severity gradient is what crossings lack, not the ability to say what the
    //   configuration has done. D7 is strict (no relaxed register) and never stamps Building, so this
    //   is always emitted; routing it through `size` keeps it gated by the one rule that gates claims.
    size: "In the few cases of this we have, the intact base did not cushion it — the reading was more negative than the trajectory break alone.",
  }),

  divergence_S2_sticky_divergence: () => ({
    // ★ THE DURATION LIVES IN THE `movement` CLAUSE, WHICH IS WHERE IT BELONGS — sourced from the
    //   value series like every other pattern's, not from one pattern's private phrasing.
    observation: "These readings have disagreed across more than one period and are not converging.",
    size: "At this distance neither pillar reliably closes toward the other at the next reading. The tension is real; when it resolves is not something the model can tell you.",
  }),

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★ THE COALESCED ENTRIES. One move across several marks — ONE entry (Coalescing ruling §1).
  //
  // ⚠ EVERY SENTENCE BELOW IS VERBATIM AS RULED (copy ruling §1–§3). Do not rewrite, re-punctuate or
  //   "tighten" any of it. The constituent crossings are named as FACTS inside the entry — that copy
  //   is here too, in the `movement` slot, because consolidating must never make a fired rule invisible.
  //
  // ⚠ WHERE THE CLAIM LIVES. `size` is the CLAIM slot (D7's note explains why a crossing may still use
  //   it), and `atEvidencedTier` gates it. An entry ruled `described` — D6+D7 and T5+T8 — emits
  //   `size: null` and therefore carries NO consequence clause at all, which is exactly what
  //   `claimSource: null` means on the record.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // ── D6+D7 · `described`. claimSource null. The mechanism, and nothing after it. ─────────────────
  divergence_D6_D7_trajectory_collapse: () => ({
    observation:
      "The trajectory has fallen from exceptional to weak in a single reading, while the balance sheet still reads as strong. A move of that span in one step means one set of results carried it across the whole ordinary range. Foundation is drawn from statements that move slowly, so its strength describes a period that predates this change.",
    // ★ NO CONSEQUENCE CLAUSE, BY RULING. The combined configuration sits outside the observed range of
    //   both constituents, and the adjacent 15+ deterioration bucket showed no clean negative — so
    //   speaking either constituent's claim here would run against the measurement that bears on it.
    size: null,
  }),

  // ── T2+T3 · the claim is REGIME-SELECTED, so the observation is too. ────────────────────────────
  // T3 reads true in HOT only; T2 is masked in HOT and reads true in two-sided markets. The maps are
  // complementary, so exactly one constituent may speak in every phase and never both. The variant is
  // chosen HERE (like T3's own copy does) rather than appended, because the phase is part of the
  // sentence. The constituent that does NOT speak is named as a fact in `movement`.
  //
  // ⚠ THE UNKNOWN PHASE IS NOT THE CALM PHASE — T3's own rule, and it applies with more force here.
  //   With no established phase we cannot tell which constituent is permitted to speak, so NEITHER
  //   does: the entry falls back to the bare mechanism and emits no claim.
  trajectory_B_T2_T3_deterioration_out_of_top_band: (ev) => {
    const phase = firedInPhase(ev);
    if (phase === "HOT") {
      return {
        observation:
          "The overall reading has left the top band in a single step. That band describes a business whose condition the market has generally already recognised, so what has slipped is the thing that supported that recognition. Here it has slipped while the wider sector is still running.",
        // claim_source: T3 — the only constituent whose regime map permits speech in HOT.
        // ★ THE DIRECTIONAL REGISTER, BECAUSE T3 IS THE SPEAKER. The register belongs to the CLAIM, not
        //   to the entry (ruling: confidence travels with claim_source), and T3's population is small.
        //   Since the figures were stripped from cards, this phrase is the reader's only signal of how
        //   much evidence stands behind the claim — a robust register here would overstate it.
        size: "In the few cases of this we have, the price has moved down over the following period rather than holding up.",
        constituentFact: "The reading also fell materially from its prior level.",
        phaseInObservation: true,
      };
    }
    if (phase === null) {
      return {
        observation:
          "The overall reading has fallen materially from a high base, and in the same move left the top band.",
        size: null, // phase unknown ⇒ neither constituent is licensed to speak
      };
    }
    return {
      observation:
        "The overall reading has fallen materially from a high base, and in the same move left the top band. A business that was reading as sound is measurably less so, and the sector around it is not running, so the change stands on its own rather than being carried by conditions.",
      // claim_source: T2. ⚠ SAME-WINDOW BY DESIGN — "over the same period as", never "after". T2's
      //   evidence is same-window and the ruling is explicit that this must not be rewritten forward.
      size: "More often than not, the price has moved down over the same period as a change of this kind rather than holding up.",
      constituentFact: "The reading also crossed out of the top band.",
      phaseInObservation: true,
    };
  },

  // ── T1+T4 · T1 speaks; T4 is named as a fact. ──────────────────────────────────────────────────
  // T1 carries a measured population and the `robust` register; T4's sample was never preserved, which
  // independently disqualifies it from speaking. See the record's `claimSource`.
  trajectory_D_T1_T4_recovery_out_of_low_zone: () => ({
    // ★ THE THIRD SENTENCE IS LOAD-BEARING (ruling §2). It stops the reader taking a recovery reading
    //   as early notice — which the low zone's strong same-window tracking would otherwise invite.
    observation:
      "The overall reading has risen out of the low zone and into steady territory in a single step. Readings this low describe a business under real strain, so a move of this size reflects a change in the underlying accounts rather than a shift in sentiment. This reading is built from results already published, so the improvement it records is one the business has already been through.",
    size: "In most cases of this kind, the price has risen over the same period.",
    constituentFact: "The reading also crossed up through the boundary into steady.",
  }),

  // ── T5+T8 · `described` on R1 grounds. claimSource null. ────────────────────────────────────────
  trajectory_D_T5_T8_foundation_weak_to_strong: () => ({
    // ★ THE NAMED CAUSES ARE NOT A RANKED SPECULATION (ruling §3). They are the set of things that can
    //   move a slow pillar this far in one reading, offered so the reader knows what to look up in the
    //   accounts. No cause is stated as operative.
    observation:
      "The balance-sheet reading has moved from below its weak mark into its strong zone in a single step. Foundation is drawn from annual and quarterly statements and ordinarily moves in small increments, so a change of this span means the accounts themselves changed shape — a restructuring, a disposal, a return to profit, or something comparable. What the reading now describes is a different balance sheet, not a gradually improving one.",
    // ★ NO CONSEQUENCE CLAUSE. Both constituents' claims were measured on ordinary-sized moves and do
    //   not survive at this magnitude — R1: reaction does not scale with move size, and inverts at the
    //   extremes.
    size: null,
  }),

  trajectory_D_T1_recovery_low_zone: () => ({
    observation: "A struggling business is turning, driven by the underlying pillars rather than the Market pillar alone.",
    size: "In most cases of this, the Market pillar had already begun moving by the time this showed.",
  }),

  trajectory_B_T2_deterioration_high_base: () => ({
    observation: "A business that was sound is measurably weakening.",
    size: "In most cases of this, the Market pillar followed.",
  }),

  trajectory_B_T3_falling_out_of_pristine: (ev) => {
    // ★ THE PHASE IS PART OF THE SENTENCE FOR T3, so the variant is selected here rather than appended.
    //   ⚠ AND THE UNKNOWN CASE IS NOT THE CALM CASE. With no established phase we must not assert
    //   "markets are calm" — we fall back to the bare crossing and let `regimeSentence` say that the
    //   phase could not be established, which is why `phaseInObservation` is false on that branch only.
    const phase = firedInPhase(ev);
    if (phase === "HOT") {
      return {
        observation:
          "The overall reading has slipped out of the top band while the sector is running hot. In the few cases of this we have, a fully-priced business losing the thing that justified the price was the least forgiving combination.",
        size: null,
        phaseInObservation: true,
      };
    }
    if (phase === null) {
      return { observation: "The overall reading has slipped out of the top band.", size: null };
    }
    return {
      observation:
        "The overall reading has slipped out of the top band. Markets are calm, so this reading now rests on what future results deliver rather than on anything the crossing itself carries.",
      size: null,
      phaseInObservation: true,
    };
  },

  trajectory_D_T4_recovering_out_of_below_par: () => ({
    observation: "The overall reading has crossed into steady. A recovery that has held long enough to cross a band.",
    // ★ NULL FOR TWO INDEPENDENT REASONS, AND BOTH NOW HOLD STRUCTURALLY.
    //   1. It is a crossing, so §1.2's severity gradient does not apply (the original reason).
    //   2. ★ IT SPEAKS NO CLAIM AT ALL — `confidence: "described"`, ruled. T4's sample was never
    //      preserved, and since the register is now the reader's only evidence signal, a pattern that
    //      cannot be tiered cannot speak. This was already true incidentally; it is now enforced by
    //      the `described` declaration on the record, which verify-copy-register.ts §4 asserts emits
    //      NEITHER register. If (2) is ever lifted by recovering the sample, (1) still holds.
    size: null,
  }),

  trajectory_D_T5_foundation_out_of_weak: () => ({
    observation: "The latest results moved the balance-sheet reading out of weak territory.",
    // ⚠ "MOST RELIABLE" WAS REMOVED, AND NOT FOR TONE. `reliably`/`reliable` is on the evidence
    //   register's UNIVERSAL deny list — the N1 escape that gate was built to catch — and since the
    //   D/S/T clause copy is now RENDERED INTO that scan, this claim tripped it. The claim itself is
    //   real (T5 is `confidence: "robust"`) and is kept; only the banned adjective is gone. The
    //   register phrase "consistently" is retained deliberately: with the figures stripped from
    //   cards it is the reader's only signal of how strong the evidence behind this is.
    size: "Of the single-pillar improvements, this one has held up most consistently.",
  }),

  trajectory_B_T6_momentum_breaking_into_weak: () => ({
    // T6's copy states BOTH regime cases in one breath, so it is phase-independent and safe to render
    // whatever the stamp says — including when there is no stamp at all.
    // ★ THE ROBUST REGISTER, MATCHING THE RECORD — "has tended to" was the DIRECTIONAL vocabulary on a
    //   pattern declared `robust`, understating evidence that is actually measured. The mirror image of
    //   D3's mismatch, and equally invisible to a reader who can no longer see n.
    observation:
      "The operating trajectory has broken into weak territory. The balance sheet may still be intact, but the direction of the business has changed. This reads most clearly in calm markets; in a hot sector it has tended to be masked.",
    size: null, // a crossing
    phaseInObservation: true,
  }),

  trajectory_D_T7_momentum_improving_while_weak: (ev) => ({
    // ★ R3 IS RETAINED, IN PILLAR LANGUAGE. On a large rise the copy must state that the move has
    //   already happened — before results producing a 15+ point Momentum gain, the Market pillar had
    //   already run. Never "you're early" (FORWARD_LANGUAGE_BANS enforces that from the other side).
    //   The ruled copy for T7 does not mention R3 either way, and dropping a measured protection
    //   because a rewrite was silent about it would be losing it by accident.
    observation:
      "The turn is happening while the business still reads as weak — the earliest point at which a recovery becomes visible in the numbers." +
      (ev.largeMovePriceAlreadyRan
        ? " On a move this size the Market pillar has usually already moved before the reading catches up."
        : ""),
    size: null, // ⚠ the authored copy quotes no population — nothing to gate. See the block header.
  }),

  trajectory_D_T8_foundation_strong_improving: () => ({
    observation: "A business that was already sound is getting sounder.",
    size: "Uncommon, and in the few cases of this we have, it has held.",
  }),

  trajectory_B_T9_foundation_weak_declining: () => ({
    observation: "A business that was already weak is continuing to erode. Not a break — a slow one.",
    // ★ THE TYPICAL CASE, NOT THE MEAN — and this pattern is why the rule exists. T9's mean is +0.6%
    //   and reads mildly POSITIVE; roughly two-thirds of cases fell. A sentence written from the mean
    //   would tell the reader the opposite of what the study found, so the prose is written from the
    //   hit-rate and states no figure at all.
    size: "More often than not, Foundation deterioration of this kind has shown up in the Market pillar in the readings that followed.",
  }),
};

/**
 * ★ THE COMPOSER. Five clauses, fixed order, each independently included or omitted.
 *
 * `lifecycle` is optional: without it the movement clause is simply absent (and `resolution` with it),
 * which is exactly what a caller with no history should render. Every other clause is unaffected, so a
 * consumer that never adopts lifecycles keeps working and keeps getting a complete sentence.
 */
export function composeVerdict(key: string, evidence: unknown, lifecycle: FindingLifecycle | null = null): ComposedVerdict {
  const ev = (evidence && typeof evidence === "object" ? evidence : {}) as Ev;
  const parts = PATTERN_CLAUSES[key];
  const byType = new Map<ClauseType, string>();

  if (parts) {
    const p = parts(ev);
    byType.set("observation", p.observation);

    // ★ BAND CONTEXT — gap-basis only, and NOT gated by the claim rule. See bandContextClause.
    //   Movement/crossing patterns have no standing two-pillar placement to report.
    if (isPatternKey(key) && PATTERN_FACTS[key].basis === "gap") {
      const bc = bandContextClause(key, ev);
      if (bc) byType.set("band_context", bc);
    }

    // ── movement — the value history, plus how it closed when it did ──
    //
    // ⚠ THE TWO MUST NOT BOTH ANNOUNCE THE CLOSURE. The movement vocabulary's `closed` case says "The
    //   gap has closed back under the level at which it carries meaning", and all three ruled ended
    //   bodies now OPEN with "The gap has closed." Emitting both gave "The gap has closed back under
    //   the level at which it carries meaning. The gap has closed. …" — a stutter, and the second
    //   sentence is the one carrying the attribution. So where a resolution is established it speaks
    //   alone; the movement line is what renders when there is a path but no typed closure.
    const res = resolutionClause(lifecycle);
    const mv = res ? null : movementClause(lifecycle, ev);
    // ★ THE CONSTITUENT FACT LEADS THE MOVEMENT SLOT ON A COALESCED ENTRY. It states which OTHER rule
    //   the same move satisfied — the guarantee that consolidating never makes a fired rule invisible
    //   (Coalescing ruling §1). It is placed FIRST because it is about the event the card is reporting,
    //   whereas the derived movement line is about how the quantity has travelled since; and it is
    //   emitted UNCONDITIONALLY, never gated by the claim rule, because it asserts no consequence —
    //   suppressing it on a `described` entry would hide the very fact that two rules fired.
    const movement = [p.constituentFact ?? null, mv, res].filter((s): s is string => !!s).join(" ");
    if (movement) byType.set("movement", movement);

    // ── the claim rule. Relaxed ⇒ no size AND no phase. The card describes and stops. ──
    const atTier = atEvidencedTier(key, ev);
    if (atTier && p.size) byType.set("size", p.size);
    // ⚠ AND NOT WHEN THE OBSERVATION ALREADY CARRIES IT (T3/T6) — see PatternClauseParts.
    if (atTier && !p.phaseInObservation) {
      const phase = regimeSentence(ev).trim();
      if (phase) byType.set("phase", phase);
    }
  } else {
    // Not a D/S/T pattern — its authored renderer is one undivided observation. It has no record, so
    // no tier, no regime map and no value series: the other three clauses are structurally absent
    // rather than withheld.
    const fn = VERDICTS[key];
    const out = fn ? safeRender(fn, ev) : "";
    if (out) byType.set("observation", out);
  }

  const boundary = doesntMean(key);
  if (boundary) byType.set("boundary", boundary);

  const clauses = CLAUSE_ORDER.filter((t) => byType.has(t)).map((t) => ({ type: t, text: byType.get(t)! }));
  // ⚠ `boundary` is excluded from the joined text — see ComposedVerdict.text's note.
  const text = clauses.filter((c) => c.type !== "boundary").map((c) => c.text).join(" ");
  return { clauses, text };
}

/**
 * ★ THE ENDED-FINDING CARD (Part 4) — what it was, how long it stood, that it has closed, and how.
 *
 * ⚠ OBSERVATION + MOVEMENT + BOUNDARY ONLY. No `size`, no `phase`, on any ended card. Both of those
 * qualify a claim about a condition that HOLDS; this one does not hold any more. Quoting the study's
 * measured outcome beside a closed divergence would attach a live population's reading to a stock that
 * has left the population — the same category error the relaxed-tier rule prevents on firing cards,
 * arriving from the other direction.
 *
 * The observation is stated in the PAST TENSE, from the run's own span, so a reader cannot mistake it
 * for something standing today. It is composed from the lifecycle's declared facts (period keys, run
 * length, the value at each end) rather than from a fired row, because by definition there is no
 * current row to read.
 */
export function composeEndedVerdict(key: string, lifecycle: FindingLifecycle): ComposedVerdict {
  const name = findingName(key);
  const span =
    lifecycle.runLength > 1
      ? `stood for ${lifecycle.runLength} readings, ${lifecycle.firstSeen} to ${lifecycle.lastSeen}`
      : `stood at ${lifecycle.lastSeen}`;
  const ago =
    lifecycle.endedPeriodsAgo === 1
      ? "It closed at the next reading."
      : `It closed ${lifecycle.endedPeriodsAgo} readings ago.`;

  const byType = new Map<ClauseType, string>();
  byType.set("observation", `${name} ${span}, and is no longer standing. ${ago}`);

  // The closure itself, and — only when the typing established it — which pillar did the moving.
  const res = resolutionClause(lifecycle);
  const closed =
    lifecycle.movementPhase === "closed" && lifecycle.valueThen !== null && lifecycle.valueNow !== null
      ? `The quantity behind it went from ${f(lifecycle.valueThen, DIFFERENCE_DISPLAY_PRECISION)} to ${f(lifecycle.valueNow, DIFFERENCE_DISPLAY_PRECISION)}.`
      : null;
  const movement = [closed, res].filter((s): s is string => !!s).join(" ");
  if (movement) byType.set("movement", movement);

  const boundary = doesntMean(key);
  if (boundary) byType.set("boundary", boundary);

  const clauses = CLAUSE_ORDER.filter((t) => byType.has(t)).map((t) => ({ type: t, text: byType.get(t)! }));
  const text = clauses.filter((c) => c.type !== "boundary").map((c) => c.text).join(" ");
  return { clauses, text };
}

function safeRender(fn: (ev: Ev) => string, ev: Ev): string {
  try {
    return fn(ev);
  } catch {
    return "";
  }
}

// ── the catalog (one File-1 sentence per fired key, bound to evidence) ─────────
export const VERDICTS: Record<string, (ev: Ev) => string> = {
  // Family N (Notable) — guarded instance verdicts (fall back to the static description if the
  // engine's evidence key is absent). Spread first; keys are disjoint from the A–I set below.
  ...N_VERDICTS,

  // ── A · Critical red flags (§5A — names the flag + the single breaching stat) ──
  ownership_R1_pledge: (ev) => {
    const pct = num(ev.pledgeRatioQ);
    const rise = num(ev.qoqRisePp);
    const pctTxt = pct !== null ? `${pct.toFixed(1)}%` : "above the 50% line";
    if (rise !== null && rise > 10) {
      return `Pledged holding rose ${rise.toFixed(1)}pp this quarter to ${pctTxt} of promoter stake — a financing-stress signal that overrides the composite.`;
    }
    return `Promoter pledged holding is at ${pctTxt} of promoter stake — a financing-stress signal that overrides the composite.`;
  },
  ownership_R2_promoter_exit: (ev) =>
    `Promoter exit — promoter holding fell ${f(ev.promoterPctDropPp, 2)}pp into ${str(ev.currentPeriod)} (past the ${f(ev.thresholdPp, 0)}pp line), a genuine sell-down — not a QIP/rights dilution.`,
  foundation_R3_earnings_quality: (ev) => {
    const yrs = num(ev.consecutiveYears);
    const series = Array.isArray(ev.series) ? (ev.series as { fy?: unknown }[]) : [];
    const span = series.length ? `${str(series[0].fy)}–${str(series[series.length - 1].fy)}` : str(ev.latestPeriod);
    return `Earnings quality breakdown — net profit has exceeded operating cash flow for ${yrs ?? "≥4"} straight years (${span}).`;
  },
  foundation_R4_debt_explosion: (ev) =>
    `Debt explosion — debt-to-equity reached ${f(ev.deRatioLatest, 2)}× in ${str(ev.latestPeriod)}, crossing ${f(ev.threshold, 0)}× for the first time in 5 years.`,
  foundation_R5_interest_coverage: (ev) =>
    `Interest coverage collapse — TTM interest coverage held below ${f(ev.threshold, 1)}× for ${num(ev.consecutiveQuarters) ?? "≥2"} straight quarters (latest ${f(ev.latestTtmIC, 2)}×).`,
  ownership_R6_distribution: (ev) =>
    `Distribution pattern — promoter ${signed(ev.promoterDeltaPp)}pp and FII ${signed(ev.fiiDeltaPp)}pp both cut while retail absorbed ${signed(ev.retailDeltaPp)}pp, same quarter (${str(ev.currentPeriod)}).`,

  // ── E · Patterns (§5E — locked copy for P11/P12/P13; field-bound for the rest) ──
  ownership_P1_clean_rotation: (ev) =>
    `Clean institutional rotation — DII added (${signed(ev.diiDeltaPp)}pp) as FII trimmed (${f(ev.fiiDeltaPp, 2)}pp) with the promoter steady, into ${str(ev.period)}.`,
  ownership_P4_dual_exit: (ev) =>
    `Dual institutional exit — FII (${f(ev.fiiDeltaPp, 2)}pp) and DII (${f(ev.diiDeltaPp, 2)}pp) both cut in the same quarter (${str(ev.period)}).`,
  ownership_P5_insider_distress: (ev) => {
    const n = num(ev.distinctSellers) ?? 1;
    return `Insider-confirmed distress — ${n} insider${n > 1 ? "s" : ""} sold a net ₹${f(ev.netSellCr, 0)} Cr on an already-weak name (composite ${f(ev.composite, 0)}).`;
  },
  ownership_P6_insider_conviction: (ev) =>
    `Insider conviction — ${num(ev.distinctBuyers) ?? 1} directors/KMP bought a net ₹${f(ev.netBuyCr, 0)} Cr over the last quarter.`,
  foundation_P7_accruals: (ev) => {
    const ocf = num(ev.ocf);
    const period = str(ev.latestPeriod);
    if (ocf !== null && ocf < 0) {
      return `Accruals divergence — operating cash flow was negative (−₹${f(-ocf, 0)} Cr) against ₹${f(ev.netProfit, 0)} Cr net profit in ${period}: earnings entirely unbacked by operating cash.`;
    }
    return `Accruals divergence — operating cash backed only ${num(ev.cashBackPct) ?? "—"}% of ${period} net profit (₹${f(ev.accrualsGap, 0)} Cr of profit not converted to cash).`;
  },
  foundation_P8_receivables: (ev) => {
    const rev = num(ev.revenueGrowthPct);
    const dir = rev !== null && rev >= 0 ? "grew" : "fell";
    return `Capital tied in receivables — receivables grew ${f(ev.receivablesGrowthPct, 1)}% in ${str(ev.latestPeriod)} while revenue ${dir} ${abs1(rev)}% (a ${f(ev.outpacePp, 1)}pp gap).`;
  },
  ownership_P10_promoter_defense: (ev) => {
    const mkt = num(ev.marketPillar);
    const n = num(ev.buyTxns) ?? 0;
    return `Promoter defense buying — the promoter bought a net ₹${f(ev.promoterNetBuyCr, 0)} Cr (${n} trade${n === 1 ? "" : "s"}) into price weakness${mkt !== null ? ` (Market ${Math.round(mkt)})` : ""}.`;
  },
  // P11/P12/P13 — File 1 LOCKED copy, realized from the evidence series (verbatim render).
  momentum_P11_margin_compression: (ev) => {
    const ser = opmArrow(ev.opmSeries);
    return ser ? `Operating margin has been compressing for ${num(ev.quartersOfDecline) ?? ""} quarters: ${ser}.` : "";
  },
  momentum_P12_margin_recovery: (ev) => {
    const ser = opmArrow(ev.opmSeries);
    return ser ? `Operating margin recovering from trough: ${ser}.` : "";
  },
  momentum_P13_revenue_inflection: (ev) => {
    const prior = num(ev.priorTtmGrowthPct);
    const latest = num(ev.latestTtmGrowthPct);
    if (prior === null || latest === null) return "";
    const delta = num(ev.deltaPp);
    const accel = delta !== null ? delta > 0 : latest > prior;
    return `Revenue growth ${accel ? "accelerated" : "decelerated"} from ${prior.toFixed(1)}% to ${latest.toFixed(1)}%.`;
  },

  // ── C · Divergence (§5C — the read layer consolidates the family; each sub-type's
  //        File-1 sentence is authored here so the consolidated card can compose them) ──
  //
  // ★ 3d · THE C2 SUBTYPE AND C3 floorLed BRANCHES ARE COPY SELECTION, NOT LOGIC — AND THE LOGIC IS
  // ALREADY IN THE RIGHT PLACE. `subtype` is decided by ruleC2 from NATIVE_ZONES.foundation.weak +
  // K2_NOTABLE (a calibrated regime test); `floorLed` is decided by ruleC3 as `foundation > momentum`.
  // Both are stamped into evidence by the rule. The renderer does not judge direction — it reads the
  // discriminant the rule set and picks the matching sentence.
  //
  // ⚠ WHICH MEANS THE FRONTEND WAS RE-IMPLEMENTING THE RULE'S OWN BRANCH EXPRESSION, one repo away
  // from the rule that defines it. If C2's discriminant were ever renamed, or C3's polarity flipped,
  // the card would keep rendering and silently say "smart money building under weakness" about a
  // stock whose owners are walking out — a directional inversion, in front of a reader, with no error
  // anywhere. Moving the renderer next to the rule closes that by construction: they now read the
  // same evidence object in the same module tree.
  // ⚠ C1 / C2 / C3 / C-over-time are RETIRED (catalogue/retired-findings.ts) and have NO renderer
  //   here — deliberately, exactly as P2/P3 have none. A retired key never reaches renderVerdict
  //   because the read layer drops the row first; an entry here would be a second place to maintain a
  //   sentence for a finding we have decided is not true.

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Family C · DIVERGENCE (Vytal_Divergence_Tool_Spec Parts 2–3)
  //
  // ★ THREE PLACES THE COPY IS GATED ON EVIDENCE, NOT ON TASTE:
  //   D1/D2  never claim an independently measured figure — the split was not separately measured,
  //          so the sentence says the direction is INHERITED from the shared configuration.
  //   D3/D4  the ±8 tier selects the register. `strong` ⇒ the study's figures may be spoken;
  //          otherwise the movement is stated and its DRIVER named, with no measured claim attached.
  //   D5     the n=5 caveat rides in the sentence itself, per the spec's "display prominently".
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  // ★ THE D/S/T RENDERERS NOW DELEGATE TO THE CLAUSE COMPOSER — one home for the sentence.
  //
  // These seventeen used to hold the sentence inline, which meant the clause set and the string were
  // two authorities on the same copy and the first edit to either would have split them. VERDICTS[k]
  // is kept because every existing consumer calls it (and renderVerdict’s precedence contract is
  // asserted by a gate), but it is now a PROJECTION of composeVerdict rather than a parallel copy.
  //
  // ⚠ NO LIFECYCLE HERE, DELIBERATELY. This entry point has no history to read, so it composes the
  // clause set WITHOUT a movement clause. A caller that wants one calls composeVerdict WITH the
  // lifecycle — which is what the health view does. A lifecycle-less caller therefore keeps getting a
  // complete sentence, and the movement clause is additive rather than load-bearing.
  ...Object.fromEntries(
    Object.keys(PATTERN_CLAUSES).map((k) => [k, (ev: Ev) => composeVerdict(k, ev, null).text]),
  ),

  // ── F · Composition (§5F) ──
  composition_F1_atypical: (ev) => {
    const band = str(ev.band).replace("_", "-");
    return `A ${f(ev.composite, 0)} that isn't a typical ${band} — ${pl(ev.maskingPillar)} runs ${f(ev.maskingDevPp, 0)}pp above its band-typical (masking) while ${pl(ev.laggingPillar)} sits ${abs1(ev.laggingDevPp, 0)}pp below.`;
  },
  trajectory_F2_composition_shift: (ev) => {
    const held = ev.compositeHeld as { prior?: unknown; current?: unknown } | undefined;
    const prior = held ? f(held.prior, 0) : "—";
    const current = held ? f(held.current, 0) : "—";
    const lead = ev.leaderChanged ? ` — lead passed from ${pl(ev.leaderPrior)} to ${pl(ev.leaderCurrent)}` : "";
    return `Mix shifted while the score held (${prior}→${current})${lead}.`;
  },

  // ── G · Convergence — ⚠ RETIRED. No renderer, for the same reason as C1–C3. Its resolution
  //      typing lives on as findings/divergence/resolution.ts, un-fired and unregistered. ──

  // ── H · Ownership events (§5H) ──
  ownership_H_block_events: (ev) => {
    const n = num(ev.deals) ?? 0;
    const net = num(ev.netCr) ?? 0;
    const lean = net > 0 ? "net buying" : net < 0 ? "net selling" : "two-sided";
    return `Ownership event — ${n} block/bulk deal${n === 1 ? "" : "s"} (₹${f(ev.grossCr, 0)} Cr, ${lean}) this window.`;
  },

  // ── I · Band transition — ⚠ RETIRED (fired the excluded composite ↓62 and the untested ↑68). ──
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRAJECTORY REGIME SENTENCE — where §1.4's three tiers become words.
//
// Reads TWO things off the evidence, which were written by two different layers:
//   · the CONTRACT  (regimeTier + regimeReadPhases) — stamped by the RULE, static per pattern
//   · the PHASE     (REGIME_EVIDENCE_KEY.regime)    — stamped at FIRE TIME by the scoring pass
// Keeping them apart is what lets the rule stay a pure function while the copy stays phase-accurate.
//
// ★ THE UNKNOWN CASE IS NOT THE SAME AS THE NO-READ CASE. If the regime could not be established the
//   sentence says so; it never silently falls back to the "no directional read in this phase" line,
//   which would assert that we KNOW the phase and it happens to be uninformative.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The HOT-append for T2 (Part 2, T2 · "In a HOT regime, append").
 *
 * ⚠ "showing up in the price" → "showing up in the Market pillar". The model measures four pillars and
 * never measured a return, so a claim may only be about a pillar. This is the same substitution applied
 * across every D/T block; the observation is unchanged, only what it is an observation OF.
 */
const T2_HOT_APPEND =
  " The sector is in a strong run, which has historically postponed this kind of deterioration showing up in the Market pillar rather than cancelling it.";

// ⚠ T3_HOT AND T3_NO_READ ARE DELETED. T3's two phase variants are now whole sentences inside its own
// observation (see PATTERN_CLAUSES), because the ruled copy writes the crossing and the phase as one
// statement rather than a sentence plus an append. `phaseInObservation` stops this function running
// for T3 and T6 at all — except on T3's unknown-phase branch, which deliberately still reaches the
// "could not be established" line below.

function regimeSentence(ev: Ev): string {
  const tier = str(ev.regimeTier);
  if (!tier) return "";
  const stamp = ev[REGIME_EVIDENCE_KEY] as { regime?: unknown } | undefined;
  const phase = stamp && typeof stamp.regime === "string" ? stamp.regime : null;

  // Regime not established — say that, never imply we checked and found nothing.
  if (!phase) {
    return tier === "decides_read"
      ? " The market phase could not be established for this sector, and this reading depends on it."
      : "";
  }

  if (tier === "decides_read") {
    const phases = Array.isArray(ev.regimeReadPhases) ? (ev.regimeReadPhases as string[]) : [];
    // The phase carries a measured read — name it. (T3/T6 never reach here; their copy is inline.)
    if (phases.includes(phase)) return ` Its sector is in a ${phase} phase, where this reading has held.`;
    // ★ §1.4 line 87 — the crossing stands; the direction does not.
    return ` In a ${phase} phase this reading has no directional history.`;
  }

  if (tier === "always_display") {
    const base = ` Market phase at the time of this reading: ${phase}.`;
    return phase === "HOT" ? `${base}${T2_HOT_APPEND}` : base;
  }

  // magnitude_caveat — HOT flatters the size of the move; other phases add nothing.
  return phase === "HOT" ? " The sector is running hot, which flatters the size of moves like this one." : "";
}

/** Generic last-resort copy when no renderer matched and the engine wrote no sentence. */
function genericVerdict(key: string): string {
  const name = findingName(key);
  return familyOf(key) === "A"
    ? `${name} — an override condition that takes precedence over the composite score.`
    : `${name} — a conditional signal; review the evidence below.`;
}

/**
 * The verdict SENTENCE for a finding, bound to its evidence JSON. Prefers File 1's authored copy;
 * falls back to the engine's own assembled `verbatim`/`verdict` string, then generic.
 *
 * ★ PRECEDENCE IS THE FRONTEND'S, UNCHANGED. Do not "simplify" it to read evidence.verdict first —
 * that would silently swap which of the two authorities wins, changing the sentence on every stock
 * page in the product without a single line of copy being edited.
 */
export function renderVerdict(key: string, evidence: unknown): string {
  const ev = (evidence && typeof evidence === "object" ? evidence : {}) as Ev;
  const fn = VERDICTS[key];
  if (fn) {
    try {
      const out = fn(ev);
      if (out) return out;
    } catch {
      /* fall through to the engine-assembled string */
    }
  }
  return str(ev.verbatim) || str(ev.verdict) || genericVerdict(key);
}
