// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE THREE READER BLOCKS' RESOLVERS — portfolio · watchlist · relationship. Stage 7.
//
// ── ★ EVERY ONE CARRIES `ReaderCoverage`, NEVER `StockCoverage` (§3.7) ────────────────────────────
// A book has no tier, no window and no quarters. The nearest thing it has to coverage is HOW MUCH OF
// ITSELF WE CAN SPEAK TO — `holdings` against `holdingsScored` — and that ratio bounds every sentence
// downstream. Stage 6 measured why this matters: a reader holding 21 positions where 11 are scored,
// answered with a score computed over 11, is being told something about 52% of their money.
//
// ── ★ `relationship` IS THE ODD ONE AND IT IS THE INTERESTING ONE ─────────────────────────────────
// Its subject is a STOCK; its perspective is the reader. So it carries the stock's coverage in the
// envelope and the reader's position in the payload — the only block where those come apart. A
// version that carried reader coverage would say "11 of 21 scored" under a question about one
// company, which answers a question nobody asked.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { buildPortfolioHealthView } from "../portfolio/phs/portfolio-health-view.js";
import { enrichWatchlist } from "../controllers/me/watchlist-enrich.js";
import { probeStockRelationship } from "../ai/insight/relationship.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { nextEventKey, resolveNextEvents, startOfUtcDay } from "../reminders/resolve.js";
import { absent, resolved, type Coverage, type ReaderCoverage, type Resolved, type Source } from "./contract.js";

const PROV: Source[] = ["stocks"];

/** The reader envelope, built once and shared by the two book-scoped blocks. */
export async function readerCoverageFor(userId: string): Promise<ReaderCoverage> {
  const rows = await prisma.$queryRawUnsafe<{ total: bigint; scored: bigint; as_of: Date | null }[]>(
    `SELECT COUNT(*)::bigint AS total,
            COUNT(*) FILTER (
              WHERE h.stock_id IS NOT NULL
                AND h.stock_id IN (SELECT DISTINCT stock_id FROM score_snapshots)
            )::bigint AS scored,
            MAX(h.last_computed_at) AS as_of
       FROM holdings h
      WHERE h.user_id = $1 AND h.quantity > 0`,
    userId,
  );
  const r = rows[0];
  return {
    kind: "reader",
    asOf: r?.as_of ? new Date(r.as_of).toISOString().slice(0, 10) : null,
    holdings: Number(r?.total ?? 0),
    holdingsScored: Number(r?.scored ?? 0),
  };
}

// ═══ 8 · PORTFOLIO ═════════════════════════════════════════════════════════════════════════════════
export interface HoldingLine {
  readonly symbol: string; readonly name: string;
  readonly valueCr: number | null; readonly weightPct: number | null;
  readonly score: number | null; readonly band: string | null;
  /** Held through the instrument catalogue rather than as a share — a fund, bond, G-sec or REIT. */
  readonly nonEquity: boolean;
}
export interface PortfolioRead {
  readonly holdings: number; readonly holdingsScored: number;
  readonly score: number | null; readonly band: string | null;
  readonly provisional: boolean;
  /** 0..1 — the share of BOOK VALUE the score is computed over. Distinct from the count ratio. */
  readonly scoredWeight: number | null;
  readonly totalValue: number | null;
  readonly lines: readonly HoldingLine[];
  readonly findings: readonly {
    readonly label: string; readonly detail: string; readonly severity: "high" | "medium";
    /**
     * ★★ THE BOUNDARY, CARRIED AT LAST — Phase 2 · Batch 2.
     *
     * ⚠ IT WAS ON THE OBJECT ALL ALONG AND WAS BEING DROPPED. The note below this interface lists the
     *   portfolio finding's own fields — "`id`, `family`, `label`, `tone`, `loud`, `read`,
     *   `doesntMean`" — and the mapper read six of the seven. All 58 PHS registry entries carry one,
     *   and the portfolio register is the "≠ x ≠ y" form that `lib/findings/boundary.ts` and
     *   `BoundaryLine` were built for: *"≠ the position is a mistake, ≠ it will fall, ≠ trim it.
     *   Concentration is a fact about how much the score depends on one name, not a judgment on the
     *   name."* That sentence is the whole reason a concentration finding is safe to show, and it was
     *   the one part not reaching the reader.
     *
     * ⚠ AND IT IS THE ONE FIELD THESE 58 ENTRIES ALWAYS HAVE. Measured: the PHS variant carries NO
     *   name and NO description — `doesntMean`, `job` and `lifetime` are all it has. So dropping it
     *   dropped the only authored copy the registry holds for them.
     */
    readonly doesntMean: string | null;
  }[];
  /** How many findings we actually HOLD, against the (at most four) carried in `findings`. */
  readonly findingsHeld: number;
  /** Positions we hold that the "Your book" list could not name — non-equity, or past the row cap. */
  readonly linesOmitted: number;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ WHY THE LIST IS SHORTER THAN THE POSITION COUNT WHEN NOTHING WAS OMITTED — Phase 2 · Batch 2.
   *
   * ⚠ MEASURED ON THE FIXTURE BOOK: 21 positions, 20 rows in the list, `linesOmitted: 0`. All three
   *   numbers are correct and together they read as a contradiction — a reader who counts the list
   *   gets 20 after being told 21, and the field that exists to explain a short list says nothing was
   *   dropped. Nothing WAS dropped: RELIANCE is held in two accounts, so two POSITIONS are one
   *   INSTRUMENT. `I-SET-RECONCILES` cannot catch this, because by its own definition the set does
   *   reconcile.
   *
   * ★ SO THE ANSWER SAYS IT. This is the count of instruments held in more than one account, and it
   *   is what turns "21 versus 20" from a discrepancy into a fact about how the reader's accounts are
   *   arranged. 0 for a book with no duplicates, which is most of them.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly heldInSeveralAccounts: number;
}

export async function resolvePortfolio(userId: string): Promise<Resolved<PortfolioRead>> {
  // ★★ GUARDED BEFORE THE COUNT, AND THIS IS THE MOST IMPORTANT GUARD IN THE FILE. `rc.holdings === 0`
  //    below answers `ok: true` with "you hold nothing" — the right answer for an empty book and a
  //    catastrophic one for a book we could not read. An unguarded throw here also meant the honest
  //    absence installed further down was unreachable under a real outage.
  const rc = await readerCoverageFor(userId).catch(() => null);
  if (!rc) return absent<PortfolioRead>("reader_read_failed", { subject: null, query: null });
  const coverage: Coverage = { subject: rc, query: null };

  // ⚠ AN EMPTY BOOK IS `ok: true`, NOT ABSENT. "You hold nothing" is an answer; refusing to resolve
  //   would render nothing at all on the one question the reader already knows the answer to.
  if (rc.holdings === 0) {
    return resolved<PortfolioRead>({
      holdings: 0, holdingsScored: 0, score: null, band: null, provisional: false,
      scoredWeight: null, totalValue: null, lines: [], findings: [], findingsHeld: 0, linesOmitted: 0,
      heldInSeveralAccounts: 0,
    }, coverage, PROV);
  }

  // ⚠ C-1, BOOK-SHAPED. `buildPortfolioHealthView` returns an object and never null, so `!view` meant
  //   the catch and nothing else — and `not_ingested` rendered that as "a first set of quarterly
  //   results, which this company has not filed with us yet", said about a reader's own holdings.
  //   `reader_read_failed` is the token whose phrase is about US and says, explicitly, that this is
  //   not the same as holding nothing.
  let read = true;
  const view = await buildPortfolioHealthView(userId).catch(() => { read = false; return null; });
  // A read that FAILED is absent; a book with no computed snapshot is `ok: true` with a null score.
  if (!read || !view) return absent<PortfolioRead>("reader_read_failed", coverage);

  const snap = view.snapshot ?? null;
  const health = snap?.healthRead ?? null;
  const cs = snap?.coverageState ?? null;

  // ★ `LEFT JOIN`, AND BOTH SIDES OF THE BOOK — THE INNER JOIN SILENTLY DELETED A THIRD OF IT.
  //
  //   ⚠ THIS IS THE SAME DEFECT AS THE STAGE-7 `resolveReaderSubject` ONE, IN A SECOND QUERY. It read
  //   `JOIN stocks s ON s.id = h.stock_id`, and 8 of this reader's 21 positions are not shares at all
  //   — funds, bonds, G-secs, REITs, held by `instrument_id` with a NULL `stock_id`. An inner join
  //   drops every one of them without a trace, so "Your book" listed 12 rows under a total that said
  //   "Positions 21" and the reader had no way to know which nine were missing or why.
  //
  //   A non-equity holding is not an unscored share and must not render as one: it is coalesced to
  //   the instrument catalogue and carries a NULL score, which `heroSetSection` states in words.
  const CAP = 40;
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT COALESCE(s.symbol, i.symbol, i.isin)   AS symbol,
            COALESCE(s.name,   i.name,  i.scheme_name, i.symbol) AS name,
            (s.id IS NULL)                          AS non_equity,
            SUM(h.quantity * h.avg_cost) / 1e7      AS value_cr,
            MAX(ss.composite) AS score, MAX(ss.label_band) AS band
       FROM holdings h
       LEFT JOIN stocks s      ON s.id = h.stock_id
       LEFT JOIN instruments i ON i.id = h.instrument_id
       LEFT JOIN LATERAL (
         SELECT composite, label_band FROM score_snapshots
          WHERE stock_id = h.stock_id ORDER BY as_of_date DESC LIMIT 1
       ) ss ON true
      WHERE h.user_id = $1 AND h.quantity > 0
      GROUP BY 1, 2, 3
      ORDER BY value_cr DESC NULLS LAST
      LIMIT ${CAP}`,
    userId,
  ).catch(() => []);

  const total = rows.reduce((a, r) => a + Number(r.value_cr ?? 0), 0);
  const lines: HoldingLine[] = rows.map((r) => {
    const v = r.value_cr === null || r.value_cr === undefined ? null : Number(r.value_cr);
    return {
      symbol: String(r.symbol), name: String(r.name),
      valueCr: v,
      // ⚠ `null`, NOT 0, WHEN THE DENOMINATOR IS ZERO — a weight of 0% is a claim about a position.
      weightPct: v === null || total <= 0 ? null : Math.round((v / total) * 1000) / 10,
      score: r.score === null || r.score === undefined ? null : Number(r.score),
      band: r.band === null || r.band === undefined ? null : String(r.band),
      // ⚠ "not scored" AND "not a share" ARE DIFFERENT SENTENCES. A bond has no health score because
      //   the score reads quarterly results and a bond files none — that is a fact about the
      //   instrument, not a gap in our coverage of it, and the tag must not imply otherwise.
      nonEquity: r.non_equity === true,
    };
  });
  // ★ DERIVED FROM THE CAP, NOT FROM THE COUNT DIFFERENCE. `rc.holdings` counts holding ROWS and
  //   `lines` counts distinct symbols after the GROUP BY, so a reader holding TCS in two accounts
  //   would have been told one position was omitted when none was. Only a full page means truncation.
  const linesOmitted = rows.length === CAP ? Math.max(0, rc.holdings - lines.length) : 0;

  // ★ THE FIELD NAMES ARE `label` AND `read`, AND READING THE WRONG ONES PUT A PLACEHOLDER ON SCREEN.
  //   This said `o.title ?? o.key ?? "Finding"` with `o.detail ?? o.message` beside it. A portfolio
  //   finding carries NONE of those four names — it carries `id`, `family`, `label`, `tone`, `loud`,
  //   `read`, `doesntMean` — so every fallback missed and the literal string "Finding" rendered as
  //   the label of all four items, with an empty detail under each. The reader saw
  //   `Finding / Finding / Finding / Finding` while the real text ("Held by design, not scored" —
  //   "₹2,93,508 of your book … sits outside the Health read") sat in the object unread.
  //
  //   ⚠ NO `?? "Finding"` FALLBACK ANY MORE, DELIBERATELY. A placeholder is what let this ship: it
  //   turned a missing field into something that renders, so nothing ever failed loudly. A finding
  //   with no label is now DROPPED, and `findingsHeld` records how many — an item we cannot name is
  //   not an item we can show.
  const rawFindings = (health?.findings ?? []) as unknown as Record<string, unknown>[];
  const named = rawFindings
    .map((o) => ({
      label: typeof o.label === "string" ? o.label.trim() : "",
      detail: typeof o.read === "string" ? o.read.trim() : "",
      // `loud` is the scorer's own "this one matters" flag; `tone` carries the direction.
      severity: (o.loud === true ? "high" : "medium") as "high" | "medium",
      // ⚠ NEVER DEFAULTED, for the same reason the label is not: a fabricated boundary reads exactly
      //   like an authored one. `null` means the object carried none, which is visible.
      doesntMean: typeof o.doesntMean === "string" && o.doesntMean.trim().length > 0
        ? o.doesntMean.trim() : null,
    }))
    .filter((f) => f.label.length > 0);
  // Loud first, so a cap never drops the one that mattered for one that did not.
  const ordered = [...named].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  const findings = ordered.slice(0, 4);

  // ★ HOW MANY INSTRUMENTS THE READER HOLDS IN MORE THAN ONE ACCOUNT — see `heldInSeveralAccounts`.
  //   Counted off the LINES the answer will actually draw, against the POSITION count the coverage
  //   half reports, so the two numbers on screen are reconciled by the same arithmetic that produced
  //   them rather than by a second query that could disagree.
  const heldInSeveralAccounts = Math.max(0, rc.holdings - lines.length - linesOmitted);

  return resolved<PortfolioRead>({
    holdings: rc.holdings,
    holdingsScored: rc.holdingsScored,
    heldInSeveralAccounts,
    score: health?.value ?? null,
    band: health?.band ?? null,
    provisional: health?.provisional ?? false,
    scoredWeight: cs?.scoredWeight ?? null,
    totalValue: cs?.totalValue ?? (total > 0 ? total * 1e7 : null),
    lines,
    findings,
    // ⚠ THE BOUND ON THE LIST ABOVE. Four of nine shown is a different statement from four of four,
    //   and a list that truncates in silence presents a slice as the whole.
    findingsHeld: named.length,
    linesOmitted,
  }, coverage, PROV);
}

// ═══ 9 · WATCHLIST ═════════════════════════════════════════════════════════════════════════════════
export interface WatchlistLine {
  readonly symbol: string; readonly name: string;
  readonly score: number | null; readonly band: string | null; readonly favorite: boolean;
}
export interface WatchlistRead { readonly lines: readonly WatchlistLine[]; readonly total: number }

export async function resolveWatchlist(userId: string): Promise<Resolved<WatchlistRead>> {
  // Same guard as the book, same reason — see resolvePortfolio.
  const rc = await readerCoverageFor(userId).catch(() => null);
  if (!rc) return absent<WatchlistRead>("reader_read_failed", { subject: null, query: null });
  const coverage: Coverage = { subject: rc, query: null };

  // ★ EVERY FIELD `WatchlistRow` DECLARES, BECAUSE `enrichWatchlist` COPIES THEM THROUGH VERBATIM.
  //
  //   ⚠ THIS SELECT USED TO ASK FOR FOUR COLUMNS AND THE CALL BELOW CAST THE RESULT `as never`.
  //   `WatchlistRow` requires ten — symbol, name, sector, industryType, pinnedBand and pinnedPrice
  //   among them — and `enrichWatchlist` passes each straight into the entry it returns. Missing,
  //   they came back `undefined`; `String(undefined ?? undefined ?? "")` is `""`; and the
  //   `.filter(l => l.symbol)` below then dropped ALL FIVE PINS. The reader saw the empty-watchlist
  //   sentence rendered directly above a total reading "PINNED 5" — two contradictory statements in
  //   one card, from one silenced type error.
  //
  //   ⚠ AND `as never` IS GONE. The compiler had this exact error and was told to be quiet. That cast
  //   is the reason a four-column select typechecked against a ten-field contract, so removing the
  //   cast is the actual fix — widening the select alone would leave the next field free to vanish
  //   the same way.
  let read = true;
  const pins = await prisma.watchlist.findMany({
    where: { userId },
    select: {
      stockId: true, favorite: true, addedAt: true,
      pinnedHealth: true, pinnedBand: true, pinnedPrice: true,
      stock: { select: { symbol: true, name: true, industryType: true, sector: { select: { name: true } } } },
    },
    orderBy: { addedAt: "desc" },
  }).catch(() => { read = false; return null; });
  // ⚠ C-1. `findMany` resolves to an array or throws — it never yields null — so `pins === null` was
  //   the catch alone, reported as `not_ingested`. The empty case below is the real "you have pinned
  //   nothing", and it is already answered as data rather than as an absence.
  if (!read || pins === null) return absent<WatchlistRead>("reader_read_failed", coverage);
  // Empty is an answer, not an absence — see the portfolio note above.
  if (pins.length === 0) return resolved<WatchlistRead>({ lines: [], total: 0 }, coverage, PROV);

  // Flattened to the shape `WatchlistRow` actually declares — no cast, so the compiler checks it.
  const enriched = await enrichWatchlist(
    pins.map((p) => ({
      stockId: p.stockId,
      symbol: p.stock?.symbol ?? "",
      name: p.stock?.name ?? "",
      sector: p.stock?.sector?.name ?? null,
      industryType: p.stock?.industryType ?? "",
      addedAt: p.addedAt,
      favorite: p.favorite,
      pinnedHealth: p.pinnedHealth,
      pinnedBand: p.pinnedBand,
      pinnedPrice: p.pinnedPrice,
    })),
  ).catch((e: unknown) => {
    // ⚠ LOGGED, NOT SWALLOWED (§3.1). The empty array this returns is indistinguishable from an empty
    //   watchlist at every call site above, which is precisely how the defect above stayed invisible.
    console.warn("[watchlist] enrich failed (rendering pins unenriched):", (e as Error).message);
    return null;
  });
  // ★ A FAILED ENRICHMENT FALLS BACK TO THE PINS THEMSELVES, NOT TO NOTHING. We know the symbol and
  //   the name from the row we already read; only the score is enrichment's to add. Returning [] here
  //   would reproduce the exact contradiction this block was fixed for.
  if (enriched === null) {
    return resolved<WatchlistRead>({
      lines: pins.map((p) => ({
        symbol: p.stock?.symbol ?? "", name: p.stock?.name ?? "",
        score: p.pinnedHealth === null ? null : Number(p.pinnedHealth),
        band: p.pinnedBand, favorite: p.favorite,
      })).filter((l) => l.symbol),
      total: pins.length,
    }, coverage, PROV);
  }
  // ★ READ OFF THE DECLARED SHAPE, NOT GUESSED AT. The `e.stock ?? e` / `e.health ?? e` pattern here
  //   was probing for fields at two possible depths because nobody was sure which the entry had —
  //   and `EnrichedWatchlistEntry` is flat, with `health` a NUMBER rather than an object, so
  //   `health.score` was never going to resolve at either depth.
  const lines: WatchlistLine[] = enriched.map((e) => ({
    symbol: e.symbol,
    name: e.name || e.symbol,
    score: typeof e.health === "number" ? e.health : null,
    band: e.band ?? null,
    favorite: Boolean(e.favorite),
  })).filter((l) => l.symbol);

  return resolved<WatchlistRead>({ lines, total: pins.length }, coverage, PROV);
}

// ═══ 10 · RELATIONSHIP ═════════════════════════════════════════════════════════════════════════════
export interface RelationshipRead {
  readonly symbol: string; readonly name: string;
  readonly held: boolean;
  readonly quantity: number | null;
  readonly valueCr: number | null;
  /** This position as a share of the reader's whole book. `null` when the book has no value. */
  readonly weightPct: number | null;
  readonly sectorExposurePct: number | null;
  readonly watchlisted: boolean;
  readonly favorite: boolean;
  readonly bookHoldings: number;
}

export async function resolveRelationship(userId: string, symbol: string): Promise<Resolved<RelationshipRead>> {
  // ★ THE ENVELOPE IS THE STOCK'S — see the header. The reader's position is payload, not coverage.
  // ⚠ Guarded for the same reason as the rest: unguarded it threw, and a thrown coverage read makes
  //   every honest absence below unreachable. With no envelope there is nothing to answer inside.
  const cov = await resolveStockCoverage(symbol).catch(() => null);
  if (!cov) return absent<RelationshipRead>("read_failed", { subject: null, query: null });
  const coverage = cov.coverage;

  // ⚠ AND THE LOOKUP IS GUARDED TOO, FOR THE REASON THE PAIR TEST ESTABLISHED: unguarded, this threw
  //   under a dead database and the honest absences below became unreachable. `findUnique` returns a
  //   row or null, so the two arms are genuinely distinct — a throw is ours, a null is coverage.
  let stockRead = true;
  const stock = await prisma.stock.findUnique({
    where: { symbol: symbol.toUpperCase() },
    select: { id: true, symbol: true, name: true, sectorId: true },
  }).catch(() => { stockRead = false; return null; });
  if (!stockRead) return absent<RelationshipRead>("read_failed", coverage);
  if (!stock) return absent<RelationshipRead>("not_in_universe", coverage);

  // ★★ THE WORST OF THE FOUR SWALLOWS IN THIS BUILD, AND NO GATE COULD SEE IT. All four of these
  //    catches fed a `resolved()` — an `ok: true` ANSWER — rather than an `absent()`, so the
  //    swallowed-absence gate was structurally blind to them: it looks for a catch reaching a
  //    record-shaped absence, and here the failure reached a DATA FIELD instead.
  //
  //    `probe` is the one that matters. `catch(() => ({ held: false }))` renders through
  //    blocks-subject.ts:133 as **"You hold it: no"** — a flat, confident statement about the
  //    reader's own position, produced by a read that never completed. The empty-book defect told a
  //    reader their book was empty; this tells them they do not own a specific company.
  //
  //    The other three degrade the same way one step down: `[]` becomes a null quantity, value and
  //    weight, each rendering `relationship_not_held`.
  //
  // ⚠ SO THE WHOLE READER SIDE IS ABSENT IF ANY PART OF IT FAILED. `RelationshipRead` is entirely
  //   about the reader's relationship to this stock; there is no honest partial answer to give.
  let readerRead = true;
  const swallowed = <T>(fallback: T) => () => { readerRead = false; return fallback; };
  const [probe, pos, book, sector] = await Promise.all([
    probeStockRelationship(userId, stock.id).catch(swallowed({ held: false, watchlist: null })),
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT SUM(h.quantity)::float AS qty, SUM(h.quantity * h.avg_cost) / 1e7 AS value_cr
         FROM holdings h WHERE h.user_id = $1 AND h.stock_id = $2 AND h.quantity > 0`,
      userId, stock.id,
    ).catch(swallowed([] as Array<Record<string, unknown>>)),
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT SUM(h.quantity * h.avg_cost) / 1e7 AS value_cr, COUNT(*)::int AS n
         FROM holdings h WHERE h.user_id = $1 AND h.quantity > 0`,
      userId,
    ).catch(swallowed([] as Array<Record<string, unknown>>)),
    stock.sectorId
      ? prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT SUM(h.quantity * h.avg_cost) / 1e7 AS value_cr
             FROM holdings h JOIN stocks s ON s.id = h.stock_id
            WHERE h.user_id = $1 AND s.sector_id = $2 AND h.quantity > 0`,
          userId, stock.sectorId,
        ).catch(swallowed([] as Array<Record<string, unknown>>))
      : Promise.resolve([] as Array<Record<string, unknown>>),
  ]);
  if (!readerRead) return absent<RelationshipRead>("reader_read_failed", coverage);

  const num = (rows: Array<Record<string, unknown>>, k: string): number | null => {
    const v = rows[0]?.[k];
    return v === null || v === undefined ? null : Number(v);
  };
  const posVal = num(pos, "value_cr");
  const bookVal = num(book, "value_cr");
  const secVal = num(sector, "value_cr");

  return resolved<RelationshipRead>({
    symbol: stock.symbol,
    name: stock.name,
    held: probe.held,
    quantity: num(pos, "qty"),
    valueCr: posVal,
    weightPct: posVal === null || bookVal === null || bookVal <= 0 ? null : Math.round((posVal / bookVal) * 1000) / 10,
    sectorExposurePct: secVal === null || bookVal === null || bookVal <= 0 ? null : Math.round((secVal / bookVal) * 1000) / 10,
    watchlisted: Boolean(probe.watchlist),
    favorite: Boolean((probe.watchlist as { favorite?: boolean } | null)?.favorite),
    bookHoldings: Number(num(book, "n") ?? 0),
  }, coverage, PROV);
}


// ═══ 16 · ALERTS ═══════════════════════════════════════════════════════════════════════════════════
export interface AlertLine {
  readonly id: string; readonly symbol: string; readonly name: string;
  /** One reader-facing sentence describing what this alert watches for. Pre-formatted (N-1). */
  readonly description: string;
  readonly active: boolean;
}
export interface AlertsRead { readonly alerts: readonly AlertLine[]; readonly total: number }

/**
 * The reader's own alerts. ★ THE SIXTEENTH BLOCK, AND THE ONE THAT CLOSED CHECKLIST ROW 29 —
 * `deleteAlert` needs the LIST before it can offer a control per row, and until stage 8 nothing
 * rendered one.
 *
 * ⚠ AN EMPTY LIST IS `ok: true`. "You have no alerts" is an answer; refusing to resolve would render
 * nothing on a question the reader can already answer for themselves.
 */
export async function resolveAlerts(userId: string): Promise<Resolved<AlertsRead>> {
  const rc = await readerCoverageFor(userId).catch(() => null);
  if (!rc) return absent<AlertsRead>("reader_read_failed", { subject: null, query: null });
  const coverage: Coverage = { subject: rc, query: null };

  // ⚠ NO SILENT CATCH ON THE READ ITSELF (§3.1, stage 7). A failed query here must not become "you
  //   have no alerts" — the first draft of this function had `.catch(() => null)` around it and
  //   reported an empty list to a reader while the column names were wrong.
  //
  // ★ IT NOW RETURNS AN ABSENCE RATHER THAN THROWING, AND THE COMMENT THAT USED TO SIT HERE WAS
  //   WRONG. It said "the composition treats a throw as 'we could not look'" — nothing did. The
  //   dead-database run showed the throw propagating out of `alertsBlock` and killing the entire
  //   answer, so a reader asking about alerts got an error page, not a sentence. The INTENT was
  //   right and only the mechanism was missing: `reader_read_failed` says "we could not look" in
  //   the one vocabulary the reader ever sees.
  let read = true;
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT a.id, a.type, a.operator, a.threshold_price, a.threshold_band, a.finding_key,
            a.active, s.symbol, s.name
       FROM alerts a JOIN stocks s ON s.id = a.stock_id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC`,
    userId,
  ).catch(() => { read = false; return [] as Array<Record<string, unknown>>; });
  // The empty list below is a real answer — "you have set no alerts". This is the other thing.
  if (!read) return absent<AlertsRead>("reader_read_failed", coverage);

  const alerts: AlertLine[] = rows.map((r) => {
    const op = String(r.operator ?? "") === "lt" ? "falls below" : "rises above";
    const price = r.threshold_price === null || r.threshold_price === undefined ? null : Number(r.threshold_price);
    const band = r.threshold_band === null || r.threshold_band === undefined ? null : String(r.threshold_band);
    const what =
      r.finding_key ? `when "${String(r.finding_key).replace(/_/g, " ")}" fires`
      : price !== null ? `when the price ${op} ₹${price.toLocaleString("en-IN")}`
      : band !== null ? `when the band ${op} ${band.replace(/_/g, " ")}`
      : "on a condition we no longer recognise";
    return {
      id: String(r.id), symbol: String(r.symbol), name: String(r.name),
      description: `${String(r.name)} — ${what}`,
      active: r.active !== false,
    };
  });
  return resolved<AlertsRead>({ alerts, total: alerts.length }, coverage, PROV);
}


// ═══ 18 · EVENT REMINDERS ══════════════════════════════════════════════════════════════════════════
/**
 * ★ THE OTHER HALF OF "WHAT HAVE I ASKED TO BE TOLD ABOUT", AND IT WAS MISSING.
 *
 * ⚠ A READER WITH NO ALERTS AND FOUR REMINDERS WAS TOLD THEY HAD NOTHING SET. Vytal has two
 *   notification mechanisms — `alerts` fire on a CONDITION (a price level, a band, a finding) and
 *   `event_reminders` fire on a DATE (n days before a scheduled corporate event). They are separate
 *   tables, separate endpoints and separate pages, and that separation is an implementation fact the
 *   reader does not have and should not need. "What alerts do I have?" is a question about being
 *   notified, and answering it from one table while a populated second table sits beside it is the
 *   absence-is-a-state rule (N-4) broken in the way that costs most: a confident, wrong "nothing".
 *
 * The date is resolved through `resolveNextEvents` — the same resolver the reminders page and the
 * daily eval pass use — so the next occurrence a reader is shown here is the one they will actually
 * be woken for. ⚠ AND A REMINDER WITH NO SCHEDULED OCCURRENCE SAYS SO rather than being hidden: a
 * live rule watching an event nobody has filed a date for is a real state, and dropping it would
 * under-report exactly the rows worth knowing about.
 */
export interface ReminderLine {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly eventType: string;
  readonly daysBefore: number;
  /** ISO date of the next occurrence we hold, or null when nothing is scheduled. */
  readonly nextEventDate: string | null;
  readonly description: string;
  readonly active: boolean;
}
export interface RemindersRead { readonly reminders: readonly ReminderLine[]; readonly total: number }

export async function resolveReminders(userId: string): Promise<Resolved<RemindersRead>> {
  const rc = await readerCoverageFor(userId).catch(() => null);
  if (!rc) return absent<RemindersRead>("reader_read_failed", { subject: null, query: null });
  const coverage: Coverage = { subject: rc, query: null };

  // ⚠ NO SILENT CATCH, for the same reason resolveAlerts has none — a failed read must not become
  //   "you have no reminders". "We could not look" is a different sentence, and it is now RETURNED
  //   as one rather than thrown: see resolveAlerts for why the throw never reached a reader as words.
  let read = true;
  const rows = await prisma.eventReminder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, stockId: true, eventType: true, daysBefore: true, active: true,
      stock: { select: { symbol: true, name: true } },
    },
  }).catch(() => { read = false; return []; });
  if (!read) return absent<RemindersRead>("reader_read_failed", coverage);

  const today = startOfUtcDay(new Date());
  const nextMap = await resolveNextEvents(
    rows.map((r) => ({ stockId: r.stockId, eventType: r.eventType })),
    today,
  );

  const reminders: ReminderLine[] = rows.map((r) => {
    const next = nextMap.get(nextEventKey(r.stockId, r.eventType)) ?? null;
    const event = r.eventType.replace(/_/g, " ");
    const iso = next ? new Date(next.eventDate).toISOString().slice(0, 10) : null;
    const lead = r.daysBefore === 1 ? "the day before" : `${r.daysBefore} days before`;
    return {
      id: r.id,
      symbol: r.stock?.symbol ?? "",
      name: r.stock?.name ?? "",
      eventType: r.eventType,
      daysBefore: r.daysBefore,
      nextEventDate: iso,
      description: iso
        ? `${r.stock?.name ?? r.stock?.symbol ?? "This company"} — ${lead} its ${event} on ${iso}`
        : `${r.stock?.name ?? r.stock?.symbol ?? "This company"} — ${lead} its next ${event}, which is not on our calendar yet`,
      active: r.active !== false,
    };
  });
  return resolved<RemindersRead>({ reminders, total: reminders.length }, coverage, PROV);
}
