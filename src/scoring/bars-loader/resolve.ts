// File: src/scoring/bars-loader/resolve.ts
//
// In-memory bar-set resolver over the loader's would-WRITE output. This is the
// pure analogue of metric-scoring/bars.ts:loadBarSet — it resolves a
// (barPath, metricKey) to its bars from the parsed source, following PG6→PG5
// inheritance — so the verification harness can exercise the FULL real chain
// (real file → loaded bars → L1) WITHOUT a database, honouring the dry-run
// mandate (commits nothing).

import type { WouldWriteRow } from "./types.js";
import { BAR_PATH_INHERITANCE } from "../metric-scoring/bars.js";
import type { MetricBarSetInput } from "../metric-scoring/types.js";

export interface ResolvedBars extends MetricBarSetInput {
  rawLabel: string;
  resolvedFromBarPath: string;
}

/** Index would-write rows by `${barPath}|${metricKey}` for O(1) lookup. */
export function indexRows(rows: WouldWriteRow[]): Map<string, WouldWriteRow> {
  const m = new Map<string, WouldWriteRow>();
  for (const r of rows) m.set(`${r.barPath}|${r.metricKey}`, r);
  return m;
}

const resolvePath = (barPath: string): string => BAR_PATH_INHERITANCE[barPath] ?? barPath;

/** Resolve (barPath, metricKey) → bars from the loaded rows, following a single
 *  inheritance hop (PG6→PG5). null if no such bar set was loaded. PURE. */
export function resolveBars(
  index: Map<string, WouldWriteRow>,
  barPath: string,
  metricKey: string,
): ResolvedBars | null {
  const effective = resolvePath(barPath);
  const row = index.get(`${effective}|${metricKey}`);
  if (!row) return null;
  return {
    metricKey,
    direction: row.direction,
    bars: { ...row.bars },
    note: `loaded ${row.specMetricKeySource ? `(srcKey=${row.specMetricKeySource}) ` : ""}from vytal_pg_bars.json${effective !== barPath ? `, inherited ${barPath}→${effective}` : ""}`,
    illustrative: false,
    barPath,
    resolvedFromBarPath: effective,
    metricBarSetId: null,
    unit: row.unit,
    sscu: row.sscu,
    rawLabel: row.rawLabel,
  };
}
