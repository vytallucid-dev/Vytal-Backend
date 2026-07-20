// ═══════════════════════════════════════════════════════════════
// RETENTION ENGINE — ONE generic pruner. Reads the `retention_policy` table and
// executes. Zero hardcoded limits (a change is a DB UPDATE). Three mode handlers,
// each built on the table's REAL constraint. Every limit is floor-clamped UP.
// Exemptions are engine-owned named predicates. The score-layer cascade order is
// enforced. NO globs, NO wildcard deletes — every delete is scoped by explicit id
// / key / predicate.
//
// ⚠️ DRY-RUN IS THE DEFAULT SAFETY: with dryRun=true the engine issues ZERO
//    mutating statements — it only COUNTS. A dry-run therefore cannot perturb any
//    row, any score, any fingerprint, by construction.
// ═══════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import {
  EXEMPTIONS,
  assertColumn,
  assertTable,
  clampUp,
  q,
  type Catalog,
  type PolicyOverride,
  type RetentionPolicyRow,
} from "./policy.js";

export interface TableResult {
  table: string;
  mode: string;
  status: "ok" | "skipped_disabled" | "error";
  /** The row's live-delete gate. false → counted, never deleted (per-table dry-run). */
  armed: boolean;
  /** True when this was a LIVE run but the row was held (armed=false): counted, not deleted. */
  held: boolean;
  requested: number | null; // requested keep / days / supersededDays
  floor: number;
  effective: number | null; // after the floor clamp
  clamped: boolean;
  floorReason: string;
  exemption: string | null;
  /** Rows that WOULD be (dry-run/held) or WERE (live+armed) deleted at the top level. */
  matched: number;
  deleted: number; // 0 in dry-run OR when held (armed=false)
  /** Mode-specific sub-counts (supersede cascade steps, etc.). */
  detail?: Record<string, number | string>;
  note?: string;
  error?: string;
}

export interface RetentionReport {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalMatched: number;
  totalDeleted: number;
  clampsFired: number;
  results: TableResult[];
}

type Row = Record<string, unknown>;

async function count(sql: string, ...params: unknown[]): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(sql, ...params)) as Row[];
  return Number((rows[0]?.n as number | bigint | undefined) ?? 0);
}

async function loadCatalog(): Promise<Catalog> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  )) as { table_name: string; column_name: string }[];
  const cat: Catalog = new Map();
  for (const r of rows) {
    if (!cat.has(r.table_name)) cat.set(r.table_name, new Set());
    cat.get(r.table_name)!.add(r.column_name);
  }
  return cat;
}

// ── MODE 1: depth_per_key — keep newest N per key (advances only as data arrives) ──
// "keep newest N", NOT "delete older than": a stalled stock keeps everything it has.
async function runDepth(p: RetentionPolicyRow, cat: Catalog, dryRun: boolean): Promise<TableResult> {
  if (p.keep == null || !p.orderCol || p.keyCols.length === 0) {
    throw new Error("depth_per_key requires keep, order_col and key_cols");
  }
  assertColumn(cat, p.table, "id");
  assertColumn(cat, p.table, p.orderCol);
  for (const k of p.keyCols) assertColumn(cat, p.table, k);

  const { value: keep, clamped } = clampUp(p.keep, p.floor);
  const partition = p.keyCols.map(q).join(", ");
  // ranked once; "surplus" = rows beyond the newest `keep` per key.
  const ranked = `SELECT "id", row_number() OVER (PARTITION BY ${partition} ORDER BY ${q(p.orderCol)} DESC, "id" DESC) AS rn FROM ${q(p.table)}`;
  const matched = await count(`SELECT count(*)::int AS n FROM (${ranked}) s WHERE s.rn > $1`, keep);

  let deleted = 0;
  if (!dryRun && matched > 0) {
    deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM ${q(p.table)} WHERE "id" IN (SELECT "id" FROM (${ranked}) s WHERE s.rn > $1)`,
      keep,
    );
  }
  return baseResult(p, "depth_per_key", clamped, keep, matched, deleted, null);
}

// ── MODE 2: time — fixed calendar window on ts_column, with a named exemption ──
async function runTime(p: RetentionPolicyRow, cat: Catalog, dryRun: boolean): Promise<TableResult> {
  if (p.days == null || !p.tsColumn) throw new Error("time requires days and ts_column");
  assertColumn(cat, p.table, p.tsColumn);

  const { value: days, clamped } = clampUp(p.days, p.floor);

  let exClause = "";
  if (p.exceptWhere) {
    const ex = EXEMPTIONS[p.exceptWhere];
    if (!ex) throw new Error(`unknown exemption predicate: ${p.exceptWhere}`);
    exClause = ` ${ex.deleteClause}`;
  }
  // A NULL ts_column is never < cutoff → spared automatically (insider_trades.trade_date).
  const where = `${q(p.tsColumn)} < now() - make_interval(days => $1::int)${exClause}`;
  const matched = await count(`SELECT count(*)::int AS n FROM ${q(p.table)} WHERE ${where}`, days);

  let deleted = 0;
  if (!dryRun && matched > 0) {
    deleted = await prisma.$executeRawUnsafe(`DELETE FROM ${q(p.table)} WHERE ${where}`, days);
  }
  return baseResult(p, "time", clamped, days, matched, deleted, p.exceptWhere);
}

// ── MODE 3: supersede_chain — score layer, cascade order ENFORCED ──
// Keep every HEAD (never pointed-at). Prune SUPERSEDED (pointed-at) non-head rows
// older than N days. Order: null supersedes_id (NoAction FK) → delete snapshots
// (CASCADE patterns/red_flags/guardrail) → delete orphan pillars (CASCADE leaves)
// → orphan peer_stats / runs LAST (RESTRICT-guarded, so the DB itself backstops).
async function runSupersede(p: RetentionPolicyRow, cat: Catalog, dryRun: boolean): Promise<TableResult> {
  if (p.supersededDays == null) throw new Error("supersede_chain requires superseded_days");
  const t = p.table; // score_snapshots
  assertTable(cat, t);
  for (const c of ["id", "created_at", "supersedes_id", "foundation_pillar_id", "momentum_pillar_id", "market_pillar_id", "ownership_pillar_id"]) {
    assertColumn(cat, t, c);
  }
  const { value: sdays, clamped } = clampUp(p.supersededDays, p.floor);

  // Targets: superseded (someone points at them via supersedes_id) AND older than cutoff.
  // A head is never pointed-at, so "pointed-at" ⇔ "non-head". $1 = sdays (reused).
  const targetSel = `SELECT s."id" FROM ${q(t)} s WHERE s."created_at" < now() - make_interval(days => $1::int) AND EXISTS (SELECT 1 FROM ${q(t)} n WHERE n."supersedes_id" = s."id")`;

  const matched = await count(`SELECT count(*)::int AS n FROM (${targetSel}) x`, sdays);

  const childCount = (child: string) =>
    count(`SELECT count(*)::int AS n FROM ${q(child)} c WHERE c."snapshot_id" IN (${targetSel})`, sdays);
  const cascadedPatterns = await childCount("score_patterns");
  const cascadedRedFlags = await childCount("score_red_flags");
  const cascadedGuardrail = await childCount("score_guardrail_events");

  // Pillars that would ORPHAN: referenced by a target snapshot AND by NO survivor.
  const projectedOrphanPillars = await count(
    `SELECT count(*)::int AS n FROM ${q("score_pillars")} p
       WHERE EXISTS (SELECT 1 FROM ${q(t)} s WHERE s."id" IN (${targetSel}) AND ${pillarRefPlain("s")})
         AND NOT EXISTS (SELECT 1 FROM ${q(t)} s WHERE s."id" NOT IN (${targetSel}) AND ${pillarRefPlain("s")})`,
    sdays,
  );

  let deleted = 0;
  if (!dryRun && matched > 0) {
    await prisma.$transaction(async (tx) => {
      // 1 — null the chain pointer on the referrers (NoAction FK forbids deleting a still-pointed row).
      await tx.$executeRawUnsafe(`UPDATE ${q(t)} SET "supersedes_id" = NULL WHERE "supersedes_id" IN (${targetSel})`, sdays);
      // 2 — delete the superseded snapshots (CASCADE → patterns / red_flags / guardrail_events).
      deleted = await tx.$executeRawUnsafe(`DELETE FROM ${q(t)} WHERE "id" IN (${targetSel})`, sdays);
      // 3 — delete now-orphaned pillars (no snapshot references them). CASCADE → metrics/subs/ownership/flows.
      await tx.$executeRawUnsafe(
        `DELETE FROM ${q("score_pillars")} p WHERE NOT EXISTS (SELECT 1 FROM ${q(t)} s WHERE ${pillarRefPlain("s")})`,
      );
      // 4 — orphan peer_stats then runs, LAST. RESTRICT-guarded: only truly-dereferenced rows can go.
      await tx.$executeRawUnsafe(
        `DELETE FROM ${q("score_peer_stats")} ps WHERE NOT EXISTS (SELECT 1 FROM ${q("score_metrics")} m WHERE m."peer_stats_snapshot_id" = ps."id")`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM ${q("score_runs")} r
           WHERE NOT EXISTS (SELECT 1 FROM ${q(t)} s WHERE s."run_id" = r."id")
             AND NOT EXISTS (SELECT 1 FROM ${q("score_pillars")} pp WHERE pp."run_id" = r."id")
             AND NOT EXISTS (SELECT 1 FROM ${q("score_peer_stats")} ps WHERE ps."run_id" = r."id")`,
      );
    });
  }

  const res = baseResult(p, "supersede_chain", clamped, sdays, matched, deleted, null);
  res.detail = {
    supersededSnapshots: matched,
    cascadedPatterns,
    cascadedRedFlags,
    cascadedGuardrail,
    projectedOrphanPillars,
    peerStatsRuns: "orphans swept post-cascade at execution (RESTRICT-guarded)",
  };
  return res;
}

// pillarRefPlain: the 4-column OR for a snapshot alias `s` against pillar `p`.
function pillarRefPlain(s: string): string {
  return `(${s}."foundation_pillar_id" = p."id" OR ${s}."momentum_pillar_id" = p."id" OR ${s}."market_pillar_id" = p."id" OR ${s}."ownership_pillar_id" = p."id")`;
}

function baseResult(
  p: RetentionPolicyRow,
  mode: string,
  clamped: boolean,
  effective: number,
  matched: number,
  deleted: number,
  exemption: string | null,
): TableResult {
  return {
    table: p.table,
    mode,
    status: "ok",
    armed: p.armed, // overridden with `held` by the caller for a live+unarmed run
    held: false,
    requested: p.keep ?? p.days ?? p.supersededDays ?? null,
    floor: p.floor,
    effective,
    clamped,
    floorReason: p.floorReason,
    exemption,
    matched,
    deleted,
    note: clamped
      ? `requested ${p.keep ?? p.days ?? p.supersededDays}, floored at ${effective} — ${p.floorReason}`
      : undefined,
  };
}

// ── The run ─────────────────────────────────────────────────────
export async function runRetention(opts: {
  dryRun: boolean;
  /** Restrict the run to these physical table names (a manual single-table run). */
  only?: string[];
  /**
   * Treat the `only` tables as armed regardless of their DB `armed` flag — for an
   * EXPLICIT, --confirm-gated manual run (e.g. the Step-2 daily_prices correction,
   * whose DB flag is deliberately flipped to true only AFTER §13 passes). Never
   * set by the cron. Applies only to tables named in `only`.
   */
  forceArmOnly?: boolean;
  /**
   * PROPOSED (not-yet-saved) policy values, merged onto the loaded rows BEFORE
   * counting. The single home for the count: the admin-UI preview passes a proposed
   * value here and gets a delta computed by the EXACT code the nightly run uses —
   * never a parallel estimate. Each override targets one table; only the set fields
   * (keep/days/supersededDays/armed/enabled) are swapped. Read-only when paired with
   * dryRun:true.
   */
  overrides?: PolicyOverride[];
  onProgress?: (percent: number, note: string) => void | Promise<void>;
}): Promise<RetentionReport> {
  const startedAt = new Date();
  const t0 = Date.now();

  const cat = await loadCatalog();
  let policies = (await prisma.retentionPolicy.findMany()) as unknown as RetentionPolicyRow[];
  if (opts.only) policies = policies.filter((p) => opts.only!.includes(p.table));

  // Merge proposed overrides onto the loaded policy — one value swapped, same code.
  if (opts.overrides) {
    for (const o of opts.overrides) {
      const p = policies.find((x) => x.table === o.table);
      if (!p) continue;
      if (o.keep !== undefined) p.keep = o.keep;
      if (o.days !== undefined) p.days = o.days;
      if (o.supersededDays !== undefined) p.supersededDays = o.supersededDays;
      if (o.armed !== undefined) p.armed = o.armed;
      if (o.enabled !== undefined) p.enabled = o.enabled;
    }
  }

  // Supersede runs LAST (its cascade is internally ordered; depth/time are independent).
  const rank = (m: string) => (m === "supersede_chain" ? 1 : 0);
  const ordered = [...policies].sort((a, b) => rank(a.mode) - rank(b.mode) || a.table.localeCompare(b.table));

  const results: TableResult[] = [];
  let i = 0;
  for (const p of ordered) {
    i++;
    await opts.onProgress?.(Math.round((i / ordered.length) * 100), `${opts.dryRun ? "counting" : "pruning"} ${p.table}`);

    if (!p.enabled) {
      results.push({
        table: p.table, mode: p.mode, status: "skipped_disabled", armed: p.armed, held: false,
        requested: p.keep ?? p.days ?? p.supersededDays ?? null, floor: p.floor,
        effective: null, clamped: false, floorReason: p.floorReason, exemption: p.exceptWhere,
        matched: 0, deleted: 0, note: "disabled (per-table kill switch)",
      });
      continue;
    }

    // A row that is not armed is COUNTED but never deleted — a per-table dry-run,
    // even inside a live run. This is what holds daily_prices back in STEP 1. An
    // explicit --confirm manual run may force-arm the `only` tables (STEP 2).
    const forced = opts.forceArmOnly === true && (opts.only?.includes(p.table) ?? false);
    const isArmed = p.armed || forced;
    const effectiveDryRun = opts.dryRun || !isArmed;

    try {
      assertTable(cat, p.table);
      let res: TableResult;
      if (p.mode === "depth_per_key") res = await runDepth(p, cat, effectiveDryRun);
      else if (p.mode === "time") res = await runTime(p, cat, effectiveDryRun);
      else if (p.mode === "supersede_chain") res = await runSupersede(p, cat, effectiveDryRun);
      else throw new Error(`unknown mode: ${p.mode}`);
      res.armed = p.armed; // report the DB flag, not the override
      res.held = !opts.dryRun && !isArmed; // live run, but this table is held
      if (res.held) res.note = `HELD (armed=false) — counted, NOT deleted${res.note ? "; " + res.note : ""}`;
      results.push(res);
    } catch (e) {
      // One bad policy row (e.g. a UI-typo'd column) must never abort the whole run.
      results.push({
        table: p.table, mode: p.mode, status: "error", armed: p.armed, held: false,
        requested: p.keep ?? p.days ?? p.supersededDays ?? null, floor: p.floor,
        effective: null, clamped: false, floorReason: p.floorReason, exemption: p.exceptWhere,
        matched: 0, deleted: 0, error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const finishedAt = new Date();
  return {
    dryRun: opts.dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Date.now() - t0,
    totalMatched: results.reduce((s, r) => s + r.matched, 0),
    totalDeleted: results.reduce((s, r) => s + r.deleted, 0),
    clampsFired: results.filter((r) => r.clamped).length,
    results,
  };
}
