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

// ── Mode + family ids ────────────────────────────────────────────────────────────────────────────────
export type ModeId = "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8" | "M9" | "M10" | "M11" | "M12";
export type Family = "UO" | "UH" | "UN" | "UD" | "UE" | "UG" | "ELEVATED";
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
  coverage: { state: string | null; reason: string | null };
  snapshot: {
    generation: string; // in-force ScoreSnapshot id
    periodKey: string;
    composite: number;
    band: string;
  } | null;
  sector: { key: string; displayName: string; sectorClass: string | null } | null;
  peerGroup: { id: string; label: string; memberCount: number } | null;
  findings: ObjectFinding[];
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
  arithmetic: Record<string, unknown> | null; // structured numbers behind the claim (echo/exposure/position)
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
  meta: {
    resolvedAt: string; // ISO
    snapshotGeneration: string | null;
    lastLookLabel: string | null;
    degradations: Degradation[];
  };
}
