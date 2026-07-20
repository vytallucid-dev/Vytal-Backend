// ═══════════════════════════════════════════════════════════════
// RETENTION — policy types, the NAMED-exemption registry, and identifier
// validation. The engine (engine.ts) reads the `retention_policy` DB table and
// executes; NOTHING here or there is hardcoded per-table except the exemption
// predicates, which are DELIBERATELY engine-owned (never free SQL from the DB —
// that is the whole safety model when a UI later writes policy rows).
// ═══════════════════════════════════════════════════════════════

export type RetentionModeName = "depth_per_key" | "time" | "supersede_chain";

export const RETENTION_MODES: readonly RetentionModeName[] = [
  "depth_per_key",
  "time",
  "supersede_chain",
] as const;

/** A row of `retention_policy`, as the engine consumes it (Prisma-shaped). */
export interface RetentionPolicyRow {
  id: string;
  table: string;
  mode: string;
  keyCols: string[];
  orderCol: string | null;
  keep: number | null;
  days: number | null;
  supersededDays: number | null;
  floor: number;
  floorReason: string;
  exceptWhere: string | null;
  tsColumn: string | null;
  enabled: boolean;
  /**
   * ARMED — the per-table live-delete gate, distinct from `enabled`:
   *   enabled=false → the row is skipped entirely (not even counted).
   *   armed=false   → the row IS counted, but NEVER deleted, even in a live run
   *                   (a per-table dry-run). Default false = safe: a new/UI-added
   *                   row cannot delete until it is deliberately armed. Also the
   *                   standing kill switch — disarm a misbehaving table with one UPDATE.
   */
  armed: boolean;
}

/** A proposed (not-yet-saved) change to one policy row — the admin UI's preview
 *  merges this onto the loaded policy before the dry-run count. Only the set fields
 *  are swapped. */
export interface PolicyOverride {
  table: string;
  keep?: number;
  days?: number;
  supersededDays?: number;
  armed?: boolean;
  enabled?: boolean;
}

// ── NAMED EXEMPTIONS ────────────────────────────────────────────
// A named exemption is a SPARE rule expressed as an extra AND-clause that
// RESTRICTS a delete to the prunable rows. The DB stores only the NAME
// (`except_where`); the engine owns the SQL. An unknown name → the engine errors
// that table's rule and deletes nothing (never a silent free-SQL execution).
export interface Exemption {
  /** Human description of what is SPARED (for the report). */
  spares: string;
  /** SQL fragment appended to the delete WHERE — keeps ONLY the prunable rows. */
  deleteClause: string;
}

export const EXEMPTIONS: Record<string, Exemption> = {
  // stock_news referenced by an ai_summary (implicit m2m `_AiSummaryToStockNews`,
  // column "B" = StockNews.id, alphabetical after "A" = AiSummary.id) is source
  // material for a generated summary — never prune it out from under one.
  ai_summary_referenced: {
    spares: "stock_news rows referenced by an ai_summary",
    deleteClause: `AND "id" NOT IN (SELECT "B" FROM "_AiSummaryToStockNews")`,
  },
  // A fired event with delivered=false is an UNSENT notification — the email drain
  // still owes it. Prune only delivered=true; spare delivered=false.
  delivered_only: {
    spares: "undelivered fired events (delivered = false — unsent email)",
    deleteClause: `AND "delivered" = true`,
  },
  // Open ingestion errors ARE the live triage queue. Prune resolved + ignored
  // (both terminal); spare open.
  resolved_or_ignored: {
    spares: "open errors (the live triage queue)",
    deleteClause: `AND "status" IN ('resolved', 'ignored')`,
  },
  // Never delete a job mid-flight: prune only terminal jobs, spare pending/running.
  terminal_jobs_only: {
    spares: "pending/running jobs (never mid-flight)",
    deleteClause: `AND "status" NOT IN ('pending', 'running')`,
  },
};

// ── IDENTIFIER VALIDATION ───────────────────────────────────────
// Every table/column name that reaches a SQL string comes from the policy table,
// which a UI will eventually write → untrusted. Validate the SHAPE (blocks
// injection) AND existence against the live catalog (blocks a misconfigured but
// well-formed name) before it is ever interpolated.
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

export function assertIdent(name: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`unsafe identifier (must match ${IDENT_RE}): ${JSON.stringify(name)}`);
  }
}

export type Catalog = Map<string, Set<string>>;

export function assertTable(catalog: Catalog, table: string): void {
  assertIdent(table);
  if (!catalog.has(table)) throw new Error(`table does not exist: ${table}`);
}

export function assertColumn(catalog: Catalog, table: string, col: string): void {
  assertIdent(col);
  if (!catalog.get(table)?.has(col)) throw new Error(`column does not exist: ${table}.${col}`);
}

/** Double-quote an already-validated identifier. NEVER call on an unvalidated name. */
export const q = (id: string): string => `"${id}"`;

/**
 * Clamp a requested limit UP to the floor — the one-way guard. `keep`/`days`/
 * `supersededDays` may be RAISED to the floor, never lowered below it. A UI that
 * sets keep=5 on an 8-floor table gets 8, with the clamp recorded.
 */
export function clampUp(
  requested: number | null,
  floor: number,
): { value: number; clamped: boolean; requested: number | null } {
  if (requested == null) return { value: floor, clamped: true, requested };
  const value = Math.max(requested, floor);
  return { value, clamped: requested < floor, requested };
}
