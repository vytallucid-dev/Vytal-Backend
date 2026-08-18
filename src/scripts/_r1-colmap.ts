// ═══════════════════════════════════════════════════════════════
// R1c support — map the SCORE-INPUT MANIFEST (Prisma field names) onto real DB
// columns, and FAIL LOUD if any relevant column cannot be resolved. The snapshot
// must track exactly what the scorer reads; a silently-dropped column would make
// R4's null classification a lie.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { SCORE_INPUT_COLUMNS, type ScoreInputTable } from "../scoring/inputs/score-input-columns.js";

export const TABLES: ScoreInputTable[] = [
  "fundamentals",
  "quarterly_results",
  "banking_fundamentals",
  "banking_quarterly_results",
];

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

export interface ColMap {
  table: ScoreInputTable;
  /** field -> db column, for the VALUE columns the scorer reads (keys excluded). */
  valueCols: Array<{ field: string; col: string }>;
  /** key columns present on this table. */
  keyCols: string[];
  unresolved: string[];
}

/** Keys are handled separately — they are identity, not measurable content. */
const KEYS = new Set(["stockId", "resultType", "reportDate", "fiscalYear", "quarter"]);

export async function buildColMaps(): Promise<ColMap[]> {
  const out: ColMap[] = [];
  for (const table of TABLES) {
    const have = new Set(
      ((await prisma.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
        table,
      )) as Array<{ column_name: string }>).map((r) => r.column_name),
    );
    const valueCols: Array<{ field: string; col: string }> = [];
    const unresolved: string[] = [];
    for (const field of SCORE_INPUT_COLUMNS[table].relevant) {
      if (KEYS.has(field)) continue;
      const cand = [snake(field), field];
      const hit = cand.find((c) => have.has(c));
      if (hit) valueCols.push({ field, col: hit });
      else unresolved.push(field);
    }
    const keyCols = ["result_type", "report_date", "fiscal_year", "quarter"].filter((c) => have.has(c));
    out.push({ table, valueCols, keyCols, unresolved });
  }
  return out;
}
