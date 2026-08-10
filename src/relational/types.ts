// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — THE RESOLVED OBJECTS (Overview Pattern Library §1.2 / §1.3 / §1.4).
//
// The library resolves for (object, reader) and emits a FINISHED RelationalState — including the RENDERED
// `claim` strings, the `negatives` array (for the AI layer, §6.2), and `meta.degradations`. The card is
// ONE consumer; the AI layer is another and reads the SAME object under instruction (§6.1). Because the
// AI reads the finished object, the sentences are authored HERE, backend (§6.2 — the deliberate exception
// to the "frontend owns words" rule: copy the AI cannot see is copy it will re-derive, which §6.4 forbids).
//
// v1 SLICE: Object = stock; families UO + UH; modes M1 / M3 / M9. The shapes are defined generically so
// UN / UD / UE / UG entries and modes M2–M12 slot in with no reshape — in particular every echo/exposure
// entry carries its own `arithmetic` + `interpretationCeiling` (§6.3), unused this slice but shaped now.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { ToneLevel } from "../ai/tone.js";
import type { RelationalCoverage } from "./coverage.js";

// ── Mode + family ids ────────────────────────────────────────────────────────────────────────────────
export type ModeId = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8" | "M9" | "M10" | "M11" | "M12";
/** The entry namespaces. `UW` (Watchlist) is a SEVENTH namespace added by this build — the library's
 *  position axis has three values (HELD / WATCHED / NEITHER) but only HELD had body entries, so
 *  watchlist membership had no home and the watched modes had nothing true to stand on. It is NOT part
 *  of UH: that family's boundary language is exposure-based, and watchlisting is not exposure. */
export type Family = "UO" | "UH" | "UW" | "UN" | "UD" | "UE" | "UG" | "ELEVATED";
export type TemporalClass = "CONDITION" | "TRANSITION" | "CLOCK_EVENT";

// ── Position + attention axes (§2.1) ─────────────────────────────────────────────────────────────────
export type PositionAxis = "HELD" | "WATCHED" | "NEITHER";
export type AttentionAxis = "FIRST" | "RETURNING" | "RECURRING" | "DORMANT";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// READER CONTEXT (§1.2) — resolved server-side, once per request. `Object`-independent (it is one
// reader's whole book / watchlist / attention), so it is reusable across surfaces. Anonymous ⇒ a VALID
// context with identity.userId null and no reader-side facts (resolves to M9, not an error path).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One aggregated position in the reader's book, entity-aggregated by ISIN stem (the entity law). */
export interface ReaderHolding {
  entityKey: string; // ISIN stem — the aggregation key (never rendered)
  displayLabel: string; // via the entity ledger's displayName — never a raw ISIN
  value: number; // ₹ combined market value across accounts + routes for this entity
  weightPct: number; // whole-book weight, 0–100
  accountLabels: string[]; // user-authored account names (never account IDs)
  isScored: boolean;
  sector: string | null;
  route: "direct" | "fund_lookthrough" | "both";
  /** The constituent instrument symbols behind this entity — used to match "this stock" to the book. */
  symbols: string[];
}

export interface ReaderBook {
  exists: boolean;
  accountCount: number;
  scoredHoldingsCount: number;
  totalHoldingsCount: number;
  unscoredHoldingsCount: number;
  totalValue: number;
  typicalPositionValue: number | null; // median position value; basis for UH4 (null when too few)
  holdings: ReaderHolding[];
  /** Whether the reader holds any FUND product (basket). Drives the `lookthrough_unavailable` negative
   *  and UG5 (look-through is permanently unavailable — UH5 can never fire this slice). */
  hasFundHoldings: boolean;
  /** false ⇒ UH5 cannot fire, UG5 fires instead (§1.2). Permanently false today (no look-through). */
  lookThroughAvailable: boolean;
  phsComposite: number | null; // latest PHS headline (read-only; never juxtaposed with price/returns)
  phsBand: string | null;
}

export interface ReaderWatchlist {
  exists: boolean;
  count: number;
  /** Membership for THIS object only in the slice — addedAt when watchlisted, else null. */
  thisAddedAt: Date | null;
  /** §Phase 4 (UN3) — watchlist members that share THIS object's peer group, excluding the object
   *  itself. Display names, never symbols-only. Empty when none or when the object has no PG. */
  peersInPeerGroup: { stockId: string; symbol: string; name: string }[];
}

/**
 * §Phase 7 — what changed on THIS object since the reader last looked (the UD substrate).
 *
 * ⚠ ABSENCE PRODUCES SILENCE (Standing Rule 7). `evaluable: false` is the honest state whenever
 * `lastViewedAt` is unknown — the UD family then renders nothing and the mode falls back to its
 * no-delta sibling's shape. This is the family most exposed to the M1 failure mode: a delta asserted
 * from a missing rollup row would be exactly the same class of falsehood as "first time you're
 * reading it" asserted from a missing row.
 */
export interface ReaderDelta {
  /** false ⇒ no `lastViewedAt`, so no delta is computable. UD is NOT EVALUABLE, never "nothing new". */
  evaluable: boolean;
  /** The instant the delta is measured from. null ⇔ not evaluable. */
  since: Date | null;
  /** A month-grain label for the header ("since July 2026"). null ⇔ not evaluable. */
  sinceLabel: string | null;
  /** Snapshot generation in force when the reader last looked. null ⇔ unknown/never stamped. */
  lastSeenGeneration: string | null;
  /** True when the object's in-force snapshot differs from the one the reader last saw (UD9). */
  newSnapshotSinceLastLook: boolean;
  /** patternKeys whose fired instance is NEWLY standing since the last look — i.e. present now and
   *  absent from the snapshot the reader last saw (UD1). Empty when not evaluable.
   *
   *  ★ TWO SUBSTRATES, MERGED. Score-channel keys are diffed against the last-seen SNAPSHOT (above);
   *  filing-channel keys have no snapshot to diff against and are instead gated on `since` — a filing
   *  key only lands here when its transition's own `createdAt` postdates this reader's last look (see
   *  `resolveDelta` in reader-context.ts). The two never collide (channel-exclusive namespaces) and
   *  buildUD1 does not care which produced a given key. */
  newlyStandingKeys: string[];
  /** patternKeys present at the last look and ABSENT now (UD2). Empty when not evaluable. */
  clearedKeys: string[];
  /** The band in force when the reader last looked, for UD3. null ⇔ unknown. */
  lastSeenBand: string | null;
}

/** §Phase 6 — the reader's book-wide fired-finding census, for the UE (echo) family. ONE indexed query
 *  over the in-force snapshots of the reader's scored holdings — never per-holding fan-out (§5.7). */
export interface ReaderEcho {
  /** Scored holdings folded into this census — the observedShare DENOMINATOR for SCORE keys. */
  scoredHoldingsCount: number;
  /** patternKey → the reader's holdings (display names) whose in-force snapshot carries that key.
   *  Names, never symbols or ids, so an echo claim can list them without a lookup (§0.9).
   *  ⚠ SCORE KEYS ONLY as of step 5 — filing keys live in `filing` below, with their own denominator. */
  byPatternKey: Map<string, string[]>;
  /** ★ THE FILING CHANNEL'S HALF OF THE SAME RATIO (step 5). See {@link ReaderFilingEcho}. */
  filing: ReaderFilingEcho;
}

/**
 * §Phase 6 · step 5 — the filing channel's book census.
 *
 * ★ WHY THIS IS A SECOND CENSUS AND NOT MORE ENTRIES IN `byPatternKey`.
 * The echo's whole arithmetic is `lift = observedShare / expectedShare`. Step 5 moved a filing key's
 * expectedShare onto the population in which its RULE evaluated. If observedShare stayed on the
 * scored-holdings denominator, lift would divide a share of one population by a share of another and
 * the multiple would mean nothing — worse than before the split, because before it at least compared
 * two numbers drawn from the same frozen basis.
 *
 * So both halves move together. A filing key's book share is `holdings where the rule fired` over
 * `holdings where the rule EVALUATED` — the same fired/not_fired distinction the universe side uses,
 * for the same reason: a holding whose rule declined is not a clean observation of that holding.
 *
 * ★ AND IT REACHES HOLDINGS WITH NO SNAPSHOT. The old census joined score_patterns to a head
 * snapshot, so an unscored holding contributed to neither numerator nor denominator. A book holding
 * 360ONE at 90% promoter pledge counted zero holdings showing pledging.
 */
export interface ReaderFilingEcho {
  /** ruleKey → the reader's holdings (display names) whose CURRENT filing row for that rule is fired. */
  byRuleKey: Map<string, string[]>;
  /** ruleKey → how many of the reader's holdings that rule EVALUATED on (fired + not_fired). The
   *  observedShare DENOMINATOR for that key. Absent ⇒ the rule evaluated on none of them. */
  evaluatedByRuleKey: Map<string, number>;
  /** Holdings with at least one evaluated filing row — the family's minimum-book gate for filing
   *  keys, standing in for `scoredHoldingsCount`. */
  coveredHoldingsCount: number;
}

/** §Phase 4 — the reader's exposure to THIS object's neighbourhood (peer group + sector). Resolved
 *  object-side because both cuts are relative to the object being read. */
export interface ReaderNeighbourhood {
  /** Weight of the object's peer group in the reader's whole book, 0–100. null ⇔ no PG / no book. */
  pgWeightPct: number | null;
  /** The reader's holdings inside the object's peer group, INCLUDING the object when held. */
  pgHeld: { stockId: string; symbol: string; name: string; isThisObject: boolean }[];
  /** Roster size of the object's peer group. null ⇔ no PG. */
  pgSize: number | null;
  /** Weight of the object's SECTOR in the reader's whole book, 0–100. A sector may span several peer
   *  groups, so this is a genuinely different cut — never presented as correcting the PG figure. */
  sectorWeightPct: number | null;
  /** The reader's holdings in the object's sector, including the object when held. */
  sectorHeldCount: number;
}

/** Attention is a ROUTER, never content (§0.6). These fields select the mode and eligibility; they are
 *  NEVER rendered as facts about the reader. */
export interface ReaderAttention {
  hasHistory: boolean; // false on the first-ever session with this object
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  viewCount: number;
  viewCountTrailing30d: number; // derived from AttentionEvent (60d retained); 0 when unavailable
  lastViewedSnapshotGeneration: string | null;
}

export interface ReaderContext {
  identity: {
    userId: string | null; // null ⇒ anonymous
    isAuthenticated: boolean;
    aiLevel: ToneLevel; // never null; default "balanced"
  };
  /** The one OBJECT-scoped fact carried on the otherwise object-independent context: does the reader hold
   *  THIS object, union-aware (manual FIFO ∪ broker mirror)? Resolved from `probeStockRelationship`, which
   *  the resolver already runs — authoritative even before a PHS snapshot exists (so a freshly-synced
   *  holding reads HELD without waiting on the entity ledger). false for anonymous. */
  heldThisObject: boolean;
  book: ReaderBook | null; // null ⇔ anonymous or no portfolio connected
  watchlist: ReaderWatchlist | null; // null ⇔ anonymous
  attention: ReaderAttention | null; // null ⇔ anonymous (no attention for a stranger)
  /** §Phase 4 — exposure to this object's peer group + sector. null ⇔ anonymous or no book. */
  neighbourhood: ReaderNeighbourhood | null;
  /** §Phase 6 — the book-wide fired-finding census for echo. null ⇔ anonymous, no book, or the census
   *  could not be resolved (in which case the UE family is dropped and a degradation is recorded —
   *  never a partial echo, §5.7). */
  echo: ReaderEcho | null;
  /** §Phase 7 — what changed since the reader last looked. null ⇔ anonymous. Carries `evaluable:false`
   *  (never null) when authenticated but `lastViewedAt` is unknown — the distinction matters: null is
   *  "no reader", not-evaluable is "a reader we cannot compute a delta for". */
  delta: ReaderDelta | null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// OBJECT STATE (§1.3) — the stock, resolved to what the entries read. Read (never re-derived) from the
// existing engines: identity + coverage + the in-force snapshot + the persisted fired set.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One persisted fired finding, consumed AS DATA (§0.7) — never a parsed verdict string. `polarity` is
 *  DERIVED from the key namespace (`_N\d+_` ⇒ positive), not a column (§3). `magnitude` is deliberately
 *  ABSENT from this shape — the relational layer must never read it (§0.7.1). */
export interface ObjectFinding {
  kind: "pattern" | "red_flag";
  key: string; // patternKey / flagKey (opaque; never rendered)
  severity: string | null; // family-native token (critical / high / medium / low / recovery / green …)
  polarity: "positive" | "negative" | "neutral"; // derived from the key namespace
  temporalClass: TemporalClass;
  /** The rule's own evidence JSON (carries `years`/`quarters` self-dated run length + `verdict` claim). */
  evidence: Record<string, unknown> | null;
}

export interface ObjectState {
  kind: "stock";
  stockId: string;
  symbol: string;
  displayLabel: string;
  isScored: boolean;
  /** The hand-authored editorial lead from `stock_overviews.core_business` (the SAME row the Overview
   *  page's "What it does" renders), compressed to ONE sentence for card use. null when the stock has no
   *  editorial row — 280 of 504 stocks today — in which case UO1 falls back to sector + classification,
   *  which is honest and already correct. NEVER read from `Stock.description` (populated on 0 rows). */
  businessLead: string | null;
  /** ⚠ §Phase 3 — DERIVED, not read from `StockScoringState` (0 rows, no writer, returns null for a
   *  scored and an unscored stock alike). Built from the in-force snapshot ref + the Phase 2 declined
   *  set + peer-group membership. See relational/coverage.ts for the branch table. */
  coverage: RelationalCoverage;
  snapshot: {
    generation: string; // in-force ScoreSnapshot id
    periodKey: string;
    composite: number;
    band: string;
  } | null;
  sector: { key: string; displayName: string; sectorClass: string | null } | null;
  peerGroup: { id: string; label: string; memberCount: number } | null;
  findings: ObjectFinding[];
  /** §1.3 / Phase 2 — the checks that COULD NOT RUN on the in-force snapshot. Distinct from a rule that
   *  ran and returned false (recorded by the absence of a finding).
   *
   *  `null` is NOT the same as `[]` and the distinction is load-bearing:
   *    · null — the snapshot predates the evaluability column, or was written without collecting the
   *             set. We do NOT know what declined, so UG9 must not fire and UO3 must not claim
   *             completeness.
   *    · []   — the collector ran and every registered rule was evaluable. "Nothing flagged" is a
   *             FULL-strength claim here.
   *    · [..] — these named checks could not run; UO3's claim is qualified and UG9 can state the gap. */
  notEvaluable: { ruleRef: string; reason: string }[] | null;
  pondMask: { heat: "hot" | "warm" | "calm"; isHot: boolean } | null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE OUTPUT OBJECT (§1.4)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** A ranked candidate before slot allocation — an entry plus its ladder position. */
export interface ResolvedEntry {
  entryId: string; // "UO1", "UH1", … or "ELEVATED:<opaque>" (never a raw patternKey)
  family: Family;
  claim: string; // the RENDERED, tone-invariant sentence
  gloss: string | null; // per aiLevel (§0.11) — the ONE tone-dependent piece
  temporalClass: TemporalClass;
  standingSince: { label: string; snapshotCount: number } | null; // null this slice (absent prerequisite)
  isNewSinceLastLook: boolean;
  weight: { ladderRung: number; relationalWeight: number }; // self-describing (§6.3)
  /**
   * ★ THE MODE'S FLOOR RANK — 0-based, in the order `floorIds` declared, or `null` for an entry the
   * ladder placed by global rung. STAMPED BY ARBITRATION (absent on pre-assembly candidates).
   *
   * ⚠ THIS IS NOT SLOT INDEX, AND THE DIFFERENCE IS THE WHOLE POINT (§4.2). Rung is a GLOBAL ordering;
   * a mode's floor is a READER-DEPENDENT one. Identity sits at rung 14 because for a reader with
   * context it is the least useful line on the card — and it is the FIRST thing M9/M10 rank because
   * for a stranger it is the most useful. A consumer that wants "how relevant is this, for this
   * reader" needs the second statement, and slot index is only a proxy for it: the echo merge below
   * removes entries from `slots`, so index shifts under a rearrangement that says nothing about
   * relevance. Published so no consumer has to count array positions to recover a fact this layer
   * already decided.
   */
  floorRank?: number | null;
  arithmetic: Record<string, unknown> | null; // structured numbers behind the claim (echo/exposure/position)
  /**
   * ★ THE TWO VERBATIM HALVES OF `claim`, WHERE ONE EXISTS. Present on exactly the entries whose claim
   * is a finding's own sentence FOLLOWED BY the echo family's book-and-market counts — the UE entries
   * that render standalone, and every host `attachEchoAnnotations` merged an echo into. Both are
   * slices of the SAME bytes as `claim` (`claim === claimHead + " " + claimTail`), so a consumer that
   * shows them separately is still rendering the copy verbatim (§0.10).
   *
   * ⚠ PUBLISHED BECAUSE THE SPLIT CANNOT BE RECOVERED FROM THE STRING. `__arithmeticOnlyClaim` is the
   * annotation form, not the appended one: UE1 joins with an em-dash where the annotation uses a
   * semicolon, and UE6 opens "This is showing" where the annotation opens "Showing". A consumer
   * matching one against the other gets the right answer on some entries and silently the wrong one
   * on others. Absent (both undefined) when the claim has no such split.
   */
  claimHead?: string;
  claimTail?: string;
  interpretationCeiling: string | null; // hard AI instruction boundary (§6.3) — echo/exposure entries
  doesntMean: string;
  sourceRef: string; // stable, opaque reference for AI/telemetry — NEVER rendered
}

/** A fact that did NOT resolve into a slot — for the AI layer (§6.2). Absence is as useful as presence. */
export interface NegativeFact {
  fact: string;
  detail: Record<string, unknown> | null;
}

/** A coverage gap declared once (§5.2.1 / §6) — a fact about OUR coverage, never a fabricated input. */
export interface Degradation {
  prerequisite: string;
  effect: string;
}

export interface RelationalState {
  mode: ModeId;
  header: { entryId: string; claim: string; gloss: string | null };
  slots: ResolvedEntry[]; // ordered, capped per mode
  overflow: ResolvedEntry[]; // full standing set, available on expand
  negatives: NegativeFact[]; // for the AI layer (§6.2)
  /** The ONE slot entry whose `doesntMean` the card shows inline — UO6 (strength) first, then UO2
   *  (health), then UO3 (flags), else the first slot. THE BACKEND PICKS: the frontend renders whichever
   *  entryId this names and must not re-derive the priority itself (§4). Always a slots[] entryId (never
   *  overflow) when slots is non-empty. */
  boundaryEntryId: string | null;
  /**
   * The ONE slot entry that OPENS the card — the first slot at rung 1–4 (the ladder's urgent floor),
   * else the first slot. THE BACKEND PICKS, for the same reason it picks `boundaryEntryId`: this is a
   * relevance call, arbitration already makes exactly this class of call once, and a consumer
   * re-deriving it from `weight.ladderRung` is a second copy of the ladder living outside the ladder.
   *
   * ⚠ WHY NOT SIMPLY "HIGHEST RUNG LEADS". A mode's floor ranks identity first for a stranger BECAUSE
   * that is what a stranger needs (§4.2). Reading rung alone would open a watched stock on its
   * watchlist date and an uncovered stock on its coverage gap. Rungs 1–4 are the one band that
   * outranks the mode's own statement of relevance; everything else defers to arbitration's order.
   *
   * Always a `slots[]` entryId (never `overflow`) when `slots` is non-empty.
   */
  leadEntryId: string | null;
  meta: {
    resolvedAt: string; // ISO
    snapshotGeneration: string | null;
    lastLookLabel: string | null;
    degradations: Degradation[];
  };
}
