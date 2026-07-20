// ─────────────────────────────────────────────────────────────
// RETENTION ADMIN CONTROLLER (Layer 3) — the surface over retention_policy.
// Mounted at /api/v1/admin/retention behind requireAdmin. The guardrails are the
// point, and they live in two PURE functions (previewPolicyChange /
// applyPolicyChange) that the endpoints wrap AND the verify script exercises
// directly — so the test hits the exact code the UI does:
//   · the preview and the save-time projection both come from the SAME
//     runRetention dry-run (one home for the count),
//   · every admin change writes exactly one retention_policy_audit row in the SAME
//     transaction as the policy UPDATE, with a server-computed projected delta
//     (never client-passed).
// ─────────────────────────────────────────────────────────────
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { runRetention } from "../../retention/engine.js";
import type { PolicyOverride } from "../../retention/policy.js";

// The editable fields (mode-dependent) — the ONLY columns this UI may write.
// floor / mode / key / exemption are correctness constraints, never editable here.
const NUMERIC_FIELDS = ["keep", "days", "supersededDays"] as const;
const BOOL_FIELDS = ["armed", "enabled"] as const;
const EDITABLE = [...NUMERIC_FIELDS, ...BOOL_FIELDS] as const;
export type EditableField = (typeof EDITABLE)[number];

const changeSchema = z.object({
  field: z.enum(EDITABLE),
  value: z.union([z.number().int(), z.boolean()]),
});

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** The REAL nightly deletion count under a policy row's state: 0 if disabled
 *  (skipped) or unarmed (held/counted-not-deleted), else the clamped dry-run count. */
function effectiveDeletions(r: { status: string; armed: boolean; matched: number } | undefined): number {
  if (!r) return 0;
  if (r.status === "skipped_disabled") return 0;
  if (!r.armed) return 0;
  return r.matched;
}

/** One dry-run for one table under an optional proposed override — THE single home
 *  for the count, reused by preview AND the save-time projection AND the verify. */
async function projectFor(table: string, override?: PolicyOverride) {
  const report = await runRetention({ dryRun: true, only: [table], overrides: override ? [override] : undefined });
  const r = report.results.find((x) => x.table === table);
  return {
    deletions: effectiveDeletions(r),
    clamped: r?.clamped ?? false,
    effective: r?.effective ?? null,
    floor: r?.floor ?? null,
    floorReason: r?.floorReason ?? "",
  };
}

function overrideOf(table: string, field: EditableField, value: number | boolean): PolicyOverride {
  return { table, [field]: value } as unknown as PolicyOverride;
}
function typeMatches(field: EditableField, value: number | boolean): boolean {
  return NUMERIC_FIELDS.includes(field as never) ? typeof value === "number" : typeof value === "boolean";
}
function serialize(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
function projectionString(deletions: number, clamped: boolean, floor: number | null, reason: string): string {
  return `next run would delete ${deletions} rows` + (clamped ? ` (clamped to floor ${floor}: ${reason})` : "");
}

// ── PURE FUNCTION: preview a proposed change (real dry-run, writes nothing) ──
export async function previewPolicyChange(table: string, field: EditableField, value: number | boolean): Promise<Result<{
  table: string; field: EditableField; value: number | boolean;
  currentDeletions: number; proposedDeletions: number; delta: number;
  clamped: boolean; effective: number | null; floor: number | null; floorReason: string;
}>> {
  const policy = await prisma.retentionPolicy.findUnique({ where: { table } });
  if (!policy) return { ok: false, status: 404, error: `Unknown policy table: ${table}` };
  if (!typeMatches(field, value)) return { ok: false, status: 400, error: `${field} expects a ${NUMERIC_FIELDS.includes(field as never) ? "number" : "boolean"}` };

  const current = await projectFor(table); // persisted state
  const proposed = await projectFor(table, overrideOf(table, field, value));
  return {
    ok: true,
    data: {
      table, field, value,
      currentDeletions: current.deletions,
      proposedDeletions: proposed.deletions,
      delta: proposed.deletions - current.deletions,
      clamped: proposed.clamped, effective: proposed.effective, floor: proposed.floor, floorReason: proposed.floorReason,
    },
  };
}

// ── PURE FUNCTION: apply a change — projection + policy UPDATE + audit INSERT in
//    ONE transaction. `projectedDelta` is SERVER-computed here (never client-passed).
//    A sub-floor numeric is accepted and CLAMPED by the engine at run time; the
//    projection reflects the clamped effect, so the audit records what will truly happen.
export async function applyPolicyChange(table: string, field: EditableField, value: number | boolean, changedBy: string): Promise<Result<{
  policy: unknown; projectedDelta: string; clamped: boolean; floor: number | null;
}>> {
  const policy = await prisma.retentionPolicy.findUnique({ where: { table } });
  if (!policy) return { ok: false, status: 404, error: `Unknown policy table: ${table}` };
  if (!typeMatches(field, value)) return { ok: false, status: 400, error: `${field} expects a ${NUMERIC_FIELDS.includes(field as never) ? "number" : "boolean"}` };

  const proposed = await projectFor(table, overrideOf(table, field, value));
  const projectedDelta = projectionString(proposed.deletions, proposed.clamped, proposed.floor, proposed.floorReason);
  const oldValue = serialize((policy as Record<string, unknown>)[field]);

  const data: Prisma.RetentionPolicyUpdateInput = {};
  if (field === "keep") data.keep = value as number;
  else if (field === "days") data.days = value as number;
  else if (field === "supersededDays") data.supersededDays = value as number;
  else if (field === "armed") data.armed = value as boolean;
  else if (field === "enabled") data.enabled = value as boolean;

  const [updated] = await prisma.$transaction([
    prisma.retentionPolicy.update({ where: { table }, data }),
    prisma.retentionPolicyAudit.create({
      data: { policyTable: table, field, oldValue, newValue: serialize(value), changedBy, projectedDelta },
    }),
  ]);
  return { ok: true, data: { policy: updated, projectedDelta, clamped: proposed.clamped, floor: proposed.floor } };
}

// ── ENDPOINTS (thin wrappers over the pure functions) ──
export async function getPolicies(_req: Request, res: Response): Promise<void> {
  const rows = await prisma.retentionPolicy.findMany({ orderBy: [{ mode: "asc" }, { table: "asc" }] });
  res.json({ success: true, data: rows });
}

export async function previewChange(req: Request, res: Response): Promise<void> {
  const table = String(req.body?.table ?? "");
  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: "Invalid field/value" }); return; }
  const r = await previewPolicyChange(table, parsed.data.field, parsed.data.value);
  if (!r.ok) { res.status(r.status).json({ success: false, error: r.error }); return; }
  res.json({ success: true, data: r.data });
}

export async function writePolicy(req: Request, res: Response): Promise<void> {
  const table = String(req.params.table);
  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: "Invalid field/value" }); return; }
  // The acting admin's NAME for the audit record — resolved FROM the token's user
  // (never a payload value, so it stays IDOR-safe): display name → email → id fallback,
  // because most users have no display_name yet.
  const auth = req.authUser!;
  const ledger = await prisma.userLedger.findUnique({ where: { userId: auth.userId }, select: { displayName: true } });
  const changedBy = ledger?.displayName?.trim() || auth.email || auth.userId;
  const r = await applyPolicyChange(table, parsed.data.field, parsed.data.value, changedBy);
  if (!r.ok) { res.status(r.status).json({ success: false, error: r.error }); return; }
  res.json({ success: true, data: r.data });
}

export async function getAudit(req: Request, res: Response): Promise<void> {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const [rows, total] = await Promise.all([
    prisma.retentionPolicyAudit.findMany({ orderBy: { changedAt: "desc" }, take: limit, skip: (page - 1) * limit }),
    prisma.retentionPolicyAudit.count(),
  ]);
  res.json({ success: true, data: rows, total, page, limit });
}

export async function getAuditForTable(req: Request, res: Response): Promise<void> {
  const rows = await prisma.retentionPolicyAudit.findMany({
    where: { policyTable: String(req.params.table) },
    orderBy: { changedAt: "desc" }, take: 100,
  });
  res.json({ success: true, data: rows });
}
