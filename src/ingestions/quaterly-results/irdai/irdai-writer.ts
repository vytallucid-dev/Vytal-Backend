// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// INSERT-ONLY WRITER — the same T3 guarantee the BSE lane carries. Nothing relaxes because the
// source is cleaner.
//
// ★ THE RULE: NSE wins wherever it has a row. BSE wins wherever IT has a row and NSE does not.
//   IRDAI writes ONLY where neither does. An IRDAI row never updates an existing row, ever.
//
// ⚠ WHY NOT THE SHARED INGESTERS. Every v3 ingester ends in
//        prisma.<table>.upsert({ where: key, create: data, update: data })
//   on a key that DOES NOT INCLUDE `source`. Calling one from an IRDAI run silently overwrites the
//   NSE row. The shared ingesters are not touched and not called — same ruling as bse-writer.ts.
//
// ★ THREE ENFORCEMENT LAYERS, all required:
//     (1) GUARANTEE — INSERT … ON CONFLICT DO NOTHING. Atomic, no read-then-write race, and
//         structurally incapable of updating a row it did not create. Implemented here.
//     (2) PROOF — an id + updated_at baseline of every non-IRDAI row, diffed after the run.
//     (3) PROOF — count of rows WHERE source <> 'irdai' AND updated_at > run_start. Must be 0.
//   (2) and (3) live in irdai-fence.ts.
//
// ⚠ source = "irdai", DISTINCTLY. Three sources now agree to the rupee on overlapping periods —
//   MEASURED, HDFCLIFE FY26 gross premium is 79387.07 from nse_xbrl_annual and 79,38,707 lakh from
//   the IRDAI L-1-A-RA, the same number. The `source` column is the ONLY thing that keeps them
//   apart afterwards. It is never "irdai_or_nse", never blank, never inherited.
//
// ⚠ RAW CELLS ONLY. No derived columns — margins, QoQ/YoY, growth and the rest are the derive
//   layer's job. Same convention as the BSE lane, and it keeps the write surface auditable.
//
// ⚠ RATIO COLUMNS ARE NULLED WHEN THE GATE REFUSES. Never scaled, never guessed — the SBILIFE
//   ruling (fundamentals-view.service.ts:1417). See irdai-ratio-gate.ts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";

export const IRDAI_SOURCE = "irdai";
/** These are IRDAI L-form / NL-form PDFs, not an XBRL taxonomy. Recorded honestly. */
export const IRDAI_TAXONOMY = "irdai_forms";

export type Grain = "quarterly" | "annual";
export type Basis = "standalone" | "consolidated";
export type Family = "life" | "general";

export interface WriteTarget {
  family: Family;
  grain: Grain;
  stockId: string;
  symbol: string;
  fiscalYear: string;
  /** "Q1".."Q4" for quarterly, null for annual. */
  quarter: string | null;
  reportDate: Date;
  filingDate: Date;
  basis: Basis;
  /** The document this row came from. Audit trail. */
  sourceUrl: string;
}

export type WriteOutcome =
  | { written: true; rowId: string }
  | { written: false; reason: "existing_row_present"; detail: string }
  | { written: false; reason: "no_cells"; detail: string }
  | { written: false; reason: "dry_run"; detail: string };

interface Executor {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T[]>;
}

const TABLE: Record<string, string> = {
  "life|quarterly": "life_insurance_quarterly_results",
  "life|annual": "life_insurance_fundamentals",
  "general|quarterly": "general_insurance_quarterly_results",
  "general|annual": "general_insurance_fundamentals",
};

function tableFor(t: WriteTarget): string {
  const k = `${t.family}|${t.grain}`;
  const tbl = TABLE[k];
  if (!tbl) throw new Error(`no table for ${k}`);
  return tbl;
}

/**
 * ⚠ THE ONLY WRITE PATH IN THIS LANE.
 *
 * `cells` are RAW columns already converted into the table's unit (Rs crore) by the parser.
 * Keys are validated against the table's real columns before interpolation — no caller-supplied
 * identifier ever reaches the SQL text unchecked.
 */
export async function writeRow(
  db: Executor,
  t: WriteTarget,
  cells: Record<string, number | null>,
  opts: { dryRun: boolean },
): Promise<WriteOutcome> {
  const table = tableFor(t);

  // ── validate every column name against the live schema ────────────────────────────────────────
  const known = new Set(
    (
      await db.$queryRawUnsafe<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name=$1`,
        table,
      )
    ).map((c) => c.column_name),
  );
  const cols = Object.keys(cells).filter((c) => cells[c] !== null);

  // ⚠⚠ AN EMPTY ROW IS NEVER WRITTEN. R1.
  //   A row with zero data cells is indistinguishable from a gap to every downstream reader — it
  //   returns nulls exactly as a missing period does — yet it is NOT free: it occupies a slot under
  //   the depth_per_key retention cap (44 quarterly / 18 annual, armed), and it ASSERTS that the
  //   period exists and was successfully ingested. That is worse than absence, because absence is
  //   honest about itself.
  //   ⚠ The guard lives HERE, in the only write path, not only in the caller. A caller that forgets
  //     the check must still be unable to create one.
  if (cols.length === 0) {
    return {
      written: false,
      reason: "no_cells",
      detail:
        `refusing to insert a row with zero data cells for ${t.symbol} ${t.fiscalYear} ${t.quarter ?? ""} ` +
        `(${t.basis}). An empty row reads as a gap but consumes a retention slot and asserts the period ` +
        `was ingested. The unit belongs in the ledger, not in the table.`,
    };
  }

  const unknown = cols.filter((c) => !known.has(c));
  if (unknown.length) {
    // ⚠ B1d: fail loud. A typo'd column name must not become a silently-dropped field.
    throw new Error(`writeRow: ${table} has no column(s) ${unknown.join(", ")}`);
  }

  const keyCols =
    t.grain === "quarterly"
      ? `stock_id, quarter, fiscal_year, result_type`
      : `stock_id, fiscal_year, result_type`;

  if (opts.dryRun) {
    const existing = await db.$queryRawUnsafe<{ source: string }>(
      t.grain === "quarterly"
        ? `SELECT source FROM "${table}" WHERE stock_id=$1 AND quarter=$2 AND fiscal_year=$3 AND result_type=$4`
        : `SELECT source FROM "${table}" WHERE stock_id=$1 AND fiscal_year=$2 AND result_type=$3`,
      ...(t.grain === "quarterly"
        ? [t.stockId, t.quarter, t.fiscalYear, t.basis]
        : [t.stockId, t.fiscalYear, t.basis]),
    );
    return existing.length
      ? { written: false, reason: "existing_row_present", detail: `held by source=${existing[0].source}` }
      : { written: false, reason: "dry_run", detail: `would insert ${cols.length} cells into ${table}` };
  }

  const id = randomUUID();
  const fixed: Array<[string, unknown]> = [
    ["id", id],
    ["stock_id", t.stockId],
    ["fiscal_year", t.fiscalYear],
    ["report_date", t.reportDate],
    ["filing_date", t.filingDate],
    ["xbrl_url", t.sourceUrl],
    ["result_type", t.basis],
    ["source", IRDAI_SOURCE],
    ["xbrl_taxonomy", IRDAI_TAXONOMY],
    ["created_at", new Date()],
    ["updated_at", new Date()],
  ];
  if (t.grain === "quarterly") fixed.splice(3, 0, ["quarter", t.quarter]);

  const allCols = [...fixed.map(([c]) => c), ...cols];
  const values = [...fixed.map(([, v]) => v), ...cols.map((c) => cells[c])];
  const placeholders = allCols.map((_, i) => `$${i + 1}`).join(", ");

  // ⚠ ON CONFLICT DO NOTHING is the whole guarantee. Do not "improve" this into an upsert, a
  //   DO UPDATE, or a read-then-write. It is deliberately incapable of touching an existing row.
  const sql =
    `INSERT INTO "${table}" (${allCols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders}) ` +
    `ON CONFLICT (${keyCols}) DO NOTHING`;

  const n = await db.$executeRawUnsafe(sql, ...values);
  return n === 1
    ? { written: true, rowId: id }
    : { written: false, reason: "existing_row_present", detail: "ON CONFLICT DO NOTHING suppressed the insert" };
}
