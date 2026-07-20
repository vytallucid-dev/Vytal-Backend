// ═══════════════════════════════════════════════════════════════════════════
// FUND DISCOVERY — GET /api/v1/funds. A filterable CATALOGUE, never a leaderboard.
//
// Grain: FAMILIES (3,823 of them), not schemes (14,041). A family's members have DIFFERENT
// returns — Direct/Regular differ by expense ratio — so every row must state WHOSE numbers it
// shows. That choice is `resolveRepresentative` (mf-representative.ts), the SAME function
// GET /mf/:schemeCode/family calls: one rule, one home, so a fund can never read one return in
// the list and a different one when opened.
//
// ── WHY AN IN-PROCESS CACHE, NOT A LIVE QUERY PER REQUEST ──
// Measured live (this DB, this connection): joining mf_family_members × mf_families ×
// instruments × mf_analytics for the WHOLE catalogue and shipping it over the wire costs
// 0.7–2.7s wall-clock, even warm — dominated by transferring ~14,041 wide rows, not by the
// query itself (Postgres's own EXPLAIN ANALYZE reports ~54ms server-side once warm). A
// per-request browse endpoint cannot pay that. Representative resolution and category
// normalisation are also plain functions of this data (`resolveRepresentative`,
// `normaliseCategory`) that do not belong re-derived in SQL — that would be a SECOND
// implementation of the one rule this build exists to consolidate.
//
// So: fetch once, resolve once, cache the ~3,823 resolved FamilyRows in memory, and serve every
// filter/sort/facet/paginate operation as pure JS over that array — sub-millisecond at this size.
// STALE-WHILE-REVALIDATE: a request against a cache older than STALE_AFTER_MS still gets served
// instantly from the old array while a rebuild kicks off in the background, so steady-state
// traffic never blocks on the ~1–2s rebuild — only the very first request after a cold start does.
// Nothing here is a NAV series or persisted anywhere; it evaporates on process restart, rebuilt
// from mf_families/mf_family_members/instruments/mf_analytics, which is the nightly-refreshed
// source of truth throughout.
// ═══════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { classifyPlanOption, type PlanTier } from "../ingestions/amfi/mf-distributions.js";
export type { PlanTier };
import { normaliseCategory } from "../ingestions/amfi/mf-category.js";
import { resolveRepresentative, type RepresentativeCandidate } from "../ingestions/amfi/mf-representative.js";

export type PlanOptionLabel = "growth" | "bonus" | "idcw";
export type AssetClassFilter = "mutual_fund" | "etf";
export type SortKey = "name" | "ret1y" | "ret3y" | "ret5y";

export class FundsQueryError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: "bad_cursor" | "bad_sort" | "bad_asset_class" | "bad_plan",
    message: string,
  ) {
    super(message);
    this.name = "FundsQueryError";
  }
}

interface PlanRef {
  tier: PlanTier;
  optionLabel: PlanOptionLabel;
}

export interface FamilyRow {
  familyId: string;
  canonicalName: string;
  fundHouse: string;
  assetClass: AssetClassFilter;
  /** Normalised leaf (never the raw AMFI wrapper string) — of the REPRESENTATIVE member. */
  categoryLeaf: string | null;
  representativeSchemeCode: string;
  representativePlan: PlanRef;
  returns: { ret1y: number | null; ret3y: number | null; ret5y: number | null };
  /** Present only for a null horizon — the omission code, same vocabulary as /analytics. */
  returnOmissions: { ret1y?: string; ret3y?: string; ret5y?: string };
  currentNav: number | null;
  /** 44.8% of schemes carry a stale NAV — never render one without this. */
  navDate: string | null;
  schemeCount: number;
  availablePlans: PlanRef[];
  isDormant: boolean;
  /** The representative has no total-return series at all (Step 19). Row still ships — a fund
   *  we can't measure still exists and must still be findable, never dropped from the list. */
  declined: boolean;
  declinedReason?: string;
}

// ── module-level cache ──────────────────────────────────────────────────────
const REFRESH_AFTER_MS = 5 * 60 * 1000; // serve-stale-and-revalidate boundary
let cache: { rows: FamilyRow[]; builtAt: number } | null = null;
let rebuildInFlight: Promise<FamilyRow[]> | null = null;

interface RawRow {
  scheme_code: string;
  family_id: string;
  plan_option: string | null;
  scheme_name: string;
  canonical_name: string;
  fund_house: string;
  family_asset_class: string;
  scheme_count: number;
  category: string | null;
  current_nav: string | null;
  nav_date: Date | null;
  is_active: boolean | null;
  series_scheme_code: string | null;
  ret_1y: number | null;
  ret_3y: number | null;
  ret_5y: number | null;
  omissions: Record<string, string> | null;
}

async function fetchRawRows(): Promise<RawRow[]> {
  return prisma.$queryRawUnsafe<RawRow[]>(`
    SELECT
      fm.scheme_code, fm.family_id, fm.plan_option, fm.scheme_name,
      f.canonical_name, f.fund_house, f.asset_class::text AS family_asset_class, f.scheme_count,
      i.category, i.current_nav::text AS current_nav, i.nav_date, i.is_active,
      a.series_scheme_code,
      a.ret_1y::float8 AS ret_1y, a.ret_3y_cagr::float8 AS ret_3y, a.ret_5y_cagr::float8 AS ret_5y,
      a.omissions
    FROM mf_family_members fm
    JOIN mf_families f ON f.id = fm.family_id AND f.ungrouped_reason IS NULL
    LEFT JOIN LATERAL (
      SELECT category, current_nav, nav_date, is_active
      FROM instruments i2
      WHERE i2.amfi_scheme_code = fm.scheme_code AND i2.asset_class IN ('mutual_fund', 'etf')
      LIMIT 1
    ) i ON true
    LEFT JOIN mf_analytics a ON a.scheme_code = fm.scheme_code
  `);
}

function planRefOf(tier: PlanTier, optionLabel: PlanOptionLabel): PlanRef {
  return { tier, optionLabel };
}
function planKey(p: PlanRef): string {
  return `${p.tier}|${p.optionLabel}`;
}

interface MemberInternal extends RepresentativeCandidate {
  plan: PlanRef;
  category: string | null;
  currentNav: string | null;
  navDate: Date | null;
  isActive: boolean;
  ret1y: number | null;
  ret3y: number | null;
  ret5y: number | null;
  omissions: Record<string, string> | null;
}

async function buildRows(): Promise<FamilyRow[]> {
  const raw = await fetchRawRows();

  const byFamily = new Map<
    string,
    { canonicalName: string; fundHouse: string; assetClass: string; schemeCount: number; members: MemberInternal[] }
  >();

  for (const r of raw) {
    const source = r.plan_option || r.scheme_name; // same fallback as loadPlanMap / getFundFamily
    const { tier, isGrowth } = classifyPlanOption(source);
    const optionLabel: PlanOptionLabel = isGrowth ? "growth" : /\bbonus\b/i.test(source) ? "bonus" : "idcw";

    const member: MemberInternal = {
      schemeCode: r.scheme_code,
      tier,
      optionLabel,
      measurable: r.series_scheme_code !== null,
      plan: planRefOf(tier, optionLabel),
      category: r.category,
      currentNav: r.current_nav,
      navDate: r.nav_date,
      isActive: r.is_active ?? false,
      ret1y: r.ret_1y,
      ret3y: r.ret_3y,
      ret5y: r.ret_5y,
      omissions: r.omissions,
    };

    let fam = byFamily.get(r.family_id);
    if (!fam) {
      fam = {
        canonicalName: r.canonical_name,
        fundHouse: r.fund_house,
        assetClass: r.family_asset_class,
        schemeCount: r.scheme_count,
        members: [],
      };
      byFamily.set(r.family_id, fam);
    }
    fam.members.push(member);
  }

  const rows: FamilyRow[] = [];
  for (const [familyId, fam] of byFamily) {
    const rep = resolveRepresentative(fam.members);
    if (!rep) continue; // cannot occur — every family has ≥1 member by construction

    const declined = !rep.measurable;
    const om = rep.omissions ?? {};
    const declinedReason = declined ? (om.ret_1y ?? "idcw_nav_not_total_return") : undefined;

    const availablePlans: PlanRef[] = [];
    const seen = new Set<string>();
    for (const m of fam.members) {
      const k = planKey(m.plan);
      if (!seen.has(k)) {
        seen.add(k);
        availablePlans.push(m.plan);
      }
    }

    rows.push({
      familyId,
      canonicalName: fam.canonicalName,
      fundHouse: fam.fundHouse,
      assetClass: fam.assetClass as AssetClassFilter,
      categoryLeaf: normaliseCategory(rep.category),
      representativeSchemeCode: rep.schemeCode,
      representativePlan: rep.plan,
      returns: { ret1y: rep.ret1y, ret3y: rep.ret3y, ret5y: rep.ret5y },
      returnOmissions: {
        ...(rep.ret1y === null ? { ret1y: om.ret_1y } : {}),
        ...(rep.ret3y === null ? { ret3y: om.ret_3y_cagr } : {}),
        ...(rep.ret5y === null ? { ret5y: om.ret_5y_cagr } : {}),
      },
      currentNav: rep.currentNav !== null ? Number(rep.currentNav) : null,
      navDate: rep.navDate ? rep.navDate.toISOString().slice(0, 10) : null,
      schemeCount: fam.schemeCount,
      availablePlans,
      isDormant: !rep.isActive,
      declined,
      ...(declinedReason ? { declinedReason } : {}),
    });
  }
  return rows;
}

async function getRows(): Promise<FamilyRow[]> {
  const now = Date.now();
  if (!cache) {
    // cold start — nothing to serve stale, must wait
    const rows = await buildRows();
    cache = { rows, builtAt: now };
    return rows;
  }
  if (now - cache.builtAt > REFRESH_AFTER_MS && !rebuildInFlight) {
    // stale-while-revalidate: kick off a background rebuild, serve the old array NOW
    rebuildInFlight = buildRows()
      .then((rows) => {
        cache = { rows, builtAt: Date.now() };
        return rows;
      })
      .finally(() => {
        rebuildInFlight = null;
      });
    rebuildInFlight.catch(() => {
      /* a failed background rebuild keeps serving the last good cache — logged by the caller */
    });
  }
  return cache.rows;
}

// ── query params ─────────────────────────────────────────────────────────────
export interface FundsQuery {
  q?: string;
  assetClass?: AssetClassFilter;
  category?: string[];
  fundHouse?: string[];
  plan?: PlanTier;
  includeDormant?: boolean;
  sort?: SortKey;
  cursor?: string;
  limit?: number;
}

export const FUNDS_DEFAULT_LIMIT = 24;
export const FUNDS_MAX_LIMIT = 100;

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return FUNDS_DEFAULT_LIMIT;
  return Math.min(FUNDS_MAX_LIMIT, Math.floor(raw));
}

export interface Facet {
  value: string;
  count: number;
}
export interface FundsResponse {
  results: FamilyRow[];
  facets: { category: Facet[]; fundHouse: Facet[]; assetClass: Facet[] };
  total: number;
  hasMore: boolean;
  cursor: string | null;
  /** How many rows in the CURRENT result set have no value for the chosen sort key. Never hidden —
   *  a sorted list that silently omits its uncovered rows is the coverage lie again, just moved
   *  from the return column to the sort order. */
  nullSortCount: number;
}

// ── cursor: encodes the row's rank tuple under the requested sort, + familyId as the unique,
//    always-present tiebreaker — a strict total order, so paging can neither skip a row nor
//    return one twice, matching the keyset discipline instruments/search already established. ──
interface Cursor {
  sort: SortKey;
  rank: number; // 0 = has a value, 1 = null (nulls-last)
  v: number | string; // name: lowercased string : numeric return, NEGATED so ASC compare = DESC by value
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
function decodeCursor(raw: string, sort: SortKey): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new FundsQueryError(400, "bad_cursor", "The pagination cursor is malformed.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new FundsQueryError(400, "bad_cursor", "The pagination cursor is malformed.");
  }
  const { sort: s, rank, v, id } = parsed as Record<string, unknown>;
  if (
    s !== sort || typeof rank !== "number" ||
    (typeof v !== "number" && typeof v !== "string") || typeof id !== "string"
  ) {
    throw new FundsQueryError(400, "bad_cursor", "The pagination cursor does not match the current sort.");
  }
  return { sort, rank, v, id } as Cursor;
}

function rankOf(row: FamilyRow, sort: SortKey): Cursor {
  if (sort === "name") {
    return { sort, rank: 0, v: row.canonicalName.toLowerCase(), id: row.familyId };
  }
  const val = row.returns[sort];
  return { sort, rank: val === null ? 1 : 0, v: val === null ? 0 : -val, id: row.familyId };
}

function compareRank(a: Cursor, b: Cursor): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.v !== b.v) return a.v < b.v ? -1 : 1; // same call site ⇒ same type (both string or both number)
  return a.id.localeCompare(b.id);
}

const VALID_SORTS: SortKey[] = ["name", "ret1y", "ret3y", "ret5y"];
const VALID_TIERS: PlanTier[] = ["direct", "regular"];
const VALID_ASSET_CLASSES: AssetClassFilter[] = ["mutual_fund", "etf"];

export async function browseFunds(query: FundsQuery): Promise<FundsResponse> {
  const sort: SortKey = query.sort ?? "name";
  if (!VALID_SORTS.includes(sort)) {
    throw new FundsQueryError(400, "bad_sort", `sort must be one of ${VALID_SORTS.join(", ")}.`);
  }
  if (query.assetClass && !VALID_ASSET_CLASSES.includes(query.assetClass)) {
    throw new FundsQueryError(400, "bad_asset_class", `assetClass must be one of ${VALID_ASSET_CLASSES.join(", ")}.`);
  }
  if (query.plan && !VALID_TIERS.includes(query.plan)) {
    throw new FundsQueryError(400, "bad_plan", `plan must be one of ${VALID_TIERS.join(", ")}.`);
  }
  const limit = clampLimit(query.limit);
  const cursor = query.cursor ? decodeCursor(query.cursor, sort) : null;

  const all = await getRows();

  const q = query.q?.trim().toLowerCase();
  const categorySet = query.category?.length ? new Set(query.category) : null;
  const fundHouseSet = query.fundHouse?.length ? new Set(query.fundHouse) : null;
  const includeDormant = query.includeDormant ?? false;

  // Every predicate is named so facets can drop exactly one and reuse the rest — see below.
  const matchesQ = (r: FamilyRow) =>
    !q || r.canonicalName.toLowerCase().includes(q) || r.fundHouse.toLowerCase().includes(q);
  const matchesAssetClass = (r: FamilyRow) => !query.assetClass || r.assetClass === query.assetClass;
  const matchesCategory = (r: FamilyRow) => !categorySet || (r.categoryLeaf !== null && categorySet.has(r.categoryLeaf));
  const matchesFundHouse = (r: FamilyRow) => !fundHouseSet || fundHouseSet.has(r.fundHouse);
  const matchesPlan = (r: FamilyRow) => !query.plan || r.availablePlans.some((p) => p.tier === query.plan);
  const matchesDormant = (r: FamilyRow) => includeDormant || !r.isDormant;

  const filtered = all.filter(
    (r) => matchesQ(r) && matchesAssetClass(r) && matchesCategory(r) && matchesFundHouse(r) && matchesPlan(r) && matchesDormant(r),
  );

  // ── facets reflect the OTHER active filters, never the whole catalogue and never the facet's
  //    own filter (a facet counting only itself would just echo the current selection back). ──
  function facetCounts(dropCategory: boolean, dropFundHouse: boolean, dropAssetClass: boolean): (r: FamilyRow) => boolean {
    return (r: FamilyRow) =>
      matchesQ(r) && matchesDormant(r) && matchesPlan(r) &&
      (dropAssetClass || matchesAssetClass(r)) &&
      (dropCategory || matchesCategory(r)) &&
      (dropFundHouse || matchesFundHouse(r));
  }
  function countBy(rows: FamilyRow[], key: (r: FamilyRow) => string | null): Facet[] {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = key(r);
      if (v === null) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }
  const facets = {
    category: countBy(all.filter(facetCounts(true, false, false)), (r) => r.categoryLeaf),
    fundHouse: countBy(all.filter(facetCounts(false, true, false)), (r) => r.fundHouse),
    assetClass: countBy(all.filter(facetCounts(false, false, true)), (r) => r.assetClass),
  };

  const sorted = [...filtered].sort((a, b) => compareRank(rankOf(a, sort), rankOf(b, sort)));
  const nullSortCount = sort === "name" ? 0 : sorted.filter((r) => r.returns[sort] === null).length;

  let startIdx = 0;
  if (cursor) {
    startIdx = sorted.findIndex((r) => compareRank(rankOf(r, sort), cursor) > 0);
    if (startIdx === -1) startIdx = sorted.length;
  }
  const page = sorted.slice(startIdx, startIdx + limit);
  const hasMore = startIdx + limit < sorted.length;
  const nextCursor = hasMore && page.length > 0 ? encodeCursor(rankOf(page[page.length - 1]!, sort)) : null;

  return {
    results: page,
    facets,
    total: sorted.length,
    hasMore,
    cursor: nextCursor,
    nullSortCount,
  };
}

/** Test-only escape hatch — forces a synchronous rebuild regardless of TTL. Used by the paging
 *  verification script so it measures one stable snapshot rather than racing a background refresh. */
export async function _forceRebuildForVerification(): Promise<void> {
  const rows = await buildRows();
  cache = { rows, builtAt: Date.now() };
}
