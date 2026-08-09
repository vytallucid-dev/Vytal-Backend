// ═══════════════════════════════════════════════════════════════════════
// WATCHLIST ENRICHMENT — the rich read-join behind GET /me/watchlist.
//
// A BULK, no-N+1 projection (holdings-controller pattern): a fixed handful of
// `findMany({ where: { …: { in } } })` queries regardless of how many stocks are
// pinned, joined to the SAME computed sources every surface reads —
//   stock_prices · score_snapshots (+redFlags +patterns) · market_cap_tier_snapshot ·
//   score_pillars · score_metrics
// — then mapped to a per-stock view. READ-ONLY: health / band / tier / findings are
// READ, never recomputed.
//
// ── ★ TWO FINDING CHANNELS, AND THE UNSCORED PIN NOW HAS ONE ─────────────────────────────────────
// `findings` is score-derived and gated on the head snapshot: an unscored pin gets empty arrays,
// which is correct for that channel and was ALSO the whole of what the row said. `filingFindings` is
// the second channel — what the company FILED — and it is present on every pin. Empty arrays on an
// unscored row read to a user as "nothing wrong here"; that row now carries either real filing
// findings or `filingFindings.coverage.quietNote` saying which checks ran and which could not.
//
// The three-lens verdicts REUSE the exported lens-pattern
// derivations (deriveLensTriplet / lensPattern / lensPillarPattern / verdict composers)
// applied in-memory over the bulk-fetched metric rows — scoring is consumed, never
// touched. Honest-empty: an unscored pin returns price + "not scored yet", never a
// fabricated score; absent findings/verdicts are empty arrays, never faked.
//
// Standing-context refinement (the S3.5 rank second-check) is intentionally omitted in
// this digest — it needs per-stock peer-standing queries and is a display refinement, not
// the pattern itself; the composers handle band=null with their BASE wording. The full
// standing-reconciled read lives on the per-stock health page.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
// ★ THE FILING CHANNEL — rooted at stock, so an UNSCORED pin is no longer a row of empty arrays.
import { readFilingFindings, type FilingFindingsSection } from "../../filing/read.js";
import {
  deriveLensTriplet,
  lensPattern as computeLensPattern,
  lensPillarPattern as computeLensPillarPattern,
  applyAntiDoubleCount,
  applyAntiDoubleCountPillar,
  STEADY_EQUIVALENT_MIN,
  type MetricLensAtom,
  type FiredHeadline,
} from "../../scoring/lens-patterns/index.js";
import { composeLmVerdict, composeLpVerdict } from "../../scoring/lens-patterns/standing-context.js";
// ONE canonical finding row, shared with the per-stock health read (Stage 3) — see `findings` below.
import type { FindingsSection, RedFlagView, PatternView } from "../../scoring/read/health-view.types.js";
import { renderVerdict } from "../../scoring/findings/verdicts.js";
import { dropRetiredFlags, dropRetiredPatterns } from "../../catalogue/retired-findings.js";
import { dropNotCoveredPatterns } from "../../catalogue/not-covered.js";
import { dropFilingFlags, dropFilingPatterns } from "../../filing/channel.js";

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numN = (v: unknown): number | null => (v == null ? null : Number(v));
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** Group rows into a Map<key, rows[]> (used to bucket findings/metrics by their FK). */
function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

// ── the pinned-baseline row (already normalized from the wire by the caller) ──────────
export interface WatchlistRow {
  stockId: string;
  symbol: string;
  name: string;
  sector: string | null;
  industryType: string;
  addedAt: Date;
  favorite: boolean;
  pinnedHealth: number | null;
  pinnedBand: string | null;
  pinnedPrice: unknown; // Prisma Decimal | null
}

// ── three-lens atom mapping — mirrors health-view.service's private `toAtom` (a pure
//    column map; kept in sync). Reads the persisted MetricScore three-lens columns. ────
interface AtomSource {
  metricKey: string;
  scoreState: string;
  rawValue: unknown;
  l1Available: boolean;
  l1Band: string | null;
  l2Available: boolean;
  l2Score: unknown;
  l2AnchorApplied: unknown;
  l3Available: boolean;
  l3Score: unknown;
  l3AnchorApplied: unknown;
  l3Mean: unknown;
  l3StdDev: unknown;
  l3WindowN: number | null;
  peerStats: { mean: unknown; stdDev: unknown; sampleN: number } | null;
}
/** Peer cross-section by metricKey — the natural-key fallback for MetricScores written
 *  before the peer_stats FK existed (mirrors health-view.service's `peerFallback`). */
type PeerFallback = Map<string, { mean: unknown; stdDev: unknown; sampleN: number }>;

function toAtom(ms: AtomSource, pillar: "foundation" | "momentum", peerFallback: PeerFallback): MetricLensAtom {
  // FK first, natural-key fallback second (identical resolution order to the service).
  const peer = ms.peerStats ?? peerFallback.get(ms.metricKey) ?? null;
  return {
    metricKey: ms.metricKey,
    pillar,
    scored: ms.scoreState === "scored",
    rawValue: num(ms.rawValue),
    l1Available: ms.l1Available,
    l1Band: (ms.l1Band as MetricLensAtom["l1Band"]) ?? null,
    l2Available: ms.l2Available,
    l2Score: numN(ms.l2Score),
    l2AnchorApplied: numN(ms.l2AnchorApplied),
    peerMean: peer ? num(peer.mean) : null,
    peerStdDev: peer ? num(peer.stdDev) : null,
    peerSampleN: peer ? peer.sampleN : null,
    l3Available: ms.l3Available,
    l3Score: numN(ms.l3Score),
    l3AnchorApplied: numN(ms.l3AnchorApplied),
    l3Mean: numN(ms.l3Mean),
    l3StdDev: numN(ms.l3StdDev),
    l3WindowN: ms.l3WindowN ?? null,
  };
}

export interface LensMetricVerdict {
  pillar: "foundation" | "momentum";
  metricKey: string;
  id: string;
  label: string;
  tone: string;
  fieldVerdict: "PG_WEAK" | "PG_STRONG" | null;
  role: "top_level" | "supporting_detail";
  verdict: string;
}
export interface LensPillarVerdict {
  pillar: "foundation" | "momentum";
  id: string;
  label: string;
  tone: string;
  fieldVerdict: "PG_WEAK" | "PG_STRONG" | null;
  role: "top_level" | "supporting_detail";
  verdict: string;
}
export interface ThreeLensDigest {
  metricPatterns: LensMetricVerdict[]; // fired LM patterns per scored metric (F+M)
  pillarPatterns: LensPillarVerdict[]; // fired LP patterns per pillar (F+M)
}

interface PillarLensInput {
  pillar: "foundation" | "momentum";
  state: string;
  subtotal: number;
  metrics: AtomSource[];
}

/** Build the LM/LP three-lens digest for one snapshot from its F+M pillars' metric rows,
 *  reusing the exported lens derivations. band=null → the composers' BASE verdict wording. */
function buildLensDigest(pillars: PillarLensInput[], firedHeadlines: FiredHeadline[], peerFallback: PeerFallback): ThreeLensDigest {
  const metricPatterns: LensMetricVerdict[] = [];
  const pillarPatterns: LensPillarVerdict[] = [];

  for (const p of pillars) {
    const pillarScored = p.state === "scored";
    const pillarReadsAcceptable = pillarScored && p.subtotal >= STEADY_EQUIVALENT_MIN;

    // LM — only on SCORED metrics (mirrors the service guard).
    for (const ms of p.metrics) {
      if (ms.scoreState !== "scored") continue;
      const atom = toAtom(ms, p.pillar, peerFallback);
      const triplet = deriveLensTriplet(atom);
      const fired = computeLensPattern(triplet.l1, triplet.l2, triplet.l3, { pillarReadsAcceptable });
      if (!fired) continue;
      const adc = applyAntiDoubleCount(fired, p.pillar, firedHeadlines);
      metricPatterns.push({
        pillar: p.pillar,
        metricKey: ms.metricKey,
        id: fired.id,
        label: fired.label,
        tone: fired.tone,
        fieldVerdict: fired.fieldVerdict,
        role: adc.role,
        verdict: composeLmVerdict(fired.id, fired.fieldVerdict, null),
      });
    }

    // LP — pillar roll-up over ALL atoms (scored + honest-empty).
    const atoms = p.metrics.map((ms) => toAtom(ms, p.pillar, peerFallback));
    const lp = computeLensPillarPattern(atoms);
    for (const pat of lp.patterns) {
      const adc = applyAntiDoubleCountPillar(pat, p.pillar, firedHeadlines);
      pillarPatterns.push({
        pillar: p.pillar,
        id: pat.id,
        label: pat.label,
        tone: pat.tone,
        fieldVerdict: pat.fieldVerdict,
        role: adc.role,
        verdict: composeLpVerdict(pat.id, pat.fieldVerdict, null, lp.shares as { nL3: number }),
      });
    }
  }

  return { metricPatterns, pillarPatterns };
}

// ── the enriched watchlist entry (the GET response element) ───────────────────────────
export interface EnrichedWatchlistEntry {
  stockId: string;
  symbol: string;
  name: string;
  sector: string | null;
  industryType: string;
  addedAt: string;
  favorite: boolean;
  scored: boolean;
  // current read layer (null = honestly unavailable, never faked)
  health: number | null;
  band: string | null;
  healthAsOf: string | null;
  tier: string;
  marketCap: number | null; // ₹Cr from the latest market-cap freeze (null ⇔ unknown/unranked)
  price: number | null;
  prevClose: number | null;
  dayChangePct: number | null;
  priceDate: string | null;
  // pin-time baseline (immutable) + current-vs-pinned deltas (cheap UI convenience)
  pinnedHealth: number | null;
  pinnedBand: string | null;
  pinnedPrice: number | null;
  healthDelta: number | null; // health − pinnedHealth (both present)
  priceChangePct: number | null; // (price − pinnedPrice) / pinnedPrice × 100
  // fired findings (honest-empty arrays when none)
  //
  // ★ CONVERGED onto the CANONICAL rows (Stage 3). This was a structural clone of health-view's
  // RedFlagView/PatternView, re-declared inline — same fields, drifted types (`tier: string` instead
  // of the "auto" | "review" union, and `guardrailEventId` simply missing). Two declarations of one
  // wire shape is how a field lands on one surface and not the other, which is exactly what happened:
  // adding `verdict` here would otherwise have meant adding it twice and hoping both stayed in step.
  // Now there is one row type, and the watchlist gets every future field for free.
  findings: FindingsSection;
  /**
   * ★ FILING findings — the second channel, present on EVERY pin including the unscored ones.
   *
   * `findings` above is score-derived: on an unscored pin it is empty arrays, which is honest for
   * that channel and used to be the entire content of the row. This carries what the company FILED,
   * plus `coverage.quietNote` — the line that distinguishes "we checked and it is clean" from "we
   * could not check" from "we hold no filings", none of which an empty array can say.
   *
   * Never merged into `findings`: the two are drawn from different populations (504 vs 95) and step 5
   * gives them different base rates.
   */
  filingFindings: FilingFindingsSection | null;
  // three-lens verdicts (digest; honest-empty when unscored / nothing fired)
  threeLens: ThreeLensDigest;
}

const EMPTY_LENS: ThreeLensDigest = { metricPatterns: [], pillarPatterns: [] };

/**
 * Enrich a user's watchlist rows into the rich read view. Fixed query count (bulk joins,
 * no N+1) irrespective of watchlist size. Pure over the fetched rows after the reads.
 */
export async function enrichWatchlist(rows: WatchlistRow[]): Promise<EnrichedWatchlistEntry[]> {
  if (rows.length === 0) return [];
  const stockIds = rows.map((r) => r.stockId);

  // ── bulk read layer: price, latest snapshot (id + pillars), tier ──
  const [prices, snapshots, tiers, filingBy] = await Promise.all([
    prisma.stockPrice.findMany({
      where: { stockId: { in: stockIds } },
      select: { stockId: true, price: true, prevClose: true, dayChangePct: true, priceDate: true },
    }),
    prisma.scoreSnapshot.findMany({
      where: { stockId: { in: stockIds } },
      orderBy: [{ asOfDate: "desc" }, { version: "desc" }],
      select: {
        id: true,
        stockId: true,
        composite: true,
        labelBand: true,
        asOfDate: true,
        peerGroupId: true,
        foundationPillarId: true,
        momentumPillarId: true,
      },
    }),
    prisma.marketCapTierSnapshot.findMany({
      where: { stockId: { in: stockIds } },
      orderBy: { asOfDate: "desc" },
      select: { stockId: true, tier: true, marketCap: true },
    }),
    // ★ ROOTED AT STOCK, NOT AT THE SNAPSHOT. One more bulk read alongside the others — no N+1, and
    //   an unscored pin resolves it exactly as a scored one does.
    readFilingFindings(stockIds),
  ]);

  const priceBy = new Map(prices.map((p) => [p.stockId, p]));
  const tierBy = new Map<string, string>();
  const mcapBy = new Map<string, number | null>(); // ₹Cr from the same latest freeze as the tier
  for (const t of tiers)
    if (!tierBy.has(t.stockId)) {
      tierBy.set(t.stockId, t.tier); // first = latest
      mcapBy.set(t.stockId, numN(t.marketCap));
    }
  // latest snapshot per stock (rows are pre-sorted asOfDate desc, version desc → first wins)
  const latestSnap = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) if (!latestSnap.has(s.stockId)) latestSnap.set(s.stockId, s);

  const snapIds = [...latestSnap.values()].map((s) => s.id);
  const pillarIds = [...latestSnap.values()].flatMap((s) => [s.foundationPillarId, s.momentumPillarId]);
  // (peerGroupId, asOfDate) pairs → the period cross-sections for the peer-stats fallback.
  const pgIds = [...new Set([...latestSnap.values()].map((s) => s.peerGroupId))];
  const asOfDates = [...latestSnap.values()].map((s) => s.asOfDate);

  // ── bulk findings + three-lens inputs for the LATEST snapshots only ──
  const [redFlags, patterns, pillarScores, metricScores, peerStats] =
    snapIds.length === 0
      ? [[], [], [], [], []]
      : await Promise.all([
          prisma.redFlag.findMany({
            where: { snapshotId: { in: snapIds } },
            // guardrailEventId is selected because the canonical RedFlagView carries it — the
            // watchlist's own clone had silently dropped it. Converging the type surfaced the gap.
            select: { snapshotId: true, flagKey: true, severity: true, tier: true, triggeringValues: true, guardrailEventId: true },
          }),
          prisma.scorePattern.findMany({
            where: { snapshotId: { in: snapIds } },
            select: {
              snapshotId: true,
              patternKey: true,
              direction: true,
              severity: true,
              displayState: true,
              magnitude: true,
              evidence: true,
              metricRefs: true,
            },
          }),
          prisma.pillarScore.findMany({
            where: { id: { in: pillarIds } },
            select: { id: true, pillarState: true, subtotal: true },
          }),
          prisma.metricScore.findMany({
            where: { pillarScoreId: { in: pillarIds } },
            select: {
              pillarScoreId: true,
              metricKey: true,
              scoreState: true,
              rawValue: true,
              l1Available: true,
              l1Band: true,
              l2Available: true,
              l2Score: true,
              l2AnchorApplied: true,
              l3Available: true,
              l3Score: true,
              l3AnchorApplied: true,
              l3Mean: true,
              l3StdDev: true,
              l3WindowN: true,
              peerStats: { select: { mean: true, stdDev: true, sampleN: true } },
            },
          }),
          // The period cross-sections (peerGroupId × asOfDate) for the peer-stats fallback —
          // over-fetches the in×in grid, exact (pg, date) pairing resolved in JS below.
          prisma.peerStatsSnapshot.findMany({
            where: { peerGroupId: { in: pgIds }, asOfDate: { in: asOfDates } },
            select: { peerGroupId: true, asOfDate: true, metricKey: true, mean: true, stdDev: true, sampleN: true },
          }),
        ]);

  // group findings + pillar meta + metrics by their keys
  // ★ RETIREMENT SUPPRESSION (boundary 4 of 9 — the watchlist). Applied at the grouping step so
  //   every downstream consumer of these two maps (the entry's findings section AND the lens
  //   anti-double-count) sees the same suppressed set.
  const redBySnap = groupBy(dropRetiredFlags(redFlags), (rf) => rf.snapshotId);
  const patBySnap = groupBy(dropNotCoveredPatterns(dropRetiredPatterns(patterns)), (p) => p.snapshotId);
  const pillarById = new Map(pillarScores.map((p) => [p.id, p]));
  const metricsByPillar = groupBy(metricScores, (m) => m.pillarScoreId);
  // peer-stats fallback map, keyed by "peerGroupId|asOfDate" → (metricKey → cross-section).
  const pfKey = (pgId: string, asOf: Date) => `${pgId}|${ymd(asOf)}`;
  const peerFallbackByKey = new Map<string, PeerFallback>();
  for (const ps of peerStats) {
    const k = pfKey(ps.peerGroupId, ps.asOfDate);
    let m = peerFallbackByKey.get(k);
    if (!m) peerFallbackByKey.set(k, (m = new Map()));
    m.set(ps.metricKey, { mean: ps.mean, stdDev: ps.stdDev, sampleN: ps.sampleN });
  }
  const EMPTY_FALLBACK: PeerFallback = new Map();

  return rows.map((r) => {
    const price = priceBy.get(r.stockId);
    const snap = latestSnap.get(r.stockId) ?? null;

    const currentPrice = numN(price?.price);
    const prevClose = numN(price?.prevClose);
    const pinnedPrice = numN(r.pinnedPrice);
    const health = snap ? Math.round(num(snap.composite)) : null;

    // findings + three-lens (only for a scored snapshot; else honest-empty)
    const rf = snap ? redBySnap.get(snap.id) ?? [] : [];
    const pt = snap ? patBySnap.get(snap.id) ?? [] : [];
    // ★ CHANNEL SUPPRESSION (filing/channel.ts) — the RENDERED sets only. `filingFindings` on this
    //   same row already carries the 22 filing keys, from the filing's own period, so serving them
    //   here as well puts the same finding on one watchlist row twice.
    //
    // ⚠ APPLIED HERE AND NOT AT `redBySnap` / `patBySnap`, WHICH IS WHERE THE RETIREMENT FILTER SITS.
    //   Those maps also feed `firedHeadlines` → buildLensDigest's anti-double-count. A retired
    //   headline must stop suppressing a live lens read (it is no longer a claim); a filing headline
    //   must KEEP suppressing it (it is still a claim, still on this row, just from the other
    //   channel). Filtering at the grouping step would surface lens reads that are correctly hidden.
    const rfShown = dropFilingFlags(rf);
    const ptShown = dropFilingPatterns(pt);
    const firedHeadlines: FiredHeadline[] = pt.map((p) => {
      const ev = p.evidence as { leg?: string } | null;
      return { patternKey: p.patternKey, leg: ev?.leg ?? null };
    });

    let threeLens = EMPTY_LENS;
    if (snap) {
      const pillarInputs: PillarLensInput[] = [];
      for (const [pillar, pillarId] of [
        ["foundation", snap.foundationPillarId],
        ["momentum", snap.momentumPillarId],
      ] as const) {
        const meta = pillarById.get(pillarId);
        if (!meta) continue;
        pillarInputs.push({
          pillar,
          state: meta.pillarState,
          subtotal: num(meta.subtotal),
          metrics: metricsByPillar.get(pillarId) ?? [],
        });
      }
      const peerFallback = peerFallbackByKey.get(pfKey(snap.peerGroupId, snap.asOfDate)) ?? EMPTY_FALLBACK;
      threeLens = buildLensDigest(pillarInputs, firedHeadlines, peerFallback);
    }

    return {
      stockId: r.stockId,
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      industryType: r.industryType,
      addedAt: r.addedAt.toISOString(),
      favorite: r.favorite,
      scored: snap != null,
      health,
      band: snap ? snap.labelBand : null,
      healthAsOf: snap ? ymd(snap.asOfDate) : null,
      tier: tierBy.get(r.stockId) ?? "unknown",
      marketCap: mcapBy.get(r.stockId) ?? null,
      price: currentPrice,
      prevClose,
      dayChangePct: numN(price?.dayChangePct),
      priceDate: price?.priceDate ? ymd(price.priceDate) : null,
      pinnedHealth: r.pinnedHealth,
      pinnedBand: r.pinnedBand,
      pinnedPrice,
      healthDelta: health != null && r.pinnedHealth != null ? health - r.pinnedHealth : null,
      priceChangePct:
        currentPrice != null && pinnedPrice != null && pinnedPrice > 0
          ? ((currentPrice - pinnedPrice) / pinnedPrice) * 100
          : null,
      findings: {
        redFlags: rfShown.map((f) => ({
          flagKey: f.flagKey,
          severity: f.severity,
          tier: f.tier as RedFlagView["tier"],
          triggeringValues: f.triggeringValues ?? null,
          guardrailEventId: f.guardrailEventId ?? null,
          verdict: renderVerdict(f.flagKey, f.triggeringValues ?? null),
        })),
        patterns: ptShown.map((p) => ({
          patternKey: p.patternKey,
          direction: p.direction,
          severity: p.severity,
          displayState: (p.displayState ?? "active") as PatternView["displayState"],
          magnitude: numN(p.magnitude),
          evidence: p.evidence ?? null,
          metricRefs: p.metricRefs ?? null,
          verdict: renderVerdict(p.patternKey, p.evidence ?? null),
          // ⚠ NOT RESOLVED HERE, AND SAYING SO. The watchlist is a list view over N stocks; a
          // per-stock lifecycle walk is two extra queries each for a fact this surface does not
          // render. `null` is the honest "not computed" — see the field note on PatternView.
          lifecycle: null,
          // Same reasoning, one step on: without a lifecycle the clause set would be missing its
          // `movement` clause, and a partial decomposition served as a complete one is worse than
          // none. The joined `verdict` above is unaffected and is what this surface renders.
          clauses: null,
          // Same reasoning as `lifecycle`/`clauses`: this list view renders a row, not a card. The
          // record facts are cheap (frozen constants, no query) but serving a pair here would mean
          // resolving each stock's pillars, which is the join this surface deliberately does not do.
          facts: null,
          tier: null,
          state: null,
          pair: null,
        })),
        // `null`, not `[]` — this surface did not resolve lifecycles, which is a different claim
        // from "nothing ended". See the field note on FindingsSection.
        recentlyEnded: null,
        // Same reasoning as the rest of this digest: a list row renders neither a not-covered note
        // nor a cross-tool line, and evaluating them per stock is a join this surface does not do.
        notCovered: [],
        // Same reasoning — the quiet/not-quiet distinction is a per-stock read this list view does
        // not do; `null` here is consistent with `recentlyEnded: null` above, not a claim either way.
        quietNote: null,
        crossTool: [],
      },
      // ★ THE SECOND CHANNEL, ON EVERY ROW. Separate from `findings` above and never merged into it:
      //   that one is score-derived and empty on an unscored pin, this one is filing-derived and real
      //   on all 504 stocks. `coverage.quietNote` is what a row renders when `fired` is empty, so the
      //   list can distinguish "checked, clean" from "could not check" from "no filings held".
      //
      //   ⚠ Unlike the digest above, this is NOT trimmed for the list view: it is one indexed read
      //   for the whole page and carries no per-stock lifecycle walk, so there is nothing to defer.
      filingFindings: filingBy.get(r.stockId) ?? null,
      threeLens,
    };
  });
}
