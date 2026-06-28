// ─────────────────────────────────────────────────────────────
// INGESTION-ERRORS ADMIN CONTROLLER (the resolution UI backend)
//   GET    /api/v1/admin/ingestion-errors           — triage list + filters
//   PATCH  /api/v1/admin/ingestion-errors/:id        — resolve / ignore
//   POST   /api/v1/admin/ingestion-errors/:id/fill   — hand-fill → re-derive → cascade
//   POST   /api/v1/admin/ingestion-errors/:id/refetch— prices re-fetch job
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { applyRawFieldEdit } from "../../fill/raw-field-edit.js";
import { resolveErrorRowId, annotateFill, fillMetaFor, REFETCH_TABLES } from "../../fill/error-resolution.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";
import { enqueueOrGetPgRescore } from "../../jobs/scoring-triggers.js";
import { scoredPgById, pgRefsForSymbols } from "../../scoring/composite/pg-registry.js";
import type { PgRef } from "../../scoring/composite/score-pass.js";

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ── GET / — list + filters ────────────────────────────────────
const ListQuery = z.object({
  status: z.string().optional(), // default "open"; "all" = no filter
  severity: z.string().optional(),
  cron: z.string().optional(),
  source: z.string().optional(),
  resolutionPath: z.enum(["source_code", "admin_fill", "rescore"]).optional(),
  guardType: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const listIngestionErrors = async (req: Request, res: Response) => {
  const q = ListQuery.safeParse(req.query);
  if (!q.success) return res.status(400).json({ success: false, error: "Invalid query", details: q.error.flatten().fieldErrors });
  const { status, severity, cron, source, resolutionPath, guardType, page, limit } = q.data;

  const where: Record<string, unknown> = {};
  if (!status || status === "open") where.status = "open";
  else if (status !== "all") where.status = status;
  if (severity) where.severity = severity;
  if (cron) where.cron = cron;
  if (source) where.source = source;
  if (resolutionPath) where.resolutionPath = resolutionPath;
  if (guardType) where.guardType = guardType;

  const [rows, total] = await Promise.all([
    prisma.ingestionError.findMany({ where, orderBy: { lastSeenAt: "desc" }, take: limit, skip: (page - 1) * limit }),
    prisma.ingestionError.count({ where }),
  ]);

  // Severity-prominence sort (critical first), then most-recent; annotate fill/refetch.
  const data = rows
    .map((r) => {
      const { fill, reFetchAvailable } = annotateFill(r);
      return {
        ...r,
        createdAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        severityRank: SEV_RANK[r.severity] ?? 9,
        fill,
        reFetchAvailable,
      };
    })
    .sort((a, b) => a.severityRank - b.severityRank || b.lastSeenAt.localeCompare(a.lastSeenAt));

  return res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
};

// ── PATCH /:id — resolve / ignore ─────────────────────────────
const PatchBody = z.object({
  status: z.enum(["resolved", "ignored", "open"]),
  resolvedBy: z.string().optional(),
  note: z.string().optional(),
});

export const patchIngestionError = async (req: Request, res: Response) => {
  const b = PatchBody.safeParse(req.body);
  if (!b.success) return res.status(400).json({ success: false, error: "Invalid body", details: b.error.flatten().fieldErrors });
  const existing = await prisma.ingestionError.findUnique({ where: { id: req.params.id as string } });
  if (!existing) return res.status(404).json({ success: false, error: "Ingestion error not found" });

  const terminal = b.data.status !== "open";
  const updated = await prisma.ingestionError.update({
    where: { id: existing.id },
    data: {
      status: b.data.status,
      resolvedBy: terminal ? (b.data.resolvedBy ?? "user:admin") : null,
      resolvedAt: terminal ? new Date() : null,
      resolutionNote: b.data.note ?? existing.resolutionNote,
    },
  });
  return res.json({ success: true, data: { id: updated.id, status: updated.status, resolvedBy: updated.resolvedBy, resolvedAt: updated.resolvedAt?.toISOString() ?? null } });
};

// ── POST /:id/fill — hand-fill → re-derive → cascade ──────────
const FillBody = z.object({
  field: z.string(),
  value: z.number().nullable(),
  citation: z.string().min(4, "citation required (CN-4)"),
  note: z.string().optional(),
  editedBy: z.string().optional(),
});

export const fillIngestionError = async (req: Request, res: Response) => {
  const b = FillBody.safeParse(req.body);
  if (!b.success) return res.status(400).json({ success: false, error: "Invalid body", details: b.error.flatten().fieldErrors });
  const err = await prisma.ingestionError.findUnique({ where: { id: req.params.id as string } });
  if (!err) return res.status(404).json({ success: false, error: "Ingestion error not found" });

  // Resolve the concrete row to edit from the error's entity.
  const rowId = await resolveErrorRowId(err.targetTable, err.targetEntity, err.runRef);
  if (!rowId) {
    return res.status(422).json({ success: false, error: `Could not resolve a fillable row for ${err.targetTable} / ${err.targetEntity ?? "(no entity)"}. This table/field may not be hand-fillable.` });
  }

  const meta = fillMetaFor(err.targetTable, b.data.field);
  const result = await applyRawFieldEdit({
    table: err.targetTable,
    rowId,
    field: b.data.field,
    newValue: b.data.value,
    citation: b.data.citation,
    editedBy: b.data.editedBy ?? "user:admin",
    note: b.data.note,
    bounds: meta.bounds ?? undefined,
  });
  if (!result.ok) return res.status(400).json({ success: false, error: result.reason });

  // The raw data is corrected + re-derived synchronously → the violation is
  // resolved; the score rescore (if any) runs async (poll jobId).
  await prisma.ingestionError.update({
    where: { id: err.id },
    data: {
      status: "resolved",
      resolvedBy: b.data.editedBy ?? "user:admin",
      resolvedAt: new Date(),
      resolutionCitation: b.data.citation,
      resolutionNote: `Filled ${err.targetTable}.${b.data.field} = ${b.data.value}${b.data.note ? ` — ${b.data.note}` : ""}`,
    },
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: result.jobId,
      statusUrl: result.jobId ? `/api/v1/admin/jobs/${result.jobId}` : null,
      cascade: result.cascade, // banking | general | prices | none
      reDerivedChanged: result.reDerived?.changed ?? {},
      done: result.jobId == null, // events (no rescore) complete immediately
      note: "Filling re-derived all dependent ratios from current data — stale values get corrected.",
    },
  });
};

// ── POST /:id/refetch — prices feed re-fetch (the feed-break route) ──
export const refetchIngestionError = async (req: Request, res: Response) => {
  const err = await prisma.ingestionError.findUnique({ where: { id: req.params.id as string } });
  if (!err) return res.status(404).json({ success: false, error: "Ingestion error not found" });
  if (!REFETCH_TABLES.has(err.targetTable)) {
    return res.status(422).json({ success: false, error: `Re-fetch is not available for ${err.targetTable} (only ${[...REFETCH_TABLES].join(", ")}).` });
  }
  const dateIso = err.runRef?.split(":")[0];
  if (!dateIso) return res.status(422).json({ success: false, error: "Could not determine the trading date to re-fetch (no runRef)." });

  const job = await enqueueJob({
    type: JobTypes.PRICES_REFETCH,
    payload: { dateIso, triggeredBy: "user:admin", reason: `re-fetch for ingestion error ${err.id}` },
    triggeredBy: "user:admin",
  });
  return res.status(202).json({
    success: true,
    data: { jobId: job.id, statusUrl: `/api/v1/admin/jobs/${job.id}`, dateIso, message: `Re-fetching the bhavcopy for ${dateIso}. Poll the status URL.` },
  });
};

// ── POST /:id/rescore — re-score a scoring-error entity (the resolve action) ──
// Near-twin of refetch: map the scoring-error row's entity → the right rescore
// trigger, return the pollable jobId, and DO NOT mark the row resolved here — the
// row is closed only when the rescore SUCCEEDS, via auto-resolve-on-heal in the
// worker (a rescore that fails again must leave the row open for retry).
export const rescoreIngestionError = async (req: Request, res: Response) => {
  const err = await prisma.ingestionError.findUnique({ where: { id: req.params.id as string } });
  if (!err) return res.status(404).json({ success: false, error: "Ingestion error not found" });

  // GUARD: only scoring rows with the rescore resolution path. An ingestion row
  // (a bad input value / feed) can't be "rescored" — it needs a fill or a code fix.
  if (err.source !== "scoring" || err.resolutionPath !== "rescore") {
    return res.status(422).json({
      success: false,
      error: "Re-score is only available for scoring errors (resolutionPath=rescore). Use Fill / Re-fetch / code-fix for ingestion rows.",
    });
  }

  // Map the stored entity → the PG(s) to rescore.
  //   • pgId set  → a PG-keyed failure (pg_rescore / pg_cascade) → rescore that PG.
  //   • else      → a symbol-keyed failure (fill_cascade); targetEntity = "SYMBOL@period"
  //                 → fan the symbol to its scored PG(s).
  let refs: PgRef[] = [];
  if (err.pgId) {
    const ref = scoredPgById(err.pgId);
    if (!ref) {
      return res.status(422).json({ success: false, error: `Unknown scored PG "${err.pgId}" — cannot rescore (it is not one of the 13 scored peer groups).` });
    }
    refs = [ref];
  } else if (err.targetEntity) {
    const symbol = err.targetEntity.split("@")[0];
    refs = await pgRefsForSymbols([symbol]);
    if (!refs.length) {
      return res.status(422).json({ success: false, error: `Symbol "${symbol}" maps to no scored peer group — cannot rescore.` });
    }
  } else {
    return res.status(422).json({ success: false, error: "Scoring error carries no pgId or entity — cannot determine what to rescore." });
  }

  // Enqueue (or coalesce onto an in-flight) rescore per PG; the FIRST jobId is the
  // pollable handle the UI tracks.
  const reason = `manual rescore for scoring error ${err.id}`;
  const jobIds: string[] = [];
  let anyCoalesced = false;
  for (const ref of refs) {
    const handle = await enqueueOrGetPgRescore(ref, "user:admin", reason);
    jobIds.push(handle.jobId);
    anyCoalesced = anyCoalesced || handle.coalesced;
  }

  return res.status(202).json({
    success: true,
    data: {
      jobId: jobIds[0],
      statusUrl: `/api/v1/admin/jobs/${jobIds[0]}`,
      jobIds,
      pgIds: refs.map((r) => r.pgId),
      coalesced: anyCoalesced,
      message: anyCoalesced
        ? `A rescore for ${refs.map((r) => r.pgId).join(", ")} is already in flight — tracking it. The row resolves automatically when it succeeds.`
        : `Re-scoring ${refs.map((r) => r.pgId).join(", ")}. The row resolves automatically when the rescore succeeds. Poll the status URL.`,
    },
  });
};
