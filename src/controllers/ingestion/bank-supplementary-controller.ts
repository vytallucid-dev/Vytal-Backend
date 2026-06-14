// ─────────────────────────────────────────────────────────────
// BANK SUPPLEMENTARY — ADMIN CONTROLLER
//
// POST /api/v1/admin/bank-supplementary
//   Accepts a SINGLE JSON body of many manual banking figures (CASA, Tier-1),
//   validates strictly + atomically (all-or-nothing), and writes append-only
//   supersede rows. See docs/bank-supplementary-format.md for the contract.
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { z } from "zod";
import { ingestBankSupplementary } from "../../ingestions/bank-supplementary/ingest.js";

// Envelope-shape only. The rich per-entry validation (symbol resolves to a bank,
// metric enum, percent range, required sourceCitation, …) lives in the ingest so
// every bad entry gets its own clear reason rather than a flattened zod blob.
const BodySchema = z.object({
  enteredBy: z.string().min(1, "enteredBy is required"),
  entries: z.array(z.unknown()).min(1, "entries must be a non-empty array"),
});

export const uploadBankSupplementary = async (req: Request, res: Response) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await ingestBankSupplementary({
      enteredBy: parsed.data.enteredBy,
      entries: parsed.data.entries,
    });

    if (!result.ok) {
      // All-or-nothing: at least one entry was invalid, so NOTHING was written.
      const { rejected, total } = result.summary;
      return res.status(400).json({
        success: false,
        error: `Upload rejected (all-or-nothing): ${rejected} of ${total} entr${total === 1 ? "y" : "ies"} invalid. No rows written.`,
        data: { summary: result.summary, rejected: result.rejected },
      });
    }

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("[bank-supplementary/upload] error:", err);
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};
