// ─────────────────────────────────────────────────────────────
// DISTRIBUTION YIELD (Step 14) — the thin tier's one number, and the one place it could lie.
//
// A REIT/InvIT does not pay a "dividend"; it makes a DISTRIBUTION, which is a blend of interest,
// dividend, repayment of SPV-level debt / capital, and other income. The market quotes these
// trusts on their trailing-12-month distribution yield:
//
//     yield = Σ (per-unit distributions with an ex-date in the last 12 months) / current price
//
// SOURCE: NSE /api/corporates-corporateActions — the SAME endpoint the corporate-events ingest
// already uses. Note that ingest keeps only `series === "EQ"` (events.ts:357), so today none of
// these records reach us; we read the endpoint directly rather than widen the equity events path.
//
// ══ THE TRAP, AND WHY THIS FILE IS SO CAREFUL ══
// The per-unit amount lives in a free-text `subject`, and it comes in TWO shapes:
//
//   (A) TOTAL-LED — the overwhelming majority:
//       "Distribution - Rs 6.50 Per Unit Consisting Of Re 0.14 Per Unit As Interest/
//        Rs 1.39 Per Unit As Dividend/ Rs 4.97 Per Unit As Repayment Of Spv Level Debt"
//       → the FIRST amount (6.50) is the TOTAL; the rest are its components.
//
//   (B) COMPONENTS-ONLY — no declared total (a real Embassy record from Aug-2023):
//       "Interst Amount - Re 0.69 Per Unit/Dividend - Rs 2.38 Per Unit/
//        Repayment Of Spv Level Debt - Rs 2.30 Per Unit/ Other Income - Re 0.01 Per Unit"
//       → the FIRST amount (0.69) is JUST THE INTEREST. The real total is 5.38.
//
// A naive "first Rs amount" regex reads shape (B) as 0.69 and understates the yield by ~8×. It
// would not crash. It would not look wrong. It would just quietly print a false number that a
// user might act on — the worst possible failure for this codebase.
//
// So: we extract ONLY the DECLARED TOTAL (shape A). We do NOT sum components to rescue shape B —
// the component labels are unbounded free text ("Other Income", "Principal Payment", "Capital
// Repayment", misspelled "Interst"), and a sum that misses one label is the same silent
// understatement wearing a cleverer hat.
//
// And a partial TTM window is itself a lie: if ANY record inside the 12-month window is
// unparseable, the SUM is not "mostly right", it is WRONG-AND-LOW. So one unparseable record
// inside the window poisons the whole instrument's yield → the yield goes honestly NULL and a
// validity fault is raised. Never a silently-understated yield. Never a fabricated one.
// ─────────────────────────────────────────────────────────────
import { nseClient } from "../../lib/client.js";

/** Raw record from /api/corporates-corporateActions (only the fields we read). */
interface CorpActionRaw {
  symbol?: string;
  series?: string;
  subject?: string;
  exDate?: string;
}

/** NSE ships dates as "30-Apr-2026". Local to this module — the events ingest's parser is not exported. */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function parseNseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2]!.toLowerCase());
  if (mon < 0) return null;
  const d = new Date(Date.UTC(Number(m[3]), mon, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Does this record describe a distribution at all? (Non-distribution corporate actions — an AGM,
 * a name change, a unit split — are legitimately not distributions and must NOT count as faults.)
 */
export function isDistribution(subject: string): boolean {
  return /distribution|dividend|interest|interst|repayment|capital|income/i.test(subject);
}

/** Why a subject's per-unit total was refused. Both refusals mean the SAME thing downstream:
 *  we do not know this record's total, so any TTM sum containing it is untrustworthy. */
export type AmountFailReason = "no_declared_total" | "total_disagrees_with_components";

export type AmountParse = { ok: true; perUnit: number } | { ok: false; reason: AmountFailReason };

const NUM = String.raw`([\d,]+(?:\.\d+)?)`;
/** The declared total: the word "Distribution", then the first amount. The currency token is
 *  OPTIONAL — a real record reads "Distribution - 3.04316 Consisting Of Interest Rs 3.04013 …". */
const TOTAL_RE = new RegExp(String.raw`distribution[^0-9]*?(?:(rs|re|₹)\.?\s*)?` + NUM, "i");
/** Every currency-tagged amount. Anchored on Rs/Re/₹ so a DATE ("30 June 2025") is never summed. */
const CURRENCY_RE = new RegExp(String.raw`(?:rs|re|₹)\.?\s*` + NUM, "gi");

const toNum = (s: string) => Number.parseFloat(s.replace(/,/g, ""));

/**
 * Extract the DECLARED TOTAL per-unit amount — and then PROVE it is a total, not a component.
 *
 * Two things had to be true, and only checking the first is how you ship a quiet lie:
 *
 *   1. The subject must be TOTAL-LED (anchored on the word "Distribution"). A components-only
 *      subject has no anchor and is refused outright — that is the ₹0.69-instead-of-₹5.38 case.
 *
 *   2. The number we read must AGREE WITH ITS OWN COMPONENTS. Every real record itemises the
 *      total ("Rs 6.50 … Consisting Of Re 0.14 As Interest / Rs 1.39 As Dividend / Rs 4.97 As
 *      Repayment"), so the components are a FREE CHECKSUM on the total: 0.14+1.39+4.97 = 6.50.
 *      If NSE ever writes "Distribution - Interest Rs 2.5 Per Unit / Dividend Rs 1.0" — total-led
 *      in shape, but the first number is the INTEREST — the checksum catches it (2.5 vs 1.0) and
 *      we refuse, where a shape-only check would have happily published 2.5 as the total.
 *
 * When a subject itemises nothing, there is no checksum to run and the declared total stands.
 */
export function parseDeclaredTotal(subject: string): AmountParse {
  const m = subject.match(TOTAL_RE);
  if (!m) return { ok: false, reason: "no_declared_total" };

  const total = toNum(m[2]!);
  if (!Number.isFinite(total) || total <= 0) return { ok: false, reason: "no_declared_total" };

  const currency = [...subject.matchAll(CURRENCY_RE)].map((c) => toNum(c[1]!)).filter(Number.isFinite);
  // If the total itself carried a currency token, it IS the first of these — drop it, so what is
  // left is exactly the component list.
  const components = m[1] ? currency.slice(1) : currency;

  if (components.length === 0) return { ok: true, perUnit: total }; // nothing itemised → no checksum

  const sum = components.reduce((s, v) => s + v, 0);
  // 2% (floor 1 paisa) absorbs the rounding NSE does when it itemises to 4dp against a 2dp total.
  const tolerance = Math.max(total * 0.02, 0.01);
  if (Math.abs(total - sum) > tolerance) {
    return { ok: false, reason: "total_disagrees_with_components" };
  }

  return { ok: true, perUnit: total };
}

export interface DistributionRecord {
  exDate: Date;
  perUnit: number;
  subject: string;
}

export interface OffendingRecord {
  exDate: string;
  subject: string;
  /** WHICH check refused it — "no total declared" vs "the total contradicts its own components". */
  why: AmountFailReason;
}

export type TtmDistribution =
  /** A trustworthy TTM sum: every in-window record parsed. */
  | { ok: true; perUnitTtm: number; records: DistributionRecord[] }
  /** At least one in-window record we could not read → the SUM is untrustworthy. Yield = NULL. */
  | { ok: false; reason: "unparseable_record"; offending: OffendingRecord[] }
  /** No distributions in the window at all. NOT a fault — a newly-listed trust genuinely has none. */
  | { ok: false; reason: "no_distributions_in_window"; offending: [] };

/**
 * Fold a symbol's corporate-action history into a trailing-12-month per-unit distribution total.
 *
 * `asOf` is passed in (never Date.now() inside the fold) so a re-run over the same day is
 * deterministic and the verifier can pin a window.
 */
export function foldTtm(raw: CorpActionRaw[], asOf: Date): TtmDistribution {
  const windowStart = new Date(asOf);
  windowStart.setUTCFullYear(windowStart.getUTCFullYear() - 1);

  const records: DistributionRecord[] = [];
  const offending: OffendingRecord[] = [];

  for (const r of raw) {
    const subject = (r.subject ?? "").trim();
    if (!subject || !isDistribution(subject)) continue; // not a distribution — not a fault

    const exDate = parseNseDate(r.exDate);
    if (!exDate) continue; // no ex-date → cannot be placed in a window; not in-window by definition

    // Strictly the trailing 12 months, ex-date inclusive of today, exclusive of a year ago.
    if (exDate <= windowStart || exDate > asOf) continue;

    const amt = parseDeclaredTotal(subject);
    if (!amt.ok) {
      // IN-WINDOW and UNREADABLE. This is the poisoning case — see the header.
      offending.push({ exDate: r.exDate ?? "?", subject, why: amt.reason });
      continue;
    }
    records.push({ exDate, perUnit: amt.perUnit, subject });
  }

  if (offending.length > 0) return { ok: false, reason: "unparseable_record", offending };
  if (records.length === 0) return { ok: false, reason: "no_distributions_in_window", offending: [] };

  const perUnitTtm = records.reduce((s, r) => s + r.perUnit, 0);
  return { ok: true, perUnitTtm: Math.round(perUnitTtm * 1e6) / 1e6, records };
}

/** Fetch one trust's corporate actions. Throws on a network/parse failure — the caller degrades. */
export async function fetchCorporateActions(symbol: string): Promise<CorpActionRaw[]> {
  const path = `/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`;
  const data = await nseClient.get<CorpActionRaw[]>(path);
  return Array.isArray(data) ? data : [];
}
