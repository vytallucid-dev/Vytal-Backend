// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FENCE — enforcement layers (2) and (3). The PROOF that layer (1) held.
//
// Layer (1), INSERT … ON CONFLICT DO NOTHING in bse-writer.ts, is the guarantee. This file is the
// evidence that it worked, captured independently of the code that made the promise.
//
// ⚠ A GUARANTEE WITHOUT PROOF IS WHAT WE HAD BEFORE T3. The point is not to trust the writer; it is
//   to be able to show, after the fact and from the database itself, that not one NSE row moved.
//
//   (2) BASELINE DIFF   — every NSE row's id + updated_at captured BEFORE the run, compared AFTER.
//                         Catches an update, a delete, and a row swapped for a new id.
//   (3) SOURCE COUNT    — rows WHERE source LIKE 'nse\_%' AND updated_at > run_start. Must be 0.
//                         Independent of the baseline: catches anything the baseline missed because
//                         it was inserted mid-run.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { PrismaClient } from "../../../generated/prisma/client.js";

export const FENCED_TABLES = [
  "quarterly_results",
  "fundamentals",
  "banking_quarterly_results",
  "banking_fundamentals",
  "nbfc_quarterly_results",
  "nbfc_fundamentals",
  "life_insurance_quarterly_results",
  "life_insurance_fundamentals",
  "general_insurance_quarterly_results",
  "general_insurance_fundamentals",
] as const;

export type FencedTable = (typeof FENCED_TABLES)[number];

export interface Baseline {
  capturedAt: Date;
  /** table -> rowId -> updated_at epoch ms. NSE-sourced rows only. */
  rows: Record<string, Map<string, number>>;
  totals: Record<string, number>;
}

/** ⚠ Table names are interpolated from the FENCED_TABLES literal union only — never from input. */
export async function captureBaseline(prisma: PrismaClient): Promise<Baseline> {
  const rows: Record<string, Map<string, number>> = {};
  const totals: Record<string, number> = {};
  for (const t of FENCED_TABLES) {
    const res = await prisma.$queryRawUnsafe<Array<{ id: string; updated_at: Date }>>(
      `SELECT id, updated_at FROM ${t} WHERE source LIKE 'nse\\_%'`,
    );
    const m = new Map<string, number>();
    for (const r of res) m.set(r.id, new Date(r.updated_at).getTime());
    rows[t] = m;
    totals[t] = m.size;
  }
  return { capturedAt: new Date(), rows, totals };
}

export interface FenceViolation {
  table: string;
  kind: "updated" | "disappeared";
  rowId: string;
  detail: string;
}

export interface FenceReport {
  ok: boolean;
  violations: FenceViolation[];
  /** Layer (3): NSE rows whose updated_at moved after the run started, counted per table. */
  touchedSinceStart: Record<string, number>;
  baselineTotals: Record<string, number>;
  afterTotals: Record<string, number>;
}

export async function verifyFence(
  prisma: PrismaClient,
  baseline: Baseline,
  runStart: Date,
): Promise<FenceReport> {
  const violations: FenceViolation[] = [];
  const touchedSinceStart: Record<string, number> = {};
  const afterTotals: Record<string, number> = {};

  for (const t of FENCED_TABLES) {
    // ── layer (2): baseline diff ────────────────────────────────────────────────
    const after = await prisma.$queryRawUnsafe<Array<{ id: string; updated_at: Date }>>(
      `SELECT id, updated_at FROM ${t} WHERE source LIKE 'nse\\_%'`,
    );
    const seen = new Map<string, number>();
    for (const r of after) seen.set(r.id, new Date(r.updated_at).getTime());
    afterTotals[t] = seen.size;

    for (const [id, was] of baseline.rows[t]) {
      const now = seen.get(id);
      if (now === undefined) {
        violations.push({ table: t, kind: "disappeared", rowId: id, detail: "NSE row present at baseline is gone" });
      } else if (now !== was) {
        violations.push({
          table: t,
          kind: "updated",
          rowId: id,
          detail: `updated_at moved ${new Date(was).toISOString()} -> ${new Date(now).toISOString()}`,
        });
      }
    }

    // ── layer (3): independent source-based count ───────────────────────────────
    const cnt = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM ${t} WHERE source LIKE 'nse\\_%' AND updated_at > $1`,
      runStart,
    );
    touchedSinceStart[t] = Number(cnt[0]?.n ?? 0n);
  }

  const anyTouched = Object.values(touchedSinceStart).some((n) => n > 0);
  return {
    ok: violations.length === 0 && !anyTouched,
    violations,
    touchedSinceStart,
    baselineTotals: baseline.totals,
    afterTotals,
  };
}
