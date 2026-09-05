// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FIXTURES THE HARNESS NEEDS — discovered, asserted, never created.
//
// ── ★ WHY THIS FILE EXISTS RATHER THAN A HARDCODED UUID ───────────────────────────────────────────
// Four of the ten defects this harness must catch are only visible against a POPULATED book:
//
//   · "₹0 Cr" needs positions whose value is real and small
//   · "PINNED 5" over an empty list needs pins
//   · the `JOIN stocks` silently dropping 8 of 21 needs a MIXED book — shares and instruments
//   · "Positions 21" over 12 rows needs more holdings than the row cap
//
// An empty book satisfies every invariant here trivially, which is §9.3's own failure mode wearing a
// green tick: a suite asserting universals over an empty set passes and tests nothing.
//
// ── ★ AND WHY IT DOES NOT SEED ────────────────────────────────────────────────────────────────────
// This project has ONE database — the harness DATABASE_URL is the same Supabase project that holds
// real users (see scripts/lib/throwaway-user.ts, which says so plainly). A harness that writes 21
// positions to make itself pass is a harness that has changed the thing it is measuring, and the
// rows outlive the run.
//
// So: it DISCOVERS a book that already exists, ASSERTS it is populated enough to be evidence, and
// FAILS LOUDLY naming what is missing when it is not. A missing fixture must never be a quiet skip,
// because a quiet skip is indistinguishable from a pass.
//
// ⚠ READ-ONLY. Nothing in this file writes.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

/** What a book must have before it is worth asserting over. Concrete, never `> 0` (§9.3). */
export const BOOK_FLOOR = {
  /** Below this a "set" is not a set and truncation/reconciliation cannot be exercised. */
  holdings: 8,
  /** ★ THE ONE THAT CATCHES THE JOIN. An all-equity book cannot show a non-equity drop. */
  nonEquity: 1,
  /** At least one scored position, or the band/pillar half of every reader answer is absent. */
  scored: 1,
} as const;

export interface BookFixture {
  readonly userId: string;
  readonly email: string;
  readonly holdings: number;
  readonly nonEquity: number;
  readonly scored: number;
  readonly watchlist: number;
  /** Everything the floors asked for that this book does not have. Empty ⇒ usable. */
  readonly missing: readonly string[];
}

/**
 * Find the most populated book available, preferring a declared fixture account.
 *
 * ★ PREFERENCE ORDER IS DELIBERATE. `HARNESS_BOOK_USER_ID` lets an operator pin the book explicitly.
 *   Otherwise the richest book wins — which will usually be a developer's own, and that is the right
 *   default for a suite whose whole purpose is meeting real data.
 */
export async function findBookFixture(): Promise<BookFixture | null> {
  const pinned = process.env.HARNESS_BOOK_USER_ID?.trim();
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT h.user_id,
            COUNT(*)::int                                    AS holdings,
            COUNT(*) FILTER (WHERE h.stock_id IS NULL)::int  AS non_equity,
            COUNT(DISTINCT ss.stock_id)::int                 AS scored
       FROM holdings h
       LEFT JOIN LATERAL (
         SELECT stock_id FROM score_snapshots WHERE stock_id = h.stock_id LIMIT 1
       ) ss ON true
      WHERE h.quantity > 0 ${pinned ? "AND h.user_id = $1" : ""}
      GROUP BY h.user_id
      ORDER BY holdings DESC
      LIMIT 1`,
    ...(pinned ? [pinned] : []),
  ).catch(() => []);
  const r = rows[0];
  if (!r) return null;

  const userId = String(r.user_id);
  const [u] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT email FROM users WHERE id = $1`, userId,
  ).catch(() => []);
  const [w] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT COUNT(*)::int AS n FROM watchlist WHERE user_id = $1`, userId,
  ).catch(() => [{ n: 0 }]);

  const holdings = Number(r.holdings ?? 0);
  const nonEquity = Number(r.non_equity ?? 0);
  const scored = Number(r.scored ?? 0);
  const missing: string[] = [];
  if (holdings < BOOK_FLOOR.holdings) missing.push(`${holdings} holdings, floor is ${BOOK_FLOOR.holdings}`);
  if (nonEquity < BOOK_FLOOR.nonEquity) missing.push(`${nonEquity} non-equity holdings, floor is ${BOOK_FLOOR.nonEquity} — the JOIN-drop defect is unexercisable without one`);
  if (scored < BOOK_FLOOR.scored) missing.push(`${scored} scored holdings, floor is ${BOOK_FLOOR.scored}`);

  return {
    userId, email: String(u?.email ?? "(unknown)"),
    holdings, nonEquity, scored, watchlist: Number(w?.n ?? 0), missing,
  };
}

/**
 * ★ WHAT THE READER ACTUALLY HOLDS — the harness's own count, deliberately naive.
 *
 * ⚠ THIS EXISTS BECAUSE THE ACCEPTANCE TEST CAUGHT THE HARNESS MISSING D10. Reintroducing the inner
 *   `JOIN stocks` — the query that silently drops every non-equity position — left every invariant
 *   green. From the PAYLOAD ALONE the two states are identical: a list of 13 under a total of 21 with
 *   `totalAvailable: 21` set is exactly what an honestly-truncated list looks like. There is no
 *   property of the payload that separates "we capped this list and said so" from "a join ate a third
 *   of it", because the resolver's own idea of how many exist is derived from the same lossy query.
 *
 * ★ SO THE ORACLE HAS TO COME FROM OUTSIDE THE CODE UNDER TEST. This query is the simplest complete
 *   statement of "what does this reader hold" — outer joins to both catalogues, no filtering. It is a
 *   second implementation on purpose: a test whose oracle is simpler than the implementation is the
 *   normal shape of a test, and the naive version is the one that cannot lose rows.
 */
export async function expectedBook(userId: string): Promise<{ symbols: number; nonEquity: number }> {
  const [r] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT COUNT(DISTINCT COALESCE(s.symbol, i.symbol, i.isin))::int AS symbols,
            COUNT(DISTINCT COALESCE(s.symbol, i.symbol, i.isin))
              FILTER (WHERE h.stock_id IS NULL)::int                 AS non_equity
       FROM holdings h
       LEFT JOIN stocks s      ON s.id = h.stock_id
       LEFT JOIN instruments i ON i.id = h.instrument_id
      WHERE h.user_id = $1 AND h.quantity > 0`,
    userId,
  ).catch(() => [] as Array<Record<string, unknown>>);
  return { symbols: Number(r?.symbols ?? 0), nonEquity: Number(r?.non_equity ?? 0) };
}

/**
 * The stocks the market half of the matrix runs against.
 *
 * ★ THREE SHAPES, NOT THREE COMPANIES. A healthy tier-2 subject, a genuinely THIN one, and a bank —
 *   because a bank's statement family is different and the family-aware paths only diverge there.
 *   A matrix proven on TCS alone has been run against a third of the contract and cannot say which
 *   third. (Stage 5b learned the thin one the hard way: 360ONE is an NBFC that files 32 quarters and
 *   was standing in for a thin subject while being nothing of the kind.)
 */
export const SUBJECTS = {
  healthy: "TCS",
  thin: "MOLBIO",
  bank: "HDFCBANK",

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ FOUR ROLES ADDED AT PHASE 1 · BATCH 1, AND THE FIRST ONE IS A DEFECT IN THIS FILE.
  //
  // ⚠ `thin: "MOLBIO"` IS TIER 0 — measured through `resolveStockCoverage`: 0 quarters in ALL FIVE
  //   industry tables, and one shareholding filing. Both families authored in this batch declare
  //   `minTier: 1`, and so do both orientation families, so **MOLBIO can never reach any of them**.
  //   Every "does this degrade honestly" assertion the matrix runs on the thin arm has been testing
  //   the PLANNER's degradation, not the family's — which is the same shape as the stage-5b finding
  //   that three registered families were dead code, one layer down. MOLBIO stays, because a tier-0
  //   subject is a real state worth exercising; it is no longer the only thin arm.
  //
  //   `thinTier1` is the thin arm a FAMILY can actually reach: measured, MANIPALHOS is tier 1 with 1
  //   quarter, 0 annual years and exactly 1 shareholding filing. That single filing is also what the
  //   brief asks OA to be verified against, so one subject serves both families' thin path.
  //
  // ★ `nbfc` CARRIES TWO CONSTRAINTS AT ONCE and that is why it is BAJFINANCE rather than any bank.
  //   Measured: tier 1, 29 quarters, 6 annual years, the `nbfc` payload — so it exercises the
  //   fourth statement family AND the "all 142 NBFCs are unscored" fact. An answer full of real
  //   figures reads as a scored company unless it says otherwise, and only an unscored subject with
  //   real depth can prove it says otherwise.
  //
  // ★ `pledged` AND `deepOwnership` EXERCISE THE TWO PLEDGE STATES AND THE INSIDER RAIL.
  //   ASHOKLEY: measured, the ONLY state where both pledge columns are positive — 51.37% by share
  //   count against 59.03% by the pct column, which is the disagreement that decided the ruling.
  //   INFY: 30 filings, 382 insider rows, 4 deals — the dealing answer has nothing to show on TCS
  //   (0 insider rows), so a matrix proven on TCS alone would never build a populated insider rail.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  thinTier1: "MANIPALHOS",
  nbfc: "BAJFINANCE",
  pledged: "ASHOKLEY",
  deepOwnership: "INFY",

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THREE ROLES ADDED AT PHASE 2 · BATCH 1, AND ALL THREE ARE SHAPES `StockCoverage` CANNOT SEE.
  //
  // T · Trajectory and A · Attribution both turn on facts about a stock's HISTORY that tier and depth
  // do not express — whether the score actually moved, and whether a pillar's weight was ever carried
  // by the others. A fixture chosen for tier alone would run every case against a flat, fully scored
  // series and never once exercise the two branches these families exist for. `checkTrajectoryFixtures`
  // below asserts each of these, for the same reason `checkPeerFixtures` exists.
  //
  // ★ `moved` CARRIES THREE CONSTRAINTS AT ONCE, which is why it is INDUSINDBK rather than the largest
  //   mover. Measured: 2 phases with a 20.4-point step at FY25Q3, a range of 27.6 across 5 bands, AND
  //   it is a BANK — so the brief's "a bank or NBFC, not only a non-financial" is satisfied by the
  //   subject that also exercises the phase detector hardest. Its Foundation and Momentum fields are
  //   the banking set (Tier-1, GNPA, CASA, NIM …), so A's field-grain walk is exercised on the family
  //   whose metric keys collide with the non-financial ones (`bars-loader/label-map.ts` says so).
  //
  // ★ `flat` IS THE NEGATIVE CONTROL FOR THE PHASE DETECTOR, and it is the one nobody would think to
  //   add. Measured: EICHERMOT ranges 5.3 points across 14 quarters and segments to exactly ONE phase.
  //   Without it every trajectory assertion would be checked only on series that DO segment, and a
  //   detector that always finds a change would pass all of them.
  //
  // ★ `redistributed` MUST BE REDISTRIBUTED IN THE CURRENT PERIOD, which is why it is VEDL and not LT.
  //   Measured: only 8 stocks have ever carried a redistributed pillar, and only VEDL (market) and
  //   JSWENERGY (momentum) carry one at FY27Q1 — the period A reads. LT's four redistributed quarters
  //   are historical, so it exercises T's event rail and NOT A's absent bar. Picking LT here would have
  //   left A's redistribution path unexercised while looking correct.
  moved: "INDUSINDBK",
  flat: "EICHERMOT",
  redistributed: "VEDL",

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ ONE ROLE ADDED AT PHASE 2 · BATCH 2, AND IT IS A SHAPE NOTHING ELSE HERE EXPRESSES.
  //
  // PT's central claim is that a quarter where the rules RAN AND RAISED NOTHING is a RESULT and not a
  // gap, and the brief asks for it by name. Measured: ICICIBANK holds 7 witnessed empties of 14 —
  // the deepest in the universe — where TCS holds ZERO. A findings census proven only on TCS would
  // never once render the honest-empty sentence, and the assertion for it would pass on nothing.
  //
  // ⚠ IT IS ALSO A BANK, which keeps the brief's "not only a non-financial" satisfied on this family
  //   without a fifth subject.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  witnessedEmpty: "ICICIBANK",
} as const;

/**
 * What each role must still be true of. Read by `checkSubjects` below.
 *
 * ★ EVERY ROLE STATES ITS OWN SHAPE, WHICH THE OLD TWO-BRANCH TEST COULD NOT. It read
 *   `role === "thin" ? tier < 2 && q <= 8 : tier === 2 && q >= 8` — so adding an unscored NBFC with
 *   29 quarters to the roster would have been reported as a BROKEN fixture, because the else-branch
 *   demands tier 2. A fixture check that fails on a correct fixture gets deleted, and the version
 *   that gets deleted checks nothing.
 */
const ROLE_SHAPE: Record<keyof typeof SUBJECTS, { want: string; ok: (s: { tier: number; quarters: number; snapshots: number | null }) => boolean }> = {
  healthy:       { want: "tier 2, 8+ quarters",        ok: (s) => s.tier === 2 && s.quarters >= 8 },
  // ⚠ THE THIN SUBJECT MUST STAY THIN. If it grows a history the matrix quietly loses its thin arm.
  thin:          { want: "tier 0 — no quarterly row in any of the five tables",
                   ok: (s) => s.tier === 0 && s.quarters === 0 },
  bank:          { want: "tier 2, 8+ quarters, banking family", ok: (s) => s.tier === 2 && s.quarters >= 8 },
  // ⚠ TIER 1 AND SHALLOW, so a family with `minTier: 1` reaches it and finds almost nothing.
  thinTier1:     { want: "tier 1, at most 4 quarters — reachable by a family, and thin once there",
                   ok: (s) => s.tier === 1 && s.quarters <= 4 },
  // ⚠ TIER 1 WITH REAL DEPTH — the unscored-but-well-covered case. If this ever scores, the "we hold
  //   these filings and do not score this company" path loses its only fixture.
  nbfc:          { want: "tier 1 (unscored) with 8+ quarters", ok: (s) => s.tier === 1 && s.quarters >= 8 },
  pledged:       { want: "tier 2 with depth — the both-columns-positive pledge state",
                   ok: (s) => s.tier === 2 && s.quarters >= 8 },
  deepOwnership: { want: "tier 2 with depth and a populated insider feed",
                   ok: (s) => s.tier === 2 && s.quarters >= 8 },
  // ⚠ TIER AND DEPTH ARE NOT WHAT MAKES THESE THREE USABLE — see `checkTrajectoryFixtures`, which
  //   asserts the shape that actually matters. These entries only keep them scored and deep enough to
  //   reach the families at all.
  moved:         { want: "tier 2 with a full score history", ok: (s) => s.tier === 2 && (s.snapshots ?? 0) >= 8 },
  flat:          { want: "tier 2 with a full score history", ok: (s) => s.tier === 2 && (s.snapshots ?? 0) >= 8 },
  redistributed: { want: "tier 2 with a full score history", ok: (s) => s.tier === 2 && (s.snapshots ?? 0) >= 8 },
  // ⚠ THE SHAPE THAT MATTERS IS ASSERTED IN `checkTrajectoryFixtures`, not here — tier and depth
  //   cannot see whether a quarter was WITNESSED.
  witnessedEmpty: { want: "tier 2 with a full score history", ok: (s) => s.tier === 2 && (s.snapshots ?? 0) >= 8 },
};


/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ PEER-GROUP REACHABILITY — Phase 1 · Batch 2, and it exists because of the MOLBIO failure.
 *
 * `checkSubjects` above proves each role still has the TIER and DEPTH its matrix cases assume. That is
 * not enough for PG: three of its cases turn on a fact `StockCoverage` cannot express at all —
 * **whether the subject is in a peer group, and whether that pond is scored.**
 *
 *   healthy    must be in a pond with ≥2 SCORED members    ← the standing/rank/marker path
 *   nbfc       must be in a pond with ZERO scored members  ← the unscored-roster path
 *   thinTier1  must be in NO pond at all                   ← the unassigned-decline path
 *
 * ⚠ EVERY ONE OF THOSE CAN FLIP WITHOUT ANYTHING ELSE MOVING. The scoring roster grows; a pond gets
 *   its first snapshot; a stock is added to the Nifty-500 expansion. On any of those the case still
 *   runs, still passes, and is silently exercising a path it was not written for — which is precisely
 *   what MOLBIO did for two batches (tier 0, so every "thin" assertion tested the planner's
 *   degradation rather than the family's) and what the brief asks not to repeat.
 *
 * ⚠ AND THE UNSCORED-POND ROLE IS THE FRAGILE ONE, because the brief asked for something that does not
 *   exist. Measured: 13 ponds are wholly scored, 10 are wholly unscored, and NONE is mixed — so "a
 *   peer group containing unscored members" is only satisfiable as a wholly unscored pond. If a mixed
 *   pond ever appears it is a better fixture than this one, and this check is where that shows up.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface PeerFixtureCheck {
  readonly role: string;
  readonly symbol: string;
  readonly ok: boolean;
  readonly note: string;
}

export async function checkPeerFixtures(): Promise<PeerFixtureCheck[]> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT s.symbol,
            pg.display_name                                                      AS pond,
            (SELECT COUNT(*) FROM stock_peer_groups x WHERE x.peer_group_id = spg.peer_group_id)::int AS members,
            (SELECT COUNT(*) FROM stock_peer_groups x
              WHERE x.peer_group_id = spg.peer_group_id
                AND EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = x.stock_id))::int    AS scored
       FROM stocks s
       LEFT JOIN stock_peer_groups spg ON spg.stock_id = s.id
       LEFT JOIN peer_groups pg        ON pg.id = spg.peer_group_id
      WHERE s.symbol = ANY($1)`,
    [SUBJECTS.healthy, SUBJECTS.nbfc, SUBJECTS.thinTier1],
  ).catch(() => [] as Array<Record<string, unknown>>);
  const by = new Map(rows.map((r) => [String(r.symbol), r]));

  const want: { role: string; symbol: string; need: string; ok: (r: Record<string, unknown> | undefined) => boolean }[] = [
    {
      role: "healthy", symbol: SUBJECTS.healthy,
      need: "a peer group with at least 2 SCORED members — the standing, rank and peer-marker path",
      ok: (r) => Boolean(r?.pond) && Number(r?.scored ?? 0) >= 2,
    },
    {
      role: "nbfc", symbol: SUBJECTS.nbfc,
      need: "a peer group with ZERO scored members — the unscored-roster path",
      ok: (r) => Boolean(r?.pond) && Number(r?.scored ?? 0) === 0 && Number(r?.members ?? 0) >= 2,
    },
    {
      role: "thinTier1", symbol: SUBJECTS.thinTier1,
      need: "NO peer group at all — the unassigned-decline path",
      ok: (r) => !r?.pond,
    },
  ];

  return want.map((w) => {
    const r = by.get(w.symbol);
    const ok = w.ok(r);
    return {
      role: w.role, symbol: w.symbol, ok,
      note: `${w.role}: ${r?.pond ? `${r.pond} — ${r.scored} of ${r.members} scored` : "no peer group"}` +
        (ok ? "" : ` — this role needs ${w.need}; pick another subject for it`),
    };
  });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ TRAJECTORY AND ATTRIBUTION REACHABILITY — Phase 2 · Batch 1. The MOLBIO lesson, third time.
 *
 * `checkSubjects` proves tier and depth. `checkPeerFixtures` proves pond membership. Neither can see
 * the two facts T and A are built around:
 *
 *   moved          the score must actually SEGMENT — at least 2 phases, or the change-point detector
 *                  is only ever exercised on series where it correctly finds nothing
 *   flat           the score must segment to exactly ONE phase — the negative control. A detector that
 *                  always finds a change passes every `moved` assertion.
 *   redistributed  a pillar's weight must be carried by the others IN THE PERIOD A READS. Historical
 *                  redistribution exercises T's rail and not A's absent bar, and the two look
 *                  identical from a tier.
 *
 * ⚠ ALL THREE CAN FLIP WITHOUT ANYTHING ELSE MOVING. A quarter is added and a two-phase series becomes
 *   three, or a flat one finally steps; a pillar becomes scorable again and the redistributed fixture
 *   is a normal one. In every case the matrix case still runs, still passes, and is exercising a path
 *   it was not written for.
 *
 * ★ IT RUNS THE REAL DETECTOR, NOT A COPY OF IT. Re-deriving "did this segment" here with a second
 *   implementation would make the fixture check agree with itself rather than with the family (N-3).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export async function checkTrajectoryFixtures(): Promise<PeerFixtureCheck[]> {
  const { resolveTrajectory } = await import("../resolve/trajectory.js");
  const { resolveAttribution } = await import("../resolve/attribution.js");

  const out: PeerFixtureCheck[] = [];

  // ⚠ EACH CHECK TAKES ITS SYMBOL AS AN ARGUMENT RATHER THAN CLOSING OVER THE LOOP BINDING. The first
  //   draft destructured `[role, symbol, need, test]` and the arrow bodies referenced `symbol` — which
  //   is the TUPLE's own binding, still in its temporal dead zone while the array literal is being
  //   evaluated. All three checks threw `Cannot access 'symbol' before initialization`, and the
  //   surrounding `.catch` turned each throw into a FAILED fixture with a plausible message. A harness
  //   whose own error path reports "this fixture is broken" when the HARNESS is broken is the worst
  //   available failure: it sends the reader to change a subject that was never wrong.
  const checks: {
    role: string; symbol: string; need: string;
    run: (sym: string) => Promise<{ ok: boolean; note: string }>;
  }[] = [
    {
      role: "moved", symbol: SUBJECTS.moved,
      need: "a score history that segments into 2 or more phases — the change-point path",
      run: async (sym) => {
        const t = await resolveTrajectory(sym);
        return t.ok
          ? { ok: t.data.phases.length >= 2, note: `${t.data.phases.length} phase(s), range ${t.data.range}` }
          : { ok: false, note: `no score history (${t.absent.reason})` };
      },
    },
    {
      role: "flat", symbol: SUBJECTS.flat,
      need: "a score history that segments into exactly ONE phase — the negative control for the detector",
      run: async (sym) => {
        const t = await resolveTrajectory(sym);
        return t.ok
          ? { ok: t.data.phases.length === 1, note: `${t.data.phases.length} phase(s), range ${t.data.range}` }
          : { ok: false, note: `no score history (${t.absent.reason})` };
      },
    },
    {
      role: "redistributed", symbol: SUBJECTS.redistributed,
      need: "a pillar redistributed IN THE PERIOD ATTRIBUTION READS — not merely at some point in the past",
      run: async (sym) => {
        const a = await resolveAttribution(sym);
        return a.ok
          ? { ok: a.data.redistributed.length >= 1,
              note: a.data.redistributed.length
                ? `${a.data.redistributed.join(", ")} redistributed at ${a.data.periodKey}`
                : `nothing redistributed at ${a.data.periodKey}` }
          : { ok: false, note: `no score (${a.absent.reason})` };
      },
    },
    {
      role: "witnessedEmpty", symbol: SUBJECTS.witnessedEmpty,
      need: "at least one quarter where the rules RAN AND RAISED NOTHING — the honest-empty path",
      run: async (sym) => {
        const { resolvePatterns } = await import("../resolve/patterns.js");
        const r = await resolvePatterns(sym);
        return r.ok
          ? { ok: r.data.witness.witnessedEmpty >= 1,
              note: `${r.data.witness.witnessedEmpty} witnessed empty of ${r.data.witness.periods} quarters` }
          : { ok: false, note: `no findings history (${r.absent.reason})` };
      },
    },
  ];

  for (const { role, symbol, need, run } of checks) {
    const r = await run(symbol).catch((e) => ({ ok: false, note: `check failed: ${String(e).slice(0, 80)}` }));
    out.push({
      role, symbol, ok: r.ok,
      note: `${role}: ${r.note}` + (r.ok ? "" : ` — this role needs ${need}; pick another subject for it`),
    });
  }
  return out;
}

/**
 * Confirm each named subject still resolves and still has the SHAPE the matrix assumes.
 *
 * ★ THROUGH `resolveStockCoverage`, NOT A RAW QUERY, AND THE FIRST DRAFT PROVED WHY. It counted rows
 *   in `quarterly_results` — and a bank files into `banking_quarterly_results`, so HDFCBANK came back
 *   with "0 quarters" while carrying 60 scored periods. The harness would have been asserting that
 *   its own bank fixture was broken. Family-awareness already lives in the coverage resolver; a
 *   second copy of it here would be a second opinion, and the second opinion is the wrong one (N-3).
 */
export async function checkSubjects(): Promise<{ symbol: string; ok: boolean; note: string }[]> {
  const { resolveStockCoverage } = await import("../resolve/stock-coverage.js");
  const { stockCoverage } = await import("../resolve/contract.js");
  const out: { symbol: string; ok: boolean; note: string }[] = [];
  for (const [role, symbol] of Object.entries(SUBJECTS)) {
    const cov = await resolveStockCoverage(symbol).catch(() => null);
    const sc = cov ? stockCoverage(cov.coverage) : null;
    if (!sc) { out.push({ symbol, ok: false, note: `${role}: does not resolve in our universe` }); continue; }
    const q = sc.depth.quarters, sn = sc.depth.snapshots ?? 0, tier = sc.tier;
    const shape = ROLE_SHAPE[role as keyof typeof SUBJECTS];
    const ok = shape.ok({ tier, quarters: q, snapshots: sc.depth.snapshots });
    out.push({
      symbol, ok,
      note: `${role}: tier ${tier}, ${q} quarters, ${sn} scored` +
        // ★ THE NOTE NAMES WHAT THE ROLE NEEDS, so a broken fixture is actionable rather than a
        //   verdict. "no longer deep/scored enough" did not say what enough was.
        (ok ? "" : ` — this role needs ${shape.want}; pick another subject for it`),
    });
  }
  return out;
}
