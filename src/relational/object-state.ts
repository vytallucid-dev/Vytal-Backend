// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — OBJECT STATE RESOLVER (§1.3).
//
// The stock, resolved to what the UO/UH entries read — CONSUMED AS DATA, never re-derived (§0.7). Every
// fact comes from an existing engine: identity + sector + peer group from the catalog, coverage from
// `resolveCoverage`, the in-force snapshot from `getLatestSnapshotRef` (the SAME supersede-aware resolver
// the health view uses), and the fired set from the persisted `score_patterns` / `score_red_flags` rows
// hanging off that snapshot. It NEVER recomputes a score, a band, or a finding.
//
// ★ MAGNITUDE IS NOT SELECTED (§0.7.1). `ScorePattern.magnitude` exists on the row and is deliberately
// NOT read into `ObjectFinding` — it answers a question about the MODEL, never about the reader, and a
// display-only finding can be the most important thing on the card. Grep-verified in the build.
//
// ★ POLARITY IS DERIVED FROM THE KEY NAMESPACE (§3), never a column: `_N\d+_` ⇒ positive (Family N, the
// constructive twins). The locked invariant — P/R may affect the score, everything else is display-only —
// means no migration is needed to know a finding's polarity for selection.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { getLatestSnapshotRef } from "../scoring/read/scoring-read.service.js";
import { deriveCoverage } from "./coverage.js";
import type { ObjectState, ObjectFinding } from "./types.js";

/** `_N\d+_` ⇒ Family N (positive). A red flag is negative. Otherwise fall back to the fired instance's
 *  own `direction` (positive/negative), and `neutral` when it carries none. This is the ONLY polarity
 *  derivation in the layer, and it reads the KEY, not a hardcoded id list (§0.7). */
const N_NAMESPACE = /_N\d+_/;
function derivePolarity(key: string, kind: "pattern" | "red_flag", direction: string | null): ObjectFinding["polarity"] {
  if (N_NAMESPACE.test(key)) return "positive";
  if (kind === "red_flag") return "negative";
  if (direction === "positive") return "positive";
  if (direction === "negative") return "negative";
  return "neutral";
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * ⚠ TEMPORAL CLASS, DERIVED FROM THE FINDING'S OWN EVIDENCE (§0.5 · §Phase 6 correction).
 *
 * Every finding used to be stamped `CONDITION` unconditionally, which made the class useless for
 * selection — and the echo family needs it, because co-occurrence means different things per class:
 *   · CONDITION co-occurring  → a trait of the reader's BOOK COMPOSITION      ("receivables outpacing
 *                                revenue in 3 of your 7 holdings" — describes what they own)
 *   · TRANSITION co-occurring → a SYNCHRONISED MOVE across holdings, which is real and worth saying
 *   · CLOCK_EVENT co-occurring → a fact about a TIME WINDOW, not about the book at all
 *
 * The last is the horoscope failure mode wearing a low base rate: "5 of your holdings had block deals
 * recently" passes every gate — both counts true, base rate genuinely low — and means nothing, because
 * a 90-day window catches whatever the market did. The base-rate gate cannot detect it; only the class
 * can. Echo therefore excludes CLOCK_EVENT (see entries.ts `resolveEcho`).
 *
 * PROPERTY-DRIVEN, NOT AN ID LIST (§0.7): a rule that measures inside a declared window publishes
 * `windowDays` in its own evidence. Live, exactly four keys do so — all of them insider/block-deal feed
 * patterns — and a new windowed rule is classified correctly with no change here.
 */
function deriveTemporalClass(evidence: Record<string, unknown> | null): ObjectFinding["temporalClass"] {
  if (evidence && typeof evidence.windowDays === "number") return "CLOCK_EVENT";
  return "CONDITION"; // TRANSITION is the UD family's to assign when it lands
}

/**
 * Parse the persisted declined-check set (Phase 2). PRESERVES the null/[] distinction:
 *   · null / absent / malformed → null  ("we do not know what declined")
 *   · []                        → []    ("the collector ran; everything was evaluable")
 * A malformed value degrades to null rather than [] — an unreadable record must never be reported as a
 * positive all-clear (§0.9 honest-empty over fabricated).
 */
function parseNotEvaluable(v: unknown): { ruleRef: string; reason: string }[] | null {
  if (!Array.isArray(v)) return null;
  const out: { ruleRef: string; reason: string }[] = [];
  for (const e of v) {
    const r = asRecord(e);
    if (!r || typeof r.ruleRef !== "string" || typeof r.reason !== "string") continue;
    out.push({ ruleRef: r.ruleRef, reason: r.reason });
  }
  return out;
}

/**
 * Take the editorial `coreBusiness` LEAD SENTENCE for card use (§1.5). The stored prose is 2–4 sentences
 * and belongs to the Overview page's own section; a slot takes the first sentence, whole.
 *
 * ⚠ TRUNCATION IS NOT COMPRESSION. There is NO character-budget cut here and there must never be one: a
 * mid-clause ellipsis reads as a rendering failure, not a summary. The sentence is taken COMPLETE or the
 * entry falls back to sector + classification (which is honest and already correct). Every editorial
 * sentence is hand-authored and grammatical — a long one is still a good one.
 *
 * The earlier 220-char budget in this function silently rejected 40 of the 224 editorial rows (17.9%),
 * including RELIANCE (268 chars), HDFCBANK (241) and BAJFINANCE (255) — three of the largest names in
 * the universe fell back to "Banks, a cyclical name." while good copy sat unused in the table. Measured
 * first-sentence length across all 224 rows: min 72 · median 199 · p90 232 · max 293.
 *
 * `SANITY_MAX_CHARS` is NOT a display budget — it is a guard against a malformed row (an un-terminated
 * paragraph, a pasted blob) reaching a slot. It sits above the observed maximum, so it rejects nothing
 * that exists today and only ever fires on data that is wrong rather than merely long.
 *
 * Sentence-splitting is deliberately conservative: it breaks only on a terminator followed by whitespace
 * and a capital/opening character, so a decimal ("1.5") or an abbreviation ("Ltd. ") cannot split a
 * sentence in half. Never re-authors, re-punctuates, or re-orders a word (§0.10).
 */
const SANITY_MAX_CHARS = 400;
function leadSentence(prose: string | null | undefined): string | null {
  const text = (prose ?? "").trim();
  if (!text) return null;
  const m = text.match(/^(.{20,}?[.?!])\s+(?=[A-Z(])/);
  const candidate = m ? m[1].trim() : text;
  // Malformed-row guard only — never a display cut. A sentence over this length is not trusted prose.
  if (candidate.length > SANITY_MAX_CHARS) return null;
  return candidate;
}

/**
 * Resolve the ObjectState for one stock. Returns null only when the stockId is not a real stock (the
 * caller 404s). A scored stock carries a snapshot + fired set; an unscored one resolves identity +
 * coverage with `snapshot: null` and an empty fired set — honest-empty, never fabricated.
 */
export async function resolveObjectState(stockId: string): Promise<ObjectState | null> {
  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
    select: {
      id: true,
      symbol: true,
      name: true,
      sector: { select: { name: true, displayName: true, sectorClass: true } },
      // §1.5 — the hand-authored editorial lead. Same row/relation the Overview page reads via
      // buildOverviewView; read here (not re-derived) so the card and the page cannot disagree.
      overview: { select: { coreBusiness: true } },
    },
  });
  if (!stock) return null;
  const businessLead = leadSentence(stock.overview?.coreBusiness);

  // ⚠ §Phase 3 — the `resolveCoverage` read is GONE from this path. It queried StockScoringState (0
  // rows, no writer) and returned null for a scored and an unscored stock alike. Coverage is now
  // DERIVED below from the snapshot ref + the declined set + PG membership. Two indexed lookups now.
  const [spg, snapRef] = await Promise.all([
    prisma.stockPeerGroup.findFirst({
      where: { stockId: stock.id },
      select: { peerGroup: { select: { id: true, displayName: true, stockCount: true } } },
    }),
    getLatestSnapshotRef(stock.id),
  ]);
  const pg = spg?.peerGroup ?? null;

  const sector = stock.sector
    ? { key: stock.sector.name, displayName: stock.sector.displayName, sectorClass: stock.sector.sectorClass ?? null }
    : null;
  const peerGroup = pg ? { id: pg.id, label: pg.displayName, memberCount: pg.stockCount } : null;

  // ── Not scored: identity + coverage only, no snapshot, empty fired set (UG1/UH10 handle the reason). ──
  if (!snapRef) {
    return {
      kind: "stock",
      stockId: stock.id,
      symbol: stock.symbol,
      displayLabel: stock.name,
      businessLead,
      isScored: false,
      // Derived: no snapshot ⇒ covered_unscored (in a PG, in scope, not yet scored) or display_only
      // (no PG ⇒ never scored by design). Both are honest states; the old code had neither.
      coverage: deriveCoverage({ isScored: false, hasPeerGroup: pg !== null, notEvaluable: null }),
      snapshot: null,
      sector,
      peerGroup,
      findings: [],
      // No in-force snapshot ⇒ no rule ever ran on this stock ⇒ we know NOTHING about declined
      // checks. That is null, never [] — an empty array would assert a clean evaluation we never made.
      notEvaluable: null,
      pondMask: null,
    };
  }

  // ── Scored: the in-force snapshot + its persisted fired set. Targeted select — NOT the full health
  //    graph (metrics / peer distributions), so this stays lean against the §5.7 budget. `magnitude` is
  //    deliberately NOT selected. ──
  const SNAP_SELECT = {
    id: true,
    periodKey: true,
    composite: true,
    labelBand: true,
    maskHeat: true,
    patterns: { select: { patternKey: true, severity: true, direction: true, evidence: true } },
    redFlags: { select: { flagKey: true, severity: true, triggeringValues: true } },
  } as const;

  // ⚠ MIGRATION-TOLERANT READ (Phase 2/3). `not_evaluable` ships in a migration that is written but
  // NOT YET APPLIED, so a database at the previous schema will reject a select naming that column
  // (Prisma P2022). The card is guaranteed-resolve and must not 500 on a pending migration, so the
  // column is fetched in a SEPARATE, best-effort query: on failure the declined set degrades to
  // `null`, which already means exactly "we do not know what declined". Once the migration is
  // applied this simply starts returning real data — no code change, no second path to maintain.
  const [snap, declinedRaw] = await Promise.all([
    prisma.scoreSnapshot.findUnique({ where: { id: snapRef.id }, select: SNAP_SELECT }),
    prisma.scoreSnapshot
      .findUnique({ where: { id: snapRef.id }, select: { notEvaluable: true } })
      .then((r) => r?.notEvaluable ?? null)
      .catch(() => null), // column absent (migration pending) ⇒ unknown, never a fabricated all-clear
  ]);
  if (!snap) {
    // The ref resolved but the row vanished between calls (a concurrent prune) — treat as unscored.
    return {
      kind: "stock",
      stockId: stock.id,
      symbol: stock.symbol,
      displayLabel: stock.name,
      businessLead,
      isScored: false,
      // Derived: no snapshot ⇒ covered_unscored (in a PG, in scope, not yet scored) or display_only
      // (no PG ⇒ never scored by design). Both are honest states; the old code had neither.
      coverage: deriveCoverage({ isScored: false, hasPeerGroup: pg !== null, notEvaluable: null }),
      snapshot: null,
      sector,
      peerGroup,
      findings: [],
      // No in-force snapshot ⇒ no rule ever ran on this stock ⇒ we know NOTHING about declined
      // checks. That is null, never [] — an empty array would assert a clean evaluation we never made.
      notEvaluable: null,
      pondMask: null,
    };
  }

  const findings: ObjectFinding[] = [
    ...snap.patterns.map((p): ObjectFinding => ({
      kind: "pattern",
      key: p.patternKey,
      severity: p.severity,
      polarity: derivePolarity(p.patternKey, "pattern", p.direction),
      temporalClass: deriveTemporalClass(asRecord(p.evidence)),
      evidence: asRecord(p.evidence),
    })),
    ...snap.redFlags.map((r): ObjectFinding => ({
      kind: "red_flag",
      key: r.flagKey,
      severity: r.severity ?? "critical",
      polarity: derivePolarity(r.flagKey, "red_flag", null),
      temporalClass: deriveTemporalClass(asRecord(r.triggeringValues)),
      evidence: asRecord(r.triggeringValues),
    })),
  ];

  const declined = parseNotEvaluable(declinedRaw);

  return {
    kind: "stock",
    stockId: stock.id,
    symbol: stock.symbol,
    displayLabel: stock.name,
    businessLead,
    isScored: true,
    // Derived: scored_full (declined === []) · scored_partial (declined non-empty) ·
    // scored_unknown_depth (declined === null — a snapshot written before the Phase 2 column).
    coverage: deriveCoverage({ isScored: true, hasPeerGroup: pg !== null, notEvaluable: declined }),
    snapshot: {
      generation: snap.id,
      periodKey: snap.periodKey,
      composite: Number(snap.composite),
      band: snap.labelBand,
    },
    sector,
    peerGroup,
    findings,
    // Phase 2 — null (unknown) and [] (all evaluable) are preserved as distinct states.
    notEvaluable: declined,
    pondMask: snap.maskHeat
      ? { heat: snap.maskHeat as "hot" | "warm" | "calm", isHot: snap.maskHeat === "hot" }
      : null,
  };
}
