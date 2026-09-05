// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — WHAT WE HOLD ON ONE STOCK. The single-subject counterpart to resolver #1.
//
// ── ★ WHY THIS ONE, SECOND ─────────────────────────────────────────────────────────────────────────
// Resolver #1 returns a SET, so it exercised only half the contract: `query` populated, `subject`
// null whenever the answer was ambiguous. A contract validated on one shape is a contract validated
// once. This is the other shape — exactly one subject, no search — and it is the shape most of §3.6's
// remaining resolvers have. If `SubjectCoverage` could not carry a single stock honestly, the split
// would be wrong and every later wrapper would inherit that.
//
// ── ★ WHAT IT ANSWERS ─────────────────────────────────────────────────────────────────────────────
// "Can a composition ask this stock the question it wants to ask?" Tier, in-force as-of, depth, and
// the resolved window — before any composition commits to rendering a trend it does not have the
// periods for.
//
// ⚠ ABSENCE IS NOT AN ERROR HERE. An unknown symbol is `not_in_universe`; a known one with no results
// is `not_ingested`. Both are `ok:false` with a reader phrase, and neither throws — a composition
// asking about a company we just listed must get an answer it can render, not an exception.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import {
  absent, resolved, NO_DEPTH,
  type Resolved, type Source, type StockCoverage, type Window,
} from "./contract.js";

export interface StockSubject {
  readonly stockId: string;
  readonly symbol: string;
  readonly name: string;
  readonly industryType: string;
}

/** The five industry results tables. Same union as resolver #1 — a financial's quarters do not live
 *  in `quarterly_results`, and reading that table alone reports a bank as tier 0. */
const QUARTERLY_UNION = `
  SELECT stock_id, fiscal_year || quarter AS pk, report_date FROM quarterly_results
  UNION ALL SELECT stock_id, fiscal_year || quarter, report_date FROM banking_quarterly_results
  UNION ALL SELECT stock_id, fiscal_year || quarter, report_date FROM nbfc_quarterly_results
  UNION ALL SELECT stock_id, fiscal_year || quarter, report_date FROM life_insurance_quarterly_results
  UNION ALL SELECT stock_id, fiscal_year || quarter, report_date FROM general_insurance_quarterly_results`;

// ⚠ PIT-CORRECTNESS SURVIVES THE WRAPPER. The in-force reduction is MAX(version) per (stock, period),
// tie-broken by latest as_of_date — `scoring-read.service.ts#inForceByPeriod`'s rule, not a new one,
// and NOT "latest row wins". A wrapper that quietly read latest-available would be worse than no
// wrapper, because it would look period-bounded and not be.
const SQL = `
WITH st AS (SELECT id, symbol, name, "industryType" AS industry_type FROM stocks WHERE symbol = $1),
periods AS (
  SELECT DISTINCT pk, MAX(report_date) AS report_date
  FROM (${QUARTERLY_UNION}) u WHERE stock_id = (SELECT id FROM st) GROUP BY pk
),
ranked AS (SELECT pk, ROW_NUMBER() OVER (ORDER BY pk DESC) AS rn FROM periods),
q AS (
  SELECT (SELECT COUNT(*)::int FROM periods) AS quarters,
         -- ★ THE FROM-PERIOD OF THE WINDOW ACTUALLY GRANTED, not of everything held. Asking 8 of a
         -- stock holding 32 must resolve to the LAST 8 — reporting the full span with a count of 8
         -- describes a range that holds 32, which is the shortened-window lie in reverse.
         (SELECT pk FROM ranked WHERE rn = LEAST(COALESCE($2::int, (SELECT COUNT(*)::int FROM periods)),
                                                 (SELECT COUNT(*)::int FROM periods))) AS first_pk,
         (SELECT pk FROM ranked WHERE rn = 1) AS last_pk,
         (SELECT MAX(report_date) FROM periods) AS last_report
),
inforce AS (
  SELECT DISTINCT ON (period_key) period_key, as_of_date
  FROM score_snapshots
  WHERE snapshot_type = 'quarterly' AND stock_id = (SELECT id FROM st)
  ORDER BY period_key, version DESC, as_of_date DESC
),
s AS (SELECT COUNT(*)::int AS snapshots, MAX(as_of_date) AS as_of FROM inforce)
SELECT st.id, st.symbol, st.name, st.industry_type,
       q.quarters, q.first_pk, q.last_pk, q.last_report,
       s.snapshots, s.as_of
FROM st, q, s`;

interface Row {
  id: string; symbol: string; name: string; industry_type: string;
  quarters: number; first_pk: string | null; last_pk: string | null; last_report: Date | null;
  snapshots: number; as_of: Date | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * What we hold on one stock, by exact symbol.
 *
 * @param requestedQuarters  how many quarters the CALLER wants. The returned `window` is what it
 *                           ACTUALLY GETS — asking 20 of a stock holding 8 resolves to 8, and the
 *                           caller can see it did (§3.3: RESOLVED, never as-requested).
 */
export async function resolveStockCoverage(
  symbol: string,
  opts: { requestedQuarters?: number } = {},
): Promise<Resolved<StockSubject>> {
  const sym = (symbol ?? "").trim().toUpperCase();
  if (sym.length === 0) return absent("not_in_universe", { subject: null, query: null });

  const want = opts.requestedQuarters ?? null;
  // ★★ THE ONE GUARD THAT COVERS TWENTY-FOUR CALL SITES. This function is the coverage envelope for
  //    the entire market side: `blocks-stock.ts`'s seven resolvers reach it through `envelopeFor`,
  //    and seven composition families call it directly. Unguarded, a database failure threw out of
  //    ALL of them, so with the database down every market answer was a 500 rather than a sentence —
  //    measured 18 of 18 throwing, resolvers and compositions alike.
  //
  // ⚠ AND IT RETURNS AN ABSENCE RATHER THAN AN EMPTY ENVELOPE, WHICH IS THE WHOLE POINT. Returning a
  //   well-formed "we know nothing about this stock" coverage would stop the throw and be the exact
  //   defect §3.1 forbids: a read that FAILED, rendered as a record we do not hold. `read_failed` is
  //   distinguishable by every caller; a zeroed envelope is not.
  let read = true;
  const rows = (await prisma.$queryRawUnsafe(SQL, sym, want).catch(() => { read = false; return []; })) as Row[];
  if (!read) return absent("read_failed", { subject: null, query: null });
  const r = rows[0];
  // No row at all — the symbol is not one we carry. Distinct from carrying it with no results.
  if (!r) return absent("not_in_universe", { subject: null, query: null });

  const tier: 0 | 1 | 2 = r.snapshots > 0 ? 2 : r.quarters > 0 ? 1 : 0;
  const asOf = tier === 2 ? iso(r.as_of) : tier === 1 ? iso(r.last_report) : null;

  // ★ THE WINDOW IS THE MIN OF WHAT WAS ASKED AND WHAT EXISTS, AND from/to DESCRIBE THAT SAME RANGE.
  const window: Window | null =
    r.quarters > 0 && r.first_pk && r.last_pk
      ? { fromPeriod: r.first_pk, toPeriod: r.last_pk, periods: want === null ? r.quarters : Math.min(want, r.quarters) }
      : null;

  const subject: StockCoverage = {
    kind: "stock",
    tier, asOf, window,
    // snapshots null — not 0 — when unscored. §3.1: 0 would say "scored, no periods".
    depth: { quarters: r.quarters, snapshots: r.snapshots > 0 ? r.snapshots : null },
  };

  // ⚠ TIER 0 IS AN ABSENCE, AND IT CARRIES ITS COVERAGE. The stock is real and we know its name; we
  // hold no results for it. `not_ingested` says exactly that, and the `subject` rides along on the
  // absent arm so a caller can still render "we cover this company, first results pending" rather
  // than a bare miss. This is why both arms of Resolved carry coverage.
  if (tier === 0) return absent("not_ingested", { subject, query: null });

  const provenance: Source[] = ["stocks", "quarterly_results"];
  if (tier === 2) provenance.push("score_snapshots");

  // `query: null` — nothing was searched. A single-subject resolver has no universe count to report,
  // and inventing one (2,290) would describe a search that never happened.
  return resolved(
    { stockId: r.id, symbol: r.symbol, name: r.name, industryType: r.industry_type },
    { subject, query: null },
    provenance,
  );
}
