// ─────────────────────────────────────────────────────────────
// MISS-LOG ADMIN CONTROLLER (T-0) — the read surface over composition_misses.
// Mounted at /api/v1/admin/miss-log behind requireAdmin.
//
// ★ READ-ONLY, AND STRUCTURALLY SO. There is no write endpoint and there is not
//   going to be one: rows are appended by `recordMiss` on the way out of a turn,
//   and an admin surface that could edit them would be an admin surface that
//   could edit the evidence.
//
// ★ THE `source` SPLIT IS APPLIED BY DEFAULT (§6.5). `?allSources=true` opts out.
//   A lexical `unresolved` is our quota talking, not the reader, and the ranking
//   that decides what gets BUILT must not count it. The split totals ride on
//   every response regardless, so the denial volume is never invisible.
// ─────────────────────────────────────────────────────────────
import type { Request, Response } from "express";
import { z } from "zod";
import {
  summariseMisses, topMissedQuestions, missShapes, missingDataCensus, sectionsAlmostServed,
} from "../../composition/miss-log.js";

const Query = z.object({
  // Unbounded by default — the tail is the signal. See the module header.
  days: z.coerce.number().int().positive().max(3650).optional(),
  limit: z.coerce.number().int().positive().max(200).default(25),
  /**
   * ⚠ NOT `z.coerce.boolean()`. That coerces with JS truthiness, so the STRING "false" — which is
   * exactly what `?allSources=false` puts in req.query — becomes `true`, and the caller who
   * explicitly asked for the §6.5 split off would silently get it on. Caught on the live run.
   * Only the literal "true"/"1" opt in; everything else, including absence, keeps the split.
   */
  allSources: z.enum(["true", "false", "1", "0"]).optional()
    .transform((v) => v === "true" || v === "1"),
  /** Harness rows are excluded by default (T-0b). `byOrigin` in the summary shows how many. */
  includeHarness: z.enum(["true", "false", "1", "0"]).optional()
    .transform((v) => v === "true" || v === "1"),
});

export const getMissLog = async (req: Request, res: Response): Promise<void> => {
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
    return;
  }
  const { days, limit, allSources, includeHarness } = parsed.data;
  const modelOnly = !allSources;
  const readerOnly = !includeHarness;

  try {
    const [summary, questions, shapes, missing, sections] = await Promise.all([
      summariseMisses(days, readerOnly),
      topMissedQuestions({ days, limit, modelOnly, readerOnly }),
      missShapes(days, modelOnly, readerOnly),
      missingDataCensus(days, readerOnly),
      sectionsAlmostServed(days, readerOnly),
    ]);
    res.json({
      success: true,
      data: {
        window: { days: days ?? null, modelOnly, readerOnly },
        summary,
        questions,
        shapes,
        missing,
        sectionsAlmostServed: sections,
      },
    });
  } catch (e) {
    console.error("[admin/miss-log]", e);
    res.status(500).json({ success: false, error: "miss_log_read_failed" });
  }
};
