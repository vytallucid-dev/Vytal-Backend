// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE LINE-ITEM SCREEN — a filter over what companies FILED, across every industry's statements.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE THIRD UNIVERSE, AND THE ONE THE SCREEN COULD NOT REACH AT ALL.
//
//   scored metrics · pillars · bands      95      score_snapshots / score_metrics
//   FILED LINE ITEMS                   2,284      the five quarterly + five annual statement tables
//   findings · patterns                2,291      stock_findings
//
// A reader asking for "revenue above 100cr" is asking about the middle row, and got a definition card.
//
// ── ★ BASIS IS RESOLVED WITH `chooseBasis`, NOT WITH A SCREEN-SPECIFIC DEFAULT ────────────────────
// The Operator's ruling, and the reason is a session a reader can actually have: a screen defaulting
// to standalone would show them TCS's consolidated revenue on the stock page and its standalone
// revenue in the screen, an hour apart, with no way to tell which was which. `chooseBasis` and
// `preferredBasisFor` are imported from the Fundamentals view — one home, two consumers.
//
// ⚠ AND IT IS RESOLVED IN TYPESCRIPT, NOT IN SQL. A `(result_type = 'consolidated') DESC` in the
//   ORDER BY would have been one query instead of a fold, and it would be a SECOND implementation of
//   the ruling — the kind that agrees today and drifts the first time the family default changes. So
//   the query returns the latest row per (stock, BASIS) — at most two rows per company — and the real
//   function picks between them.
//
// ── ⚠ MIXED BASES ARE THE NORMAL RESULT, SO EVERY ROW CARRIES ITS OWN ────────────────────────────
// 15,935 stock-periods across 1,495 stocks hold both. A banking row resolves standalone and a
// non-financial one consolidated IN THE SAME RESULT SET, which is correct and is invisible unless the
// row says so. `LineItemMatch.basis` is what the card renders.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { chooseBasis, preferredBasisFor } from "../scoring/read/fundamentals-view.service.js";
import { absent, resolved, type QueryCoverage, type Resolved } from "./contract.js";
import type { LineItemCondition } from "../composition/line-item-conditions.js";

export type Basis = "standalone" | "consolidated";

export interface LineItemValue {
  readonly label: string;
  /** Already formatted, in the reader's units (N-1 — a renderer never divides or rounds). */
  readonly display: string;
  /** The raw stored number, for the column's sort. */
  readonly sort: number;
}

export interface LineItemMatch {
  readonly symbol: string;
  readonly name: string;
  /** ★ PER ROW, because a mixed set is the normal case. */
  readonly basis: Basis;
  /** The period the figure is from — "FY26 Q1" / "FY26". Stocks sit at their own. */
  readonly period: string;
  readonly periodSort: number;
  readonly values: readonly LineItemValue[];
}

export interface LineItemScreenRead {
  readonly matches: readonly LineItemMatch[];
  readonly matched: number;
  /** Companies that carry a figure for EVERY condition asked — the honest denominator. */
  readonly evaluable: number;
  /** Companies that have filed a statement at all, of any industry. */
  readonly considered: number;
  readonly conditions: readonly { readonly label: string; readonly bound: string; readonly evaluable: number }[];
  /** How many rows resolved to each basis — what the card states about the set as a whole. */
  readonly basisSplit: { readonly standalone: number; readonly consolidated: number };
  /** Set when the reader named a basis; `null` when `chooseBasis` decided. */
  readonly basisRequested: Basis | null;
  readonly sortedBy: string;
}

const FAMILY_BY_TABLE: Record<string, "non_financial" | "banking" | "nbfc" | "life_insurance" | "general_insurance"> = {
  quarterly_results: "non_financial", fundamentals: "non_financial",
  banking_quarterly_results: "banking", banking_fundamentals: "banking",
  nbfc_quarterly_results: "nbfc", nbfc_fundamentals: "nbfc",
  life_insurance_quarterly_results: "life_insurance", life_insurance_fundamentals: "life_insurance",
  general_insurance_quarterly_results: "general_insurance", general_insurance_fundamentals: "general_insurance",
};

interface Row {
  stock_id: string; symbol: string; name: string | null;
  result_type: string; v: string | number; fiscal_year: string; quarter: string | null; report_date: Date;
}

/**
 * ⚠ THE COLUMN AND TABLE ARE INTERPOLATED, AND THEY ARE NOT READER INPUT. Both come from
 *   `screen-fields.generated.ts`, which is emitted from schema.prisma — so the only strings that can
 *   reach here are column names that exist. The BOUND is parameterised, because that IS reader input.
 *   Asserted below rather than trusted: anything not matching `^[a-z_]+$` is refused.
 */
// ⚠ DIGITS ARE LEGAL IN A COLUMN NAME AND THE FIRST DRAFT FORBADE THEM. `^[a-z_]+$` silently
//   rejected `cet1_ratio`, `roa_quarterly` and every other numbered column — so "core capital above
//   15%" ran, read nothing, and reported "no company clears it" over an empty set. A guard that
//   drops real columns is worse than no guard, because the screen still answers.
const SAFE = /^[a-z0-9_]+$/;

async function readOne(
  table: string, column: string, grain: "quarterly" | "annual",
): Promise<Row[]> {
  if (!SAFE.test(table) || !SAFE.test(column)) return [];
  const period = grain === "quarterly" ? "q.quarter" : "NULL::text";
  // ★ LATEST ROW PER (STOCK, BASIS). At most two per company; `chooseBasis` picks between them.
  const sql = `
    SELECT DISTINCT ON (q.stock_id, q.result_type)
           q.stock_id, s.symbol, s.name, q.result_type,
           q.${column} AS v, q.fiscal_year, ${period} AS quarter, q.report_date
    FROM ${table} q JOIN stocks s ON s.id = q.stock_id
    WHERE q.${column} IS NOT NULL
    ORDER BY q.stock_id, q.result_type, q.report_date DESC`;
  return prisma.$queryRawUnsafe<Row[]>(sql);
}

const num = (v: unknown): number =>
  typeof v === "number" ? v
  : typeof (v as { toNumber?: () => number })?.toNumber === "function" ? (v as { toNumber: () => number }).toNumber()
  : Number(v);

/** ₹ Cr, a percent, a multiple or a per-share figure — formatted once, here (N-1). */
function display(v: number, unit: LineItemCondition["field"]["unit"]): string {
  const g = (x: number, dp = 2) => x.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  switch (unit) {
    case "currency":
      return Math.abs(v) >= 100_000 ? `₹${g(v / 100_000)} lakh Cr` : `₹${g(Math.round(v), 0)} Cr`;
    case "percent": return `${g(v, 1)}%`;
    case "fraction": return `${g(v * 100, 1)}%`;
    case "times": return `${g(v, 1)}×`;
    case "perShare": return `₹${g(v)}`;
  }
}

/**
 * Run every line-item condition and intersect. Conditions are ANDed — a company must carry a figure
 * for each and clear each.
 */
export async function resolveLineItemScreen(
  conditions: readonly LineItemCondition[],
  requestedBasis: Basis | null = null,
  /**
   * ★ THE OTHER UNIVERSE'S MATCH SET, when the sentence spanned two — the intersection is applied
   *   HERE rather than at the block, so `matched` and `basisSplit` describe the SAME set the reader
   *   is shown.
   *
   * ⚠ THE FIRST DRAFT NARROWED AT THE BLOCK AND LEFT THIS RESOLVER'S TOTALS OVER THE UNNARROWED SET,
   *   so a combined filter returning 18 companies announced "748 consolidated and 90 standalone
   *   here" — a basis split over 838 rows the reader could not see, presented as a fact about the 18
   *   in front of them. One narrowing, one home.
   */
  restrictTo: ReadonlySet<string> | null = null,
): Promise<Resolved<LineItemScreenRead>> {
  if (conditions.length === 0) {
    return absent<LineItemScreenRead>("missing_line_item", { subject: null, query: null });
  }

  let read = true;
  const fail = () => { read = false; return [] as Row[]; };

  // One pass per condition; a condition may span several industry tables.
  const perCondition: {
    cond: LineItemCondition;
    /** stock → the row chosen for it, already basis-resolved. */
    chosen: Map<string, { row: Row; basis: Basis }>;
  }[] = [];

  for (const cond of conditions) {
    const sources = cond.field.sources.filter((s) => s.grain === cond.grain);
    const batches = await Promise.all(sources.map((s) => readOne(s.table, s.column, cond.grain).catch(fail)));
    // ⚠ THE ROW CARRIES THE TABLE IT CAME FROM, and the first draft did not — it took
    //   `sources.find(...)?.table`, which is just the FIRST source whatever the row's origin, so
    //   every bank would have been given the non-financial default. The family default is a property
    //   of the table, so the table has to travel with the row.
    const byStock = new Map<string, { row: Row; table: string }[]>();
    sources.forEach((s, i) => {
      for (const r of batches[i] ?? []) {
        const cur = byStock.get(r.stock_id);
        if (cur) cur.push({ row: r, table: s.table }); else byStock.set(r.stock_id, [{ row: r, table: s.table }]);
      }
    });

    const chosen = new Map<string, { row: Row; basis: Basis }>();
    for (const [stockId, tagged] of byStock) {
      const rows = tagged.map((t) => t.row);
      const family = FAMILY_BY_TABLE[tagged[0]!.table] ?? "non_financial";
      const available = [...new Set(rows.map((r) => r.result_type))] as Basis[];
      const basis = chooseBasis(requestedBasis ?? undefined, available, preferredBasisFor(family));
      const row = rows.find((r) => r.result_type === basis) ?? rows[0];
      if (row) chosen.set(stockId, { row, basis: row.result_type as Basis });
    }
    perCondition.push({ cond, chosen });
  }

  if (!read) return absent<LineItemScreenRead>("read_failed", { subject: null, query: null });

  // ★ THE POPULATION: every company that has filed a statement of any kind. Not the whole book —
  //   `considered` must be the set the screen could actually look at.
  const consideredRows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT COUNT(DISTINCT stock_id)::bigint AS n FROM (
      SELECT stock_id FROM quarterly_results
      UNION SELECT stock_id FROM banking_quarterly_results
      UNION SELECT stock_id FROM nbfc_quarterly_results
      UNION SELECT stock_id FROM life_insurance_quarterly_results
      UNION SELECT stock_id FROM general_insurance_quarterly_results
      UNION SELECT stock_id FROM fundamentals) x`).catch(() => null);
  const considered = Number(consideredRows?.[0]?.n ?? 0);

  // Evaluable = carries a figure for EVERY condition. Matched = clears every bound.
  const first = perCondition[0]!;
  const evaluableIds: string[] = [];
  for (const stockId of first.chosen.keys()) {
    if (perCondition.every((p) => p.chosen.has(stockId))) evaluableIds.push(stockId);
  }

  const matches: LineItemMatch[] = [];
  let standalone = 0, consolidated = 0;
  for (const stockId of evaluableIds) {
    let passes = true;
    const values: LineItemValue[] = [];
    let period = ""; let periodSort = 0; let basis: Basis = "consolidated"; let symbol = ""; let name = "";
    for (const p of perCondition) {
      const hit = p.chosen.get(stockId)!;
      const v = num(hit.row.v);
      if (p.cond.min !== undefined && v < p.cond.min) { passes = false; break; }
      if (p.cond.max !== undefined && v > p.cond.max) { passes = false; break; }
      values.push({ label: p.cond.field.label, display: display(v, p.cond.field.unit), sort: v });
      const d = new Date(hit.row.report_date).getTime();
      if (d > periodSort) {
        periodSort = d;
        period = hit.row.quarter ? `${hit.row.fiscal_year} ${hit.row.quarter}` : hit.row.fiscal_year;
        basis = hit.basis;
      }
      symbol = hit.row.symbol; name = hit.row.name ?? hit.row.symbol;
    }
    if (!passes) continue;
    // ★ THE INTERSECTION, BEFORE ANY TOTAL IS TAKEN.
    if (restrictTo && !restrictTo.has(symbol)) continue;
    if (basis === "standalone") standalone++; else consolidated++;
    matches.push({ symbol, name, basis, period, periodSort, values });
  }

  // Best on the first condition, so the column the reader led with is the ranking.
  matches.sort((a, b) => {
    const c0 = conditions[0]!;
    const av = a.values[0]?.sort ?? 0, bv = b.values[0]?.sort ?? 0;
    return c0.max !== undefined ? av - bv : bv - av;
  });

  const q: QueryCoverage = {
    universeSearched: considered,
    // ⚠ NO DEPTH FLOOR IS DECLARED, AND THAT IS A DECISION. Every condition here reads ONE period —
    //   the latest filed — so a company with 8 quarters and one with 34 are equally able to answer it,
    //   and a floor would exclude companies that can. The floor becomes mandatory the day a condition
    //   spans periods ("revenue growing for 3 quarters"), which this build does not do; that is stated
    //   in the report rather than half-built here.
    depthFloor: null,
    excludedForDepth: 0,
    dropped: [{
      filter: "no figure filed",
      dropped: Math.max(0, considered - evaluableIds.length),
      why: "companies that have filed no figure for every condition asked",
    }].filter((d) => d.dropped > 0),
  };

  return resolved<LineItemScreenRead>({
    matches,
    matched: matches.length,
    evaluable: evaluableIds.length,
    considered,
    conditions: perCondition.map((p) => ({
      label: p.cond.field.label,
      bound: `${p.cond.min !== undefined ? "≥" : "≤"} ${p.cond.saidValue}`,
      evaluable: p.chosen.size,
    })),
    basisSplit: { standalone, consolidated },
    basisRequested: requestedBasis,
    sortedBy: `${conditions[0]!.field.label}, ${conditions[0]!.max !== undefined ? "lowest" : "highest"} first`,
  }, { subject: null, query: q }, ["stocks", "quarterly_results"]);
}
