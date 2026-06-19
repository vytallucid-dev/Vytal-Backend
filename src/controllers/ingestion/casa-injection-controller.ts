// ─────────────────────────────────────────────────────────────
// LIVE CASA INJECTION — ADMIN CONTROLLER
//
// POST /api/v1/admin/bank-supplementary/casa
//   Inject a SINGLE live CASA value (with source) for a PG5/PG6 bank. CASA-ONLY:
//   Tier-1 is XBRL-primary and is NOT injectable here. Validates the CN-4 citation
//   gate + the unit-sanity band, then writes an append-only supersede row. The new
//   CASA flows into the bank's F7 (CASA) on the next live banking score.
//
//   400 on any validation failure (errors[]); 200 with the accepted action +
//   warnings[] (e.g. confidence=C verify-warning).
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { z } from "zod";
import { injectLiveCasa } from "../../ingestions/bank-supplementary/inject-casa.js";

// Envelope-shape only. The rich CASA validation (band, CN-4 citation, 12-bank symbol,
// metricKey=casa_pct, confidence) lives in injectLiveCasa so every reason is explicit.
const BodySchema = z.object({
  enteredBy: z.string().min(1, "enteredBy is required"),
  symbol: z.string().min(1, "symbol is required"),
  fiscalYear: z.string().min(1, "fiscalYear is required"),
  periodEnd: z.string().optional().nullable(),
  value: z.number({ error: "value must be a number (CASA percent)" }),
  sourceCitation: z.string().optional().nullable(), // presence enforced in injectLiveCasa (CN-4 reason)
  confidence: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  metricKey: z.string().optional().nullable(), // optional; rejected unless "casa_pct"
});

export const injectCasa = async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Invalid request body", details: parsed.error.flatten().fieldErrors });
  }

  try {
    const result = await injectLiveCasa({
      symbol: parsed.data.symbol,
      fiscalYear: parsed.data.fiscalYear,
      periodEnd: parsed.data.periodEnd ?? null,
      value: parsed.data.value,
      sourceCitation: parsed.data.sourceCitation ?? "",
      confidence: parsed.data.confidence ?? "",
      notes: parsed.data.notes ?? null,
      metricKey: parsed.data.metricKey ?? undefined,
      enteredBy: parsed.data.enteredBy,
    });

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: `CASA injection REJECTED: ${result.errors.length} validation failure${result.errors.length === 1 ? "" : "s"}. Nothing written.`,
        data: { errors: result.errors, warnings: result.warnings },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        action: result.action, // inserted | superseded | unchanged
        symbol: result.symbol,
        fiscalYear: result.fiscalYear,
        value: result.value,
        version: result.version,
        rowId: result.rowId,
        supersededId: result.supersededId,
        warnings: result.warnings,
        note: result.action === "unchanged"
          ? "identical value+source already on file — no new version written"
          : `CASA ${result.action} as version ${result.version}; flows into F7 on the next live banking score for ${result.symbol}`,
      },
    });
  } catch (err) {
    console.error("[bank-supplementary/casa] error:", err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
};
