// ═══════════════════════════════════════════════════════════════════════════
// SEARCHING THE CATALOGUE — the read that makes the ~19,000 non-equity instruments discoverable.
//
// Every other lookup in the API is equity-only (/api/stocks ships the 504-row universe) or
// key-first (/api/v1/mf/:schemeCode requires you to already know the code). A holding can now be a
// fund, a bond, a G-sec, an SGB, a REIT or an InvIT — and 17,567 of those funds have NO ticker at
// all — so manual entry needs a server-side search over the WHOLE spine, ranked, capped, paged.
//
// This is NOT a second resolution rule. `resolveInstrument` turns a string into EXACTLY ONE row or
// refuses; search returns a RANKED LIST. What the two share is the one normalization rule
// (`normalizeIdentifier`): ISIN/symbol are matched by upper-casing the input, names case-insensitively
// in SQL. Tiers 0 and 1 below are, by construction, resolveInstrument's two exact lookups (isin=Q,
// symbol=Q) — the same rule, surfaced as ranking rather than as a match-or-refuse.
//
// WHY RAW SQL. The ordering is a COMPUTED rank (which match tier a row falls in), and the pagination
// is KEYSET over that computed rank. Prisma's query builder cannot express either an ORDER BY over a
// CASE expression or a row-value keyset comparison against one, and offset paging drifts on an 19k
// catalogue. So the query is hand-written — the same tool holdings-controller/phs reach for when the
// shape outgrows the builder. It is fully parameterized ($1..$n); no value is interpolated.
// ═══════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { normalizeIdentifier } from "./resolve-instrument.js";

// ── The result row. DELIBERATELY a different projection from resolveInstrument's SELECT: search
//    needs `isActive` (so the client can mark a dormant row) and does NOT expose the internal `id`
//    or `stockId`. `assetClass` is the raw enum value (stock | etf | bond | gsec | sgb | mutual_fund
//    | reit | invit) so the client can label and group. ──
export interface InstrumentSearchResult {
  isin: string;
  symbol: string | null;
  name: string;
  assetClass: string;
  isActive: boolean;
}

export interface InstrumentSearchResponse {
  results: InstrumentSearchResult[];
  /** True when the catalogue holds more matches past this page. NEVER omitted: a truncated list that
   *  looks complete is a lie by omission — the client must be able to say "showing N of many". */
  hasMore: boolean;
  /** Opaque keyset cursor for the NEXT page, or null when this is the last page. */
  cursor: string | null;
}

/** A refusal the controller maps straight to HTTP — never a guess, never the whole catalogue. */
export class InstrumentSearchError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: "q_required" | "q_too_short" | "bad_cursor",
    message: string,
  ) {
    super(message);
    this.name = "InstrumentSearchError";
  }
}

// ── Knobs, reported and enforced server-side. ──
/** Minimum `q` length. Set to 3, the length at which the pg_trgm index actually accelerates a
 *  `name ILIKE '%q%'` scan (a trigram is 3 chars). Below it the contains-search degrades to a full
 *  scan of the ~19k catalogue on every keystroke — precisely the load the ask forbids. Exact ISIN
 *  (12 chars) and every real ticker clear 3 comfortably. */
export const SEARCH_MIN_Q_LENGTH = 3;
/** Default page size when the caller asks for none — a picker shows ~20. */
export const SEARCH_DEFAULT_LIMIT = 20;
/** Hard server-side ceiling, applied regardless of what `limit` is asked for. */
export const SEARCH_MAX_LIMIT = 50;

// ── The keyset cursor. Encodes the FULL sort key of the last row returned, so the next page is
//    "everything strictly after this key". isin is unique and the final key ⇒ a strict total order
//    ⇒ paging can neither skip a row nor return one twice. ──
interface Keyset {
  t: number; // tier
  a: number; // active_rank
  s: number; // symbol_rank
  n: string; // name
  i: string; // isin
}

function encodeCursor(k: Keyset): string {
  return Buffer.from(JSON.stringify(k), "utf8").toString("base64url");
}

function decodeCursor(raw: string): Keyset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new InstrumentSearchError(400, "bad_cursor", "The pagination cursor is malformed.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new InstrumentSearchError(400, "bad_cursor", "The pagination cursor is malformed.");
  }
  const { t, a, s, n, i } = parsed as Record<string, unknown>;
  if (
    typeof t !== "number" || typeof a !== "number" || typeof s !== "number" ||
    typeof n !== "string" || typeof i !== "string"
  ) {
    throw new InstrumentSearchError(400, "bad_cursor", "The pagination cursor is malformed.");
  }
  return { t, a, s, n, i };
}

/** Escape the LIKE metacharacters (`% _ \`) so a user typing "50%" searches for the literal, not a
 *  wildcard. Applied ONLY to the ILIKE patterns; the `=` comparisons take the raw normalized value. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return SEARCH_DEFAULT_LIMIT;
  return Math.min(SEARCH_MAX_LIMIT, Math.floor(raw));
}

interface RawRow {
  isin: string;
  symbol: string | null;
  name: string;
  assetClass: string;
  isActive: boolean;
  tier: number;
  active_rank: number;
  symbol_rank: number;
}

/**
 * Search the instrument catalogue by name / symbol / ISIN, ranked and keyset-paged.
 *
 * RANKING (composite, most-significant first):
 *   1. tier         — 0 exact ISIN, 1 exact symbol, 2 name-prefix, 3 name-contains
 *   2. active_rank  — 0 active, 1 inactive  (a dormant/matured/delisted row ranks BELOW a live one)
 *   3. symbol_rank  — 0 has a ticker, 1 ticker-less  (floats the singular tradable instruments above
 *                     the mass of fund share classes — the ONLY non-specced key, see the report; a
 *                     `q=hdfc` otherwise buries HDFCBANK under ~628 HDFC fund rows alphabetically)
 *   4. name ASC, isin ASC — a stable, deterministic total order (isin is unique)
 */
export async function searchInstruments(
  rawQ: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<InstrumentSearchResponse> {
  const q = normalizeIdentifier(rawQ);
  if (!q) {
    throw new InstrumentSearchError(400, "q_required", "q is required.");
  }
  if (q.length < SEARCH_MIN_Q_LENGTH) {
    throw new InstrumentSearchError(
      400,
      "q_too_short",
      `q must be at least ${SEARCH_MIN_Q_LENGTH} characters.`,
    );
  }

  const limit = clampLimit(opts.limit);
  const keyset = opts.cursor ? decodeCursor(opts.cursor) : null;

  const esc = escapeLike(q);
  const prefixPattern = `${esc}%`;
  const containsPattern = `%${esc}%`;

  // $1 = normalized q (exact isin/symbol), $2 = prefix pattern, $3 = contains pattern.
  const params: unknown[] = [q, prefixPattern, containsPattern];
  let cursorClause = "";
  if (keyset) {
    // Row-value keyset: everything strictly after the last row's full sort key.
    cursorClause =
      `WHERE (tier, active_rank, symbol_rank, name, isin) > ` +
      `($4::int, $5::int, $6::int, $7::text, $8::text)`;
    params.push(keyset.t, keyset.a, keyset.s, keyset.n, keyset.i);
  }
  const limitParam = `$${params.length + 1}`;
  params.push(limit + 1); // +1 to detect a further page without a second COUNT query.

  const sql = `
    WITH matches AS (
      SELECT
        isin, symbol, name, asset_class AS "assetClass", is_active AS "isActive",
        CASE
          WHEN isin = $1   THEN 0
          WHEN symbol = $1 THEN 1
          WHEN name ILIKE $2 THEN 2
          ELSE 3
        END AS tier,
        CASE WHEN is_active THEN 0 ELSE 1 END AS active_rank,
        CASE WHEN symbol IS NULL THEN 1 ELSE 0 END AS symbol_rank
      FROM instruments
      WHERE isin = $1 OR symbol = $1 OR name ILIKE $3
    )
    SELECT isin, symbol, name, "assetClass", "isActive", tier, active_rank, symbol_rank
    FROM matches
    ${cursorClause}
    ORDER BY tier, active_rank, symbol_rank, name, isin
    LIMIT ${limitParam}
  `;

  const rows = await prisma.$queryRawUnsafe<RawRow[]>(sql, ...params);

  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;

  const results: InstrumentSearchResult[] = kept.map((r) => ({
    isin: r.isin,
    symbol: r.symbol,
    name: r.name,
    assetClass: String(r.assetClass),
    isActive: Boolean(r.isActive),
  }));

  let cursor: string | null = null;
  if (hasMore && kept.length > 0) {
    const last = kept[kept.length - 1]!;
    cursor = encodeCursor({
      t: Number(last.tier),
      a: Number(last.active_rank),
      s: Number(last.symbol_rank),
      n: last.name,
      i: last.isin,
    });
  }

  return { results, hasMore, cursor };
}
