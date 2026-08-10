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
import { dropRetiredPatterns } from "../catalogue/retired-findings.js";
// ★ NOT-COVERED SUPPRESSION (companion to boundary 6 of 9 above) — a persisted `notcovered_*` row
//   must never win a card slot on the relational surface either.
import { dropNotCoveredPatterns } from "../catalogue/not-covered.js";
// ★ THE FILING CHANNEL (this build). `readFilingFindings` is the SAME read the stock page, the chat's
//   batch findings and the grounding block go through — the card joins the existing consumers rather
//   than growing a second reader of stock_findings. `dropFilingPatterns`/`dropFilingFlags` are the
//   companion suppression: the moment this resolver serves BOTH channels it inherits channel.ts's rule
//   that a frozen score-channel row must not be served beside its live filing twin.
import { readFilingFindings } from "../filing/read.js";
import { dropFilingPatterns } from "../filing/channel.js";
import type { FilingFindingView } from "../filing/read.types.js";
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
/**
 * ★ THE FILING CHANNEL, PROJECTED ONTO THE CARD'S FINDING SHAPE (this build).
 *
 * ⚠ WHY THIS EXISTS AT ALL. `ObjectState.findings` was built from score_patterns / score_red_flags
 * only, and returned `[]` outright when no snapshot resolved. Four entry families read nothing else —
 * UO6, ELEVATED, UD1 and the whole UE echo layer — so on a stock we do not score they all evaluated to
 * nothing, and the card said so out loud. Live: 360ONE stands on a CRITICAL pledge red flag (90% of
 * promoter holding pledged) and its card read "Nothing standing on this stock repeats elsewhere in
 * your book" under the header "Your position, and what's standing on it." The finding existed, in a
 * table this resolver never opened.
 *
 * ⚠ NO ADAPTER, BY CONSTRUCTION. `FilingFindingView` already publishes `key` (not `ruleKey`) and
 * `kind: "red_flag" | "pattern"` (the DB enum's own value) — normalised at the source precisely so
 * consumers converge. The only work here is deriving the two fields the card owns: `polarity` and
 * `temporalClass`, through the SAME two functions the score channel goes through. A filing finding is
 * therefore classified by identical rules, not by a parallel set that could drift.
 *
 * ⚠ `verdict` AND `name` ARE CARRIED INTO THE EVIDENCE BAG, AND THAT IS NOT A RE-RENDER. UO6 reads
 * `evidence.verdict` / `evidence.name` directly to compose its strength claim, and the score channel's
 * rows happen to carry both. The filing view already holds the AUTHORED verdict — produced by the same
 * `renderVerdict` every other surface uses — so lifting it into the bag hands UO6 the sentence the rest
 * of the product shows. Without it UO6 falls through to its "A standing strength." placeholder on a
 * real, named finding. Idempotent: `renderVerdict`'s own precedence would resolve to this same string.
 */
function filingToObjectFinding(v: FilingFindingView): ObjectFinding {
  const evidence: Record<string, unknown> = { ...(v.evidence ?? {}) };
  if (typeof evidence.verdict !== "string" && v.verdict) evidence.verdict = v.verdict;
  if (typeof evidence.name !== "string" && v.name) evidence.name = v.name;
  return {
    kind: v.kind,
    key: v.key,
    severity: v.severity,
    // The SAME derivations the score channel uses — polarity from the key namespace + direction,
    // temporal class from the finding's own `windowDays`. Never a filing-specific rule.
    polarity: derivePolarity(v.key, v.kind, v.direction),
    temporalClass: deriveTemporalClass(evidence),
    evidence,
  };
}

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
  const [spg, snapRef, filingSection] = await Promise.all([
    prisma.stockPeerGroup.findFirst({
      where: { stockId: stock.id },
      select: { peerGroup: { select: { id: true, displayName: true, stockCount: true } } },
    }),
    getLatestSnapshotRef(stock.id),
    // ⚠ FAIL-SOFT, LIKE EVERY OTHER READ ON THIS PATH. The card is guaranteed-resolve (§0.4): a filing
    // read that throws degrades to no filing findings rather than 500-ing the card. Logged, because a
    // silent degradation to "" is how the echo census stayed broken for seven days.
    readFilingFindings([stock.id]).catch((err: unknown) => {
      console.warn(`[relational/object-state] filing read failed for ${stock.id}: ${(err as Error).message}`);
      return null;
    }),
  ]);
  const pg = spg?.peerGroup ?? null;
  // The CURRENT fired filing findings for this stock, in the card's shape. `readFilingFindings` returns
  // a section for every id it is given (an absent key would send a consumer back to rendering nothing),
  // so an empty list here means "nothing fired", not "not looked at".
  const filingFindings: ObjectFinding[] = (filingSection?.get(stock.id)?.fired ?? []).map(filingToObjectFinding);

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
      // ★ NOT `[]` ANY MORE. The filing channel runs on all 504 active stocks and is the ONLY channel
      //   that reaches a stock we do not score — 218 of the 355 display-only stocks carry at least one
      //   fired filing finding. This is what un-blinds UO6 / ELEVATED / UD1 / UE on an unscored stock.
      findings: filingFindings,
      // No in-force SCORE snapshot ⇒ no scoring rule ran ⇒ we know NOTHING about which of THOSE checks
      // declined. That is null, never [] — an empty array would assert a clean evaluation we never
      // made. (The filing channel keeps its own declined set; it is deliberately not folded in here,
      // because `notEvaluable` feeds `deriveCoverage`, whose states are defined over the score channel.)
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
    // ★ `redFlags` was selected here until 2026-08-11 and produced nothing after `dropFilingFlags`
    //   — all six red-flag rules are filing rules, and the live filing channel is folded in below.
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
      // ★ NOT `[]` ANY MORE. The filing channel runs on all 504 active stocks and is the ONLY channel
      //   that reaches a stock we do not score — 218 of the 355 display-only stocks carry at least one
      //   fired filing finding. This is what un-blinds UO6 / ELEVATED / UD1 / UE on an unscored stock.
      findings: filingFindings,
      // No in-force SCORE snapshot ⇒ no scoring rule ran ⇒ we know NOTHING about which of THOSE checks
      // declined. That is null, never [] — an empty array would assert a clean evaluation we never
      // made. (The filing channel keeps its own declined set; it is deliberately not folded in here,
      // because `notEvaluable` feeds `deriveCoverage`, whose states are defined over the score channel.)
      notEvaluable: null,
      pondMask: null,
    };
  }

  // ★ RETIREMENT SUPPRESSION (boundary 6 of 9 — the relational card's object state). A retired key
  //   reaching here would be handed to derivePolarity/deriveTemporalClass and could win a card slot,
  //   putting an obsolete claim in the reader's most prominent surface.
  // ★ CHANNEL SUPPRESSION — NEWLY REQUIRED, AND REQUIRED FOR THE REASON channel.ts ALREADY STATES.
  //
  //   Its rule is that filing-key suppression belongs at boundaries serving BOTH channels, "because
  //   only there does removing a row remove a DUPLICATE rather than a fact". Until this build this
  //   resolver served the score channel alone, so it was correctly exempt — and it is listed among the
  //   exempt surfaces there. Merging the filing channel in below is exactly what moves it across that
  //   line, so it inherits the rule in the same commit that makes it apply.
  //
  //   Without this, the 86 FROZEN filing rows still sitting on scored heads (58 of 95 scored stocks —
  //   score_patterns is append-only and the scoring pass stopped writing these in step 2) would be
  //   served BESIDE their live filing twins: the same rule, on the same card, from two tables, dated
  //   two different periods. The frozen row is the stale one; the filing row is current, so the frozen
  //   one goes and the filing one stays.
  const findings: ObjectFinding[] = [
    ...dropFilingPatterns(dropNotCoveredPatterns(dropRetiredPatterns(snap.patterns))).map((p): ObjectFinding => ({
      kind: "pattern",
      key: p.patternKey,
      severity: p.severity,
      polarity: derivePolarity(p.patternKey, "pattern", p.direction),
      temporalClass: deriveTemporalClass(asRecord(p.evidence)),
      evidence: asRecord(p.evidence),
    })),
    // The live filing channel — the same rules, read from the table that is still being written.
    ...filingFindings,
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
