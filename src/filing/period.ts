// File: src/filing/period.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FILING PERIOD RESOLVER — which period a rule's row is keyed on, and when that period ended.
//
// Step 1 fixed the storage convention: `period_key` is "<grain>:<period>" and `period_end` is a real
// DATE carrying the ordering (a prefixed key does not sort across grains). This resolves both from
// the filing the rule actually read.
//
// ── ★ THE PERIOD IS THE FILING'S, NOT THE PASS'S ─────────────────────────────────────────────────
// A single filing-pass run over one stock writes rows at up to THREE different periods, because the
// three filings arrive at different times and cover different spans. On 2026-08-09 a stock's rows
// might be A:FY26 (annual accounts, year-ended 31 Mar 2026), Q:FY27Q1 (results, quarter-ended 30 Jun
// 2026) and S:FY27Q1 (shareholding, as-on 30 Jun 2026). That is correct and is the whole reason the
// grain prefix exists: three statements about three filings, each keyed to its own.
//
// ── ★ period_end COMES FROM THE FILING, NOT FROM A DERIVED CALENDAR ──────────────────────────────
// It would be easy to compute "FY26 ends 2026-03-31" from the label plus Stock.fiscalYearEnd. It
// would also be a second convention that can disagree with the data — a December-fiscal-year filer, a
// restated period, a 15-month transition year. The filings carry `report_date` (documented as the
// period end: "qe_Date (year-end)"), and shareholding carries `as_on_date`. Those are used verbatim.
//
// ── NO PERIOD ⇒ NO ROW, AND THAT IS THE HONEST ANSWER ────────────────────────────────────────────
// A stock with zero shareholding filings has no shareholding quarter to key an R2 row on. We do not
// invent one, and we do not fall back to "today" — a row keyed to a period the company never filed
// would be a fabricated statement about a fabricated quarter. Row absence means "this rule has not
// been run for this period", which is exactly true. The pass counts and reports these.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ WHICH FILING PRODUCED THE FINDING — the `period_key` prefix.
 *
 * ── ★ GRAIN W IS NOT A FILING, AND THAT IS THE POINT (step 6) ────────────────────────────────────
 * A, Q and S each name a document the company filed. W names a TRAILING WINDOW: the 90 days ending at
 * the moment we evaluated. P6 (insider conviction) and H (block/bulk events) read dated event streams
 * that no filing calendar governs, and until step 6 they were forced onto grain S on the argument that
 * "the shareholding quarter is genuinely the period they evaluated over".
 *
 * That argument was wrong, and measurably so. Both rules anchored their window at the latest
 * shareholding as-on date, so the window ended where the SHAREHOLDING calendar ended — 2026-06-30 for
 * most stocks — while the deal feed runs to yesterday. Every block deal of the last six weeks fell
 * outside it. Measured on the cohort step 2 flagged: 38 display-only stocks hold block deals, H fired
 * on 2, and all 38 fire once the window ends at the evaluation date. Two stocks (MCX, BAYERCROP) carry
 * a shareholding anchor stuck at 2018-12-31 and were excluding eight years of deals.
 *
 * So the window now ends at the evaluation date, and the period says so. `W:FY27Q2` reads as "the
 * trailing window, evaluated during FY27Q2" and `period_end` is the window's own end — which is why a
 * W row's period_end advances every time the pass runs and an A/Q/S row's does not.
 *
 * ⚠ DECLARED HERE, NOT IN registry.ts, AND THE REASON IS THE IMPORT GRAPH. registry.ts builds the
 * 22-rule table at module scope, so it pulls in every rule file and everything they reach. A
 * types-only importer of the grain used to acquire that whole graph — and through it the Prisma
 * client — which put a live DB import inside two build gates that are supposed to be pure.
 * verify-build-gate-hygiene caught it. This file has no imports at all, and must keep none.
 */
export type FilingGrain = "A" | "Q" | "S" | "W";

export interface ResolvedPeriod {
  /** "<grain>:<period>" — the identity column. */
  periodKey: string;
  /** The filing's own period end. The ONLY chronological ordering key. */
  periodEnd: Date;
  /** The bare period label without the prefix ("FY26", "FY27Q1") — for reporting. */
  label: string;
}

/** The period each grain resolves to for one stock, or null where that filing does not exist. */
export interface FilingPeriods {
  A: ResolvedPeriod | null;
  Q: ResolvedPeriod | null;
  S: ResolvedPeriod | null;
  /** ★ ALWAYS RESOLVES. A rolling window has no filing to be missing — see the note on grain W. */
  W: ResolvedPeriod;
}

export const makePeriod = (grain: FilingGrain, label: string, periodEnd: Date): ResolvedPeriod => ({
  periodKey: `${grain}:${label}`,
  periodEnd,
  label,
});

/** Split "A:FY26" back into its parts. Used by the read side and by the reporting scripts. */
export function parsePeriodKey(periodKey: string): { grain: FilingGrain; label: string } | null {
  const m = /^([AQSW]):(.+)$/.exec(periodKey);
  return m ? { grain: m[1] as FilingGrain, label: m[2] } : null;
}

/**
 * ★ THE ROLLING WINDOW'S PERIOD — the fiscal quarter the EVALUATION DATE falls in, with the window's
 * own end as `period_end`.
 *
 * The label is a quarter so a W row is stable within a quarter and upserts onto itself as the window
 * rolls, rather than accumulating one row per stock per day. `period_end` is the evaluation date, so
 * the read layer's "greatest period_end wins" reduction always serves the freshest window, and so a
 * reader can see how current the observation is.
 *
 * ⚠ THE FISCAL QUARTER IS DERIVED FROM THE CALENDAR, NOT FROM Stock.fiscalYearEnd. Every consumer of
 * this label treats it as "when we looked", not as "the company's Q2" — a rolling window belongs to
 * our clock, not to the filer's. Deriving it per-filer would give two companies looked at on the same
 * day two different window labels for the same 90 days.
 */
export function rollingWindowPeriod(evaluatedAt: Date): ResolvedPeriod {
  const m = evaluatedAt.getUTCMonth(); // 0-11
  const y = evaluatedAt.getUTCFullYear();
  // Indian fiscal year: Apr–Mar. Apr–Jun = Q1 … Jan–Mar = Q4, and FY26 ends 31 Mar 2026.
  const q = m >= 3 ? Math.floor((m - 3) / 3) + 1 : 4;
  const fyEndYear = m >= 3 ? y + 1 : y;
  return makePeriod("W", `FY${String(fyEndYear).slice(2)}Q${q}`, evaluatedAt);
}
