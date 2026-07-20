// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO HEALTH SNAPSHOT — the authenticated user's pre-computed PHS read.
//
//   GET /api/v1/me/portfolio     the latest Portfolio Health Score snapshot
//
// PURE READ over the persisted snapshot (A.12). A GET NEVER computes or persists —
// it only serves the latest persisted row. The frontend never recomputes a score,
// penalty or weight either; it renders exactly what this serves. The snapshot is the
// single source of truth (engine → persist.computeAndPersistPhs).
//
// PRESENTATION SPLIT (portfolio-spec 1.1 presentation addendum) — the read is REGROUPED
// into two NAMED reads over the SAME computed values (no math, no recompute, byte-identical):
//   • construction_read — ALWAYS present (needs zero scored holdings): the Structure pillar,
//     its display band, PC/PB findings, and the tier/coverage context.
//   • health_read — NULLABLE, present ONLY when scored_weight > 0: the uncapped Health Score
//     + band, Quality/Signals, a Provisional tag, pillarProfile + lensProfile (1.2), and
//     PQ/PS/PX/PV findings. null when no scored holdings. (1.2: coverage ceiling retired.)
//   • headline_slot — "health" if health_read exists, else "construction".
//   • coverage_state — the coverage story both reads reference (weights + counts + unlock flag).
// Nothing here changes a number: pillars/PHS/findings/ledgers are read verbatim off the row.
//
// Freshness is the MUTATION path's job, not the read's: computeAndPersistPhs fires on
// a transaction write (the book changed) and on the nightly rescore (scores changed) —
// the only two things that move portfolio health. So by the time this GET runs, the
// latest snapshot already reflects the current book.
//
// No snapshot yet (empty book, or a book whose first mutation/rescore hasn't landed) →
// the honest construction state (snapshot:null); hasHoldings tells the UI which.
//
// Owner = req.authUser.userId (never the payload) — IDOR-proof, no id input.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import type { PfFinding } from "../../portfolio/phs/patterns.js";
import type { PillarProfile, LensProfile } from "../../portfolio/phs/engine.js";
import { listPortfolioDisclosure, constructionValuation } from "../../portfolio/phs/assemble.js";
import { fireReadTimeFindings, fireDisclosureFindings, fireInstrumentFindings } from "../../portfolio/phs/read-time-findings.js";
import { composeStory, type Storyboard } from "../../portfolio/phs/story.js";
import { loadHeldInstrumentFacts, loadHeldFundAnalytics } from "../../portfolio/phs/read-time-catalog.js";
import { describeUnpriced } from "../../portfolio/disclosures.js";
// (Construction v2 Stage 6) constructionBandOf lives in constants.ts now (a scoring constant — §9.1),
// re-exported here so existing importers keep working. The Construction decomposition types come from
// the engine module.
import { constructionBandOf, type ConstructionBand } from "../../portfolio/phs/constants.js";
import type { Archetype, Exposures, CDeduction, ConstructionData } from "../../portfolio/phs/entity.js";
export { constructionBandOf };
export type { ConstructionBand };

/** Decimal | null → number | null (Prisma.Decimal serializes to string otherwise). */
const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** A value `num()` accepts — number, Prisma.Decimal (has toString), string, or null. */
type NumLike = number | string | { toString(): string } | null;

/** The snapshot fields the reshape reads — structural so the Prisma row AND test mocks
 *  both satisfy it (no dependency on the exact generated row type). (1.2) ceiling columns
 *  (phsRaw/ceilingApplied/ceilingValue) are retired and no longer read. */
export interface SnapshotReadInput {
  id: string;
  phs: number | null; // (1.2) the `phs` column now holds the uncapped Health Score
  band: string | null;
  provisional: boolean; // coverage < 40% → the "Provisional" tag
  evaluable: boolean;
  quality: NumLike;
  structure: NumLike;
  signals: NumLike;
  coverage: NumLike; // = scored value share (c)
  totalValue: NumLike;
  recognizedUnscoredValue: NumLike;
  smallUnscoredValue: NumLike;
  structureLedger: unknown; // StructureDeduction[]
  signalsLedger: unknown; // SignalsDeduction[]
  firedFindings: unknown; // PfFinding[] | null
  pillarProfile: unknown; // (1.2 Change 4) PillarProfile | null
  lensProfile: unknown; // (1.2 Change 5) LensProfile
  structureTier: string | null; // (Stage 6) LEGACY — no longer served (patterns.ts still reads r.structureTier)
  capitalTier: string | null;
  constructionData: unknown; // (Stage 6) ConstructionData | null (null on pre-2.0 / no-holding rows)
  constantVersion: string;
  createdAt: Date;
}

// ── the two-read contract (wire) ────────────────────────────────────────────────────
export type HeadlineSlot = "health" | "construction";

export interface CoverageState {
  scoredWeight: number; // 0..1 (= the snapshot's coverage, c)
  recognizedUnscoredWeight: number; // 0..1
  smallUnscoredWeight: number; // 0..1
  /** (Stage 9) "N of M" — counted in persist over the SAME aggregated `holdings` array `totalValue` sums,
   *  and frozen on the row beside it. NULL on pre-2.0 rows that carry no construction_data: we cannot
   *  know the aggregated count of a book we did not decompose, and "0 of 0" would be a fabrication. The
   *  read degrades to the coverage % alone, exactly as it degrades the Construction ledger. */
  scoredCount: number | null;
  totalCount: number | null;
  totalValue: number; // ₹ book value at compute time (denominator; prevents ₹ loss)
  unlockTrigger: boolean; // recognized-unscored capital exists → scoring it lifts the read (c_eff)
}

export interface ConstructionRead {
  value: number; // the Construction Net 0..100 (the `structure` column — verbatim)
  band: ConstructionBand; // (Stage 6) recut cutoffs 85/70/55/40 · bottom band Precarious (was Fragile)
  // (Construction v2 Stage 6) the C1–C6 decomposition — the FE renders the evaluability panel +
  // ShapePicture from these STRUCTURED fields, never by parsing `detail`. null on legacy / no-holding
  // rows (no construction_data) → the FE degrades to value + band.
  archetype: Archetype | null; // Stock-led | Fund-led | Blended | Income-led | Commodity-led
  exposures: Exposures | null; // { nameRisk, basket, debt, commodity } composition shares
  rules: CDeduction[] | null; // [C1…C6] — each { rule, evaluable, points, subjectShare, firedSubject, detail }
  gross: number | null; // C1+C2 decomposition (never a competing score, §8)
  // (Stage 6, §9.4) COPY INPUT ONLY — never a badge. structureTier is RETIRED from the payload.
  capitalTier: string | null; // Modest | Moderate | Substantial | null
  findings: PfFinding[]; // PC + PB (— OR every fired finding when there is no health read)
}

export interface HealthRead {
  value: number | null; // (1.2) the Health Score — TRUE / UNCAPPED (was "PHS"); present ⇒ integer
  band: string | null; // Strong | Steady | Mixed | Fragile | Weak
  quality: number | null; // the anchor
  signals: number; // penalty-only (the only term in Health besides Quality)
  evaluable: boolean; // always true when this read is present
  provisional: boolean; // (1.2 Change 3) coverage < 40% → "Provisional" tag (ceiling retired)
  findings: PfFinding[]; // PQ + PS + PX + PV
  signalsLedger: unknown; // the red-flag evidence (SignalsDeduction[])
  pillarProfile: PillarProfile | null; // (1.2 Change 4) where the quality comes from
  lensProfile: LensProfile; // (1.2 Change 5) findings-character shares; null ⇔ no lens patterns
}

export interface PortfolioReads {
  id: string;
  headlineSlot: HeadlineSlot;
  coverageState: CoverageState;
  constructionRead: ConstructionRead; // ALWAYS present
  healthRead: HealthRead | null; // null ⇔ scored_weight = 0
  /** (Stage 10b) The composed storyboard — 4 movements of prose over the fired set + the reference.
   *  Null ⇔ no `constructionData` (pre-2.0) or no scored holdings. Composed at read, stored nowhere. */
  story: Storyboard | null;
  constantVersion: string;
  asOf: string; // ISO
}

/** (Stage 9) The "N of M scored" coverage counts, read OFF THE SNAPSHOT (`constructionData`), not
 *  re-counted live. They must come from the same population `totalValue` sums — see
 *  `ConstructionData.scoredCount`. Null on pre-2.0 rows carrying no construction_data. */
export interface ReshapeCounts {
  scoredCount: number | null;
  totalCount: number | null;
}

/**
 * PART B family → read. EXHAUSTIVE BY DECLARATION — every family says where it goes, and a family that
 * says nothing is a build error rather than a default.
 *
 * ── ⚠ WHY THIS IS A MAP AND NOT `CONSTRUCTION_FAMILIES.has(f.family)` (Stage 10a) ─────────────────
 *
 * It used to be a Set plus a catch-all: construction if in the Set, HEALTH otherwise. That default is not
 * neutral. A finding it has never heard of lands in the HEALTH read — the panel that says what the book
 * IS — so the day someone adds a family and forgets this line, a fact about OUR DATA is silently rendered
 * as A JUDGMENT ABOUT THE USER'S MONEY. Hand it a PD1 and "we cannot source credit ratings" becomes a
 * health finding about a book whose bonds we never assessed. `verify-phs-pd-readtime.ts` smuggles one in
 * and proves exactly that.
 *
 * ★ CONTRAST WITH `natureOf`'s DEFAULT, WHICH IS CORRECT AND STAYS. An unclassified instrument defaults to
 * `basket` — the CONSERVATIVE choice, because a basket is charged for less than a name-risk holding. That
 * default can only ever manufacture LESS of a charge. This one manufactures a JUDGMENT ABOUT THE BOOK OUT
 * OF A FACT ABOUT US, which is the one thing the PD family exists to prevent. A default is safe when its
 * failure mode is silence, and dangerous when its failure mode is a claim.
 *
 * ⚠ UNKNOWN FAMILY ⇒ THROW, and the throw is the point. An unknown family here is NEVER data drift — the
 * fired set is written by our own `firePortfolioFindings`, so an unrouted family is always a developer who
 * added one and did not come here. It fails at the first read in dev, and `verify-phs-routing` fails it at
 * CI before that. This is deliberately the OPPOSITE call from `classifyNullReason`, which degrades by
 * omission rather than throwing: THAT input is INGESTION DATA and can legitimately grow a seventh value
 * tomorrow; THIS input is our own code and cannot. Refusing to answer beats answering wrongly — the
 * controller's catch turns it into a 500, which is loud and bad, but it does not put a lie on the page.
 */
type FindingHome = "construction" | "health";
const FINDING_HOME: Record<string, FindingHome> = {
  // PE joins PC/PB: PE6 ("Capital we couldn't value") is a fact ABOUT Construction — it names capital that
  // is NOT reflected in the number — so it belongs on the Construction read, not the Health read.
  PC: "construction",
  PB: "construction",
  PE: "construction",
  /**
   * ⚠ PENDING AN OPERATOR RULING — and declaring it is what SURFACED the question.
   *
   * PA (Stage 10a batch 1: "38 holdings · 12 companies · 62% equity — we read this as a Blended book")
   * describes the book's SHAPE, which is Construction's subject, and doc 2 opens the story with it.
   * "construction" is the reading I believe correct.
   *
   * ★ BUT NOTE WHAT IT WAS DOING UNTIL THIS LINE EXISTED. The old router was `CONSTRUCTION_FAMILIES.has()`
   * plus a catch-all, and PA is not in that Set — so every PA finding has been rendering in the HEALTH read
   * since the day it was built, and nothing said so. The family was added in one batch and the router was
   * a file away. That is the exact hazard this map was ruled in to close, caught on the code of the batch
   * that argued for it, one batch later. **A default that is wrong is indistinguishable from a default that
   * is right, until something forces the question.**
   */
  PA: "construction",
  PQ: "health",
  PS: "health",
  /**
   * (Stage 10a batch 3) PI · INSTRUMENT FACTS — "health", and the reasoning is the router's own test.
   *
   * Construction's subject is THE NUMBER ("what is in it, what is not"). Health's subject is THE BOOK.
   * A PI finding is a fact about an INSTRUMENT the user holds — a 12% ETF premium, a dormant scheme, a
   * 42% drawdown. None of it enters Construction's arithmetic (no PI value touches C1–C6), and none of it
   * is a statement about the number. It is a statement about what they own. → health.
   *
   * ★ AND NOTE THE ASYMMETRY WITH PD, WHICH SHARES PI's FILE AND ITS LIFETIME. PD is deliberately absent
   * from this map because its SUBJECT is Vytal. PI is present because its subject is the book. The two
   * families are read-time for DIFFERENT reasons — PD by subject, PI by provenance (read-time-findings.ts
   * names both doors) — and this line is where that difference is actually spent.
   *
   * ⚠ ROUTING IS FAMILY-GRAINED (see PX6 below). PI is uniform on this axis: all eight are facts about a
   * held instrument, so unlike PX there is no member here that wants the other home.
   */
  PI: "health",
  /**
   * ⚠ SEE THE REPORT — PX6 does not fit its family's home, and the router cannot tell.
   *
   * PX is a health family and these entries are right for PX1–PX5. But PX6 (Stage 10a batch 1) reads
   * "gross 64.3 → net 29.1 · gap 35.2" and binds C3/C4 — it is CONSTRUCTION arithmetic wearing a health
   * family's badge, and it rides this line into the health read. Routing is FAMILY-grained; the mismatch is
   * per-FINDING. Exhaustiveness catches an unrouted family; it cannot catch a finding filed under the wrong
   * one. Not moved here: re-homing a finding is a ruling, not a fix.
   */
  PX: "health",
  PV: "health",
  // ⚠ PD IS DELIBERATELY ABSENT. It is reference-only (doc 2 §9.2) and is served beside the snapshot, not
  // routed into a read — see the controller's `referenceFindings`. Adding it here would not "fix" anything;
  // it would give a fact about VYTAL a home inside a panel about the BOOK (ODL cv2-s10a-pd-read-time). If
  // this throws on a PD finding, the bug is upstream: something put PD into the persisted set.
};

function homeOf(f: PfFinding): FindingHome {
  const home = FINDING_HOME[f.family];
  if (!home) {
    throw new Error(
      `reshapeSnapshot: finding ${f.id} has family "${f.family}", which is not routed. Declare it in ` +
        `FINDING_HOME — construction (a fact about the number) or health (a fact about the book). If it is ` +
        `neither because it describes OUR DATA rather than the user's book, it belongs in ` +
        `read-time-findings.ts and must never reach the persisted set. Do NOT add a default: the previous ` +
        `catch-all silently filed facts about us as judgments about them.`,
    );
  }
  return home;
}

/**
 * REGROUP the flat snapshot into the two named reads. Pure — no DB, no recompute; every
 * value is read verbatim off the row (byte-identical to the pre-split flat shape).
 *
 * Finding partition (byte-identical guarantee): PC/PB → construction_read, PQ/PS/PX/PV →
 * health_read. When there is NO health read (scored_weight = 0), construction_read is the
 * ONLY read, so it carries EVERY fired finding — nothing is ever dropped. (At c=0 the health
 * families that can still fire are the constructive PS5 "no red flags" and the PV coverage
 * findings; they ride along under construction rather than vanishing with the null health read.)
 */
export function reshapeSnapshot(s: SnapshotReadInput, counts: ReshapeCounts, readTime: PfFinding[]): PortfolioReads {
  const total = num(s.totalValue) as number;
  const scoredWeight = num(s.coverage) as number; // c — the scored value share
  const recognizedUnscoredWeight = total > 0 ? (num(s.recognizedUnscoredValue) as number) / total : 0;
  const smallUnscoredWeight = total > 0 ? (num(s.smallUnscoredValue) as number) / total : 0;

  // ★ THE READ-TIME JOIN — VISIBLY HERE, NOT IN THE SNAPSHOT. `readTime` (PE6) is computed by the READ
  // from a LIVE fact and merged with the PERSISTED set at render. The persisted rows never contain it:
  // the fired set is derived from HASHED INPUTS and is frozen; PE6 is derived from `heldNotValued`, which
  // the catalog can change tomorrow (ODL cv2-s7-refuse-live-facts). Different provenance, different home
  // — see read-time-findings.ts. `readTime` is a REQUIRED parameter so no caller can forget it silently.
  const findings = [...((s.firedFindings ?? []) as PfFinding[]), ...readTime];
  const structure = num(s.structure) as number;
  const healthReadPresent = scoredWeight > 0; // ⇔ evaluable ⇔ scored holdings exist

  // Every finding is routed by DECLARATION (see FINDING_HOME) — an unknown family throws rather than
  // defaulting into the health read. `homeOf` runs even at c = 0, where construction takes the whole set:
  // a family nobody routed is a bug in both states, and the state that skipped the check would be the one
  // that shipped it.
  const homes = findings.map((f) => [f, homeOf(f)] as const);
  const constructionFindings = healthReadPresent
    ? homes.filter(([, h]) => h === "construction").map(([f]) => f)
    : findings; // no health read → construction owns the whole set (nothing dropped)
  const healthFindings = healthReadPresent ? homes.filter(([, h]) => h === "health").map(([f]) => f) : [];

  const coverageState: CoverageState = {
    scoredWeight,
    recognizedUnscoredWeight,
    smallUnscoredWeight,
    scoredCount: counts.scoredCount,
    totalCount: counts.totalCount,
    totalValue: total,
    // Unlock phrasing: recognized-unscored (large/mid) capital exists → scoring it raises
    // coverage (the Health number is already TRUE/uncapped in 1.2; more coverage just lifts
    // the confidence tag, never the number). Small-unscored names don't drive the prompt.
    unlockTrigger: recognizedUnscoredWeight > 0,
  };

  // (Construction v2 Stage 6) the Construction decomposition, verbatim off the persisted column. Null on
  // pre-2.0 / no-holding rows → the read degrades to value + band (the FE handles the null). `structure`
  // (= the Net) is the displayed value; the band is recut over it (§9.1). No recompute.
  // (Stage 7) cast to the ENGINE's own `ConstructionData` type rather than re-declaring the shape here.
  // A hand-written mirror of the wire format is the same two-homes trap in miniature: it drifts the day
  // the engine adds a field and nothing tells you. Stage 7's entities[]/neff/shares/holdingCount are
  // persisted and ride along; the payload surfaces them when a surface needs them (the NTPC story is
  // PC3 → Stage 9), not speculatively.
  const cData = (s.constructionData ?? null) as ConstructionData | null;
  const constructionRead: ConstructionRead = {
    value: structure,
    band: constructionBandOf(structure),
    archetype: cData?.archetype ?? null,
    exposures: cData?.exposures ?? null,
    rules: cData?.rules ?? null,
    gross: cData?.gross ?? null,
    capitalTier: s.capitalTier, // COPY INPUT ONLY (§9.4) — never a badge
    findings: constructionFindings,
  };

  const healthRead: HealthRead | null = healthReadPresent
    ? {
        value: s.phs, // present ⇒ number (evaluable) — the Health Score, uncapped
        band: s.band,
        quality: num(s.quality),
        signals: num(s.signals) as number,
        evaluable: s.evaluable,
        provisional: s.provisional, // (1.2 Change 3) the tag replaces the retired ceiling
        findings: healthFindings,
        signalsLedger: s.signalsLedger,
        pillarProfile: (s.pillarProfile ?? null) as PillarProfile | null,
        lensProfile: (s.lensProfile ?? null) as LensProfile,
      }
    : null;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★ THE STORYBOARD (Stage 10b) — COMPOSED HERE, AT THE READ, FROM THINGS THAT ALREADY HAVE HOMES.
  //
  // It stores nothing (`cv2-s9-no-fired-set-hash`): it is a derivation over `findings` (the same set
  // the two reads partition), `s.phs`/`s.band` (the Health read), `structure` (the Net), and the
  // ledgers already inside `constructionData`. A fact with zero homes cannot drift — so the story is
  // correct the instant its inputs are, and there is nothing to backfill when a finding changes.
  //
  // ★ ZERO NEW DATA ACCESS, and that is enforced by what is available here rather than by discipline:
  //   · `sectoredShare` is C3's `subjectShare` — every branch of `c3Of` sets it to `sectors.sectoredShare`.
  //   · `allSymbols` / `nameRiskSymbols` derive from `entities` (the name-risk sleeve, aggregated) and
  //     `baskets` (funds). The holdings array is NOT persisted and is NOT needed: the ledgers carry the
  //     symbols, which is the whole reason they were persisted in Stage 7/9.
  //
  // Null-safe: a pre-2.0 row (no `constructionData`) or a book with no scored holdings composes no story
  // — `story` is null and the FE degrades, exactly as it already does for `constructionRead` fields.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ A PRE-STAGE-9 `constructionData` ROW HAS `entities` BUT NO `baskets` (Stage 9 added the basket
  // ledger). `4c5ca537`'s live snapshot is exactly one of these. So the story requires the FULL shape —
  // `entities` AND `baskets` — and degrades to null on a partial row rather than throwing inside a read.
  // Its next recompute re-persists the full shape and the story appears; until then the two panel reads
  // still serve (they never needed `baskets`). Degrade by absence, never by a 500.
  //
  // ★ AND `composeStory` ITSELF RETURNS null FOR A SECOND STALE SHAPE — a PRE-10b snapshot, whose PC/PB
  // findings carry no `storyClause` (`isPreStoryboardSnapshot`). That case would otherwise render movement
  // 4 empty on a possibly-concentrated book — a false all-clear. Same degrade, same recompute cure.
  let story: Storyboard | null = null;
  if (cData && s.phs != null && Array.isArray(cData.entities) && Array.isArray(cData.baskets)) {
    const c3 = cData.rules?.find((r) => r.rule === "C3") ?? null;
    const sectoredShare = c3 ? c3.subjectShare : 1; // C3's subjectShare IS sectors.sectoredShare
    const nameRiskSymbols = cData.entities.flatMap((e) => e.constituentInstruments.map((c) => c.symbol));
    const basketSymbols = cData.baskets.map((b) => b.isin);
    story = composeStory({
      findings, // the WHOLE fired set — PD is filtered to the reference inside the composer, not here
      health: s.phs,
      band: s.band,
      coverage: scoredWeight,
      constructionNet: structure,
      sectoredShare,
      entityLedger: cData.entities,
      basketLedger: cData.baskets,
      allSymbols: [...nameRiskSymbols, ...basketSymbols],
      nameRiskSymbols,
    });
  }

  return {
    id: s.id,
    headlineSlot: healthRead ? "health" : "construction",
    coverageState,
    constructionRead,
    healthRead,
    story,
    constantVersion: s.constantVersion,
    asOf: s.createdAt.toISOString(),
  };
}

export const getPortfolioSnapshot = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;

  try {
    // Reads only (zero writes): the latest persisted snapshot + the live "N of M scored"
    // counts the snapshot doesn't persist (it stores value splits, not holding counts) +
    // whether the user still holds anything (empty-vs-construction states when no snapshot)
    // + the DISCLOSURE channel (Step 4).
    // (Construction v2 Stage 9) THE COVERAGE COUNTS NOW COME OFF THE SNAPSHOT, not from `prisma.holding`.
    // They were two `prisma.holding.count(...)` queries — the MANUAL table only — printed in the same
    // sentence as `coverage`, which assemble computes over the AGGREGATED UNION. Two populations, one
    // sentence: e3c6bd3c rendered "Covers 1 of 1 holdings · 100% of book value" while holding THREE
    // positions; 7985d813 said "7 of 10" against a 12-holding book. Counting the raw union instead would
    // be a THIRD population (13 positions vs 12 holdings — it skips assemble's aggregation). The only
    // set that matches the % is the one the % is made of: `constructionData.holdingCount`/`scoredCount`,
    // counted in persist over the very array `totalValue` sums, and frozen alongside it.
    const [snap, disclosure] = await Promise.all([
      prisma.portfolioHealthSnapshot.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      // WHAT THIS NUMBER IS BUILT ON (Step 4) — the caveats the score itself cannot carry:
      //   • heldNotValued — positions we hold but could not price (unmapped broker symbols,
      //     future non-equity instruments). They carry NO PHS weight; showing a health score
      //     while quietly omitting part of the book is the lie this channel exists to prevent.
      //     (Computed by assemble since Step 3 — and, until Step 4, dropped on the floor by
      //     persist and served to no one.)
      //   • staleAccounts — accounts whose broker feed is severed. Their holdings DO carry PHS
      //     weight (frozen last-known quantity × our live price), so the user is owed the fact
      //     that part of their score rests on data that is N days old.
      //
      // DELIBERATELY COMPUTED HERE, NOT PERSISTED: both are LIVE facts. Instrument mapping can
      // change under a stored row, and staleness age grows every single day — a frozen ageDays
      // would begin lying the moment it was written. This stays a read, and stays honest.
      // (Still a pure read: it recomputes no score, writes nothing.)
      listPortfolioDisclosure(userId),
    ]);

    // (Construction v2 Stage 0 — Ruling 2) Stitch the valuation-completeness flags here — the only
    // place the corrected valued book (snapshot totalValue = byStock ∪ heldNotScored) and the live
    // disclosure (heldNotValued) meet. Read-time, never persisted: heldNotValued is a live fact.
    // No snapshot yet → the valued book we can see is the priced-but-unscored capital in the
    // disclosure (heldNotScoredValue); the flag self-corrects once the first snapshot lands.
    const valuedBook = snap ? Number(snap.totalValue) : Number(disclosure.heldNotScoredValue);
    // (Disclosure taxonomy) Enrich each unpriceable position with its rendered { code, cls, sentence } —
    // the SAME reason the row on /me/holdings carries, from the SAME shared composer (disclosures.ts), so
    // the summary and the row can never disagree. ADDITIVE (`note`); every existing heldNotValued field is
    // byte-unchanged. The findings inputs below still read the ORIGINAL `disclosure.heldNotValued`, so PE6/
    // PD4 are untouched. `note` is null only on the defensive no-reason path.
    const disclosureOut = {
      ...disclosure,
      ...constructionValuation(valuedBook, disclosure.heldNotValued),
      heldNotValued: disclosure.heldNotValued.map((h) => ({ ...h, note: describeUnpriced(h.unpricedReason) })),
    };
    // (Stage 9) PE6 — fired HERE, at read, from the live valuation. It is NOT in `fired_findings` and must
    // never be: `firePortfolioFindings` runs inside `persist`, which deliberately does not take
    // `heldNotValued` because the catalog can learn a price tomorrow. Computing it there freezes the same
    // staleness one layer up. See read-time-findings.ts for the full reasoning; the module exists to make
    // this shape impossible to mistake for an oversight and "tidy" into the engine.
    const readTimeFindings = fireReadTimeFindings({
      unvaluedValue: disclosureOut.unvaluedValue,
      unvaluedShare: disclosureOut.unvaluedShare,
      heldNotValued: disclosure.heldNotValued,
    });
    // (Stage 10a batch 2) THE PD FAMILY — fired here for a DIFFERENT reason than PE6, and the difference
    // is worth knowing. PE6 is read-time because its INPUT is live. PD is read-time because of its
    // SUBJECT: ★ a PD finding describes VYTAL, not the book. The persisted row is a snapshot of the
    // USER'S PORTFOLIO, and a fact about our data coverage has a different subject — wrong subject, wrong
    // lifetime, wrong home (ODL cv2-s10a-pd-read-time). PD7 proves it: `oldestSyncAgeDays = f(now)` and
    // `fingerprintOf` has no time input, so a persisted PD7 would never rewrite and would serve "synced 3
    // days ago" forever. This is also where PD1's "never suppressible" is ENFORCED — triage runs over the
    // PERSISTED fired set, and PD is never in it, so the sort never sees PD1. No flag, no exception list.
    //
    // The two loads are the ONLY new data access in the read: `instruments.attributes` has never been
    // selected in the portfolio path, so every `*NullReason` the ingestion has stamped since Step 17 has
    // been unreachable from here (ODL cv2-s10a-nullreason-honest).
    const heldIsins = [...new Set([...disclosure.heldNotScored.map((h) => h.isin)])];
    const [heldFacts, heldAnalytics] = await Promise.all([
      loadHeldInstrumentFacts(heldIsins),
      loadHeldFundAnalytics(heldIsins),
    ]);
    const disclosureFindings = fireDisclosureFindings({
      heldNotValued: disclosure.heldNotValued,
      staleAccounts: disclosure.staleAccounts,
      oldestSyncAgeDays: disclosure.oldestSyncAgeDays,
      facts: heldFacts,
      history: heldAnalytics,
    });
    // (Stage 10a batch 3) THE PI FAMILY — the SAME two loads, a THIRD fire function, and a DIFFERENT
    // destination. PI is read-time for PE6's reason (live inputs: the nightly fold rewrites mf_analytics
    // and `fingerprintOf` has no input from it, so a persisted PI5 would never rewrite) but its SUBJECT is
    // the user's instrument — so unlike PD it is ROUTED INTO A PANEL, and it rides the `readTime` join
    // into `reshapeSnapshot` exactly as PE6 does. See FINDING_HOME.PI.
    const instrumentFindings = fireInstrumentFindings({ facts: heldFacts, analytics: heldAnalytics });
    if (!snap) {
      // `hasHoldings` is a different question ("do you hold anything at all?") and now answers it over
      // the UNION: the old `prisma.holding.count` read a broker-only book as "no holdings".
      //
      // ★ PD IS SERVED HERE TOO, WITH NO SNAPSHOT — and that is the subject argument proving itself in
      // the payload. "We cannot source a credit rating for your bond" is true whether or not we have ever
      // scored this book, because it was never a statement about the book. A finding that needed the
      // snapshot to be true would not have belonged in this family.
      return res.json({
        success: true,
        data: { snapshot: null, hasHoldings: disclosure.positionCount > 0, disclosure: disclosureOut, referenceFindings: disclosureFindings },
      });
    }
    // The counts and the % come off the SAME frozen row, counted over the SAME array. Legacy rows
    // (construction_data NULL, pre-2.0) have no counts — null, never a fabricated 0.
    const cd = (snap.constructionData ?? null) as { holdingCount?: number; scoredCount?: number } | null;
    const totalCount = cd?.holdingCount ?? null;
    const scoredCount = cd?.scoredCount ?? null;
    return res.json({
      success: true,
      data: {
        // ★ PE6 AND PI JOIN HERE TOGETHER — both read-time by PROVENANCE, both about the book, both
        // routed by FINDING_HOME. PD does NOT join here and never will; it is served below, beside the
        // snapshot, because its subject is us. One line, two families, and the third one kept out of it.
        snapshot: reshapeSnapshot(snap, { scoredCount, totalCount }, [...readTimeFindings, ...instrumentFindings]),
        hasHoldings: disclosure.positionCount > 0,
        disclosure: disclosureOut,
        // ★ PD SITS BESIDE THE SNAPSHOT, NOT INSIDE IT — the subject argument, carried into the wire
        // format. `snapshot` is what we know about the USER'S BOOK; PD is what we know about OUR DATA.
        // Nesting it under `snapshot` would repeat at the payload layer the exact mistake we refused at
        // the persistence layer: a fact about us, filed under a heading about them.
        //
        // ⚠ AND NOTE WHAT IS NOT HAPPENING: PD never enters `reshapeSnapshot`. That function partitions
        // findings into the construction and health reads, and its health arm is a CATCH-ALL
        // (`!CONSTRUCTION_FAMILIES.has(f.family)`) — so a PD finding passed to it would land in the
        // HEALTH read, silently, as though "we can't rate your bonds" were a judgment about the book.
        // PD is reference-only (doc 2 §9.2) and so it is not routed by the thing that routes panels.
        referenceFindings: disclosureFindings,
      },
    });
  } catch (e) {
    console.error("[GET /me/portfolio]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to load portfolio health" });
  }
};
