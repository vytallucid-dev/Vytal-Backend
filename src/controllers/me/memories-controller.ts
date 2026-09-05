// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// /api/v1/me/memories — the reader's own stated preferences, as an ORDINARY authenticated endpoint.
//
// ── ★ WHY THIS EXISTS, AND WHY IT IS NOT A TOOL ───────────────────────────────────────────────────
// `rememberThis` and `forgetMemory` were the last two capabilities with no endpoint: the ONLY way to
// write a stated memory was a model calling a tool. That made them the two rows the stage-7
// checklist could not close, and dropping them would have cost the reader their own words.
//
// §5.4's rule holds here without exception: **no model output reaches a write.** The model classifies
// an intent; code renders a control carrying the reader's own text; the reader's tap calls this. The
// endpoint has no idea a model was involved and would behave identically if the text came from a
// settings screen — which is the test of whether the boundary is real.
//
// ── ★ EVERY GUARD THE TOOL HAD, THE ENDPOINT HAS ──────────────────────────────────────────────────
// `addStatedMemory` carries the refusal gate (`classifyMemoryText`), the 200-character cap, the
// 30-item cap that must match the DB CHECK, and the name-request branch. Moving the CALLER must not
// move the GUARD, so this controller adds no validation of its own and removes none: it derives the
// owner from the session, hands the body to the same function the tool called, and translates
// `ServiceError` to a status.
//
// ⚠ THE OWNER COMES FROM `req.authUser`, NEVER FROM THE PAYLOAD. Same rule as every other `me` route.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { addStatedMemory, forgetMemoryById, listMemories } from "../../reader/memory.js";
import { ServiceError } from "../../lib/service-error.js";

const ownerOf = (req: Request): string | null =>
  (req as { authUser?: { id?: string; userId?: string } }).authUser?.id
  ?? (req as { authUser?: { userId?: string } }).authUser?.userId
  ?? null;

function fail(res: Response, e: unknown): void {
  if (e instanceof ServiceError) {
    // ★ THE SERVICE'S OWN STATUS, CODE AND BODY, VERBATIM. `addStatedMemory` refuses whole categories
    //   with a reason the reader needs to see; flattening that to a generic 400 would tell them the
    //   request was malformed when in fact we declined to keep what they said.
    res.status(e.httpStatus).json({ success: false, error: { code: e.code, message: e.message }, ...e.body });
    return;
  }
  console.error("[me/memories]", e);
  res.status(500).json({ success: false, error: { message: "Could not complete that." } });
}

/** Everything we hold about the reader, stated and inferred, each labelled with its source. */
export const listReaderMemories = async (req: Request, res: Response): Promise<void> => {
  const userId = ownerOf(req);
  if (!userId) { res.status(401).json({ success: false, error: { message: "Not signed in." } }); return; }
  try {
    res.json({ success: true, data: { memories: await listMemories(userId) } });
  } catch (e) { fail(res, e); }
};

/**
 * Store one stated memory, or set the reader's form of address.
 *
 * ★ THE REFUSAL IS A 400 WITH THE REASON, NOT A SILENT DROP. `classifyMemoryText` declines whole
 * categories on purpose, and a reader who typed something we will not keep is owed the sentence
 * saying so — otherwise they believe it was stored and act on that belief later.
 */
export const createReaderMemory = async (req: Request, res: Response): Promise<void> => {
  const userId = ownerOf(req);
  if (!userId) { res.status(401).json({ success: false, error: { message: "Not signed in." } }); return; }
  try {
    res.status(201).json({ success: true, data: await addStatedMemory(req.body as { text?: unknown }, userId) });
  } catch (e) { fail(res, e); }
};

/** Forget one, by the id the list returned. Owner-scoped: another reader's id deletes nothing. */
export const deleteReaderMemory = async (req: Request, res: Response): Promise<void> => {
  const userId = ownerOf(req);
  if (!userId) { res.status(401).json({ success: false, error: { message: "Not signed in." } }); return; }
  const id = String(req.params.id ?? "");
  if (!id) { res.status(400).json({ success: false, error: { message: "Which one?" } }); return; }
  try {
    res.json({ success: true, data: await forgetMemoryById(id, userId) });
  } catch (e) { fail(res, e); }
};
