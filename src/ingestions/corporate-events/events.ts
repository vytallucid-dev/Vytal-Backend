// ─────────────────────────────────────────────────────────────
// Fetches corporate events from TWO NSE endpoints:
//
// 1. /api/corporates-corporateActions  — corporate actions
//    (dividends, bonus, splits, rights, buybacks, AGM)
//    Returns structured per-action data with amounts/ratios.
//
// 2. /api/event-calendar               — board meetings / results
//    (earnings dates, board meetings)
//    Returns upcoming scheduled events.
//
// Both use the NseClient session. We merge and deduplicate.
// ─────────────────────────────────────────────────────────────

import { nseClient } from "../../lib/client.js";

// ── NSE response types ────────────────────────────────────────

/** Raw record from /api/corporates-corporateActions */
interface NseCorporateActionRaw {
  symbol: string;
  series: string;
  faceVal: string | null;
  subject: string; // "Dividend - Rs 29 Per Share" / "Bonus 1:1" / "Annual General Meeting"
  exDate: string | null; // "23-APR-2025"
  recDate: string | null;
  bcStDt: string | null; // book closure start
  bcEndDt: string | null; // book closure end
  ndStartDt: string | null;
  ndEndDt: string | null;
  setPayDt: string | null; // payment date (dividends)
  comp: string; // company name
}

/** Raw record from /api/event-calendar */
interface NseEventCalendarRaw {
  symbol: string;
  series: string;
  date: string; // "18-Apr-2025"
  purpose: string; // "Board Meeting" / "Financial Results" / etc.
  bm_desc: string | null; // board meeting description
}

// ── Transformed event (ready for DB) ─────────────────────────

export type EventType =
  | "earnings"
  | "dividend"
  | "agm"
  | "board_meeting"
  | "bonus"
  | "split"
  | "rights"
  | "buyback"
  | "record_date";

export interface EventRecord {
  symbol: string;
  eventType: EventType;
  eventDate: Date;
  exDate: Date | null;
  recordDate: Date | null;
  description: string | null;
  isConfirmed: boolean;
  impactLevel: "high" | "medium" | "low";
  dividendAmount: number | null;
  dividendType: "interim" | "final" | "special" | null;
  bonusRatio: string | null;
  splitRatio: string | null;
  purpose: string | null;
}

// ── Date parsers ──────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/** Parse "23-APR-2025" or "23-Apr-2025" → Date */
function parseNseDate(s: string | null | undefined): Date | null {
  if (!s || s.trim() === "-" || s.trim() === "") return null;
  const parts = s.trim().split("-");
  if (parts.length !== 3) return null;
  const [day, mon, year] = parts;
  const m = MONTHS[mon.toUpperCase()] ?? MONTHS[mon];
  if (m === undefined) return null;
  const d = new Date(Date.UTC(parseInt(year), m, parseInt(day)));
  return isNaN(d.getTime()) ? null : d;
}

// ── Subject parser ────────────────────────────────────────────
// Extracts structured data from NSE's free-text subject field.
// e.g. "Dividend - Rs 29 Per Share" → { amount: 29, type: 'interim' }
// e.g. "Interim Dividend - Rs 10 Per Share" → { amount: 10, type: 'interim' }
// e.g. "Bonus 1:1" → { bonusRatio: '1:1' }
// e.g. "Stock Split From Rs 10/- To Rs 2/-" → split event

interface ParsedSubject {
  eventType: EventType;
  dividendAmount: number | null;
  dividendType: "interim" | "final" | "special" | null;
  bonusRatio: string | null;
  splitRatio: string | null;
  impactLevel: "high" | "medium" | "low";
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * ★ "Re" IS NOT A TYPO — IT IS THE SINGULAR OF "Rs", AND MISSING IT NULLED 3,477 DIVIDENDS.
 *
 * MEASURED. The null_rate guard tripped on 2026-08-30 at 26.1% of dividends carrying no amount
 * against a 25% ceiling, and the cause was not a "subject-format change" as the fault text
 * guessed. NSE writes a one-rupee dividend as "Dividend - Re 1 Per Share" — Indian usage puts the
 * singular rupee as "Re" and the plural as "Rs" — and the old pattern matched only `Rs`. So every
 * dividend of exactly ₹1, ₹0.50, ₹0.25 … the smallest and most common ones … parsed as NULL:
 * 3,477 of the 3,992 unparsed rows, measured across the whole table. The split branch below has
 * ALWAYS handled `Rs/Re` (see "Face Value Split From Rs.10/- To Re.1/-"); only this branch did not,
 * and the two had drifted apart on the same feed's own spelling.
 *
 * ★ AMOUNTS ARE SUMMED, BECAUSE A COMPOUND DIVIDEND IS ONE PAYMENT IN TWO CLAUSES. NSE ships
 *   "Dividend - Rs 3 Per Share/Special Dividend - Rs 2 Per Share": the holder receives ₹5. Taking
 *   the FIRST match stored ₹3 and taking the LAST stored ₹2 — both wrong, and wrong in the way this
 *   file most fears, a plausible number rather than an honest absence. 274 rows carried such a
 *   subject; every one of them is now the sum.
 *
 * ⚠ THE FACE-VALUE CLAUSE MUST BE CUT FIRST, OR THE SUM EATS A SPLIT. Four subjects announce a
 *   dividend AND a split together — "Interim Dividend - Rs 1.50/- Per Share / Face Value Split -
 *   From Rs 10/- Per Share To Rs 5/- Per Share". Summing blind gives ₹16.50 for a ₹1.50 dividend,
 *   because the face values are rupee amounts too. In all four the dividend PRECEDES the clause, so
 *   the subject is truncated at it and only the dividend side is read. Verified against all 15,263
 *   dividend subjects in the table: 11,512 unchanged, 3,477 newly parsed, 274 corrected, 0 lost.
 *
 * Returns NULL for the 515 percentage-of-face-value subjects ("Agm/Dividend-10%"). That is an
 * HONEST ABSENCE, not a failure: the payout is 10% of a face value the subject never states, and
 * inventing one would be exactly the fabricated number the whole guard layer exists to prevent.
 */
const FACE_VALUE_CLAUSE = /(face\s*value|sub-?division|stock\s*split|fv\s*split)/i;
const RUPEES_PER_SHARE = /(?:@\s*)?\bR(?:s|e)\.?\s*(\d+(?:\s*\.\s*\d+)?)/gi;

export function parseRupeesPerShare(subject: string): number | null {
  // Cut at the face-value/split clause so a split's "From Rs 10 To Rs 2" never joins the sum.
  const cut = subject.search(FACE_VALUE_CLAUSE);
  const scope = cut >= 0 ? subject.slice(0, cut) : subject;

  const amounts = [...scope.matchAll(RUPEES_PER_SHARE)]
    .map((m) => parseFloat(m[1]!.replace(/\s+/g, ""))) // "0 .70" → "0.70"
    .filter((v) => Number.isFinite(v));
  if (amounts.length === 0) return null;

  // Rounded to 4dp: summing "8.35 + 3.35" in binary floating point yields 11.700000000000001.
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 10_000) / 10_000;
}

function parseSubject(subject: string): ParsedSubject {
  const s = subject.toLowerCase().trim();

  // Dividend variants
  if (s.includes("dividend") || s.includes("div ")) {
    let dividendType: "interim" | "final" | "special" = "final";
    if (s.includes("interim")) dividendType = "interim";
    else if (s.includes("special")) dividendType = "special";

    // Extract amount: "Rs 29 Per Share" / "Rs. 29/-" / "@ Rs 5" / "Re 1 Per Share"
    //
    // ⚠ THE WHITESPACE INSIDE THE NUMBER IS NOT HYPOTHETICAL, AND IT COST A DIVIDEND. NSE ships
    //   " Dividend - Rs 0 .70 Per Share" — a space between the integer part and the decimal point.
    //   Against `\d+(?:\.\d+)?` that matches "0", stops at the space, and stores ₹0.00 for a real
    //   ₹0.70 dividend: not an absence, which would be honest, but a WRONG NUMBER, which scores.
    //   The guard caught it (JKTYRE, ex-date 2020-09-14) and it is the only occurrence in all 5,833
    //   dividend events — so the tolerance is deliberately narrow: whitespace is allowed only
    //   BETWEEN the digits and the point, never anywhere else, and never across a "Rs 5 Per Share"
    //   boundary where a following number would be a different field.
    const dividendAmount = parseRupeesPerShare(subject);

    return {
      eventType: "dividend",
      dividendAmount,
      dividendType,
      bonusRatio: null,
      splitRatio: null,
      impactLevel: dividendAmount && dividendAmount > 5 ? "high" : "medium",
    };
  }

  // Bonus
  if (s.includes("bonus")) {
    // "Bonus 1:1" or "Bonus Issue 2:1"
    const ratioMatch = subject.match(/(\d+)\s*:\s*(\d+)/);
    const bonusRatio = ratioMatch ? `${ratioMatch[1]}:${ratioMatch[2]}` : null;
    return {
      eventType: "bonus",
      dividendAmount: null,
      dividendType: null,
      bonusRatio,
      splitRatio: null,
      impactLevel: "high",
    };
  }

  // Split
  if (s.includes("split") || s.includes("sub-division")) {
    // X:Y format first (kept for any future subjects that use it; currently 0 DB rows match)
    const xyMatch = subject.match(/(\d+)\s*:\s*(\d+)/);
    if (xyMatch) {
      return {
        eventType: "split",
        dividendAmount: null,
        dividendType: null,
        bonusRatio: null,
        splitRatio: `${xyMatch[1]}:${xyMatch[2]}`,
        impactLevel: "high",
      };
    }

    // Face-value format — the actual NSE format for all 60 split rows in the DB:
    // "Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share"
    // "Face Value Split From Rs.10/- To Re.1/-"
    // "Fv Split Rs.2/- To Re.1/-"
    // Handles: Rs/Re, Rs./Re. (dotted), no-space "Rs10", trailing "/-", optional "Per Share"
    const fvMatch = subject.match(
      /R[se]\.?\s*(\d+(?:\.\d+)?)\s*\/?-?\s*(?:Per\s+Share\s+)?To\s+R[se]\.?\s*(\d+(?:\.\d+)?)/i,
    );
    let splitRatio: string | null = null;
    if (fvMatch) {
      const oldFv = parseFloat(fvMatch[1]);
      const newFv = parseFloat(fvMatch[2]);
      if (oldFv > newFv && newFv > 0) {
        // Scale to integers before GCD to handle decimal face values (e.g. Rs 0.50)
        const scale = 100;
        const o = Math.round(oldFv * scale);
        const n = Math.round(newFv * scale);
        const g = gcd(o, n);
        splitRatio = `${o / g}:${n / g}`;
      }
      // oldFv <= newFv would be a reverse split / consolidation — leave splitRatio null
    }

    return {
      eventType: "split",
      dividendAmount: null,
      dividendType: null,
      bonusRatio: null,
      splitRatio,
      impactLevel: "high",
    };
  }

  // AGM
  if (s.includes("annual general meeting") || s.includes("agm")) {
    return {
      eventType: "agm",
      dividendAmount: null,
      dividendType: null,
      bonusRatio: null,
      splitRatio: null,
      impactLevel: "low",
    };
  }

  // Rights
  if (s.includes("rights")) {
    return {
      eventType: "rights",
      dividendAmount: null,
      dividendType: null,
      bonusRatio: null,
      splitRatio: null,
      impactLevel: "high",
    };
  }

  // Buyback
  if (
    s.includes("buyback") ||
    s.includes("buy back") ||
    s.includes("buy-back")
  ) {
    return {
      eventType: "buyback",
      dividendAmount: null,
      dividendType: null,
      bonusRatio: null,
      splitRatio: null,
      impactLevel: "high",
    };
  }

  // Record date for something unspecified
  return {
    eventType: "record_date",
    dividendAmount: null,
    dividendType: null,
    bonusRatio: null,
    splitRatio: null,
    impactLevel: "low",
  };
}

// ── Purpose parser for event calendar ────────────────────────

function parsePurpose(
  purpose: string,
  desc: string | null,
): {
  eventType: EventType;
  impactLevel: "high" | "medium" | "low";
} {
  const p = (purpose ?? "").toLowerCase();
  const d = (desc ?? "").toLowerCase();
  const combined = `${p} ${d}`;

  if (combined.includes("financial results") || combined.includes("results")) {
    return { eventType: "earnings", impactLevel: "high" };
  }
  if (combined.includes("dividend")) {
    return { eventType: "dividend", impactLevel: "high" };
  }
  if (combined.includes("agm") || combined.includes("annual general")) {
    return { eventType: "agm", impactLevel: "low" };
  }
  if (
    combined.includes("board meeting") ||
    combined.includes("board of directors")
  ) {
    return { eventType: "board_meeting", impactLevel: "medium" };
  }
  if (combined.includes("bonus")) {
    return { eventType: "bonus", impactLevel: "high" };
  }
  if (combined.includes("split")) {
    return { eventType: "split", impactLevel: "high" };
  }
  if (combined.includes("buyback") || combined.includes("buy back")) {
    return { eventType: "buyback", impactLevel: "high" };
  }

  return { eventType: "board_meeting", impactLevel: "medium" };
}

// ── NSE date formatter ────────────────────────────────────────

function toNseDateParam(d: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mon = months[d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mon}-${yyyy}`;
}

// ── Fetchers ──────────────────────────────────────────────────

/**
 * Fetch all corporate actions for a specific symbol (dividends, bonus, splits, etc.).
 * NSE dropped date-range filtering from this endpoint — per-symbol is the only mode
 * that returns data. Returns the full history NSE holds for that stock.
 * Endpoint: /api/corporates-corporateActions?index=equities&symbol=SYMBOL
 */
export async function fetchCorporateActionsForSymbol(
  symbol: string,
): Promise<EventRecord[]> {
  const path = `/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`;

  const data = await nseClient.get<NseCorporateActionRaw[]>(path);

  if (!Array.isArray(data)) return [];

  const events: EventRecord[] = [];

  for (const raw of data) {
    if (!raw.symbol || !raw.series || raw.series !== "EQ") continue;

    const exDate = parseNseDate(raw.exDate);
    const recordDate = parseNseDate(raw.recDate);

    // Use exDate as the event date (most meaningful for investors)
    // Fall back to record date, then skip if neither
    const eventDate = exDate ?? recordDate;
    if (!eventDate) continue;

    const parsed = parseSubject(raw.subject ?? "");

    events.push({
      symbol: raw.symbol.trim().toUpperCase(),
      eventType: parsed.eventType,
      eventDate,
      exDate,
      recordDate,
      description: raw.subject ?? null,
      isConfirmed: true,
      impactLevel: parsed.impactLevel,
      dividendAmount: parsed.dividendAmount,
      dividendType: parsed.dividendType,
      bonusRatio: parsed.bonusRatio,
      splitRatio: parsed.splitRatio,
      purpose: raw.subject ?? null,
    });
  }

  return events;
}

/**
 * Fetch board meetings and earnings dates from the event calendar.
 * Endpoint: /api/event-calendar?index=equities&fromDate=...&toDate=...
 */
export async function fetchEventCalendar(
  from: Date,
  to: Date,
): Promise<EventRecord[]> {
  const fromStr = toNseDateParam(from);
  const toStr = toNseDateParam(to);

  const path = `/api/event-calendar?index=equities&fromDate=${fromStr}&toDate=${toStr}`;

  const data = await nseClient.get<NseEventCalendarRaw[]>(path);

  if (!Array.isArray(data)) return [];

  const events: EventRecord[] = [];

  for (const raw of data) {
    if (!raw.symbol || !raw.date) continue;
    if (raw.series && raw.series !== "EQ") continue;

    const eventDate = parseNseDate(raw.date);
    if (!eventDate) continue;

    const { eventType, impactLevel } = parsePurpose(
      raw.purpose ?? "",
      raw.bm_desc ?? "",
    );

    events.push({
      symbol: raw.symbol.trim().toUpperCase(),
      eventType,
      eventDate,
      exDate: null,
      recordDate: null,
      description: raw.bm_desc ?? raw.purpose ?? null,
      isConfirmed: true,
      impactLevel,
      dividendAmount: null,
      dividendType: null,
      bonusRatio: null,
      splitRatio: null,
      purpose: raw.purpose ?? null,
    });
  }

  return events;
}

/**
 * Deduplicate events by symbol|eventType|date.
 * Prefer corporate-actions rows (they carry amounts/exDates) over calendar rows.
 */
export function deduplicateEvents(events: EventRecord[]): EventRecord[] {
  const seen = new Map<string, EventRecord>();
  for (const event of events) {
    const key = `${event.symbol}|${event.eventType}|${event.eventDate.toISOString().split("T")[0]}`;
    if (!seen.has(key)) {
      seen.set(key, event);
    } else {
      const existing = seen.get(key)!;
      if (event.dividendAmount != null && existing.dividendAmount == null) {
        seen.set(key, event);
      } else if (event.exDate != null && existing.exDate == null) {
        seen.set(key, event);
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Fetch event-calendar events (board meetings, earnings dates) for a date window.
 * Corporate-actions are now fetched per-symbol — see fetchCorporateActionsForSymbol.
 */
export async function fetchAllEvents(
  from: Date,
  to: Date,
): Promise<EventRecord[]> {
  // Corporate-actions no longer support date-range queries (NSE API change).
  // Callers that need corporate-actions must call fetchCorporateActionsForSymbol per stock.
  // This function now returns only calendar events (meetings / earnings dates).
  return fetchEventCalendar(from, to);
}
