// ─────────────────────────────────────────────────────────────
// SESSION-DATE VALIDATION — "is this file actually the day we asked for?"
//
// ★ WHY THIS EXISTS. MEASURED 2026-08-15: nsearchives does NOT 404 on a
//   non-session date for the equity archive. Requesting
//     products/content/sec_bhavdata_full_05072026.csv   (Sunday 5 Jul 2026)
//   returns HTTP 200 with 3,283 rows whose every DATE1 reads "03-Jul-2026" —
//   Friday's file under Sunday's filename. The same held for a WEEKDAY holiday:
//     sec_bhavdata_full_01052026.csv (Maharashtra Day) → 200, 3,214 rows,
//     every DATE1 "30-Apr-2026".
//   Every parser here used to stamp the REQUESTED date onto every row and never
//   read the file's own date column, so those rows landed as a fabricated
//   session: a full bar — OHLC, volume, trade count, delivery qty — asserting the
//   market traded that day at the prior session's numbers. Two such days are in
//   daily_prices today (2026-06-26, 2026-07-05), byte-identical to their
//   predecessor across every field.
//
//   A 1,826-day backfill crosses ~60 market holidays. Without this check each one
//   becomes a fabricated session.
//
// ★ NO HOLIDAY CALENDAR IS NEEDED, AND DELIBERATELY NOT USED. Every file declares
//   its own trading date. That declaration is the authority — a calendar would be a
//   second source of truth to keep in sync, and would still be wrong the first time
//   NSE held an unscheduled session.
//
// ⚠ THE THREE ARCHIVES USE THREE DIFFERENT DATE FORMATS. All MEASURED, not assumed
//   — a shared "parse a date" helper that guessed one format would reject every real
//   file in the other two lanes, which is far worse than the bug being fixed:
//     equity  sec_bhavdata_full  DATE1        "16-Aug-2022"  DD-MMM-YYYY
//     index   ind_close_all      Index Date   "13-08-2026"   DD-MM-YYYY
//     udiff   BhavCopy_NSE_CM    TradDt       "2026-08-13"   YYYY-MM-DD
//   Each caller names its own parser. There is no format sniffing.
//
// ⚠ ONLY THE EQUITY ARCHIVE IS KNOWN TO SERVE STALE 200s. MEASURED on the same
//   Sunday: content/cm (udiff) → 404, content/indices → 404. The index and udiff
//   lanes are hardened anyway because they carry the identical latent flaw and are
//   protected only by upstream behaviour we do not control — behaviour that already
//   differs between sibling directories on the same host.
// ─────────────────────────────────────────────────────────────

const MONTHS_MMM = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** Canonical YYYY-MM-DD for a Date, read in UTC. The comparison basis for every lane. */
export function isoDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * `DD-MMM-YYYY` → YYYY-MM-DD. The equity bhavcopy's DATE1 ("16-Aug-2022").
 * Case-insensitive on the month token: NSE mixes "Apr" and "APR" across endpoints.
 * Returns null if it does not parse — the caller treats that as a rejection, never
 * as a pass.
 */
export function parseDdMmmYyyy(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mi = MONTHS_MMM.indexOf(m[2].toUpperCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** `DD-MM-YYYY` → YYYY-MM-DD. The index archive's "Index Date" ("13-08-2026"). */
export function parseDdMmYyyy(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** `YYYY-MM-DD` (possibly with a time suffix) → YYYY-MM-DD. The udiff's TradDt. */
export function parseIsoDay(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Why a file was rejected. `null` from `checkSessionDate` means "this IS the day we asked for". */
export interface SessionDateMismatch {
  /** YYYY-MM-DD we requested. */
  requested: string;
  /** Every DISTINCT raw value seen in the file's date column, capped for logging. */
  returned: string[];
  /** unparseable | stale (uniform, wrong day) | mixed (>1 distinct value) | absent */
  kind: "absent" | "unparseable" | "stale" | "mixed";
  /** One line, operator-facing. */
  message: string;
}

const MAX_REPORTED_VALUES = 8;

/**
 * Compare a file's own declared trading date(s) against the date we asked for.
 *
 * ⚠ PARTIAL MISMATCH REJECTS THE WHOLE FILE. If the column carries more than one
 *   distinct value we do not keep the matching subset. A mixed file means something
 *   is true about this source that we do not understand, and salvaging half of it
 *   would write rows on exactly the assumption that just proved false. Both stale
 *   files measured were internally UNIFORM (one distinct DATE1 each), so this
 *   forfeits nothing observed — and the distinct set is logged, so the first genuinely
 *   mixed file teaches us its shape instead of vanishing behind an opaque rejection.
 *
 * @param rawValues every value of the date column, one per data row, unparsed
 * @param requested the date the caller asked the archive for
 * @param parse     the lane's own format parser — no sniffing
 */
export function checkSessionDate(
  rawValues: string[],
  requested: Date,
  parse: (raw: string) => string | null,
): SessionDateMismatch | null {
  const want = isoDay(requested);

  const distinctRaw = [...new Set(rawValues.map((v) => (v ?? "").trim()).filter((v) => v !== ""))];

  if (distinctRaw.length === 0) {
    return {
      requested: want,
      returned: [],
      kind: "absent",
      message:
        `requested ${want} but the file declares no trading date at all ` +
        `(date column absent or empty on every row)`,
    };
  }

  const parsed = distinctRaw.map((v) => parse(v));
  if (parsed.some((p) => p === null)) {
    const bad = distinctRaw.filter((_, i) => parsed[i] === null).slice(0, MAX_REPORTED_VALUES);
    return {
      requested: want,
      returned: distinctRaw.slice(0, MAX_REPORTED_VALUES),
      kind: "unparseable",
      message:
        `requested ${want} but the file's trading date could not be parsed ` +
        `(unreadable: ${bad.map((b) => JSON.stringify(b)).join(", ")}) — refusing to assume it matches`,
    };
  }

  const distinctIso = [...new Set(parsed as string[])];

  if (distinctIso.length > 1) {
    return {
      requested: want,
      returned: distinctRaw.slice(0, MAX_REPORTED_VALUES),
      kind: "mixed",
      message:
        `requested ${want} but the file carries ${distinctIso.length} DIFFERENT trading dates ` +
        `[${distinctIso.slice(0, MAX_REPORTED_VALUES).join(", ")}] — rejecting the WHOLE file, ` +
        `not the matching subset (a mixed file is a source behaviour we do not understand)`,
    };
  }

  if (distinctIso[0] !== want) {
    return {
      requested: want,
      returned: distinctRaw.slice(0, MAX_REPORTED_VALUES),
      kind: "stale",
      message:
        `requested ${want} but the archive served ${distinctIso[0]} — not a session, no rows written ` +
        `(the archive returns 200 with the PRIOR session's file on a non-session date)`,
    };
  }

  return null;
}
