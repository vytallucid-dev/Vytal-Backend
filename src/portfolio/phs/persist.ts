// ─────────────────────────────────────────────────────────────────────────────
// PHS PERSISTENCE (A.12) — compute-once, append-only, skip-identical.
// Assembles the book → runs the engine → fingerprints the inputs → writes ONE
// snapshot per compute-event, UNLESS the fingerprint matches the user's latest
// (then skip). The snapshot is the single source every surface reads.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { computePhs, type PhsHolding } from "./engine.js";
import { constructionDataOf, buildEntityLedger, buildSectorResolution, natureOf } from "./entity.js";
import { CONSTANT_VERSION } from "./constants.js";
import { assemblePortfolio } from "./assemble.js";
import { firePortfolioFindings } from "./patterns.js";

/** Provenance IDs that (with the weights vector) make the fingerprint (A.12 · §12). */
export interface PhsProvenance {
  healthSnapshotIds: string[]; // constituent ScoreSnapshot ids (the scores PHS READ)
  findingIds: string[]; // fired finding ids per holding
  tierAsOfDate: string; // market-cap tier symbol-master version — LIVE (max asOfDate over held stocks)
  /** (Stage 7 §12) the §14 fund-sector matcher's version. The matcher does not exist yet, so this is the
   *  sentinel MATCHER_VERSION_NONE — but the FIELD ships now, because a matcher that lands without a
   *  fingerprint input is a SILENT RE-RATING: every affected book would keep serving its pre-matcher
   *  Construction until something unrelated happened to touch it. Stage 8 bumps this to "v1" and every
   *  affected snapshot invalidates. A non-null sentinel is deliberate: `undefined` would be OMITTED from
   *  the canonical JSON entirely (JSON.stringify drops undefined) — an input that is silently NOT HASHED,
   *  a fingerprint hole wearing the shape of a value. */
  matcherVersion: string;
}

/** Deterministic fingerprint (A.12 · §12). Unchanged ⇒ skip the write.
 *
 *  §12 ADDITIONS (Stage 7): the ENTITY-AGGREGATED weight vector, `assetClass` + `nature` per holding,
 *  the sector-resolution OUTPUTS, `fund_house` per fund product, and the matcher version. Before this,
 *  the hash saw only POSITION weights + score/finding ids + tier + cv — so a change that moved
 *  Construction WITHOUT moving a position weight (an issuer re-aggregating, a sector resolving, a fund
 *  house being learned, a class being reclassified) produced NO new fingerprint and NO write. The book
 *  kept serving a number its own inputs no longer supported. That is the silent-staleness bug this hash
 *  exists to make impossible; C1–C6 feed the DISPLAYED number now, so every input they read must be here.
 *
 *  REMOVED (Stage 7): `sectorVersion`. It was the hardcoded literal "nse-sector-v1" — a constant, so it
 *  could never fire; a hash input that cannot change is not a guard, it is decoration that READS as
 *  coverage. The sector-resolution OUTPUTS below replace it and are strictly better: they hash the actual
 *  fact C3/C4 read, and they fire per-book when THAT book's resolution changes rather than churning every
 *  book on a global bump. A taxonomy re-definition that leaves the resolved strings identical is
 *  CONSTANT_VERSION's job — that is what a spec bump is for. */
export function fingerprintOf(holdings: PhsHolding[], prov: PhsProvenance): string {
  const total = holdings.reduce((s, h) => s + h.marketValue, 0);
  const w6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const weight = (mv: number) => (total > 0 ? w6(mv / total) : 0);

  const weights = holdings
    .map((h) => [h.symbol, weight(h.marketValue)] as [string, number])
    .sort((a, b) => a[0].localeCompare(b[0]));

  // ENTITY-AGGREGATED weights — the vector C1/C2 actually read. Distinct from `weights` above: NTPC stock
  // + NTPC bond are two positions but ONE 19% entity, and a re-aggregation (a bond's stem newly matching
  // a catalogued issuer) changes THIS vector while leaving every position weight untouched.
  const entityLedger = buildEntityLedger(holdings, total);
  const entities = entityLedger
    .map((e) => [e.entityKey, w6(e.weight), e.sector ?? "-"] as [string, number, string])
    .sort((a, b) => a[0].localeCompare(b[0]));

  // assetClass + nature per holding — nature decides which rules can even see a holding (name-risk vs
  // basket vs commodity vs sovereign). A reclassification moves Construction with no weight change.
  const natures = holdings
    .map((h) => [h.symbol, h.assetClass ?? "unknown", natureOf(h.assetClass ?? "unknown", h.category ?? null)] as [string, string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));

  // sector-resolution OUTPUTS — what C3/C4 read, including the gate. Replaces the dead `sectorVersion`.
  const sr = buildSectorResolution(holdings, total);
  const sectors = {
    weights: sr.sectorWeights.map((s) => [s.sector, w6(s.weight)] as [string, number]).sort((a, b) => a[0].localeCompare(b[0])),
    sectoredShare: w6(sr.sectoredShare),
    unknownRatio: w6(sr.unknownRatio),
    gateOpen: sr.gateOpen,
  };

  // fund_house per FUND PRODUCT (basket ∪ commodity — C5's subject, ODL cv2-s5-c5-commodity). Learning a
  // house moves C5 with no weight change; "unknown" is recorded as itself so learning it is a real delta.
  const houses = holdings
    .filter((h) => { const n = natureOf(h.assetClass ?? "unknown", h.category ?? null); return n === "basket" || n === "commodity"; })
    .map((h) => [h.symbol, h.fundHouse ?? "unknown"] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));

  const canonical = JSON.stringify({
    weights,
    entities,
    natures,
    sectors,
    houses,
    health: [...prov.healthSnapshotIds].sort(),
    findings: [...prov.findingIds].sort(),
    tier: prov.tierAsOfDate,
    matcher: prov.matcherVersion,
    cv: CONSTANT_VERSION,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export interface PersistOutcome {
  skipped: boolean; // true ⇔ fingerprint unchanged from the latest snapshot
  snapshotId: string;
  phs: number | null;
  band: string | null;
  fingerprint: string;
}

/** Compute + persist the PHS snapshot for a user's book. Idempotent per input
 *  fingerprint (append-only; identical inputs → no new row). */
export async function computeAndPersistPhs(userId: string): Promise<PersistOutcome> {
  // `heldNotValued` is deliberately NOT taken here. It is a DISCLOSURE, not a score input — it
  // carries no PHS weight by definition, so it changes no number on this row. And it must not be
  // frozen into the snapshot: whether a symbol is valuable is a LIVE fact (the catalog can learn
  // it tomorrow), exactly like staleness age. The READ serves it, fresh, from the same assemble
  // partition — see listPortfolioDisclosure + the /me/portfolio `disclosure` channel (Step 4).
  const { holdings, prov, fieldWeakSymbols } = await assemblePortfolio(userId);
  const r = computePhs(holdings);
  // Part B: fire portfolio findings from the SAME computed values + holdings (compute-once,
  // spec §0). firePortfolioFindings READS r; it never mutates a number.
  const findings = firePortfolioFindings(holdings, r, { fieldWeakSymbols });
  const fingerprint = fingerprintOf(holdings, prov);
  // (Stage 7) built ONCE, here. Both the `construction_data` JSONB and the `structure` column are written
  // from THIS object — so the displayed number and its evidence cannot disagree by construction. Gate 3
  // asserts `structure == construction_data.net` on every persisted row.
  // `holdings.length` and the scored subset are counted over the SAME array `totalValue` sums (Stage 9).
  const cData = constructionDataOf(r.construction, r.entityLedger, r.basketLedger, r.sectors, holdings.length, holdings.filter((h) => h.health != null).length);

  const latest = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, fingerprint: true, phs: true, band: true },
  });
  if (latest && latest.fingerprint === fingerprint) {
    return { skipped: true, snapshotId: latest.id, phs: latest.phs, band: latest.band, fingerprint };
  }

  const dec = (v: number | null) => (v == null ? null : new Prisma.Decimal(v));
  const snap = await prisma.portfolioHealthSnapshot.create({
    data: {
      userId,
      phs: r.health, // (1.2) the `phs` column now stores the uncapped Health Score
      // (1.2 Change 3) the coverage ceiling is RETIRED: Health shows TRUE, so there is no pre-ceiling
      // value and no cap to record. (Stage 7 §12) the three columns that carried it — phs_raw,
      // ceiling_applied, ceiling_value — are now DROPPED, not written null/false. Proven safe first:
      // 0 of 31 rows ever carried a ceiling. A column written null forever is a fact with a home and
      // no meaning; the next reader has to be told it lies. Dropping it is the honest form.
      band: r.band,
      provisional: r.provisional,
      evaluable: r.evaluable,
      quality: dec(r.quality),
      // (Construction v2 Stage 5 — THE CUTOVER) the `structure` COLUMN — the number the read/FE display
      // as "Construction" — is the C1–C6 NET, not the legacy S-composite (r.structure). r.structure
      // (S1–S5) is still computed and still feeds structureLedger below + patterns.ts's PX findings,
      // byte-identical, until Stage 9 repoints those last consumers to `construction`.
      // (Stage 7) THE ONE DERIVED PROJECTION. Read from `cData.net` — the same in-memory object written
      // to construction_data on this row — never recomputed from r.construction. This is what makes
      // "one home per fact" structural rather than aspirational: there is no second computation that
      // could disagree. (A row served 55.01 while its engine said 32.38 because a writer set these two
      // independently. That is now impossible without editing this line.)
      structure: new Prisma.Decimal(cData.net),
      signals: new Prisma.Decimal(r.signals),
      coverage: new Prisma.Decimal(r.coverage),
      totalValue: new Prisma.Decimal(r.totalValue),
      scoredValue: new Prisma.Decimal(r.scoredValue),
      recognizedUnscoredValue: new Prisma.Decimal(r.recognizedUnscoredValue),
      smallUnscoredValue: new Prisma.Decimal(r.smallUnscoredValue),
      // (Stage 9 §15) `structure_ledger` IS NO LONGER WRITTEN — S1–S5 are deleted, so there is nothing
      // to write. The COLUMN STAYS (nullable, migration 20260716180000) and keeps its 31 rows of real
      // S-ledgers: the only surviving record of how every book was read before the Construction cutover,
      // and the thing that makes the cutover auditable after the fact. STOP WRITING; NEVER DROP — you
      // cannot un-drop history. New rows carry NULL, which is honest: "this row was never scored by
      // S-rules." A reader can tell the two eras apart, which is what an append-only table is for.
      signalsLedger: r.signalsLedger as unknown as Prisma.InputJsonValue,
      firedFindings: findings as unknown as Prisma.InputJsonValue, // Part B — fired PF findings
      // (1.2 Change 4/5) health-read enrichments — position-weighted pillar means +
      // findings-character lens shares. Null when !evaluable (no scored holdings) or (lens)
      // no lens patterns fired. Derived from the same score snapshots already in the fingerprint.
      pillarProfile: (r.pillarProfile ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
      lensProfile: (r.lensProfile ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
      // (1.1 Change 2) copy-only tiers — stored for the Part B copy selector. NOT in the
      // fingerprint (they don't move the score; fingerprint unchanged per spec 1.1/1.2).
      // structureTier is GONE from the engine (§15 — the vocabulary labels the INVESTOR, not the book).
      // The COLUMN stays and keeps its history; new rows carry NULL. patterns.ts derives its copy
      // register from holdingCount now (`copyRegisterOf`).
      capitalTier: r.capitalTier,
      // (Stage 6 · extended Stage 7 §12) THE SINGLE PERSISTED HOME for the Construction decomposition —
      // C1–C6 ledger (subjectShare + structured firedSubject + metrics), archetype, exposures, the entity
      // ledger, the Neffs, the shares, holdingCount. Persisted so a pure read renders without recomputing.
      // Zero columns beside it: §12's field list lands IN here. The `structure` column below is the ONE
      // derived projection — assigned FROM `cData.net`, in this same write, never recomputed.
      constructionData: cData as unknown as Prisma.InputJsonValue,
      constantVersion: CONSTANT_VERSION,
      fingerprint,
    },
    select: { id: true },
  });
  return { skipped: false, snapshotId: snap.id, phs: r.health, band: r.band, fingerprint };
}
