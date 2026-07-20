// ═══════════════════════════════════════════════════════════════════════════
// NAMING AN INSTRUMENT — the one place a user's string becomes a catalogue row.
//
// Before Step 20 this was `prisma.stock.findUnique({ where: { symbol } })`, and that was adequate
// because a holding could only ever BE a stock. It is not adequate now, and the reason is in the data:
//
//     mutual_fund   17,567 rows   symbol:     0   ← A FUND HAS NO TICKER. AT ALL.
//     etf              337 rows   symbol:   327   ← 10 have none (BSE-listed / matured)
//     bond             356 rows   symbol:   356   ← …but "IMC1" names THREE OF THEM
//     stock            504 rows   symbol:   504
//
// So `symbol` is not a key. It is absent for 17,567 instruments and AMBIGUOUS for at least three.
// `isin` is the key: it is @unique, it is the catalogue's dedup spine, and it is present on every
// single row. That is why it is the primary address here and symbol is only a convenience.
//
// ⚠️  AMBIGUITY IS REFUSED, NEVER RESOLVED BY PREFERENCE. Three active bonds share the symbol "IMC1".
//     There is a tempting tie-break for every one of them — pick the most recently issued, pick the
//     one with a price, pick the first by id — and every one of those would silently attach a user's
//     real money to a bond they did not choose. We return 409 and the candidate ISINs, and let them
//     say which. A holding is not a search result.
//
// EQUITY IS BYTE-IDENTICAL THROUGH THIS PATH: no stock symbol collides with any non-stock symbol
// (verified across the live catalogue), and every stock has exactly one instrument, so a symbol that
// resolved to a stock before resolves to that same stock's instrument now.
// ═══════════════════════════════════════════════════════════════════════════
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;

export interface ResolvedInstrument {
  id: string;
  isin: string;
  symbol: string | null;
  name: string;
  assetClass: string;
  /** NULL for every non-stock instrument — a bond has no row in `stocks`. */
  stockId: string | null;
  /** (T-1) `instruments.attributes` verbatim — carries `couponNullReason`, which separates a
   *  coupon-paying G-Sec from a discount T-bill. `disclosuresFor` reads it so /me/holdings and the
   *  transaction confirmation stop stamping "coupon income not tracked" on a bill that has no coupon. */
  attributes: unknown;
}

/** A refusal the controller maps straight to HTTP. Never a guess. */
export class InstrumentResolveError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: "instrument_not_found" | "ambiguous_symbol",
    message: string,
    /** On an ambiguity: the ISINs the caller must choose between. */
    public readonly candidates?: { isin: string; name: string; assetClass: string }[],
  ) {
    super(message);
    this.name = "InstrumentResolveError";
  }
}

const SELECT = {
  id: true, isin: true, symbol: true, name: true, assetClass: true, stockId: true, attributes: true,
} as const;

/** An ISIN is 12 chars: 2-letter country + 9 alphanumeric + 1 check digit. Shape-tested, not
 *  checksum-validated — we look it up, and the catalogue is the authority on whether it exists.
 *  Exported so the catalogue SEARCH shares this one shape rule instead of re-deriving it. */
export const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** The ONE normalization every catalogue lookup uppercases through: ISIN and symbol are matched
 *  case-insensitively by upper-casing the input (names are matched case-insensitively in SQL).
 *  Shared with the search so resolve and search can never disagree on how a string is normalized. */
export function normalizeIdentifier(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Resolve a user-supplied identifier to exactly ONE catalogue instrument, or refuse.
 *
 * Accepts an ISIN (unambiguous, works for every asset class) or a SYMBOL (a convenience that cannot
 * address funds and may be ambiguous). Inactive rows are excluded: a delisted instrument is not
 * something new money should be able to enter against.
 */
export async function resolveInstrument(
  db: Db,
  identifier: string,
): Promise<ResolvedInstrument> {
  const raw = normalizeIdentifier(identifier);
  if (!raw) {
    throw new InstrumentResolveError(400, "instrument_not_found", "No symbol or ISIN was given.");
  }

  // ── ISIN: the unambiguous address. Every instrument has one and it is @unique. ──
  if (ISIN_SHAPE.test(raw)) {
    const byIsin = await db.instrument.findUnique({ where: { isin: raw }, select: SELECT });
    if (!byIsin) {
      throw new InstrumentResolveError(400, "instrument_not_found", `${raw} is not in our catalogue.`);
    }
    return byIsin as ResolvedInstrument;
  }

  // ── SYMBOL: the convenience. May match none, one, or SEVERAL. ──
  const bySymbol = await db.instrument.findMany({
    where: { symbol: raw, isActive: true },
    select: SELECT,
    orderBy: { isin: "asc" }, // deterministic ORDER for the error payload — NOT a tie-break
  });

  if (bySymbol.length === 0) {
    throw new InstrumentResolveError(
      400,
      "instrument_not_found",
      `${raw} is not in our catalogue. If this is a mutual fund, use its ISIN — funds have no ticker.`,
    );
  }

  if (bySymbol.length > 1) {
    // WE DO NOT PICK. Three bonds share "IMC1"; choosing one for the user would attach their money
    // to an instrument they did not name, and they would have no way to see that it happened.
    throw new InstrumentResolveError(
      409,
      "ambiguous_symbol",
      `${raw} names ${bySymbol.length} different instruments. Enter the ISIN of the one you hold.`,
      bySymbol.map((i) => ({ isin: i.isin, name: i.name, assetClass: i.assetClass as string })),
    );
  }

  return bySymbol[0] as ResolvedInstrument;
}
