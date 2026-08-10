// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — READER CONTEXT RESOLVER (§1.2).
//
// One reader's relationship to their whole book + watchlist + attention, resolved once per request. It
// EXTENDS the joins the chat composer already uses — it does NOT write a parallel set:
//   · `probeStockRelationship` (src/ai/insight/relationship.ts) is reused VERBATIM for the (held,
//     watchlist-row) probe — union-aware, the same one the discuss composer routes on.
//   · `buildPortfolioHealthView` supplies the entity-aggregated book (weights, values, sector, PHS) — the
//     SAME read the portfolio page renders, so weights are never re-derived here.
//   · `listUnifiedPositions` supplies per-account labels + route + the fund-holding fact.
//   · `resolveToneForUser` supplies aiLevel (fail-soft to balanced).
// relationship.ts is UNCHANGED, so the chat composer's behaviour is untouched (it still calls
// probeStockRelationship / groundStockRelationship exactly as before). This resolver sits alongside it.
//
// ANONYMOUS ⇒ a VALID context (userId null, no reader-side facts) that resolves to M9 — not an error path.
// ATTENTION IS A ROUTER (§0.6): the fields below select the mode and eligibility; they are never rendered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { probeStockRelationship } from "../ai/insight/relationship.js";
import { dropRetiredPatterns, retiredKeysSqlPredicate } from "../catalogue/retired-findings.js";
// ★ NOT-COVERED SUPPRESSION (companion to boundary 8 of 9 below) — a persisted `notcovered_*` row
//   would otherwise tell a reader "N of your holdings also show this" about a configuration explicitly
//   never shipped as a claim.
import { dropNotCoveredPatterns, notCoveredKeysSqlPredicate } from "../catalogue/not-covered.js";
// ★ CHANNEL SUPPRESSION + the filing channel's own book census (step 5). A key belongs to exactly
//   one population, and which one is projected from FILING_REGISTRY — see filing/channel.ts.
import { isFilingChannelKey } from "../filing/channel.js";
// ★ THE FILING CHANNEL'S OWN DELTA SUBSTRATE (§Phase 7 extension). Snapshot-free, so it is the only
//   way UD1 can resolve on the 355 stocks that never get a ScoreSnapshot — see resolveDelta below.
import { readNewlyStandingFilingDetail } from "../filing/read.js";
import { buildPortfolioHealthView } from "../portfolio/phs/portfolio-health-view.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { resolveToneForUser } from "../ai/tone.js";
import { holdingsInPeerGroup } from "../scoring/read/holdings-in-peer-group.js";
import { monthYear } from "./copy.js";
import type { ReaderContext, ReaderBook, ReaderHolding, ReaderWatchlist, ReaderAttention, ReaderNeighbourhood, ReaderEcho } from "./types.js";

const TRAILING_30D_MS = 30 * 24 * 60 * 60 * 1000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** The anonymous / stranger context — a valid ReaderContext with no reader-side facts (→ M9). */
export function anonymousContext(): ReaderContext {
  return {
    identity: { userId: null, isAuthenticated: false, aiLevel: "balanced" },
    heldThisObject: false,
    book: null,
    watchlist: null,
    attention: null,
    neighbourhood: null, // no book ⇒ no exposure to state (§Phase 4)
    echo: null, // no book ⇒ no echo census (§Phase 6)
    delta: null, // no reader ⇒ no last look (§Phase 7); distinct from evaluable:false
  };
}

/**
 * Resolve the ReaderContext for an authenticated user reading `stockId`. `stockId` is needed only to
 * resolve the per-object facts (the watchlist row + the attention rollup for THIS object); the book and
 * tone are object-independent. Never throws — every sub-read degrades to an honest-empty rather than
 * failing the guaranteed-resolve card.
 */
export async function resolveReaderContext(
  userId: string,
  stockId: string,
  /** §Phase 4 — the object's neighbourhood keys, needed to compute the reader's exposure to THIS
   *  object's pond and sector. Optional so existing callers (and the fixture harness) are unaffected;
   *  absent ⇒ `neighbourhood` resolves null and the UN family simply does not fire. */
  objectRefs?: {
    peerGroupId: string | null;
    sectorKey: string | null;
    /** §Phase 7 — the object's in-force snapshot id + fired keys, so the delta can compare against the
     *  snapshot the reader last saw. Absent ⇒ delta resolves not-evaluable. */
    snapshotGeneration?: string | null;
    firedKeys?: string[];
  },
): Promise<ReaderContext> {
  const [tone, probe, rollup, trailing30d, watchlistCount] = await Promise.all([
    resolveToneForUser(userId), // fail-soft to balanced internally
    probeStockRelationship(userId, stockId).catch(() => ({ held: false, watchlist: null })),
    prisma.behaviorRollup.findUnique({ where: { userId_stockId: { userId, stockId } } }).catch(() => null),
    prisma.attentionEvent
      .count({ where: { userId, stockId, eventType: "view", createdAt: { gt: new Date(Date.now() - TRAILING_30D_MS) } } })
      .catch(() => 0),
    prisma.watchlist.count({ where: { userId } }).catch(() => 0),
  ]);

  const book = await resolveBook(userId);

  // ⚠ QUANTITY, NOT VALUE — the position axis correction (§2.1, library amended).
  //
  // `probeStockRelationship` (src/ai/insight/relationship.ts, not modifiable by this build) tests only
  // for the EXISTENCE of a holding row, so a fully-exited position — quantity 0, kept as a legacy row —
  // came back `held: true`. Live consequence: U2 has five qty-0 rows (RELIANCE, CUMMINSIND, TCS, M&M,
  // TATACOMM); each resolved HELD → M1 → "You own this", for a stock the reader had sold.
  //
  // The library's own definition was the root cause: it defines HELD as "…value > 0", which conflates
  // two different states. They are separated here:
  //   · quantity 0        → EXITED. Not a position. Resolves NEITHER (UH8 territory when UD lands).
  //   · quantity > 0, value null → HELD but unpriceable. UH1's honest-empty branch is exactly right.
  // Testing VALUE would wrongly drop the second case; testing QUANTITY keeps it.
  //
  // Verified against the ledger: `listUnifiedPositions` and the PHS entity ledger ALREADY exclude
  // qty-0 rows, so weights, totalValue and typicalPositionValue were never skewed — the defect was
  // confined to the position axis.
  const heldThisObject = probe.held ? await holdsPositiveQuantity(userId, stockId) : false;

  // ── UN3 substrate: watchlist members sharing THIS object's peer group (excluding the object). ──
  const peersInPeerGroup = objectRefs?.peerGroupId
    ? await watchlistPeersInPeerGroup(userId, objectRefs.peerGroupId, stockId)
    : [];

  const watchlist: ReaderWatchlist = {
    exists: watchlistCount > 0,
    count: watchlistCount,
    thisAddedAt: probe.watchlist?.addedAt ?? null,
    peersInPeerGroup,
  };

  const neighbourhood = await resolveNeighbourhood(userId, stockId, book, objectRefs);
  const echo = await resolveEcho(userId, book);

  // FIRST when there is genuinely no view history for this object; hasHistory guards against a rollup
  // created by a relationship event (no view) reading as RETURNING (§2.1 / UG6 territory).
  const viewCount = rollup?.viewCount ?? 0;
  const attention: ReaderAttention = {
    hasHistory: viewCount > 0,
    firstViewedAt: rollup?.firstViewedAt ?? null,
    lastViewedAt: rollup?.lastViewedAt ?? null,
    viewCount,
    viewCountTrailing30d: trailing30d,
    lastViewedSnapshotGeneration: rollup?.lastViewedSnapshotGeneration ?? null,
  };

  // §Phase 7 — the delta. Resolved AFTER attention, because it reads lastViewedAt/lastViewedSnapshot.
  const delta = await resolveDelta(
    userId,
    stockId,
    attention,
    objectRefs?.snapshotGeneration ?? null,
    objectRefs?.firedKeys ?? [],
  );

  return {
    identity: { userId, isAuthenticated: true, aiLevel: tone.level },
    heldThisObject, // union-aware AND quantity-gated (see the note above)
    book,
    watchlist,
    attention,
    neighbourhood,
    echo,
    delta,
  };
}

/**
 * What changed on THIS object since the reader last looked (§Phase 7, UD substrate).
 *
 * ⚠ NOT-EVALUABLE IS THE DEFAULT, NOT "NOTHING NEW" (UD8 / Standing Rule 7). Without `lastViewedAt`
 * there is no "last time" to measure from, so the family is not evaluable and renders nothing. It must
 * never degrade to "nothing new since …", which would assert a comparison we never made — the same
 * class of falsehood as the M1 first-view claim, in a different entry.
 *
 * THE COMPARISON BASIS is `lastViewedSnapshotGeneration` — the snapshot in force when the reader last
 * looked, stamped by the attention beacon. Comparing against the SNAPSHOT the reader saw (not against
 * a timestamp) is what makes "newly standing" honest: a finding is new to this reader if it is absent
 * from the snapshot they last saw and present now. Without that stamp we can still say the snapshot
 * changed (UD9) but not WHICH findings are new, so `newlyStandingKeys` stays empty rather than guessing.
 *
 * NEVER CLEANS THE SLATE (§0.5). Nothing is removed from the card because it was seen; this resolver
 * only computes the novelty ANNOTATION.
 *
 * ── ★ THE FILING CHANNEL'S OWN SUBSTRATE, RECONCILED AGAINST A DIFFERENT CLOCK ─────────────────────
 * The block above is snapshot-generation-based, so it is permanently silent on the 355 stocks that
 * never get a ScoreSnapshot — `currentGeneration` is null there, `newSnapshotSinceLastLook` is false,
 * and no amount of filing activity could ever reach `newlyStandingKeys`. The filing channel has its own
 * transitions (stock_findings, snapshot-free — filing/read.ts `readNewlyStandingFilingDetail`), and
 * that function already performs the "is this a genuine transition" test the alert evaluator uses. It
 * is reused here VERBATIM, never reimplemented — what follows is not a second version of that test.
 *
 * What that function CANNOT answer is reader-scoped: it returns an OBJECT fact ("this rule transitioned
 * on the record"), not a READER fact ("this reader hasn't seen it yet"), because it takes no reader. The
 * two clocks are genuinely different — `createdAt` dates when OUR pipeline wrote the transitioned row;
 * `since` dates when THIS reader last looked at THIS stock — and a real transition can predate a real
 * visit: the row was already there, already fired, the first time this reader ever opened the card. That
 * is not new to them, even though it is the first newly-standing row we hold. So a candidate only
 * survives into `newlyStandingKeys` when its landing postdates `since` — the same reader clock the score
 * branch above is built on, reconciled here because this is the only place both clocks are in scope.
 */
async function resolveDelta(
  userId: string,
  stockId: string,
  attention: ReaderAttention,
  currentGeneration: string | null,
  currentKeys: string[],
): Promise<ReaderContext["delta"]> {
  const since = attention.lastViewedAt;
  if (!since || !attention.hasHistory) {
    // No last look ⇒ nothing is computable. Honest not-evaluable, never "nothing new".
    return { evaluable: false, since: null, sinceLabel: null, lastSeenGeneration: null, newSnapshotSinceLastLook: false, newlyStandingKeys: [], clearedKeys: [], lastSeenBand: null };
  }

  const lastSeenGeneration = attention.lastViewedSnapshotGeneration;
  const newSnapshotSinceLastLook = Boolean(lastSeenGeneration && currentGeneration && lastSeenGeneration !== currentGeneration);

  let newlyStandingKeys: string[] = [];
  let clearedKeys: string[] = [];
  let lastSeenBand: string | null = null;

  if (lastSeenGeneration && newSnapshotSinceLastLook) {
    try {
      const seen = await prisma.scoreSnapshot.findUnique({
        where: { id: lastSeenGeneration },
        select: { labelBand: true, patterns: { select: { patternKey: true } } },
      });
      if (seen) {
        lastSeenBand = seen.labelBand;
        // Retired keys dropped on BOTH sides of the comparison: a retired key present in the
        // last-seen snapshot but suppressed now would otherwise read as "this cleared since you
        // last looked", announcing a resolution that never happened.
        //
        // ★ THE RED-FLAG HALF IS GONE (2026-08-11), and its removal is the SAME correction. It read
        //   `seen.redFlags` off the last-seen snapshot without the channel filter the other surfaces
        //   applied, so a frozen filing-rule row on that snapshot entered `seenKeys` while the
        //   current side (object-state.ts) no longer emits red flags at all — every one of them would
        //   have read as "cleared since you last looked". The score channel fires no red flags on
        //   either side of this comparison now, so both sides are patterns and the diff is honest.
        const seenKeys = new Set<string>([
          ...dropNotCoveredPatterns(dropRetiredPatterns(seen.patterns)).map((p) => p.patternKey),
        ]);
        const nowKeys = new Set(currentKeys);
        newlyStandingKeys = currentKeys.filter((k) => !seenKeys.has(k));
        clearedKeys = [...seenKeys].filter((k) => !nowKeys.has(k));
      }
    } catch {
      // A pruned or unreadable prior snapshot ⇒ we cannot say what is new. Leave both sets empty:
      // "the snapshot changed" (UD9) is still true and statable; "this finding is new" is not.
      newlyStandingKeys = [];
      clearedKeys = [];
    }
  }

  // The filing channel's transitions, gated on the reader's OWN clock (see the note above). Runs
  // regardless of whether the score branch above found anything — the two substrates are independent
  // and a key cannot collide between them (channel-exclusive namespaces, filing/channel.ts).
  try {
    const filingDetail = await readNewlyStandingFilingDetail([stockId]);
    const candidates = filingDetail.get(stockId) ?? [];
    const newToThisReader = candidates.filter((c) => c.createdAt.getTime() > since.getTime()).map((c) => c.ruleKey);
    if (newToThisReader.length > 0) {
      newlyStandingKeys = [...new Set([...newlyStandingKeys, ...newToThisReader])];
    }
  } catch {
    // Fail-soft like every other delta sub-read: the filing half drops, the score half (if any)
    // stands unaffected, and the card still renders.
  }

  return {
    evaluable: true,
    since,
    sinceLabel: monthYear(since),
    lastSeenGeneration,
    newSnapshotSinceLastLook,
    newlyStandingKeys,
    clearedKeys,
    lastSeenBand,
  };
}

/**
 * The reader's book-wide fired-finding census (§Phase 6, UE substrate).
 *
 * ★ ONE QUERY, NOT N (§5.7). The library's performance budget forbids a per-holding fan-out on the
 * read-critical path, so this resolves every holding's in-force head snapshot and its patterns in a
 * single indexed statement — `DISTINCT ON (stock_id) … ORDER BY period_key DESC, version DESC` is the
 * same supersede-aware head resolution the read layer uses, expressed once in SQL.
 *
 * Returns null on failure, which drops the UE family and records a degradation. It NEVER returns a
 * partial census: an echo built on half a book would misstate its own denominator, and the denominator
 * is half of what makes the family honest (§3.5.3).
 */
async function resolveEcho(userId: string, book: ReaderBook | null): Promise<ReaderContext["echo"]> {
  if (!book?.exists) return null;
  // Direct equity only, quantity-gated — the same rule as the position axis (§2.1 amended). A fund is
  // not an echo member because look-through does not exist.
  try {
    // ⚠ THE Prisma.raw BELOW IS LOAD-BEARING, NOT DECORATION. This is a TAGGED template, so an
    //   unwrapped predicate expression is BOUND AS A PARAMETER rather than spliced as SQL: Postgres
    //   receives `WHERE $3 AND $4` with two text values where boolean expressions belong and rejects
    //   the whole statement with 22P02. The catch below then returns null, the UE family drops, and
    //   the card still renders — so the failure is invisible to the reader and to the caller. That is
    //   not hypothetical; it is what this query did from 2026-08-02 to 2026-08-09.
    //
    //   The sibling boundary (relational/base-rates.ts) escapes this only because it assembles a plain
    //   template literal for $queryRawUnsafe, where interpolation splices text. Both helpers return
    //   `string` by design (see the SQL-fragment contract in retired-findings.ts); Prisma.raw is what
    //   turns that string back into SQL at a tagged site. Held to it by scripts/verify-sql-predicates.ts.
    //
    //   Note this comment lives OUTSIDE the template on purpose — a `$`-brace sequence written inside
    //   it, even within a `--` SQL comment, is still a live JS interpolation.
    const rows = await prisma.$queryRaw<{ stockId: string; name: string; patternKey: string }[]>`
      WITH held AS (
        SELECT DISTINCT stock_id FROM holdings WHERE user_id = ${userId} AND stock_id IS NOT NULL AND quantity > 0
        UNION
        SELECT DISTINCT stock_id FROM broker_holdings WHERE user_id = ${userId} AND stock_id IS NOT NULL AND quantity > 0
      ),
      head AS (
        SELECT DISTINCT ON (s.stock_id) s.id, s.stock_id
        FROM score_snapshots s
        JOIN held h ON h.stock_id = s.stock_id
        ORDER BY s.stock_id, s.period_key DESC, s.version DESC
      )
      SELECT head.stock_id AS "stockId", st.name AS "name", p.pattern_key AS "patternKey"
      FROM head
      JOIN stocks st ON st.id = head.stock_id
      JOIN score_patterns p ON p.snapshot_id = head.id
      -- ★ RETIREMENT SUPPRESSION (boundary 8 of 9 — "N of your holdings also show this"). RAW SQL,
      --   the second reader a Prisma extension would have missed. Without it a retired key would be
      --   presented to the reader as a live pattern shared across their own portfolio.
      --   Prisma.raw is required at this tagged site — see the note above the query.
      WHERE ${Prisma.raw(retiredKeysSqlPredicate("p.pattern_key"))}
        AND ${Prisma.raw(notCoveredKeysSqlPredicate("p.pattern_key"))}
    `;

    const scoredStocks = new Set<string>();
    const byPatternKey = new Map<string, string[]>();
    for (const r of rows) {
      scoredStocks.add(r.stockId);
      // ★ CHANNEL SUPPRESSION (step 5). A filing key on a head snapshot is a FROZEN row — the scoring
      //   pass stopped writing these in step 2 — and its rate is now computed over the population its
      //   rule evaluated in. Counting it here would put a numerator from a decaying subset of the
      //   reader's SCORED holdings over a denominator drawn from the filing population. The filing
      //   census below supplies these keys from stock_findings instead.
      if (isFilingChannelKey(r.patternKey)) continue;
      const names = byPatternKey.get(r.patternKey) ?? [];
      // De-duplicate: one stock may carry a key once per snapshot, and a name must never count twice.
      if (!names.includes(r.name)) names.push(r.name);
      byPatternKey.set(r.patternKey, names);
    }

    // The denominator is every SCORED holding, not merely those with a fired pattern — a clean holding
    // still belongs in "3 of your 8 holdings". Counted from the head set, so it matches the numerator's
    // basis exactly.
    const scoredHoldingsCount = await countScoredHoldings(userId);
    const filing = await resolveFilingEcho(userId);
    return { scoredHoldingsCount: scoredHoldingsCount ?? scoredStocks.size, byPatternKey, filing };
  } catch (err) {
    console.warn(`[relational/echo] census failed — UE family dropped: ${(err as Error).message}`);
    return null;
  }
}

/**
 * ★ THE FILING CHANNEL'S BOOK CENSUS (step 5) — the other half of the ratio the base rates split.
 *
 * Rooted at STOCK, so it folds in holdings that have never been scored. One indexed statement over
 * (stock_id, period_end DESC): `DISTINCT ON (stock_id, rule_key)` reduces the accumulated periods to
 * the current row per rule, exactly as filing/read.ts does in memory, and the two counts are then a
 * FILTER pair over that — fired for the numerator, fired-or-not_fired for the denominator.
 *
 * ⚠ THROWS ARE SWALLOWED INTO AN EMPTY CENSUS, NOT PROPAGATED. The caller's own catch drops the whole
 * UE family on failure, which is right when the SCORE census fails — that census is the family's
 * spine. A filing-census failure must not take the score half down with it: the score keys are still
 * completely computable and their claims are still honest. An empty filing census renders no filing
 * echo, which is the same outcome as a book that simply has no filings.
 */
async function resolveFilingEcho(userId: string): Promise<ReaderEcho["filing"]> {
  const empty = { byRuleKey: new Map<string, string[]>(), evaluatedByRuleKey: new Map<string, number>(), coveredHoldingsCount: 0 };
  try {
    const rows = await prisma.$queryRaw<{ ruleKey: string; name: string; stockId: string; state: string }[]>`
      WITH held AS (
        SELECT DISTINCT stock_id FROM holdings WHERE user_id = ${userId} AND stock_id IS NOT NULL AND quantity > 0
        UNION
        SELECT DISTINCT stock_id FROM broker_holdings WHERE user_id = ${userId} AND stock_id IS NOT NULL AND quantity > 0
      ),
      cur AS (
        SELECT DISTINCT ON (f.stock_id, f.rule_key)
               f.stock_id, f.rule_key, f.evaluation_state
        FROM stock_findings f
        JOIN held h ON h.stock_id = f.stock_id
        ORDER BY f.stock_id, f.rule_key, f.period_end DESC
      )
      SELECT cur.rule_key AS "ruleKey", st.name AS "name", cur.stock_id AS "stockId",
             cur.evaluation_state::text AS "state"
      FROM cur JOIN stocks st ON st.id = cur.stock_id
      WHERE cur.evaluation_state IN ('fired', 'not_fired')
    `;

    const byRuleKey = new Map<string, string[]>();
    const evaluatedByRuleKey = new Map<string, number>();
    const covered = new Set<string>();
    for (const r of rows) {
      covered.add(r.stockId);
      evaluatedByRuleKey.set(r.ruleKey, (evaluatedByRuleKey.get(r.ruleKey) ?? 0) + 1);
      if (r.state !== "fired") continue;
      const names = byRuleKey.get(r.ruleKey) ?? [];
      if (!names.includes(r.name)) names.push(r.name);
      byRuleKey.set(r.ruleKey, names);
    }
    return { byRuleKey, evaluatedByRuleKey, coveredHoldingsCount: covered.size };
  } catch (err) {
    console.warn(`[relational/echo] filing census failed — filing echoes dropped, score echoes unaffected: ${(err as Error).message}`);
    return empty;
  }
}

/** Distinct held stocks that HAVE an in-force snapshot — the echo denominator. */
async function countScoredHoldings(userId: string): Promise<number | null> {
  try {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      WITH held AS (
        SELECT DISTINCT stock_id FROM holdings WHERE user_id = ${userId} AND stock_id IS NOT NULL AND quantity > 0
        UNION
        SELECT DISTINCT stock_id FROM broker_holdings WHERE user_id = ${userId} AND stock_id IS NOT NULL AND quantity > 0
      )
      SELECT count(DISTINCT s.stock_id)::bigint AS n
      FROM score_snapshots s JOIN held h ON h.stock_id = s.stock_id
    `;
    return rows.length ? Number(rows[0].n) : null;
  } catch {
    return null;
  }
}

/**
 * Does the reader hold a POSITIVE quantity of this stock, by either route?
 *
 * The quantity gate behind `heldThisObject` (§2.1, amended). Union-aware exactly as
 * `probeStockRelationship` is — manual FIFO ∪ broker mirror — but counting only rows with quantity > 0,
 * so a fully-exited legacy row (quantity 0) is correctly NOT a position.
 *
 * Note it tests QUANTITY, never value: a holding we cannot price still has a quantity, and dropping it
 * would lose the honest-empty case UH1 exists to serve ("You hold X. Position value isn't available
 * yet."). Fail-soft: on error it falls back to the probe's answer rather than silently un-holding a
 * real position — a false NEITHER is worse than a stale HELD.
 */
export async function holdsPositiveQuantity(userId: string, stockId: string): Promise<boolean> {
  try {
    const [manual, broker] = await Promise.all([
      prisma.holding.count({ where: { userId, stockId, quantity: { gt: 0 } } }),
      prisma.brokerHolding.count({ where: { userId, stockId, quantity: { gt: 0 } } }),
    ]);
    return manual + broker > 0;
  } catch {
    return true; // degrade to the probe's answer
  }
}

/**
 * UN3 substrate — the reader's WATCHLIST members that share this object's peer group, excluding the
 * object itself. Distinct from the HELD intersection (that is `neighbourhood.pgHeld`): a watchlisted
 * peer is not exposure, and the two must never be summed or presented as one number.
 * Fail-soft to an empty list — "none" is a legitimate fact, and an infra error must not fabricate one.
 */
async function watchlistPeersInPeerGroup(
  userId: string,
  peerGroupId: string,
  thisStockId: string,
): Promise<{ stockId: string; symbol: string; name: string }[]> {
  try {
    const rows = await prisma.watchlist.findMany({
      where: { userId, stockId: { not: thisStockId }, stock: { peerGroups: { some: { peerGroupId } } } },
      select: { stock: { select: { id: true, symbol: true, name: true } } },
    });
    return rows.map((r) => ({ stockId: r.stock.id, symbol: r.stock.symbol, name: r.stock.name }));
  } catch {
    return [];
  }
}

/**
 * The reader's exposure to THIS object's peer group and sector (§3.3).
 *
 * WEIGHTS ARE READ, NEVER RE-DERIVED (§0.7): every figure is summed from the entity-aggregated
 * `book.holdings[].weightPct` the portfolio page already computes. This function performs no scoring
 * arithmetic of its own beyond addition over that existing basis.
 *
 * Returns null when there is no book to be exposed through — anonymous, or a connected account with no
 * holdings. That is the honest state; UO4/UG7 speak for it, not a fabricated 0%.
 */
async function resolveNeighbourhood(
  userId: string,
  stockId: string,
  book: ReaderBook | null,
  objectRefs?: { peerGroupId: string | null; sectorKey: string | null },
): Promise<ReaderContext["neighbourhood"]> {
  if (!book?.exists || !objectRefs) return null;

  // ── Peer group: the reader's names inside the pond, via the shared helper (no fourth PG read). ──
  let pgHeld: ReaderNeighbourhood["pgHeld"] = [];
  let pgSize: number | null = null;
  let pgWeightPct: number | null = null;
  if (objectRefs.peerGroupId) {
    const inPg = await holdingsInPeerGroup(userId, objectRefs.peerGroupId, stockId);
    pgSize = inPg.peerGroupSize;
    pgHeld = inPg.held;
    // Sum the entity-ledger weights of the book entities whose constituent symbols match a held peer.
    const heldSymbols = new Set(inPg.held.map((h) => h.symbol));
    const matched = book.holdings.filter((h) => h.symbols.some((s) => heldSymbols.has(s)));
    pgWeightPct = matched.length > 0 ? matched.reduce((sum, h) => sum + h.weightPct, 0) : 0;
  }

  // ── Sector: a DIFFERENT cut (a sector may span several ponds). Never presented as correcting the PG
  //    figure (§3.3 UN7). `ReaderHolding.sector` carries the entity ledger's sector key. ──
  let sectorWeightPct: number | null = null;
  let sectorHeldCount = 0;
  if (objectRefs.sectorKey) {
    const inSector = book.holdings.filter((h) => h.sector === objectRefs.sectorKey);
    sectorHeldCount = inSector.length;
    sectorWeightPct = inSector.reduce((sum, h) => sum + h.weightPct, 0);
  }

  return { pgWeightPct, pgHeld, pgSize, sectorWeightPct, sectorHeldCount };
}

/**
 * Build the entity-aggregated book from the PHS view + unified positions. Fail-soft: any throw degrades to
 * a minimal book (existence from the raw positions, weights null) rather than losing the whole card. Held
 * facts (weights, values, sector) come from the SAME entity ledger the portfolio page reads (§0.7).
 */
async function resolveBook(userId: string): Promise<ReaderBook | null> {
  let positions: Awaited<ReturnType<typeof listUnifiedPositions>> = [];
  try {
    positions = await listUnifiedPositions(userId);
  } catch {
    positions = [];
  }

  // Account labels per constituent symbol + the whole-book account count + the fund-holding fact.
  const labelsBySymbol = new Map<string, Set<string>>();
  const accountNames = new Set<string>();
  let hasFundHoldings = false;
  for (const p of positions) {
    accountNames.add(p.accountName);
    if (p.symbol) {
      const set = labelsBySymbol.get(p.symbol) ?? new Set<string>();
      set.add(p.accountName);
      labelsBySymbol.set(p.symbol, set);
    }
    // A recognised non-equity instrument (stockId null, instrumentId present) is a fund/basket/bond the
    // reader holds and we cannot see through — the honest trigger for `lookthrough_unavailable` / UG5.
    if (p.stockId === null && p.instrumentId !== null) hasFundHoldings = true;
  }

  let pv: Awaited<ReturnType<typeof buildPortfolioHealthView>> | null = null;
  try {
    pv = await buildPortfolioHealthView(userId);
  } catch {
    pv = null;
  }

  const exists = pv?.hasHoldings ?? positions.length > 0;
  if (!exists) {
    // Authenticated, no portfolio connected → book exists:false (UG7 states the limit once).
    return {
      exists: false,
      accountCount: 0,
      scoredHoldingsCount: 0,
      totalHoldingsCount: 0,
      unscoredHoldingsCount: 0,
      totalValue: 0,
      typicalPositionValue: null,
      holdings: [],
      hasFundHoldings: false,
      lookThroughAvailable: false,
      phsComposite: null,
      phsBand: null,
    };
  }

  const entities = pv?.snapshot?.constructionRead.entities ?? [];
  const cov = pv?.snapshot?.coverageState ?? null;
  const totalValue = cov?.totalValue ?? positions.reduce((s, p) => s + Number(p.investedValue ?? 0), 0);

  const holdings: ReaderHolding[] = entities.map((e) => {
    const symbols = e.constituentInstruments.map((c) => c.symbol);
    const labels = new Set<string>();
    for (const sym of symbols) for (const l of labelsBySymbol.get(sym) ?? []) labels.add(l);
    return {
      entityKey: e.entityKey,
      displayLabel: e.displayName,
      value: e.constituentInstruments.reduce((s, c) => s + c.marketValue, 0),
      weightPct: e.weight * 100,
      accountLabels: [...labels],
      // Per-entity scored resolution is deferred — the slice's decisions use aggregate counts
      // (scoredHoldingsCount) and per-object scored (ObjectState.isScored), never this flag.
      isScored: true,
      sector: e.sector,
      route: "direct", // look-through is unavailable, so every name-risk entity is direct-only (§1.2)
      symbols,
    };
  });

  const scoredHoldingsCount = cov?.scoredCount ?? holdings.length;
  const totalHoldingsCount = cov?.totalCount ?? holdings.length;

  return {
    exists: true,
    accountCount: accountNames.size,
    scoredHoldingsCount,
    totalHoldingsCount,
    unscoredHoldingsCount: Math.max(0, totalHoldingsCount - scoredHoldingsCount),
    totalValue,
    typicalPositionValue: median(holdings.map((h) => h.value)),
    holdings,
    hasFundHoldings,
    lookThroughAvailable: false, // permanently false today (§1.2) — UH5 can never fire; UG5 is the handler
    phsComposite: pv?.snapshot?.healthRead?.value ?? null,
    phsBand: pv?.snapshot?.healthRead?.band ?? null,
  };
}
