// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SUBJECT UNION — what an answer can be ABOUT. Stage 6.
//
// ── ★ WHY A UNION AND NOT A SECOND PARAMETER ──────────────────────────────────────────────────────
// Everything above this file assumed `symbol: string | null`. Three of the fifteen remaining blocks
// are about the reader's own book, two are about instruments that are not shares, and three are about
// more than one thing at once. Each of those was individually representable by bolting another
// optional field onto `ComposeContext` — and the result would have been a context where four fields
// are null in every combination, and every consumer guesses which one is live.
//
// A union makes the illegal states unrepresentable instead: exactly one kind, always, and a consumer
// that does not handle a kind fails to compile rather than reading `null` and carrying on.
//
// ── ★ THE READER IS A SUBJECT, NOT A FLAG ─────────────────────────────────────────────────────────
// "How is my portfolio doing" is not a question about a company with a personal filter applied. The
// subject IS the reader's book: it has its own as-of, its own size, and its own coverage shape
// (`ReaderCoverage`). Modelling it as `perspective: "reader"` alone would leave the composer with no
// subject at all and route it to the generic path, which assembles what we hold about A COMPANY.
//
// ⚠ AND YET `perspective` STILL EXISTS, BECAUSE THEY ARE ORTHOGONAL. "How much TCS do I own" is
// `perspective: "reader"` with a STOCK subject — a reader-relative question about a company. The
// subject says what we are talking about; the perspective says whose numbers answer it. Collapsing
// them would make that shape — which is `getStockRelationship`, a real capability — unrepresentable.
//
// ── ★ RESOLUTION ORDER, AND WHY STOCKS WIN TIES ───────────────────────────────────────────────────
// `resolveSubject` tries the stock universe first and only then the instrument registry. That is not
// arbitrary: the stock resolver returns a graded verdict (exact / ambiguous / weak) and the
// instrument lookup is an exact-identifier match with no notion of a near miss. Running the fuzzy
// matcher second would let a weak stock match lose to a coincidental ISIN-shaped string.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { resolveSymbol, type SymbolCandidate } from "./symbol.js";
import type { InstrumentCoverage, ReaderCoverage, StockCoverage } from "./contract.js";

/** A company we cover. The overwhelmingly common case, and the only one that carries a tier. */
export interface StockSubjectRef {
  readonly kind: "stock";
  readonly symbol: string;
  readonly name: string;
  readonly coverage: StockCoverage;
}

/** Anything tradeable that is not a share we score — funds, ETFs, bonds, G-secs, SGBs, REITs. */
export interface InstrumentSubjectRef {
  readonly kind: "instrument";
  /** What the reader typed that matched — an ISIN, a ticker, or an AMFI scheme code. */
  readonly identifier: string;
  readonly name: string;
  readonly coverage: InstrumentCoverage;
}

/** The asker's own book. There is exactly one per turn and it is never named in the question. */
export interface ReaderSubjectRef {
  readonly kind: "reader";
  readonly userId: string;
  readonly coverage: ReaderCoverage;
}

export type Subject = StockSubjectRef | InstrumentSubjectRef | ReaderSubjectRef;

/** Narrowers, so a call site says which kind it needs instead of testing a string inline. */
export const asStock = (s: Subject | undefined): StockSubjectRef | null =>
  s && s.kind === "stock" ? s : null;
export const asInstrument = (s: Subject | undefined): InstrumentSubjectRef | null =>
  s && s.kind === "instrument" ? s : null;
export const asReader = (s: Subject | undefined): ReaderSubjectRef | null =>
  s && s.kind === "reader" ? s : null;

/** What resolution produced for ONE mention. `candidates` is non-empty only when nothing committed. */
export interface SubjectResolution {
  readonly subject: Subject | null;
  readonly candidates: readonly { symbol: string; name: string }[];
  readonly ambiguous: boolean;
}

const NONE: SubjectResolution = { subject: null, candidates: [], ambiguous: false };

/**
 * Resolve ONE subject mention to a stock or a non-equity instrument.
 *
 * Stocks first (graded, fuzzy); instruments second (exact identifier). A mention that matches
 * neither returns `subject: null` with no candidates — the honest "not in our coverage", which is
 * NOT the claim that the thing does not exist.
 */
export async function resolveSubject(text: string): Promise<SubjectResolution> {
  const q = (text ?? "").trim();
  if (!q) return NONE;

  const r = await resolveSymbol(q, { limit: 4 });
  if (r.ok) {
    if (r.data.verdict === "exact") {
      const c = r.data.candidates[0]!;
      return { subject: stockRef(c), candidates: [], ambiguous: false };
    }
    // Ambiguous or weak: hand back candidates and commit to nothing. ⚠ Before falling through to the
    // instrument registry, because "HDFC" matching three stocks weakly is still a stock question.
    return {
      subject: null,
      candidates: r.data.candidates.map((c) => ({ symbol: c.symbol, name: c.name })),
      ambiguous: true,
    };
  }

  const inst = await resolveInstrumentSubject(q);
  return inst ? { subject: inst, candidates: [], ambiguous: false } : NONE;
}

const stockRef = (c: SymbolCandidate): StockSubjectRef => ({
  kind: "stock", symbol: c.symbol, name: c.name, coverage: c.coverage,
});

/**
 * Look one non-equity instrument up by ISIN, ticker or AMFI scheme code.
 *
 * ⚠ EXACT MATCH ONLY, AND THAT IS A DELIBERATE ASYMMETRY WITH THE STOCK PATH. A reader types a
 * company by name and expects fuzzy help; nobody approximates an ISIN. Fuzzy-matching identifiers
 * would turn a typo into a confident answer about a different security, which is the worst outcome
 * available on this path.
 */
async function resolveInstrumentSubject(q: string): Promise<InstrumentSubjectRef | null> {
  const norm = q.trim().toUpperCase();
  const row = await prisma.instrument.findFirst({
    // ⚠ `assetClass: { not: "stock" }` — a share is resolved by resolver #1, above, and must never
    //   arrive here wearing instrument coverage. Shares live in this catalogue too (it is the shared
    //   spine every holdable thing references), so without this an exact ISIN for a scored company
    //   would return a subject with no tier and no depth.
    where: {
      assetClass: { not: "stock" },
      OR: [{ isin: norm }, { symbol: norm }, { amfiSchemeCode: norm }],
    },
    select: { isin: true, symbol: true, amfiSchemeCode: true, name: true, assetClass: true },
  });
  if (!row) return null;

  // "Analytics held" is the nearest honest analogue of "scored" for an instrument, and it is a
  // boolean rather than a tier because there is no ladder here — see InstrumentCoverage.
  const mf = row.amfiSchemeCode
    ? await prisma.mfAnalytics.findUnique({
        where: { schemeCode: row.amfiSchemeCode },
        select: { asOfDate: true },
      }).catch(() => null)
    : null;

  return {
    kind: "instrument",
    identifier: row.amfiSchemeCode ?? row.symbol ?? row.isin,
    name: row.name,
    coverage: {
      kind: "instrument",
      instrumentType: row.assetClass,
      asOf: mf?.asOfDate ? new Date(mf.asOfDate).toISOString().slice(0, 10) : null,
      analytics: mf !== null,
    },
  };
}

/**
 * The reader as a subject. Always resolves — an empty book is a real state, not an absence, and
 * `holdings: 0` says so where a null would read as "we could not look".
 */
export async function resolveReaderSubject(userId: string): Promise<ReaderSubjectRef> {
  // ⚠ NO `.catch(() => [])` HERE, AND THE FIRST VERSION OF THIS FUNCTION HAD ONE.
  //
  // It swallowed a column-name error (`h.updated_at` — the column is `last_computed_at`) and returned
  // an empty array, which became `holdings: 0`, which rendered "your book is empty as far as we can
  // see" to a reader holding 21 positions. That is the §3.1 zero-for-unknown defect in its purest
  // form: a failed READ presented as a confident FACT about the reader's own account, in the one
  // place they can see it is false. Caught by running it live against a real book.
  //
  // A throw here is correct. `resolveReaderSubject` is called from `route()`, where a failure means
  // the turn cannot honestly claim a reader subject at all — far better than claiming an empty one.
  // ⚠ A `JOIN stocks` HERE WAS A SILENT FILTER, AND IT WAS THE SECOND BUG IN SIX LINES.
  //
  // The inner join counted 13 for a reader holding 21 open positions — the other 8 are funds, bonds
  // and other non-equity instruments, which have no `stock_id`. "You hold 13 positions" to someone
  // holding 21 is precisely the set that quietly lost members and reads as a complete set
  // (`DroppedFilter`'s reason for existing). `holdings` is now every open position and
  // `holdingsScored` is the subset we can read — two honest numbers instead of one wrong one.
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
  const row = rows[0];
  return {
    kind: "reader",
    userId,
    coverage: {
      kind: "reader",
      asOf: row?.as_of ? new Date(row.as_of).toISOString().slice(0, 10) : null,
      holdings: Number(row?.total ?? 0),
      holdingsScored: Number(row?.scored ?? 0),
    },
  };
}
