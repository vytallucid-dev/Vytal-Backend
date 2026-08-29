// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FENCE — layers (2) and (3). The PROOF that layer (1) held.
//
// ⚠ A GUARANTEE WITHOUT PROOF IS WHAT WE HAD BEFORE T3. The point is not to trust irdai-writer.ts;
//   it is to show, afterwards and from the database itself, that not one pre-existing row moved.
//
// ⚠⚠ ROWS ARE NAMED, NEVER COUNTED. B4c. A uuid is not a name. Three cron writes have already
//   landed inside fenced windows in this programme, and a bare count ("3 rows moved") cannot tell
//   you whether the mover was this lane, the nightly NSE job, or a rescore. Every baseline entry
//   carries symbol · period · basis · source, so a violation is reported as
//        "HDFCLIFE FY26 Q3 standalone [nse_xbrl_quarterly] updated at 03:14"
//   and can be attributed on sight.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export const FENCED_TABLES = [
  "life_insurance_quarterly_results",
  "life_insurance_fundamentals",
  "general_insurance_quarterly_results",
  "general_insurance_fundamentals",
] as const;
export type FencedTable = (typeof FENCED_TABLES)[number];

/** ⚠ Disjoint tables. Any movement here is a defect, not a side effect. B5c. */
export const DISJOINT_TABLES = [
  "quarterly_results",
  "fundamentals",
  "banking_quarterly_results",
  "banking_fundamentals",
  "nbfc_quarterly_results",
  "nbfc_fundamentals",
] as const;

interface Executor {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T[]>;
}

export interface NamedRow {
  rowId: string;
  /** ⚠ THE NAME. symbol · period · basis · source. Never just the uuid. */
  name: string;
  symbol: string;
  period: string;
  basis: string;
  source: string;
  updatedAt: number;
}

export interface Baseline {
  capturedAt: Date;
  /** table -> rowId -> NamedRow */
  rows: Record<string, Map<string, NamedRow>>;
  totals: Record<string, number>;
  disjointTotals: Record<string, number>;
}

async function namedRows(db: Executor, table: string): Promise<NamedRow[]> {
  const quarterly = table.includes("quarterly");
  const periodExpr = quarterly ? `f.fiscal_year || ' ' || f.quarter` : `f.fiscal_year`;
  return (
    await db.$queryRawUnsafe<{ id: string; symbol: string; period: string; basis: string; source: string; updated_at: Date }>(
      `SELECT f.id, s.symbol, ${periodExpr} AS period, f.result_type AS basis, f.source, f.updated_at
       FROM "${table}" f JOIN stocks s ON s.id = f.stock_id`,
    )
  ).map((r) => ({
    rowId: r.id,
    name: `${r.symbol} ${r.period} ${r.basis} [${r.source}]`,
    symbol: r.symbol,
    period: r.period,
    basis: r.basis,
    source: r.source,
    updatedAt: new Date(r.updated_at).getTime(),
  }));
}

/** ⚠ Table names come from the FENCED_TABLES literal union only — never from input. */
export async function captureBaseline(db: Executor): Promise<Baseline> {
  const rows: Record<string, Map<string, NamedRow>> = {};
  const totals: Record<string, number> = {};
  for (const t of FENCED_TABLES) {
    const m = new Map<string, NamedRow>();
    for (const r of await namedRows(db, t)) m.set(r.rowId, r);
    rows[t] = m;
    totals[t] = m.size;
  }
  const disjointTotals: Record<string, number> = {};
  for (const t of DISJOINT_TABLES) {
    const c = await db.$queryRawUnsafe<{ n: bigint }>(`SELECT count(*)::bigint n FROM "${t}"`);
    disjointTotals[t] = Number(c[0].n);
  }
  return { capturedAt: new Date(), rows, totals, disjointTotals };
}

export interface FenceViolation {
  table: string;
  kind: "updated" | "disappeared" | "disjoint_moved";
  /** ⚠ the NAME, not the id. */
  name: string;
  detail: string;
}

export interface FenceReport {
  ok: boolean;
  violations: FenceViolation[];
  /** rows this run added, named. */
  added: Array<{ table: string; name: string }>;
  checkedAt: Date;
}

export async function verifyFence(db: Executor, base: Baseline): Promise<FenceReport> {
  const violations: FenceViolation[] = [];
  const added: Array<{ table: string; name: string }> = [];

  for (const t of FENCED_TABLES) {
    const now = new Map<string, NamedRow>();
    for (const r of await namedRows(db, t)) now.set(r.rowId, r);

    for (const [id, was] of base.rows[t]) {
      const is = now.get(id);
      if (!is) {
        violations.push({ table: t, kind: "disappeared", name: was.name, detail: `row ${id} is gone` });
        continue;
      }
      if (is.updatedAt !== was.updatedAt) {
        violations.push({
          table: t,
          kind: "updated",
          name: was.name,
          detail: `updated_at moved ${new Date(was.updatedAt).toISOString()} -> ${new Date(is.updatedAt).toISOString()}`,
        });
      }
    }
    for (const [id, is] of now) {
      if (!base.rows[t].has(id)) {
        added.push({ table: t, name: is.name });
        // ⚠ layer (3): anything added that is NOT ours is a foreign write inside the window.
        if (is.source !== "irdai") {
          violations.push({
            table: t,
            kind: "updated",
            name: is.name,
            detail: `a NON-IRDAI row appeared inside the fenced window — attribute this before continuing`,
          });
        }
      }
    }
  }

  // ⚠ B5c: the disjoint tables must not move at all.
  for (const t of DISJOINT_TABLES) {
    const c = await db.$queryRawUnsafe<{ n: bigint }>(`SELECT count(*)::bigint n FROM "${t}"`);
    const n = Number(c[0].n);
    if (n !== base.disjointTotals[t]) {
      violations.push({
        table: t,
        kind: "disjoint_moved",
        name: `${t} row count`,
        detail: `${base.disjointTotals[t]} -> ${n}. Disjoint table: any movement is a defect.`,
      });
    }
  }

  return { ok: violations.length === 0, violations, added, checkedAt: new Date() };
}
