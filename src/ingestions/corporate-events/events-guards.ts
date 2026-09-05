// ─────────────────────────────────────────────────────────────
// CORPORATE-EVENTS detection-guard predicates (pure, no I/O).
//
// Same pattern as the other crons. Events get THREE families, not five —
// they have no contentless-row-to-reject (a board_meeting is complete with
// just date+type) and no per-stock time series (QoQ continuity is
// meaningless). The five families are a checklist, not a quota.
//
// The silent-failure surface is the free-text `subject` regex parsing
// (events.ts): a subject-format change falls through to the `record_date`
// catch-all and nulls amounts/ratios; a date-format change makes
// parseNseDate return null → the event is silently skipped (empty fetch).
//
// Thresholds HARDCODED + grounded from real corporate_events (3749 rows).
// NOT guarded: split_ratio (100% null — the parser only matches `X:Y` but
// NSE splits read "From Rs 10 To Rs 2"; always-null can't be guarded — see
// the parser-gap TODO in events.ts).
// ─────────────────────────────────────────────────────────────

export const EVENTS_CRON = "events_ingest";
export const EVENTS_SOURCE = "nse_events";

// ── GUARD 1: COUNT / coverage (run-level, PROVISIONAL) ──
// Inserts are ~0 on idempotent re-runs, so the "did we get data" signal is
// totalFetched. A date-format break empties the fetch; source-down → 0.
export const FETCH_FLOOR = 10;

// ── GUARD 2: CLASSIFICATION null-rate (batch — the precise break signal) ──
export const RECORD_DATE_MAX = 0.1; // catch-all rate; normal 0.9%
export const DIV_NO_AMOUNT_MAX = 0.25; // normal 10.2% (legit pending dividends) — fires only on a spike
export const BONUS_NO_RATIO_MAX = 0.25; // normal 3.6%
export const MIN_BATCH_FOR_RATE = 20;

// ── GUARD 3: RANGE / validity (per-record) ──
export const DIVIDEND_MAX = 1000; // real max 512/share; >1000 ⇒ regex grabbed the wrong number
/**
 * ★ THE FLOOR IS NSE'S OWN FIRST TRADING DAY, NOT A ROUND NUMBER.
 *
 * This was 2000 ("real earliest 2005") and it was a guess that the world outgrew. NSE's corporate-
 * actions archive since served ten events from 1996-1999 and every one of them is REAL, checked
 * against its own subject line: ELECTHERM "Dividend -7.5%" (1996-09-11), SHREDIGCEM "Allotment Of
 * Shares Of Gujarat Composite Ltd & Digvijay Finlease Ltd" (1997-10-01), KJMCFIN "Agm/Dividend -
 * 40%" (1997-08-27), HAWKINCOOK "Agm / Dividend - 30%" (1999-08-18) and the rest. A date-parse
 * error does not produce ten coherent 1990s AGMs and dividends with matching purpose text; it
 * produces 1970-01-01, or a year like 2097 from a two-digit "97". Those are what this guard is for.
 *
 * So the floor moves to the only date that is a FACT rather than an estimate: NSE opened its equity
 * (capital market) segment on 3 November 1994, so no NSE corporate action can predate 1994. A year
 * below it is still impossible and still faults — the guard keeps its teeth, and stops calling the
 * exchange's own early history a bug.
 */
export const MIN_EVENT_YEAR = 1994; // NSE equity segment opened 1994-11-03; earliest real event 1996

export const eventsRunRef = (label: string) => `events:${label}`;

// ── Predicates ───────────────────────────────────────────────

/** GUARD 1 — fetch collapsed (date-format break / source down). */
export function checkFetchFloor(totalFetched: number): boolean {
  return totalFetched < FETCH_FLOOR;
}

/** GUARD 2 — batch rate if it breaches `max` (skips small batches). */
export function checkBatchRate(
  count: number,
  n: number,
  max: number,
): number | null {
  if (n < MIN_BATCH_FOR_RATE) return null;
  const rate = count / n;
  return rate > max ? rate : null;
}

/** GUARD 3 — dividend amount non-positive or implausibly large. */
export function checkDividendRange(amount: number | null): boolean {
  return amount != null && (amount <= 0 || amount > DIVIDEND_MAX);
}

/** GUARD 3 — event date in an implausible year (a date-parse error). */
export function checkEventDateImplausible(d: Date, now: Date): boolean {
  const y = d.getUTCFullYear();
  const maxYear = now.getUTCFullYear() + 2;
  return y < MIN_EVENT_YEAR || y > maxYear;
}

/** GUARD 3 — record date before ex date (impossible ordering / date swap). */
export function checkRecordBeforeEx(
  exDate: Date | null,
  recordDate: Date | null,
): boolean {
  return (
    exDate != null && recordDate != null && recordDate.getTime() < exDate.getTime()
  );
}
