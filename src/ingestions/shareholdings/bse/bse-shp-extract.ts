// ─────────────────────────────────────────────────────────────────────────────
// BSE SHAREHOLDING — PURE EXTRACTOR.
//
// Turns the two BSE JSON payloads into the same shape the NSE XBRL parser
// produces, so both lanes write identical columns to `shareholding_patterns`.
// No I/O here: every function is pure and unit-testable against a saved payload.
//
//   CorporatesSHPSecuritybeta   → the A/B/C partition, share counts, pledge
//   Corp_shpSec_SHPPubShold_ng  → the public breakdown (FII / DII / MF / …)
//
// ═════════════════════════════════════════════════════════════════════════════
// ⚠️  THE PUBLIC-BREAKDOWN PAYLOAD HAS TWO INCOMPATIBLE FORMS, AND *BOTH*
//     IDENTIFIER COLUMNS LIE. THIS IS THE WHOLE REASON THIS FILE EXISTS.
// ═════════════════════════════════════════════════════════════════════════════
//
//                       COMBINED (older)              SPLIT (newer)
//   Institutions        ONE block                     split domestic / foreign
//   "Sub Total B1"      ALL institutions              DOMESTIC institutions only
//   "Sub Total B2"      Central Government            FOREIGN institutions
//   "Sub Total B3"      non-institutions              Governments
//   "Sub Total B4"      (absent)                      non-institutions
//   FII                 the B1e "FPI" line            "Sub Total B2"
//   DII                 SubTotalB1 − B1e              "Sub Total B1"  (direct)
//
// TRAP 1 — `Fld_Code` is not merely ABSENT on the newer subtotal rows, it is
//   STALE. The row whose Fld_Level reads "Sub Total B3" carries Fld_Code="STB2",
//   and "Sub Total B4" carries Fld_Code="STB3". So keying on Fld_Code==="STB2"
//   in the split form returns the GOVERNMENTS subtotal (RELIANCE Jun-2026: 0.10)
//   while you believe you are holding FOREIGN INSTITUTIONS (17.20). It is a
//   plausible-looking number, which makes it far more dangerous than a zero.
//
// TRAP 2 — keying on `Fld_Level` alone is ALSO wrong, because "Sub Total B2"
//   names Central Government in the combined form and Foreign Institutions in
//   the split form. The label is only meaningful once the form is known.
//
// THEREFORE: the form is DETECTED FROM PAYLOAD CONTENT (never inferred from the
// quarter id, which is a schedule, not a schema), and an undetectable payload
// yields null rather than a guess.
//
// The SECURITY payload does not share this problem — STA1A2 / STB1B2B3 / STABC
// are stable across both forms — so it is keyed on Fld_Code throughout.
// ─────────────────────────────────────────────────────────────────────────────
import { deriveOthersPct, round4 } from "../shareholding-derive.js";

export type BseVintage = "combined" | "split";

/** One row of either BSE table, normalised. */
export interface BseRow {
  code: string;
  /** Fld_Level, whitespace-collapsed and lower-cased (BSE pads: "Financial  Institutions"). */
  level: string;
  /** Non-empty ⇒ an individual holder line, not an aggregate. */
  holder: string;
  pct: number | null;
  /** Fld_TotalNoOfShares — fully paid + partly paid + DR. NOT what we store. */
  shares: number | null;
  /**
   * Fld_NoOfFullyPaidShares — THE count to store.
   *
   * The NSE lane extracts share counts with the XBRL keyword pair
   * ["fullypaid","equity"], i.e. FULLY PAID equity only. BSE's Fld_TotalNoOfShares
   * additionally includes partly-paid and depository-receipt shares, so the two
   * disagree for any company holding either — and both lanes write the SAME column.
   * Verified against NSE-stored rows:
   *   RELIANCE 2021-09-30  fullyPaid 6,143,162,660 = NSE exactly;
   *                        Fld_TotalNoOfShares 6,762,070,014 does not.
   *                        Promoter: 3,098,084,968 vs 3,323,114,981 — a 7% error
   *                        in the pledge-ratio denominator had we used the total.
   *   HDFCBANK 2021-09-30  fullyPaid 4,509,336,365 = NSE exactly; the total
   *                        (5,537,451,890) carries a 1.028bn ADR block.
   */
  fullyPaidShares: number | null;
  pledgedShares: number | null;
  pledgedPct: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const norm = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Map a raw BSE Table1 array (either endpoint) into BseRow[]. */
export function toRows(table1: unknown): BseRow[] {
  if (!Array.isArray(table1)) return [];
  return (table1 as Record<string, unknown>[]).map((r) => ({
    code: String(r.Fld_Code ?? "").trim(),
    // The security payload spells it FLD_LEVEL, the public one Fld_Level.
    level: norm(r.Fld_Level ?? r.FLD_LEVEL),
    holder: String(r.Fld_ShareHolderName ?? "").trim(),
    pct: num(r.Fld_TotalPercentageOf_A_B_C2),
    shares: num(r.Fld_TotalNoOfShares),
    fullyPaidShares: num(r.Fld_NoOfFullyPaidShares),
    pledgedShares: num(r.Fld_PledgeEncumberedNoOfShares),
    pledgedPct: num(r.Fld_PledgeEncumberedPercentage),
  }));
}

/** Aggregate rows only — an individual holder line is never a category total. */
const aggregates = (rows: BseRow[]): BseRow[] => rows.filter((r) => !r.holder);

/**
 * Pick the MAIN security's row when a code/level appears more than once.
 *
 * ⚠️ Some scrip codes carry MORE THAN ONE SHARE CLASS, and BSE returns a full set
 * of rows for each, interleaved, with the SMALLER class first. CUMMINSIND
 * 2020-06-30 returns two STA1A2 rows (1,817,340 shares @ 45.43% and 141,372,683
 * @ 51%), two STB1B2B3 rows, and two STABC rows (4,000,000 and 277,200,000).
 * A plain .find() takes the first — i.e. the 4m-share minor class — and writes a
 * completely different company-level picture: promoter 45.43 instead of 51.
 *
 * The cross-endpoint guard caught this one because the public endpoint reports
 * only the main class (49 vs 54.57), but that guard cannot be relied on to fire
 * for every such quarter, so the selection itself must be correct: take the row
 * with the LARGEST share count, which is the main listed equity. For the ordinary
 * single-row case this is identical to .find().
 *
 * The per-stock overlap gate is the backstop: share counts must match NSE, so a
 * wrong class choice cannot survive it.
 */
function largest(matches: BseRow[]): BseRow | undefined {
  if (matches.length <= 1) return matches[0];
  return matches.reduce((best, r) => {
    const a = r.fullyPaidShares ?? r.shares ?? -1;
    const b = best.fullyPaidShares ?? best.shares ?? -1;
    return a > b ? r : best;
  });
}
const byCode = (rows: BseRow[], code: string): BseRow | undefined =>
  largest(aggregates(rows).filter((r) => r.code === code));
const byLevel = (rows: BseRow[], level: string): BseRow | undefined =>
  largest(aggregates(rows).filter((r) => r.level === level));

// ── VINTAGE DETECTION ────────────────────────────────────────────────────────

/**
 * Decide the public-payload form from its CONTENT.
 *
 * Positive markers for SPLIT (either is sufficient, both are structural):
 *   · a "sub total b4" row — the combined form has no fourth subtotal at all
 *   · FPI broken into "…category i" / "…category ii" — the combined form has a
 *     single undivided "foreign portfolio investors" line
 * COMBINED requires the single undivided FPI line alongside a "sub total b1".
 * Anything else returns null so the caller refuses the quarter instead of
 * silently mapping a shape nobody has seen.
 */
export function detectVintage(pubRows: BseRow[]): BseVintage | null {
  const agg = aggregates(pubRows);
  const levels = new Set(agg.map((r) => r.level));

  // ── PRIMARY: the B grand-total row spells out its own arity. ──
  // Its Fld_Level reads "B=B1+B2+B3" in the combined form and "B=B1+B2+B3+B4" in
  // the split form. That row is the partition total, so unlike every leaf line it
  // is NEVER omitted — which matters, because BSE omits any row whose value is
  // zero. The previous detector keyed on the presence of a "foreign portfolio
  // investors" line and so returned null for CANFINHOME Sep-2021, a perfectly
  // ordinary combined-form filing that simply had no FPI holders that quarter.
  const total = agg.find((r) => r.code === "STB1B2B3");
  if (total) {
    const arity = total.level.replace(/\s+/g, "");
    if (arity === "b=b1+b2+b3+b4") return "split";
    if (arity === "b=b1+b2+b3") return "combined";
  }

  // ── FALLBACKS, only if that row is missing or relabelled. ──
  // Each is a STRUCTURAL marker unique to one form, never a leaf value that
  // could be omitted for being zero.
  if (levels.has("sub total b4")) return "split";
  if ([...levels].some((l) => l.startsWith("foreign portfolio investors category"))) return "split";
  // The split form renames the retail lines: "Resident Individuals holding
  // nominal share capital…" vs the combined form's "Individual share capital…".
  if ([...levels].some((l) => l.startsWith("resident individuals holding nominal share capital"))) return "split";
  if ([...levels].some((l) => l.startsWith("individual share capital"))) return "combined";
  if (levels.has("sub total b1") && levels.has("foreign portfolio investors")) return "combined";
  return null;
}

// ── PUBLIC BREAKDOWN ─────────────────────────────────────────────────────────

export interface BsePublicBreakdown {
  vintage: BseVintage;
  fiiPct: number | null;
  diiPct: number | null;
  mutualFundPct: number | null;
  insurancePct: number | null;
  banksFisPct: number | null;
  /** The B grand total, for cross-checking against the security payload. */
  publicTotalPct: number | null;
}

/**
 * DII sub-breakdown leaf lines, keyed on Fld_Level because it is populated and
 * semantically stable for LEAF categories in both forms — it is only the
 * SUBTOTAL labels that shift meaning. Matched exactly (post-normalisation), so
 * "banks" cannot also swallow "financial institutions/ banks".
 */
const MUTUAL_FUND_LEVELS = ["mutual funds/", "mutual funds"];
const INSURANCE_LEVELS = ["insurance companies"];
/** Combined form carries one merged line; split form separates them. Summing all
 *  three is safe precisely because no form contains more than one of the pair. */
const BANKS_FI_LEVELS = ["financial institutions/ banks", "banks", "other financial institutions"];
/**
 * FOREIGN Venture Capital Investors (SEBI Table III line B1d) — FOREIGN money that
 * the COMBINED form files INSIDE the single "Sub Total B1" institutions block.
 *
 * ⚠️ Deriving FII as the FPI line alone therefore leaves FVCI sitting in DII, and
 * the 2022+ SEBI form (and the NSE lane, which mirrors it) classifies FVCI under
 * FOREIGN institutions. The two lanes would then disagree on the same quarter.
 * Caught by the per-stock overlap gate on ASTERDM 2021-09-30, where NSE reported
 * fii 10.80 / dii 8.48 and this file first produced 8.20 / 11.08 — the totals
 * agreed (19.28) and only the split was wrong, which is precisely the kind of
 * error that survives a sanity check on sums.
 *   B1d foreign venture capital investors = 2.60
 *   B1e foreign portfolio investors       = 8.20  -> FII = 10.80, DII = 8.48
 * It is usually zero, which is what makes it easy to miss.
 *
 * The SPLIT form needs no equivalent: FVCI is already inside its "Sub Total B2"
 * foreign block, which is read directly.
 */
const FVCI_LEVELS = ["foreign venture capital investors"];

const firstLevel = (rows: BseRow[], levels: string[]): number | null => {
  for (const l of levels) {
    const r = byLevel(rows, l);
    if (r?.pct != null) return r.pct;
  }
  return null;
};
const sumLevels = (rows: BseRow[], levels: string[]): number | null => {
  const found = levels.map((l) => byLevel(rows, l)?.pct).filter((v): v is number => v != null);
  return found.length ? round4(found.reduce((s, v) => s + v, 0)) : null;
};

/**
 * A MISSING subtotal row is not the same as unknown data — BSE simply OMITS a
 * subtotal whose value is zero. AIIL Sep-2023 files "sub total b2" = 7.14 with no
 * "sub total b1" row at all, because it has no domestic institutional holders;
 * writing null there loses real information (a null DII and a 0 DII are different
 * facts to the Ownership pillar).
 *
 * But zero-filling blindly would turn a TRUNCATED payload into fabricated zeros.
 * So substitution is allowed only when the partition CLOSES: the subtotals that
 * ARE present, plus zero for the absent ones, must account for the published
 * public total. AIIL closes exactly (7.14 + 18.33 = 25.47 = B total), so its
 * missing B1 is provably zero. A payload that does not close keeps its nulls.
 */
const CLOSURE_TOL = 0.05;
function closes(present: number[], publicTotal: number | null): boolean {
  if (publicTotal === null) return false;
  const sum = present.reduce((a, b) => a + b, 0);
  return Math.abs(sum - publicTotal) <= CLOSURE_TOL;
}

export function extractPublicBreakdown(pubRows: BseRow[]): BsePublicBreakdown | null {
  const vintage = detectVintage(pubRows);
  if (vintage === null) return null;
  const publicTotalPct = byCode(pubRows, "STB1B2B3")?.pct ?? null;

  let fiiPct: number | null;
  let diiPct: number | null;

  if (vintage === "split") {
    // Both direct. See the trap notes: these MUST come from Fld_Level, because
    // the Fld_Code on these very rows is stale and points a subtotal too early.
    const b1 = byLevel(pubRows, "sub total b1")?.pct ?? null; // domestic institutions
    const b2 = byLevel(pubRows, "sub total b2")?.pct ?? null; // foreign institutions
    const b3 = byLevel(pubRows, "sub total b3")?.pct ?? null; // governments
    const b4 = byLevel(pubRows, "sub total b4")?.pct ?? null; // non-institutions
    const canZeroFill = closes([b1, b2, b3, b4].filter((v): v is number => v !== null), publicTotalPct);
    fiiPct = b2 ?? (canZeroFill ? 0 : null);
    diiPct = b1 ?? (canZeroFill ? 0 : null);
  } else {
    // Combined: ONE institutions block holding both domestic and foreign lines.
    // FII is FPI *plus* FVCI (see FVCI_LEVELS) — not FPI alone.
    const b1 = byLevel(pubRows, "sub total b1")?.pct ?? null; // ALL institutions
    const b2 = byLevel(pubRows, "sub total b2")?.pct ?? null; // governments
    const b3 = byLevel(pubRows, "sub total b3")?.pct ?? null; // non-institutions
    const canZeroFill = closes([b1, b2, b3].filter((v): v is number => v !== null), publicTotalPct);
    const instTotal = b1 ?? (canZeroFill ? 0 : null);
    const fpi = byLevel(pubRows, "foreign portfolio investors")?.pct ?? null;
    const fvci = firstLevel(pubRows, FVCI_LEVELS) ?? 0;
    // No FPI line at all AND the block closes ⇒ genuinely no foreign institutions.
    fiiPct = fpi !== null ? round4(fpi + fvci) : instTotal !== null && canZeroFill ? round4(fvci) : null;
    // A negative domestic residual means the total and its sub-lines disagree;
    // emit nothing rather than a fabricated number.
    diiPct =
      instTotal !== null && fiiPct !== null && instTotal - fiiPct >= -0.0001
        ? Math.max(round4(instTotal - fiiPct), 0)
        : null;
  }

  return {
    vintage,
    fiiPct,
    diiPct,
    mutualFundPct: firstLevel(pubRows, MUTUAL_FUND_LEVELS),
    insurancePct: firstLevel(pubRows, INSURANCE_LEVELS),
    banksFisPct: sumLevels(pubRows, BANKS_FI_LEVELS),
    publicTotalPct,
  };
}

// ── SECURITY PARTITION ───────────────────────────────────────────────────────

export interface BseSecurity {
  promoterPct: number | null;
  publicPct: number | null;
  employeeTrustPct: number;
  totalShares: number | null;
  promoterShares: number | null;
  pledgedShares: number | null;
  promoterPledgedPct: number | null;
}

export function extractSecurity(secRows: BseRow[]): BseSecurity {
  const prom = byCode(secRows, "STA1A2");
  const pub = byCode(secRows, "STB1B2B3");
  // Employee-benefit trust (C2). Absent in the newer payload, which simply omits
  // the row when it is zero — hence the 0 default rather than null.
  const emp = byCode(secRows, "STC2");
  const grand = byCode(secRows, "STABC");
  return {
    promoterPct: prom?.pct ?? null,
    publicPct: pub?.pct ?? null,
    employeeTrustPct: emp?.pct ?? 0,
    // FULLY PAID, not Fld_TotalNoOfShares — see the BseRow.fullyPaidShares note.
    // Taken off the STABC grand-total row rather than summed from A+B+C2, because
    // C1 can itself hold a few fully-paid shares (HDFCBANK Sep-2023: 129,919) and
    // NSE's stored total includes them.
    totalShares: grand?.fullyPaidShares ?? null,
    promoterShares: prom?.fullyPaidShares ?? null,
    pledgedShares: prom?.pledgedShares ?? null,
    promoterPledgedPct: prom?.pledgedPct ?? null,
  };
}

// ── COMBINED RESULT ──────────────────────────────────────────────────────────

/** Deliberately mirrors ParsedShareholding so both lanes write the same columns. */
export interface BseParsedShareholding {
  vintage: BseVintage;
  promoterPct: number;
  publicPct: number;
  employeeTrustPct: number;
  fiiPct: number | null;
  diiPct: number | null;
  retailPct: number | null;
  othersPct: number | null;
  mutualFundPct: number | null;
  insurancePct: number | null;
  banksFisPct: number | null;
  promoterPledgedPct: number | null;
  promoterPledgedSharesPct: number | null;
  totalShares: number | null;
  promoterShares: number | null;
  pledgedShares: number | null;
}

export type BseParseFailure =
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "zeroed" }
  | { ok: false; reason: "unknown_public_form" }
  | { ok: false; reason: "partition_missing" };
export type BseParseResult = { ok: true; value: BseParsedShareholding } | BseParseFailure;

/**
 * BSE answers HTTP 200 for a quarter it does not hold, with an empty or all-zero
 * body. That is NOT a company with no promoter — it is an absent quarter, and
 * writing it would fabricate a 0% promoter stake. A quarter counts as REAL only
 * with a positive share count AND a partition that actually partitions.
 */
export const PARTITION_FLOOR = 50;

export function parseBseShareholding(secRows: BseRow[], pubRows: BseRow[]): BseParseResult {
  if (!secRows.length) return { ok: false, reason: "empty" };

  const sec = extractSecurity(secRows);
  if (sec.promoterPct === null || sec.publicPct === null) return { ok: false, reason: "partition_missing" };
  if (!sec.totalShares || sec.totalShares <= 0) return { ok: false, reason: "zeroed" };
  if (sec.promoterPct + sec.publicPct < PARTITION_FLOOR) return { ok: false, reason: "zeroed" };

  const pub = extractPublicBreakdown(pubRows);
  if (pub === null) return { ok: false, reason: "unknown_public_form" };

  // others/retail is the residual, via the SAME pure function the NSE lane uses,
  // so a BSE-sourced row and an NSE-sourced row for adjacent quarters agree on
  // what the column means.
  const others = deriveOthersPct(sec.publicPct, pub.fiiPct, pub.diiPct);

  // % of TOTAL company shares pledged by promoters — derived from the counts,
  // which is also how computeOwnership reads pledge.
  const pledgedSharesPct =
    sec.pledgedShares !== null && sec.totalShares
      ? round4((sec.pledgedShares / sec.totalShares) * 100)
      : null;

  return {
    ok: true,
    value: {
      vintage: pub.vintage,
      promoterPct: round4(sec.promoterPct),
      publicPct: round4(sec.publicPct),
      employeeTrustPct: round4(sec.employeeTrustPct),
      fiiPct: pub.fiiPct,
      diiPct: pub.diiPct,
      retailPct: others,
      othersPct: others,
      mutualFundPct: pub.mutualFundPct,
      insurancePct: pub.insurancePct,
      banksFisPct: pub.banksFisPct,
      promoterPledgedPct: sec.promoterPledgedPct,
      promoterPledgedSharesPct: pledgedSharesPct,
      totalShares: sec.totalShares,
      promoterShares: sec.promoterShares,
      pledgedShares: sec.pledgedShares,
    },
  };
}

// ── QUARTER-ID ARITHMETIC ────────────────────────────────────────────────────
// BSE indexes quarters by a running id, not a date. 117 = Mar-2023, verified
// against fld_quartername in the quarter-info payload (130 = "June 2026").
export const QID_MAR2023 = 117;

/** qid → the quarter-end date it denotes, as an ISO string. */
export function qidToDate(qid: number): string {
  const off = qid - QID_MAR2023;
  const y = 2023 + Math.floor(off / 4);
  const q = ((off % 4) + 4) % 4;
  return `${y}-${["03-31", "06-30", "09-30", "12-31"][q]}`;
}

/** Inverse of qidToDate for a quarter-end ISO date. */
export function dateToQid(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return QID_MAR2023 + (y - 2023) * 4 + Math.floor((m - 1) / 3);
}

/** BSE wants the id as a 2-decimal string ("117.00"). */
export const qidParam = (qid: number): string => qid.toFixed(2);
