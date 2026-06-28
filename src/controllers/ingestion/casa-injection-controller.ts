// ─────────────────────────────────────────────────────────────
// LIVE CASA INJECTION — ADMIN CONTROLLER
//
// POST /api/v1/admin/bank-supplementary/casa
//   Inject a SINGLE QUARTERLY CASA value (with source) for a PG5/PG6 bank. CASA-ONLY:
//   Tier-1 is XBRL-primary and is NOT injectable here. The quarterly model: a submission
//   is (symbol, fiscalYear="FY26", quarter="Q2", value, …). Validates the CN-4 citation
//   gate + the unit-sanity band + the quarter, then writes an append-only supersede row
//   keyed per (symbol, casa_pct, fiscalYear, quarter). The new CASA flows into the bank's
//   F7 (CASA) as the newest quarter on the next live banking score (tiered read).
//
//   400 on any validation failure (errors[]); 200 with the accepted action +
//   warnings[] (e.g. confidence=C verify-warning).
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { z } from "zod";
import { injectLiveCasa } from "../../ingestions/bank-supplementary/inject-casa.js";
import { triggerCasaCascade } from "../../jobs/scoring-triggers.js";

// Envelope-shape only. The rich CASA validation (band, CN-4 citation, 12-bank symbol,
// metricKey=casa_pct, confidence) lives in injectLiveCasa so every reason is explicit.
const BodySchema = z.object({
  enteredBy: z.string().min(1, "enteredBy is required"),
  symbol: z.string().min(1, "symbol is required"),
  fiscalYear: z.string().min(1, "fiscalYear is required"),
  quarter: z.string().min(1, "quarter is required"), // "Q1".."Q4" — the quarterly model; validated in injectLiveCasa
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
      quarter: parsed.data.quarter,
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

    // A genuine CASA write (inserted/superseded) changes the bank's F7 → enqueue the CASA
    // FORWARD-CASCADE. The handler self-determines the range from the edited period:
    //   • CURRENT-period edit → a single LIVE rescore (today's behavior).
    //   • PAST-period edit    → PIT-rescore [editedPeriod .. current] + live the current
    //     period, so later snapshots that used the edited quarter as a fallback self-heal.
    // Deduped on (pgId, editedPeriod); gated by SCORING_TRIGGERS_ENABLED. An "unchanged"
    // no-op triggers nothing. Best-effort: a trigger error never fails the (committed) write.
    let rescore: Awaited<ReturnType<typeof triggerCasaCascade>> = null;
    if (result.action !== "unchanged" && result.symbol && result.fiscalYear && result.quarter) {
      const editedPeriod = `${result.fiscalYear}${result.quarter}`; // "FY26" + "Q2" → "FY26Q2"
      try {
        rescore = await triggerCasaCascade(
          result.symbol,
          editedPeriod,
          "hook:casa_inject",
          `CASA ${result.action} for ${result.symbol} ${editedPeriod} (v${result.version})`,
        );
      } catch (err) {
        console.error("[bank-supplementary/casa] cascade trigger error (CASA still written):", err);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        action: result.action, // inserted | superseded | unchanged
        symbol: result.symbol,
        fiscalYear: result.fiscalYear,
        quarter: result.quarter,
        value: result.value,
        version: result.version,
        rowId: result.rowId,
        supersededId: result.supersededId,
        warnings: result.warnings,
        rescoreTriggered: rescore, // { enqueued, deduped, scope, pgIds, jobId } | null (off / unchanged)
        note: result.action === "unchanged"
          ? "identical value+source already on file — no new version written"
          : `CASA ${result.action} as version ${result.version} (${result.fiscalYear}/${result.quarter}); ${rescore?.enqueued ? `forward-cascade enqueued for ${rescore.pgIds.join(",")} (${rescore.scope})` : rescore?.deduped ? "cascade coalesced (one already pending)" : "cascade not enqueued (triggers off)"} → self-heals F7 for ${result.symbol} from ${result.fiscalYear}${result.quarter} forward`,
      },
    });
  } catch (err) {
    console.error("[bank-supplementary/casa] error:", err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
};
