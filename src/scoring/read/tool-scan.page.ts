// File: src/scoring/read/tool-scan.page.ts
//
// THE pager for GET /api/stocks/scan — one scroll page of a research tool's landing scan.
//
// The ranking itself is built and held by tool-scan.cache.ts (it needs the whole scored
// universe before anything can be ordered). What happens HERE is per-request and cheap:
// resolve the cursor against that ranking and slice.
//
// ── WHY THE CURSOR CARRIES A SYMBOL, NOT AN OFFSET ─────────────────────────────────────
// A scan is ordered by a COMPARATOR (gap size / severity / flow tell), not by a column, so
// there is no natural sort key to page on — but there is a unique one: the symbol of the
// last card the reader actually saw. Naming that row means a ranking that rebuilt between
// pages still resumes at the right place, where a bare offset would silently repeat or skip
// whatever crossed the boundary.
//
// The row's index rides along as a FALLBACK, for the one case the symbol can't answer: a
// stock that left the scored universe between two pages. Then the index is all that is left
// of the reader's position, and resuming near it beats restarting at the top.
//
// ── ★ WHY THE FILTERS ARE APPLIED HERE AND NOT IN THE CLIENT ───────────────────────────
// The landing is infinite-scrolled: the client holds only the pages it has scrolled to. A
// client-side filter would therefore filter A PREFIX of the ranking, and a selective filter
// would show an empty grid while the matching cards sat unfetched on page 7 — with `total`
// and "showing all N" both lying. Filtering the RANKED ARRAY before the slice keeps every
// paging invariant true: `total` is the size of the filtered ranking, the cursor names a
// position inside it, and the scroll sentinel keeps pulling until that ranking is exhausted.
// It costs one predicate pass over ~560 cached rows per page request.

import { getToolScanRows, type ScanRow, type ScanToolId } from "./tool-scan.cache.js";
// THE band mapping — the single source for band → label → order (see composite/label.ts).
import { LABEL_BAND_MAP } from "../composite/label.js";

/** Cards per scroll page. The landing grid is 1 / 2 / 4 columns and 16 divides all three,
 *  so a page boundary always lands on a full row. */
export const SCAN_PAGE_SIZE = 16;

/** Upper bound on a caller-supplied page size — the whole scan is ~100 rows, so anything
 *  larger is just the un-paged read wearing a cursor. */
export const SCAN_MAX_LIMIT = 100;

/** One PAGE of one tool's scan. `total` is the whole ranking, not the page. */
export interface ToolScanPage {
  tool: ScanToolId;
  items: ScanRow[];
  total: number;
  cursor: string | null; // null once the scan is exhausted
  hasMore: boolean;
}

const encodeCursor = (symbol: string, index: number): string =>
  Buffer.from(`${symbol}|${index}`, "utf8").toString("base64url");

function decodeCursor(raw: string | undefined): { symbol: string; index: number } | null {
  if (!raw) return null;
  try {
    const [symbol, idx] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    const index = Number(idx);
    if (!symbol || !Number.isInteger(index) || index < 0) return null;
    return { symbol, index };
  } catch {
    return null;
  }
}

/**
 * The landing's reader-set filters. Both are OR within themselves and AND between:
 * "any of these ponds" AND "carrying any of these patterns". An empty/absent list is
 * NOT a filter — it means "don't narrow on this dimension" — so the unfiltered scan is
 * exactly the old behaviour.
 *
 * ⚠ Only the trajectory/divergence row shape carries `peerGroup` / `findings`. The ownership
 * scan is a different instrument (it ranks flow tells, not findings) and has neither, so a
 * filter aimed at it matches nothing rather than silently matching everything — an honest
 * empty, and the reason the predicate reads the fields optionally instead of casting.
 */
export interface ToolScanFilters {
  /** PeerGroup ids. */
  peerGroups?: string[];
  /**
   * The row's CATEGORICAL READING — finding keys on trajectory/divergence (`trajectory_B_T3…`),
   * and the TELL on ownership (`pledge_r1`, `distribution`, …).
   *
   * ⚠ ONE PARAM, TWO FIELDS, DELIBERATELY. Ownership fires no findings — it ranks shareholding
   * flow, not the findings engine — so it has no `findings` array to match. Giving it a separate
   * `tells=` param would mean a second filter dimension, a second facet list and a second code
   * path through the pager for a filter that behaves identically. What a reader picks is "the
   * reading on the card"; which field backs it is the tool's business, not the API's.
   */
  patterns?: string[];
  /** LabelBand keys (`pristine` … `fragile`). ⚠ The BAND, not a composite range — the band is
   *  the stored, provenance-stamped classification (composite/label.ts); re-deriving one from a
   *  min/max the caller supplies would be a second band mapping. */
  bands?: string[];
}

/** A row shape the filters can read. Every field optional — see the note on ToolScanFilters.
 *  `displayName` / `name` are the facet LABELS, read off the row so the options carry the same
 *  catalogue copy the cards do (this module resolves no copy of its own).
 *  `band` is the one field ALL THREE scan shapes carry, which is why it can be filtered on
 *  every tool where the other two dimensions are trajectory/divergence-only. */
type FilterableRow = {
  peerGroup?: { id: string; displayName?: string } | null;
  findings?: { key: string; name?: string }[];
  /** Ownership's categorical reading — the `patterns` dimension on that tool. */
  tell?: string;
  band?: string;
};

export const hasActiveFilters = (f: ToolScanFilters | undefined): boolean =>
  !!(f?.peerGroups?.length || f?.patterns?.length || f?.bands?.length);

/** The values a row offers to the `patterns` dimension — its findings, or (ownership) its tell.
 *  ONE definition, shared by the matcher and the facet tally, so what a reader can pick and what
 *  they get back are the same rule rather than two that agree today. */
const readingsOf = (r: FilterableRow): string[] =>
  r.findings ? r.findings.map((f) => f.key) : r.tell ? [r.tell] : [];

/**
 * The filter predicate, as a reusable closure. Built ONCE per request (the Sets would
 * otherwise be rebuilt per row), and shared with the facet builder so the counts a reader
 * sees and the rows they get back are produced by the same rule.
 */
export function scanRowMatcher(filters: ToolScanFilters = {}): (row: ScanRow) => boolean {
  const pgs = filters.peerGroups?.length ? new Set(filters.peerGroups) : null;
  const pats = filters.patterns?.length ? new Set(filters.patterns) : null;
  const bands = filters.bands?.length ? new Set(filters.bands) : null;
  if (!pgs && !pats && !bands) return () => true;

  return (row: ScanRow): boolean => {
    const r = row as FilterableRow;
    if (pgs && !(r.peerGroup && pgs.has(r.peerGroup.id))) return false;
    if (pats && !readingsOf(r).some((k) => pats.has(k))) return false;
    if (bands && !(r.band && bands.has(r.band))) return false;
    return true;
  };
}

export interface ToolScanPageOpts {
  limit?: number;
  /** Opaque cursor from the previous page. Omit for the first page. */
  cursor?: string;
  /** Reader-set narrowing. Applied to the RANKED array before the slice — see the header. */
  filters?: ToolScanFilters;
}

export async function buildToolScanPage(
  tool: ScanToolId,
  opts: ToolScanPageOpts = {},
): Promise<ToolScanPage> {
  const { limit = SCAN_PAGE_SIZE, cursor, filters } = opts;
  const all = await getToolScanRows(tool);
  // ⚠ `.filter()` COPIES — the cache's array is shared and must never be narrowed in place.
  //   Rank order survives the copy, which is what keeps the cursor meaningful.
  const rows = hasActiveFilters(filters) ? all.filter(scanRowMatcher(filters)) : all;

  // A malformed or unresolvable cursor serves the first page rather than an error — a stale
  // link should show the scan, not a 400.
  const after = decodeCursor(cursor);
  let start = 0;
  if (after) {
    const found = rows.findIndex((r) => r.symbol === after.symbol);
    start = (found >= 0 ? found : Math.min(after.index, rows.length)) + 1;
  }

  const items = rows.slice(start, start + limit);
  const end = start + items.length;
  const hasMore = end < rows.length;
  const last = items[items.length - 1];

  return {
    tool,
    items,
    total: rows.length,
    cursor: hasMore && last ? encodeCursor(last.symbol, end - 1) : null,
    hasMore,
  };
}

// ── THE FACETS — what the filter dropdowns are allowed to offer ────────────────────────
//
// Derived from the scan itself, never from the catalogue or the peer-group index: an option a
// reader can pick must be an option that returns cards. A pond with no scored member, or a
// pattern nothing fired this quarter, is not a filter — it is an empty result waiting to happen.
//
// ── ★ THE OPTION LIST IS STABLE; ONLY THE COUNTS MOVE ─────────────────────────────────────
// Options come from the WHOLE ranking, so nothing disappears out from under a reader mid-selection
// (a popover whose rows vanish as you tick them is unusable). The COUNT beside each option is
// cross-filtered — it is computed with the OTHER dimension's filter applied — so "T3 · 0" tells a
// reader, truthfully and in place, that no stock in the ponds they picked carries that pattern.

export interface ScanFacetOption {
  /** The value the client sends back in the filter (peer-group id / pattern key). */
  value: string;
  /** Reader-facing label — the pond's displayName, the finding's catalogue name. */
  label: string;
  /** Rows that would match if this option were added, given the OTHER dimension's filter. */
  count: number;
}

export interface ToolScanFacets {
  tool: ScanToolId;
  peerGroups: ScanFacetOption[];
  patterns: ScanFacetOption[];
  /** Condition bands, ordered BEST→WORST (the ladder a reader expects), never by count. */
  bands: ScanFacetOption[];
}

/** Count the values one dimension takes across `rows`, remembering each value's first label. */
function tally(
  rows: readonly ScanRow[],
  valuesOf: (row: FilterableRow) => { value: string; label: string }[],
): Map<string, ScanFacetOption> {
  const out = new Map<string, ScanFacetOption>();
  for (const row of rows) {
    // A row is counted at most ONCE per value — a stock in the same pond twice, or carrying the
    // same pattern key twice, is still one card in the grid.
    const seen = new Set<string>();
    for (const { value, label } of valuesOf(row as FilterableRow)) {
      if (seen.has(value)) continue;
      seen.add(value);
      const cur = out.get(value);
      if (cur) cur.count += 1;
      else out.set(value, { value, label, count: 1 });
    }
  }
  return out;
}

const pgValues = (r: FilterableRow) =>
  r.peerGroup ? [{ value: r.peerGroup.id, label: r.peerGroup.displayName ?? r.peerGroup.id }] : [];
/** ⚠ Labels the SAME values `readingsOf` matches — the findings' catalogue names, or the tell key
 *  (which the ownership client names from its own TELL_META, exactly as it labels its cards). */
const patternValues = (r: FilterableRow) =>
  r.findings
    ? r.findings.map((f) => ({ value: f.key, label: f.name ?? f.key }))
    : r.tell
      ? [{ value: r.tell, label: r.tell }]
      : [];
const bandValues = (r: FilterableRow) =>
  r.band ? [{ value: r.band, label: BAND_LABEL[r.band] ?? r.band }] : [];

/** Band → reader-facing word + ladder position, from THE band mapping (composite/label.ts). Not a
 *  second table: `label` and the order below are read off LABEL_BAND_MAP, so a re-band moves both. */
const BAND_LABEL: Record<string, string> = Object.fromEntries(
  LABEL_BAND_MAP.map((b) => [b.band, b.label]),
);
/** Best→worst — LABEL_BAND_MAP is ordered low→high, and a filter reads down from the top. */
const BAND_ORDER: string[] = LABEL_BAND_MAP.map((b) => b.band).reverse();

/**
 * The filter options for one tool's landing, with cross-filtered counts.
 * Reads the same cached ranking the pager reads — no extra database work.
 */
export async function buildToolScanFacets(
  tool: ScanToolId,
  filters: ToolScanFilters = {},
): Promise<ToolScanFacets> {
  const all = await getToolScanRows(tool);

  // ── Each dimension is counted against the ranking narrowed by every OTHER dimension ──
  // (i.e. its own selection is lifted, the rest still bite). With three dimensions this has to
  // be built by omission rather than by hand, or the next filter added silently stops
  // cross-filtering against the ones already here.
  const except = (skip: keyof ToolScanFilters): readonly ScanRow[] => {
    const rest: ToolScanFilters = { ...filters, [skip]: undefined };
    return hasActiveFilters(rest) ? all.filter(scanRowMatcher(rest)) : all;
  };

  const pgCounts = tally(except("peerGroups"), pgValues);
  const patCounts = tally(except("patterns"), patternValues);
  const bandCounts = tally(except("bands"), bandValues);

  // Options themselves span the WHOLE ranking; a value the cross-filter zeroed out still renders,
  // at 0, rather than vanishing. See the header.
  const merge = (
    universe: Map<string, ScanFacetOption>,
    counted: Map<string, ScanFacetOption>,
  ): ScanFacetOption[] =>
    [...universe.values()].map((o) => ({ ...o, count: counted.get(o.value)?.count ?? 0 }));

  return {
    tool,
    // Ponds read alphabetically — a reader looks one up by name, not by size.
    peerGroups: merge(tally(all, pgValues), pgCounts).sort((a, b) => a.label.localeCompare(b.label)),
    // Patterns lead with the most-present reading, then alphabetically.
    patterns: merge(tally(all, patternValues), patCounts).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    ),
    // ⚠ Bands sort by the LADDER, never by count — they are an ordered scale, and shuffling
    //   Steady above Pristine because more stocks sit there would misrepresent the scale itself.
    bands: merge(tally(all, bandValues), bandCounts).sort(
      (a, b) => BAND_ORDER.indexOf(a.value) - BAND_ORDER.indexOf(b.value),
    ),
  };
}
