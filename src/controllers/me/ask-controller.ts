// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// /api/v1/me/ask — THE NEW PATH, SERVED. One question in; sections, prose and coverage out.
//
// ── ★ WHAT CROSSES THIS BOUNDARY, AND WHAT NEVER DOES ─────────────────────────────────────────────
// Out: `payload` (fat, for the browser) and `prose` (authored sentences). **`digest` is stripped.**
// It is the model-facing half of every section (N-2) and the browser has no use for it; shipping it
// would put a second, differently-worded copy of every figure on the wire, and the first component
// to read it would be rendering the model's view of the data instead of the reader's.
//
// ── ★ THE RESPONSE IS A DISCRIMINATED UNION, NOT AN ANSWER WITH OPTIONAL FIELDS ───────────────────
// `out_of_scope`, `clarify_operation`, `clarify_subject`, `subject_not_covered` and `composed` are
// five different things that happened, and a client that had to infer which by testing for an empty
// `sections` array would eventually render a stop as a failed load.
//
// ── ★ THE READER IS THE SESSION'S, NEVER THE PAYLOAD'S ────────────────────────────────────────────
// Same rule as every other `me` route. It is what makes a reader-subject question answerable at all
// and what makes an action control safe to render: the control's endpoint derives its owner the same
// way, so a forged body reaches nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { route, modelClassifier } from "../../router/route.js";
import { composeTurn } from "../../composition/compose.js";

const AskBody = z.object({
  message: z.string().trim().min(1, "Ask something.").max(2000),
});

/** Strip the model-facing half. See the header — N-2 is enforced at the wire, not by convention. */
const forBrowser = (s: {
  kind: string; renderer: string; payload: unknown; coverage: unknown; interactions: unknown;
}) => ({ kind: s.kind, renderer: s.renderer, payload: s.payload, coverage: s.coverage, interactions: s.interactions });

export const ask = async (req: Request, res: Response): Promise<void> => {
  const userId = req.authUser!.userId;
  const parsed = AskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
    return;
  }

  try {
    const turn = await route(parsed.data.message, modelClassifier, { userId });
    const result = await composeTurn(turn, { userId });

    // ★ THE ROUTER'S OWN READING RIDES ALONG ON EVERY RESPONSE. It is what makes a wrong answer
    //   diagnosable from a transcript rather than only from a server log, and `source` is what
    //   separates "the model could not classify this" from "we never asked the model" (§6.5).
    const routed = {
      scope: turn.router.scope,
      operation: turn.router.operation,
      lens: turn.router.lens,
      perspective: turn.router.perspective,
      action: turn.router.action,
      source: turn.router.source,
      subjects: turn.subjects.map((s) => (s.kind === "stock" ? { kind: s.kind, symbol: s.symbol, name: s.name }
        : s.kind === "instrument" ? { kind: s.kind, identifier: s.identifier, name: s.name }
        : { kind: s.kind })),
    };

    if (result.kind === "composed") {
      res.json({
        success: true,
        data: {
          kind: "composed",
          compositionId: result.compositionId,
          prose: result.prose,
          sections: result.sections.map(forBrowser),
          routed,
          ...(result.plan ? { plan: { source: result.plan.source, rejected: result.plan.rejected } } : {}),
        },
      });
      return;
    }

    res.json({ success: true, data: { ...result, routed } });
  } catch (e) {
    // ⚠ A THROWN COMPOSITION IS A 500 THAT SAYS SO. The one thing it must not do is degrade to an
    //   empty answer — a reader shown nothing reads it as "we checked and found nothing".
    console.error("[me/ask]", e);
    res.status(500).json({
      success: false,
      error: "compose_failed",
      message: "Something went wrong putting that answer together. Nothing about your account changed.",
    });
  }
};
