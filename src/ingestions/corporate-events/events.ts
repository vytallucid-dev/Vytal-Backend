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

function parseSubject(subject: string): ParsedSubject {
  const s = subject.toLowerCase().trim();

  // Dividend variants
  if (s.includes("dividend") || s.includes("div ")) {
    let dividendType: "interim" | "final" | "special" = "final";
    if (s.includes("interim")) dividendType = "interim";
    else if (s.includes("special")) dividendType = "special";

    // Extract amount: "Rs 29 Per Share" or "Rs. 29/-" or "@ Rs 5"
    const amountMatch = subject.match(
      /(?:Rs\.?\s*|@\s*Rs\.?\s*)(\d+(?:\.\d+)?)/i,
    );
    const dividendAmount = amountMatch ? parseFloat(amountMatch[1]) : null;

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
    const ratioMatch = subject.match(/(\d+)\s*:\s*(\d+)/);
    const splitRatio = ratioMatch ? `${ratioMatch[1]}:${ratioMatch[2]}` : null;
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
 * Fetch corporate actions (dividends, bonus, splits, AGMs) for a date range.
 * Endpoint: /api/corporates-corporateActions?index=equities&from_date=...&to_date=...
 */
export async function fetchCorporateActions(
  from: Date,
  to: Date,
): Promise<EventRecord[]> {
  const fromStr = toNseDateParam(from);
  const toStr = toNseDateParam(to);

  const path = `/api/corporates-corporateActions?index=equities&from_date=${fromStr}&to_date=${toStr}`;

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
 * Fetch both corporate actions and event calendar for a date range.
 * Deduplicates by symbol + eventType + eventDate.
 */
export async function fetchAllEvents(
  from: Date,
  to: Date,
): Promise<EventRecord[]> {
  const [actions, calendar] = await Promise.all([
    fetchCorporateActions(from, to),
    fetchEventCalendar(from, to),
  ]);

  const all = [...actions, ...calendar];

  // Deduplicate: prefer corporate actions over calendar for same event
  // Key: symbol|eventType|date
  const seen = new Map<string, EventRecord>();

  for (const event of all) {
    const key = `${event.symbol}|${event.eventType}|${event.eventDate.toISOString().split("T")[0]}`;
    if (!seen.has(key)) {
      seen.set(key, event);
    } else {
      // If we have a duplicate, prefer the one with more data (dividendAmount, exDate etc.)
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
