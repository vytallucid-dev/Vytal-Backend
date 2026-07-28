// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — ENTRY RESOLUTION (families UO + UH · §3.1 / §3.2), plus the negatives (§6.2) and the
// degradations (§6). Each builder is a pure function of (ReaderContext, ObjectState, mode) and returns a
// candidate ResolvedEntry or null; the assembler (arbitration.ts) reserves the floor and fills the rest
// by ladder rung. Claims are TONE-INVARIANT and rendered here (the AI reads the finished object, §6.2).
//
// BOUNDARY (Part IX), enforced at authoring time and re-scanned over the assembled output (copy.ts):
//   · no prediction, no advice, no modelled trade, no returns/basis, no reader ranking (§0.8)
//   · attention is a router, never content (§0.6) — UH6 states a binary ("first time"), never a count
//   · strength is stated and dated, never celebrated (§3.1 UO6)
//   · magnitude is never read (§0.7.1) — it is not carried into ObjectFinding
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { RUNG } from "./arbitration.js";
import {
  UH_LARGE_POSITION_PCT,
  UH_TOP_N,
  UH_SLIVER_PCT,
  UH_SLIVER_VALUE,
  UH_TYPICAL_MULT,
  UH_TYPICAL_MIN_HOLDINGS,
} from "./constants.js";
import { formatINR, pctStr, scoreStr, plural, ordinal, glossFor } from "./copy.js";
import type {
  ReaderContext,
  ObjectState,
  ObjectFinding,
  ReaderHolding,
  ResolvedEntry,
  NegativeFact,
  Degradation,
  ModeId,
} from "./types.js";
import type { ResolvedMode } from "./mode.js";

// ── Doesn't-mean strings (inherited per entry, §0.10 — the relational layer adds no verdict). ─────────
const DM = {
  UO1: "identity and grouping only; the peer group is the fair comparison set, not a quality tier.",
  UO2: "higher is not a better investment, not more upside, and not a prediction — it means sounder and calmer, and already priced.",
  UO3: "nothing flagged is not an endorsement; a flag is a place to look, not a verdict.",
  UO4: "absence of a connection is not a reason to acquire one — it is a statement about your current book, nothing more.",
  UO6: "already-strong is already priced — sound, and sound for a while, is not upside, not a forecast of continuation, and not a buy.",
  UH1: "a statement of exposure, not of whether the exposure is right — no implication about adding, trimming, or holding.",
  UH2: "account spread is bookkeeping, not diversification.",
  UH3: "naming a level we declared is not a judgement on your allocation and not a suggestion to change it.",
  UH4: "typical is descriptive, not a target.",
  UH10: "unscored is not a judgement on the stock — it is a statement about our coverage.",
  ELEVATED: "a flag is a place to look, not a verdict; its meaning is owned by its own card lower on the page.",
} as const;

const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The reader's aggregated position in THIS object — matched by constituent symbol against the entity
 *  ledger (the entity-aggregation law). null when the reader does not hold it (or the book is empty). */
export function matchHeldEntity(ctx: ReaderContext, obj: ObjectState): ReaderHolding | null {
  return ctx.book?.holdings.find((h) => h.symbols.includes(obj.symbol)) ?? null;
}

/** Whether any of the reader's holdings shares this object's sector (a superset-safe proxy for peer-group
 *  overlap: a peer group is within a sector, so no sector overlap ⇒ no PG overlap). */
function hasSectorOverlap(ctx: ReaderContext, obj: ObjectState): boolean {
  const sec = obj.sector?.displayName ?? obj.sector?.key ?? null;
  if (!sec || !ctx.book) return false;
  return ctx.book.holdings.some((h) => h.sector != null && (h.sector === sec || h.sector === obj.sector?.key));
}

// ── Self-dated duration from a Family N finding's own evidence (§3.1 duration-source precedence). Reads
//    the rule's OWN run length (`years` / `quarters`), which WINS over `standing_since` and needs no
//    snapshot-chain derivation — which is why UO6 is reachable this slice. ─────────────────────────────
function selfDatedRun(f: ObjectFinding): { label: string; count: number } | null {
  const years = asNum(f.evidence?.years);
  if (years && years >= 1) return { label: `for ${plural(years, "year")}`, count: years };
  const quarters = asNum(f.evidence?.quarters);
  if (quarters && quarters >= 1) return { label: `for ${plural(quarters, "quarter")}`, count: quarters };
  return null;
}

const OPAQUE = (entryId: string, ref: string): string => `${entryId}:${ref}`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UO — Orientation (§3.1)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

function buildUO1(obj: ObjectState, level: ReaderContext["identity"]["aiLevel"]): ResolvedEntry | null {
  // Always resolvable — identity, the stranger's floor. Honest-empty when no PG (sector alone).
  const sec = obj.sector?.displayName ?? null;
  const secClass = obj.sector?.sectorClass ?? null;
  const descriptor = sec ? `${sec}${secClass ? `, a ${secClass.toLowerCase()} name` : ""}` : "a company we catalogue";
  // The PG label is already plural-shaped ("Large-Cap Private Banks"); render the count against it verbatim.
  const claim = obj.peerGroup
    ? `${obj.displayLabel} — ${descriptor}. Sits in a peer group of ${obj.peerGroup.memberCount} ${obj.peerGroup.label}.`
    : `${obj.displayLabel} — ${descriptor}. Not yet placed in a peer group.`;
  return {
    entryId: "UO1",
    family: "UO",
    claim,
    gloss: glossFor("peer group", level),
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.ORIENTATION, relationalWeight: 0.12 },
    arithmetic: null,
    interpretationCeiling: null,
    doesntMean: DM.UO1,
    sourceRef: OPAQUE("UO1", obj.stockId),
  };
}

function buildUO2(obj: ObjectState, level: ReaderContext["identity"]["aiLevel"]): ResolvedEntry | null {
  if (!obj.isScored || !obj.snapshot) return null; // not scored → UG1 carries it (out of slice) → absent
  return {
    entryId: "UO2",
    family: "UO",
    claim: `Health is about ${scoreStr(obj.snapshot.composite)} — ${obj.snapshot.band}.`,
    gloss: glossFor("health score", level),
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.ORIENTATION, relationalWeight: 0.11 },
    arithmetic: { composite: Math.round(obj.snapshot.composite), band: obj.snapshot.band },
    interpretationCeiling: null,
    doesntMean: DM.UO2,
    sourceRef: OPAQUE("UO2", obj.stockId),
  };
}

/** UO3 — flags state. Counted by CONCERN (a positive finding is not "a thing standing"). Uses the weaker
 *  copy variant only: evaluability is not served this slice (UG9 unreachable), so "nothing flagged"
 *  cannot be qualified by history depth — recorded as a degradation. */
function buildUO3(obj: ObjectState): ResolvedEntry | null {
  if (!obj.isScored) return null;
  const concerns = obj.findings.filter((f) => f.polarity !== "positive").length;
  const claim = concerns === 0 ? "Nothing flagged." : `${plural(concerns, "thing")} standing.`;
  return {
    entryId: "UO3",
    family: "UO",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.ORIENTATION, relationalWeight: 0.1 },
    arithmetic: { concernCount: concerns },
    interpretationCeiling: null,
    doesntMean: DM.UO3,
    sourceRef: OPAQUE("UO3", obj.stockId),
  };
}

/** UO4 — connection to your book, the honest null. Fires only when a book exists, position is NEITHER,
 *  there is no sector/PG overlap, and there is no watchlist connection to assert (watchlist empty this
 *  slice — per-member overlap is UN3, out of slice). When it cannot be honestly asserted it is absent and
 *  UO1/UO2 carry the M9 floor. */
function buildUO4(ctx: ReaderContext, obj: ObjectState, mode: ResolvedMode): ResolvedEntry | null {
  if (mode.positionAxis !== "NEITHER") return null;
  if (!ctx.book?.exists) return null; // no book → UG7/UG8 (out of slice)
  if (hasSectorOverlap(ctx, obj)) return null; // a connection exists — UN would state it (out of slice)
  if ((ctx.watchlist?.count ?? 0) > 0) return null; // cannot assert "nothing in your watchlist" without UN3
  return {
    entryId: "UO4",
    family: "UO",
    claim: "Nothing in your portfolio or watchlist connects to this name or its sector.",
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.ORIENTATION, relationalWeight: 0.1 },
    arithmetic: null,
    interpretationCeiling: null,
    doesntMean: DM.UO4,
    sourceRef: OPAQUE("UO4", obj.stockId),
  };
}

/** UO6 — standing strength. Resolves on the BEST self-dating Family N finding (longest run), duration read
 *  from the rule's own evidence with `standing_since` ABSENT from the environment. Stated and dated, never
 *  celebrated (§3.1). Eligible in EVERY mode — the entry that stops an always-present card from becoming
 *  permanently scolding. Never manufactured from an absence of flags (that is UO3, a weaker claim). */
function buildUO6(obj: ObjectState): ResolvedEntry | null {
  if (!obj.isScored) return null;
  // Positive-polarity, self-dating findings only (Family N by the key namespace). Pick the longest run.
  const candidates = obj.findings
    .filter((f) => f.polarity === "positive")
    .map((f) => ({ f, run: selfDatedRun(f) }))
    .filter((x): x is { f: ObjectFinding; run: { label: string; count: number } } => x.run !== null)
    .sort((a, b) => b.run.count - a.run.count);
  if (candidates.length === 0) return null; // no positive self-dating finding → does not fire (never faked)
  const { f, run } = candidates[0];
  // Elevate by reference using the finding's OWN authored claim (clean + dated by Family N's register
  // discipline); fall back to a minimal composed claim if the rule carried no verdict string.
  const verdict = typeof f.evidence?.verdict === "string" ? (f.evidence.verdict as string) : null;
  const name = typeof f.evidence?.name === "string" ? (f.evidence.name as string) : "A standing strength";
  const claim = verdict ?? `${name} — ${run.label}.`;
  return {
    entryId: "UO6",
    family: "UO",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    // Duration from the rule's own run length (NOT the absent standing_since); snapshotCount = the run.
    standingSince: { label: run.label, snapshotCount: run.count },
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.RECOVERY_STRENGTH, relationalWeight: 0.4 },
    arithmetic: { durationLabel: run.label, runLength: run.count, source: "rule_evidence" },
    interpretationCeiling: null,
    doesntMean: DM.UO6,
    sourceRef: OPAQUE("UO6", f.key),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UH — Holding (§3.2). Join facts, authored here, available nowhere else.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** UH1 — the position floor, with UH2 (≤2 accounts) and UH9 (sliver) FOLDED in. Never renders a return,
 *  gain, loss, or basis (§0.8). Honest-empty when the value is not yet available (state accounts, never a
 *  fabricated value). */
function buildUH1(ctx: ReaderContext, obj: ObjectState, held: ReaderHolding | null): ResolvedEntry | null {
  if (mode_isHeld(ctx) === false) return null;
  const accounts = held?.accountLabels ?? [];
  const nAcct = accounts.length;
  const value = held && held.value > 0 ? held.value : null;
  const weightPct = held && held.weightPct > 0 ? held.weightPct : null;
  const isSliver = weightPct != null && value != null && weightPct < UH_SLIVER_PCT && value < UH_SLIVER_VALUE;

  let claim: string;
  if (value == null) {
    // Honest-empty: value not resolvable yet (no snapshot / unpriceable) — state the position, never fake ₹.
    claim = nAcct >= 1 ? `You hold ${obj.displayLabel} across ${plural(nAcct, "account")}. Position value isn't available yet.` : `You hold ${obj.displayLabel}. Position value isn't available yet.`;
  } else if (isSliver) {
    claim = weightPct != null ? `${formatINR(value)}, under 1% of your book.` : `${formatINR(value)}.`;
  } else {
    const weightClause = weightPct != null ? ` About ${pctStr(weightPct)} of your book.` : "";
    if (nAcct >= 2 && nAcct <= 2) {
      claim = `${formatINR(value)} across ${plural(nAcct, "account")}.${weightClause}`;
    } else if (nAcct === 1) {
      claim = `${formatINR(value)} in ${accounts[0]}.${weightClause}`;
    } else if (nAcct >= 3) {
      // ≥3 accounts: UH1 states value + weight; UH2 (separate entry) names the accounts.
      claim = `${formatINR(value)} across ${plural(nAcct, "account")}.${weightClause}`;
    } else {
      claim = `${formatINR(value)}.${weightClause}`;
    }
  }

  const rel = value == null ? 0.5 : isSliver ? 0.05 : Math.max(0.5, (weightPct ?? 0) / 100);
  return {
    entryId: "UH1",
    family: "UH",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.POSITION_FACT, relationalWeight: rel },
    arithmetic: { value: value ?? null, weightPct: weightPct != null ? Math.round(weightPct) : null, accountCount: nAcct, sliver: isSliver },
    interpretationCeiling: null,
    doesntMean: DM.UH1,
    sourceRef: OPAQUE("UH1", obj.stockId),
  };
}

/** UH2 — held across ≥3 accounts (≤2 is folded into UH1). Account labels are user-authored (never IDs). */
function buildUH2(ctx: ReaderContext, obj: ObjectState, held: ReaderHolding | null): ResolvedEntry | null {
  if (!held || held.accountLabels.length < 3) return null;
  return {
    entryId: "UH2",
    family: "UH",
    claim: `Held in ${plural(held.accountLabels.length, "account")}: ${held.accountLabels.join(", ")}.`,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    // Account spread is bookkeeping (§3.2) — a low-priority context facet, not the rung-5 position JOIN
    // fact (that is UH1). It fills a remaining slot, never crowds the object's standing findings.
    weight: { ladderRung: RUNG.CONTEXT, relationalWeight: 0.3 },
    arithmetic: { accountCount: held.accountLabels.length },
    interpretationCeiling: null,
    doesntMean: DM.UH2,
    sourceRef: OPAQUE("UH2", obj.stockId),
  };
}

/** UH3 — position scale in your book: top-N by value, or above the declared heavy-name level. Thresholds
 *  are ATTRIBUTED to Vytal ("the level at which we mark…"), never phrased as an external norm (§3.2). */
function buildUH3(ctx: ReaderContext, obj: ObjectState, held: ReaderHolding | null): ResolvedEntry | null {
  if (!held || !ctx.book) return null;
  const values = ctx.book.holdings.map((h) => h.value).filter((v) => v > 0).sort((a, b) => b - a);
  const rank = held.value > 0 ? values.indexOf(held.value) + 1 : 0;
  const isTopN = rank >= 1 && rank <= UH_TOP_N;
  const isHeavy = held.weightPct >= UH_LARGE_POSITION_PCT;
  if (!isTopN && !isHeavy) return null;
  const claim = isTopN
    ? `Your ${ordinal(rank)}-largest position.`
    : `About ${pctStr(held.weightPct)} of your book — above the ${UH_LARGE_POSITION_PCT}% level at which we mark a single name as heavy.`;
  return {
    entryId: "UH3",
    family: "UH",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    // Single-name heaviness is the reader's STRUCTURAL EXPOSURE — rung 6's rationale (§4.1), the same
    // class as UN2's peer-group concentration though a different cut. Ranks above the object's own
    // findings ("self before other") but below UH1's position join fact.
    weight: { ladderRung: RUNG.POND_EXPOSURE, relationalWeight: Math.max(0.3, held.weightPct / 100) },
    arithmetic: { rank: isTopN ? rank : null, weightPct: Math.round(held.weightPct), heavyLevelPct: UH_LARGE_POSITION_PCT },
    interpretationCeiling: null,
    doesntMean: DM.UH3,
    sourceRef: OPAQUE("UH3", obj.stockId),
  };
}

/** UH4 — position scale vs your typical position. Needs enough scored holdings for a "typical" to mean
 *  something. Typical is descriptive, not a target (§3.2). */
function buildUH4(ctx: ReaderContext, obj: ObjectState, held: ReaderHolding | null): ResolvedEntry | null {
  const book = ctx.book;
  if (!held || !book || book.typicalPositionValue == null) return null;
  if (book.scoredHoldingsCount < UH_TYPICAL_MIN_HOLDINGS) return null;
  if (held.value <= 0) return null;
  const typical = book.typicalPositionValue;
  const larger = held.value >= UH_TYPICAL_MULT * typical;
  const smaller = held.value <= typical / UH_TYPICAL_MULT;
  if (!larger && !smaller) return null;
  const claim = larger
    ? `Larger than your typical position (${formatINR(typical)}).`
    : `Smaller than your typical position (${formatINR(typical)}).`;
  return {
    entryId: "UH4",
    family: "UH",
    claim,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    // "Typical is descriptive, not a target" (§3.2) — a context facet (rung 15), below the object's
    // standing findings and orientation; it fills a remaining slot on a listy mode (M3), never crowds M1.
    weight: { ladderRung: RUNG.CONTEXT, relationalWeight: 0.25 },
    arithmetic: { typicalValue: Math.round(typical), direction: larger ? "larger" : "smaller" },
    interpretationCeiling: null,
    doesntMean: DM.UH4,
    sourceRef: OPAQUE("UH4", obj.stockId),
  };
}

/** UH10 — held but not scored. UH1 still fires (position is knowable without a score); this pairs a
 *  coverage note. UG1 owns the full reason (out of slice) — here it states the honest gap in one line. */
function buildUH10(ctx: ReaderContext, obj: ObjectState): ResolvedEntry | null {
  if (mode_isHeld(ctx) === false || obj.isScored) return null;
  const reason = obj.coverage.reason ? ` — ${obj.coverage.reason}` : ".";
  return {
    entryId: "UH10",
    family: "UH",
    claim: `We don't score this stock yet${reason.startsWith(" —") ? reason : "."}`,
    gloss: null,
    temporalClass: "CONDITION",
    standingSince: null,
    isNewSinceLastLook: false,
    weight: { ladderRung: RUNG.GAP, relationalWeight: 0.2 },
    arithmetic: null,
    interpretationCeiling: null,
    doesntMean: DM.UH10,
    sourceRef: OPAQUE("UH10", obj.stockId),
  };
}

// ── ELEVATED — the object's own standing findings, elevated by reference (§0.10). Uses the finding's OWN
//    claim; the relational layer never re-interprets it. Rung by SEVERITY (never polarity, never
//    magnitude). Positive findings are NOT elevated here — they feed UO6. ──────────────────────────────
function buildElevated(ctx: ReaderContext, obj: ObjectState): ResolvedEntry[] {
  const held = ctx.heldThisObject;
  const out: ResolvedEntry[] = [];
  for (const f of obj.findings) {
    if (f.polarity === "positive") continue; // strength is UO6's job, not an elevated concern
    const sev = (f.severity ?? "").toLowerCase();
    let rung: number;
    if (f.kind === "red_flag" || sev === "critical") rung = held ? RUNG.CRITICAL_HELD : RUNG.CRITICAL_UNPOSITIONED;
    else if (sev === "high") rung = RUNG.HIGH_SEVERITY;
    else if (sev === "recovery") rung = RUNG.RECOVERY_STRENGTH;
    else if (sev === "medium") rung = RUNG.MEDIUM_SEVERITY;
    else rung = RUNG.CONTEXT;
    const verdict = typeof f.evidence?.verdict === "string" ? (f.evidence.verdict as string) : null;
    const claim = verdict ?? (f.kind === "red_flag" ? "A red flag is standing on this stock." : "A finding is standing on this stock.");
    out.push({
      entryId: `ELEVATED:${f.key}`,
      family: "ELEVATED",
      claim,
      gloss: null,
      temporalClass: f.temporalClass,
      standingSince: null, // standing_since is absent this slice (degradation) — duration suppressed
      isNewSinceLastLook: false,
      weight: { ladderRung: rung, relationalWeight: 0.3 + (held ? 0.1 : 0) },
      arithmetic: { severity: f.severity },
      interpretationCeiling: null,
      doesntMean: DM.ELEVATED,
      sourceRef: OPAQUE("ELEVATED", f.key),
    });
  }
  return out;
}

// ── tiny helper: is the reader holding THIS object (union-aware). ─────────────────────────────────────
function mode_isHeld(ctx: ReaderContext): boolean {
  return ctx.heldThisObject;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE BUILDER — assemble every candidate + the negatives + the degradations + the mode header.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface BuiltEntries {
  candidates: ResolvedEntry[];
  floorIds: string[];
  cap: number;
  header: { entryId: string; claim: string; gloss: string | null };
  negatives: NegativeFact[];
  degradations: Degradation[];
}

/** The degradations that are TRUE OF THIS SLICE regardless of the reader — coverage facts stated once
 *  (§6). None is fabricated; each names an absent prerequisite and its defined effect. */
export const SLICE_DEGRADATIONS: Degradation[] = [
  { prerequisite: "standing_since", effect: "duration labels suppressed on point-in-time findings; UO6 uses the rule's own evidence run length instead" },
  { prerequisite: "evaluability", effect: "runFindings drops not_evaluable and runFindingsDetailed has no live caller — UG9 unreachable; UO3 uses its weaker copy variant" },
  { prerequisite: "polarity", effect: "polarity is published on Family N only — UO6 selects N findings, echo would cover negatives only" },
  { prerequisite: "universe_base_rates", effect: "no nightly aggregate exists — the UE echo family cannot resolve at all (out of slice)" },
  { prerequisite: "unified_events_and_staleness", effect: "no unified event/staleness feed — UD5/UD6 unreachable (out of slice)" },
  { prerequisite: "fund_look_through", effect: "look-through is unavailable — UH5 can never fire; UG5 is the honest handler" },
  { prerequisite: "position_delta", effect: "UH7/UH8 (added/reduced since last look) need the transaction-delta path (UD family) — not resolved this slice" },
  { prerequisite: "watchlist_modes", effect: "M5–M8 are deferred — a watchlisted-not-held reader resolves to M9 (the card omits the watchlist fact)" },
  { prerequisite: "delta_family", effect: "no UD engine — M3 uses a standing-framed header rather than the UD7 'nothing new since' claim it cannot honestly verify" },
];

export function buildEntries(ctx: ReaderContext, obj: ObjectState, mode: ResolvedMode): BuiltEntries {
  const level = ctx.identity.aiLevel;
  const held = matchHeldEntity(ctx, obj);

  const candidates: ResolvedEntry[] = [];
  const push = (e: ResolvedEntry | null) => {
    if (e) candidates.push(e);
  };

  // Orientation (eligible in the stranger modes; UO6 eligible everywhere).
  push(buildUO1(obj, level));
  push(buildUO2(obj, level));
  push(buildUO3(obj));
  push(buildUO4(ctx, obj, mode));
  push(buildUO6(obj));

  // Holding (only when held).
  if (mode_isHeld(ctx)) {
    push(buildUH1(ctx, obj, held));
    push(buildUH2(ctx, obj, held));
    push(buildUH3(ctx, obj, held));
    push(buildUH4(ctx, obj, held));
    push(buildUH10(ctx, obj));
  }

  // Elevated standing findings (the object's own concerns, by reference) — feed M1/M3's standing list.
  for (const e of buildElevated(ctx, obj)) candidates.push(e);

  // ── Header + floor + cap per mode (§2.3). The floor always resolves (guaranteed-resolve, §0.4). ──
  const { header, floorIds, cap } = headerAndFloor(mode.mode, ctx, obj);

  return {
    candidates,
    floorIds,
    cap,
    header,
    negatives: buildNegatives(ctx, obj, mode),
    degradations: SLICE_DEGRADATIONS,
  };
}

/** The mode's header state + reserved floor + cap (§2.3). Every header resolves (never empty). */
function headerAndFloor(
  mode: ModeId,
  ctx: ReaderContext,
  obj: ObjectState,
): { header: BuiltEntries["header"]; floorIds: string[]; cap: number } {
  switch (mode) {
    case "M1":
      // UH6 is the header, not a body entry — a permitted binary framing ("first time"), never a count (§3.2).
      return {
        header: { entryId: "UH6", claim: "You own this — first time you're reading it.", gloss: null },
        floorIds: ["UH1"],
        cap: 3,
      };
    case "M3":
      // Delta family absent → a STANDING-framed header, not the UD7 "nothing new since …" claim we cannot
      // honestly verify without a delta engine (recorded in degradations). Never references attention as
      // content (§0.6). UO6 rides the standing list, so a clean held name is never bare (anti-scolding).
      return {
        header: { entryId: "UH1-standing", claim: "Your position, and what's standing on it.", gloss: null },
        floorIds: ["UH1"],
        cap: 4,
      };
    case "M9":
    default: {
      // Floor = UO1 + (UO2 when scored) + (UO4 when it honestly resolves). UO1 always resolves, so the
      // floor is guaranteed. Anonymous gets the SAME orientation floor with no signed-in mention (UG8).
      const floorIds = ["UO1"];
      if (obj.isScored && obj.snapshot) floorIds.push("UO2");
      floorIds.push("UO4"); // reserved iff it was built (assemble skips a missing id)
      return { header: { entryId: "UG-newToYou", claim: "New to you.", gloss: null }, floorIds, cap: 4 };
    }
  }
}

/** The negatives for the AI layer (§6.2) — everything that did NOT resolve, because absence is as useful
 *  in a conversation as presence. */
function buildNegatives(ctx: ReaderContext, obj: ObjectState, mode: ResolvedMode): NegativeFact[] {
  const out: NegativeFact[] = [];
  if (!ctx.identity.isAuthenticated) out.push({ fact: "anonymous", detail: null });
  if (mode.positionAxis !== "HELD") out.push({ fact: "not_held", detail: null });
  if (mode.positionAxis === "WATCHED") out.push({ fact: "watchlisted_not_held", detail: null });
  if (mode.attentionAxis === "FIRST" && ctx.identity.isAuthenticated) out.push({ fact: "first_visit", detail: null });
  if (ctx.identity.isAuthenticated && !ctx.book?.exists) out.push({ fact: "no_portfolio_connected", detail: null });
  if (ctx.book?.exists && mode.positionAxis === "NEITHER" && !hasSectorOverlap(ctx, obj)) {
    out.push({ fact: "no_pg_exposure", detail: { peerGroupLabel: obj.peerGroup?.label ?? null } });
  }
  if (ctx.book?.hasFundHoldings) {
    out.push({ fact: "lookthrough_unavailable", detail: { note: "reader holds fund/basket products we cannot see through" } });
  }
  // Echo is out of slice: it is never evaluated. Recorded as a negative so the AI never infers a book
  // trait from silence (§3.5.3 / §6.2).
  out.push({
    fact: "echo_not_evaluable",
    detail: { reason: ctx.book?.exists ? "out_of_slice_no_base_rates" : "no_book" },
  });
  return out;
}
