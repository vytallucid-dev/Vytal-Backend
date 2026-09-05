// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — THE PEER GROUP. What PG answers from.
//
// ── ★★ THE BRIEF'S CENTRAL PREMISE IS WRONG, AND IT WOULD HAVE DECIDED THE WHOLE FAMILY ───────────
// The plan's T-9 and this batch's brief both say: *"`stock_peer_groups` is empty while
// `score_peer_stats` holds 2,289 rows — check which the resolver reads."* Checked, and:
//
//   `stock_peer_groups`   **148 rows · 148 stocks · 23 groups.**  NOT EMPTY.
//   `score_peer_stats`    2,106 rows · 13 groups · 29 metrics · 41 as-of dates (2023-03-31→2026-08-31)
//
// ★ AND THEY ARE NOT ALTERNATIVES, WHICH IS THE PART THE FRAMING HIDES. `stock_peer_groups` is
//   MEMBERSHIP — which company is in which pond. `score_peer_stats` is the scoring engine's per-group
//   μ/σ/N per metric per period — the bars a metric is scored against. One is a roster, the other is
//   calibration. A peer ANSWER needs the roster; §4.5 rule 3 keeps the calibration off the screen
//   entirely. So "which does the resolver read" has a third answer: this one reads the roster, via
//   `buildPeerGroupHealthView`, and never touches the μ/σ table.
//
// ── ★★ THE PONDS ARE CLEANLY SPLIT, AND THE FIXTURE THE BRIEF ASKS FOR DOES NOT EXIST ────────────
// Measured across all 23 ponds: **13 are wholly scored and 10 are wholly unscored. NONE IS MIXED.**
// The read model's own header records the same thing from the other side ("in every one of them EVERY
// member is unscored: Large-Cap NBFCs 8/8, Specialty Chemicals 7/7, …").
//
// ⚠ SO "A PEER GROUP CONTAINING UNSCORED MEMBERS" IS SATISFIABLE ONLY AS A WHOLLY UNSCORED POND. There
//   is no group where some members score and others do not, and a fixture chosen on the assumption
//   that there is would have silently tested the all-scored path twice — the MOLBIO failure again,
//   which is why this was measured before a subject was picked rather than after.
//
// ── ★ HOW THE GROUP IS BUILT IS PART OF THE ANSWER, AND IT IS FROZEN ─────────────────────────────
// Every pond is named `Large-Cap <sector>`, and all 148 grouped stocks sit inside
// `market_cap_tier_snapshot` — 504 rows, 504 stocks, **ONE as-of date: 2026-07-04**. So membership is
// a market-cap tier from a single frozen month crossed with a sector. A peer answer that does not say
// so presents a two-month-old classification as a live one.
//
// ⚠ AND THE DENOMINATOR MOVES. `memberCount` is the roster; `aggregate.scoredCount` is what the median
//   is actually computed over; `notAtCurrentPeriod` is a third number again — a member with a reading
//   of an EARLIER quarter, excluded from the cross-section rather than folded into it. All three are
//   carried, because a median over a set whose size is not on screen is a figure the reader cannot
//   bound.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { buildPeerGroupHealthView, buildPeerGroupList } from "../scoring/read/peer-group-view.service.js";
import { getPeerGroupForStock } from "../scoring/read/peer-group-lookup.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { absent, coverageReadFailed, resolved, type Coverage, type QueryCoverage, type Resolved, type Source } from "./contract.js";

/** One roster row, scored or not. `composite: null` is an UNSCORED member, never a zero. */
export interface PeerMemberRow {
  readonly symbol: string;
  readonly name: string;
  /** `null` ⇒ we hold no reading for this company. Distinct from a low one. */
  readonly composite: number | null;
  readonly band: string | null;
  /** Which quarter this row is of. `null` for an unscored member. */
  readonly periodKey: string | null;
  /** Move on the member's own previous reading. `null` under two periods, or unscored. */
  readonly delta: number | null;
  readonly trajectory: string | null;
  /** Red flags currently firing on this member. 0 is a real reading; `null` means unscored. */
  readonly redFlags: number | null;
  /** For an unscored member: what the FILING channel found, since the score channel has nothing. */
  readonly filingFired: number | null;
  /** ★ THE ROW THE READER ASKED ABOUT. `set-table` gained `highlight` for exactly this. */
  readonly isSubject: boolean;
}

export interface PeerGroupRead {
  /** The company the question was about, or `null` on a pond-level question. */
  readonly symbol: string | null;
  readonly groupName: string;
  readonly sectorName: string | null;
  /** Roster size — every member, scored or not. THE denominator for membership claims. */
  readonly memberCount: number;
  /** Members folded into the aggregate. May be fewer than `memberCount`, and the gap is stated. */
  readonly scoredCount: number;
  readonly periodKey: string | null;
  readonly asOfDate: string | null;
  /** `false` ⇒ this pond has no aggregate at all: no median, no rank, no band mix. */
  readonly pondScored: boolean;
  readonly median: number | null;
  readonly medianDrift: number | null;
  readonly priorPeriodKey: string | null;
  readonly descriptor: string | null;
  readonly bands: readonly { readonly label: string; readonly count: number }[];
  readonly redFlagMembers: number | null;
  readonly rows: readonly PeerMemberRow[];
  /** The subject's own row, when the question named one and it is in this pond. */
  readonly subject: PeerMemberRow | null;
  /** Rank among SCORED members — the only set a rank is defined over. `null` when unscored. */
  readonly subjectRank: { readonly rank: number; readonly outOf: number } | null;
  /** Members whose latest reading is of an EARLIER quarter — a third state, never folded in. */
  readonly notAtCurrentPeriod: readonly { readonly symbol: string; readonly latestPeriod: string }[];
  /** Unscored roster members: how many, and how many we hold any filing for. */
  readonly unscored: { readonly count: number; readonly covered: number };
  readonly movers: {
    readonly risers: readonly { readonly symbol: string; readonly delta: number }[];
    readonly slippers: readonly { readonly symbol: string; readonly delta: number }[];
  };
  /** ★ HOW THE GROUP IS BUILT, AND WHEN THAT WAS DECIDED. See the header. */
  readonly membershipBasis: {
    readonly tierAsOf: string | null;
    readonly tierStocks: number;
    readonly sentence: string;
  };
}

/**
 * ★ THE MEMBERSHIP SENTENCE. Authored once (§7.2) — a peer answer, a comparison and a screen that all
 *   lean on the same frozen classification must not describe it three ways.
 */
function basisSentence(tierAsOf: string | null, tierStocks: number, groupName: string): string {
  if (!tierAsOf) {
    return `${groupName} is a sector grouping; we hold no record of when its market-cap classification was struck.`;
  }
  const d = new Date(tierAsOf);
  const when = Number.isNaN(d.getTime())
    ? tierAsOf
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  return (
    `${groupName} is a market-cap tier crossed with a sector. The tier was frozen once, on ${when}, ` +
    `across ${tierStocks.toLocaleString("en-IN")} companies — so membership reflects that day's ranking ` +
    `and not today's, and a company that has since changed size is still in the pond it was in then.`
  );
}

/** The one frozen tier month, read once. */
async function tierFreeze(): Promise<{ asOf: string | null; stocks: number }> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT MAX(as_of_date)::text AS as_of, COUNT(DISTINCT stock_id)::int AS stocks FROM market_cap_tier_snapshot`,
  ).catch(() => [] as Array<Record<string, unknown>>);
  const r = rows[0];
  return { asOf: r?.as_of ? String(r.as_of) : null, stocks: Number(r?.stocks ?? 0) };
}

// ⚠ NON-NULL BY CONSTRUCTION AT EVERY CALL SITE — each one null-checks before shaping. The
//   service's own return type is nullable, so the alias narrows it once here rather than at
//   three sites that would each have to remember.
type View = NonNullable<Awaited<ReturnType<typeof buildPeerGroupHealthView>>>;

/** Shape the read model's two member channels into ONE roster, with unscored rows kept as rows. */
function rowsOf(v: View, subject: string | null): PeerMemberRow[] {
  const scored: PeerMemberRow[] = (v.members ?? []).map((m) => ({
    symbol: m.symbol,
    name: m.name,
    composite: m.composite,
    band: m.labelBand,
    periodKey: m.periodKey,
    delta: m.trajectoryDelta,
    trajectory: m.trajectoryMarker,
    redFlags: m.firedFlags.length,
    filingFired: null,
    isSubject: subject !== null && m.symbol === subject,
  }));
  // ⚠ AN UNSCORED MEMBER IS A ROW, NOT A FOOTNOTE. It is in the group; leaving it out of the roster
  //   would make the table disagree with `memberCount` and read as a shorter group than it is. Its
  //   score cells are `null` — never zero, which would rank it below every real reading (§3.1).
  const unscored: PeerMemberRow[] = (v.unscoredMembers?.members ?? []).map((m) => ({
    symbol: m.symbol,
    name: m.name,
    composite: null,
    band: null,
    periodKey: null,
    delta: null,
    trajectory: null,
    redFlags: null,
    filingFired: m.filing ? (m.filing.fired ?? []).length : null,
    isSubject: subject !== null && m.symbol === subject,
  }));
  // Scored first, descending; unscored after, alphabetically. A rank is only defined over the first
  // block, and interleaving the two would imply an ordering across a boundary that has none.
  scored.sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0));
  unscored.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return [...scored, ...unscored];
}

function shape(v: View, symbol: string | null, freeze: { asOf: string | null; stocks: number }): PeerGroupRead {
  const rows = rowsOf(v, symbol);
  const subject = rows.find((r) => r.isSubject) ?? null;
  const scoredRows = rows.filter((r) => r.composite !== null);
  const idx = subject && subject.composite !== null ? scoredRows.findIndex((r) => r.symbol === subject.symbol) : -1;
  const agg = v.aggregate;
  const bands = agg
    ? Object.entries(agg.bandDistribution)
        .filter(([, n]) => typeof n === "number")
        .map(([label, n]) => ({ label, count: n as number }))
    : [];

  return {
    symbol,
    groupName: v.identity.displayName || v.identity.name,
    sectorName: v.identity.sector?.displayName ?? null,
    memberCount: v.identity.memberCount,
    scoredCount: agg?.scoredCount ?? 0,
    periodKey: v.identity.periodKey,
    asOfDate: v.identity.asOfDate,
    pondScored: Boolean(v.scored && agg),
    median: agg?.medianComposite ?? null,
    medianDrift: agg?.medianDrift ?? null,
    priorPeriodKey: agg?.priorPeriodKey ?? null,
    descriptor: agg?.descriptor ?? null,
    bands,
    redFlagMembers: agg?.redFlagMemberCount ?? null,
    rows,
    subject,
    // ⚠ RANK IS OVER THE SCORED MEMBERS AND SAYS SO. "3 of 6" where the roster is 8 would be a rank
    //   in a set the reader cannot see; `outOf` is the scored count and `memberCount` is carried
    //   separately so the answer can state both.
    subjectRank: idx >= 0 ? { rank: idx + 1, outOf: scoredRows.length } : null,
    notAtCurrentPeriod: (v.notAtCurrentPeriod ?? []).map((x) => ({ symbol: x.symbol, latestPeriod: x.latestPeriod })),
    unscored: { count: v.unscoredMembers?.count ?? 0, covered: v.unscoredMembers?.covered ?? 0 },
    movers: {
      risers: (v.movers?.risers ?? []).map((m) => ({ symbol: m.symbol, delta: m.delta })),
      slippers: (v.movers?.slippers ?? []).map((m) => ({ symbol: m.symbol, delta: m.delta })),
    },
    membershipBasis: {
      tierAsOf: freeze.asOf,
      tierStocks: freeze.stocks,
      sentence: basisSentence(freeze.asOf, freeze.stocks, v.identity.displayName || v.identity.name),
    },
  };
}

/** The query half. A peer answer searched a ROSTER, not the universe — and says how big it was. */
function coverageFor(v: View): Coverage {
  const roster = v.identity.memberCount;
  const scored = v.aggregate?.scoredCount ?? 0;
  const q: QueryCoverage = {
    universeSearched: roster,
    depthFloor: null,
    excludedForDepth: 0,
    dropped: [
      ...(roster > scored
        ? [{
            filter: "scored at the current period",
            dropped: roster - scored,
            why: v.scored
              ? "in the group and not folded into the median — no reading, or a reading of an earlier quarter"
              : "we score no member of this group, so there is no median to fold anything into",
          }]
        : []),
      ...((v.notAtCurrentPeriod ?? []).length > 0
        ? [{
            filter: "current period",
            dropped: v.notAtCurrentPeriod.length,
            why: "reading is of an earlier quarter, so folding it in would compare two different quarters",
          }]
        : []),
    ],
  };
  // ⚠ `subject: null` EVEN WHEN A COMPANY WAS NAMED. The answer is about a SET; a `StockCoverage`
  //   envelope here would describe one member and read as though it described the group.
  return { subject: null, query: q };
}

/**
 * ★ THE PEER GROUP A COMPANY BELONGS TO.
 *
 * ⚠ `not_in_universe` IS THE WRONG WORD FOR "HAS NO GROUP", AND THE DISTINCTION MATTERS: 2,143 of our
 *   2,291 stocks carry no peer-group row at all. That is the display-only firewall working as
 *   designed — a stock outside the Nifty-500 expansion is catalogued and never scored — not a stock
 *   we have never heard of. `band_typical_unavailable` is the nearest honest token in the shared
 *   vocabulary (§3.2): a comparison we could not compute for this subject.
 */
export async function resolvePeerGroupForStock(symbol: string): Promise<Resolved<PeerGroupRead>> {
  const sym = (symbol ?? "").trim().toUpperCase();
  const cov = await resolveStockCoverage(sym);
  if (coverageReadFailed(cov)) return absent<PeerGroupRead>("read_failed", { subject: null, query: null });
  if (!sym) return absent<PeerGroupRead>("not_in_universe", cov.coverage);

  const stock = await prisma.stock.findUnique({ where: { symbol: sym }, select: { id: true } });
  if (!stock) return absent<PeerGroupRead>("not_in_universe", cov.coverage);

  // ⚠ THE READ AND THE ABSENCE ARE DIFFERENT ANSWERS (F-3), AND SO ARE THE ABSENCE AND A FAILURE TO
  //   COMPUTE (N-4). Three states, three tokens: the lookup threw; the lookup succeeded and this stock
  //   belongs to no group; the group exists and its view could not be built.
  let refRead = true;
  const ref = await getPeerGroupForStock(stock.id).catch(() => { refRead = false; return null; });
  if (!refRead) return absent<PeerGroupRead>("read_failed", cov.coverage);
  if (!ref) return absent<PeerGroupRead>("peers_unassigned", cov.coverage);

  // ⚠ C-1. The pond was FOUND — `ref` resolved — so a failure here is ours, and must not be reported
  //   as the pond having no readable members.
  let viewRead = true;
  const [v, freeze] = await Promise.all([
    buildPeerGroupHealthView(ref.id).catch(() => { viewRead = false; return null; }),
    tierFreeze(),
  ]);
  if (!v) return absent<PeerGroupRead>("band_typical_unavailable", cov.coverage);

  return resolved<PeerGroupRead>(shape(v, sym, freeze), coverageFor(v), ["stocks", "score_snapshots"] satisfies Source[]);
}

/**
 * ★ A POND NAMED DIRECTLY, WITH NO COMPANY IN THE QUESTION — "how is the pharma peer group doing".
 *
 * ⚠ TODAY THAT QUESTION GETS THE WHOLE MARKET. Measured on the live router: it classifies
 *   `screen · no subject`, `extractConditions` returns nothing, and `compose.ts` step 3g falls
 *   through to `composeUniverseAnswer()` — so a question about a six-member pond is answered with the
 *   band distribution of all 95 scored companies. Every figure in that answer is real and none of it
 *   is about what was asked.
 */
export async function resolvePeerGroupByName(raw: string): Promise<Resolved<PeerGroupRead> | null> {
  const list = await buildPeerGroupList().catch(() => null);
  if (!list || list.length === 0) return null;
  const match = matchPondName(raw, list.map((g) => ({ id: g.id, displayName: g.displayName, name: g.name })));
  if (!match) return null;

  const [v, freeze] = await Promise.all([
    buildPeerGroupHealthView(match.id).catch(() => null),
    tierFreeze(),
  ]);
  if (!v) return null;
  return resolved<PeerGroupRead>(shape(v, null, freeze), coverageFor(v), ["stocks", "score_snapshots"] satisfies Source[]);
}

/**
 * ★ WHICH POND A SENTENCE NAMES — code-extracted, and deliberately conservative.
 *
 * ⚠ IT REFUSES RATHER THAN GUESSES, for the same reason `extractConditions` does. A near-miss that
 *   picks the wrong pond answers a question about six companies with a different six, and every
 *   figure in it is real — §6.2's confident-wrong-artifact. No match returns `null` and the caller
 *   falls back to the universe cross-section, which is at least honestly labelled.
 *
 * ⚠ WORD SETS, NOT `\b` REGEX. Same inherited scar as `readerShape`, `statementFocus`,
 *   `ownershipFocus` and `question-shape.ts` — a word boundary written through a script has become a
 *   literal backspace four times in this build.
 */
export function matchPondName(
  raw: string,
  ponds: readonly { id: string; displayName: string; name: string }[],
): { id: string; displayName: string } | null {
  const words = new Set(raw.toLowerCase().replace(/[^a-z0-9 &]+/g, " ").split(/ +/).filter(Boolean));
  // Words that appear in every pond name and so distinguish nothing.
  // ⚠ "pond" IS OUR OWN WORD FOR A PEER GROUP and was the one synonym missing — "compare the metals
  //   pond with the cement pond" was refused while "compare metals and cement" resolved. It sits
  //   beside `peer`/`group` for the same reason: it names the container, never which container.
  const NOISE = new Set(["large", "cap", "largecap", "peer", "group", "peers", "pond", "ponds", "the", "and", "&", "sector"]);

  let best: { id: string; displayName: string; hits: number; need: number } | null = null;
  for (const p of ponds) {
    const tokens = (p.displayName || p.name).toLowerCase().replace(/[^a-z0-9 &]+/g, " ")
      .split(/ +/).filter((w) => w && !NOISE.has(w));
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => words.has(t)).length;
    // EVERY distinguishing token must be present. "pharma" matches Large-Cap Pharma; "private banks"
    // needs both words, so "banks" alone matches neither Private nor PSU and correctly returns null.
    if (hits === tokens.length && (best === null || tokens.length > best.need)) {
      best = { id: p.id, displayName: p.displayName || p.name, hits, need: tokens.length };
    }
  }
  return best ? { id: best.id, displayName: best.displayName } : null;
}
