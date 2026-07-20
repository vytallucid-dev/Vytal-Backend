// ═══════════════════════════════════════════════════════════════════════
// ACCOUNT SCOPE — resolve an OPTIONAL `?accountId=` query param into a validated, owner-scoped id
// for the per-account portfolio read endpoints (nav / twr / benchmark).
//
// THE ONE RULE: an accountId that isn't the caller's is NEVER served. The owner always comes from
// the token (req.authUser.userId), never the payload — so IDOR is structurally impossible: a foreign
// or unknown id finds no owned account and is a 404 (no existence disclosure), identical to a missing
// one. When no accountId is supplied the endpoint stays WHOLE-BOOK — additive, no regression to today.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";

export type AccountScope =
  | { ok: true; accountId: string | undefined } // undefined ⇒ whole-book (no accountId supplied)
  | { ok: false }; //                              a 404 was already written to `res`

/**
 * Read `req.query.accountId`, and:
 *  • absent/empty  → { ok: true, accountId: undefined }  (whole-book — unchanged behaviour)
 *  • owned         → { ok: true, accountId: <id> }
 *  • foreign/unknown → writes 404 and returns { ok: false }  (caller must `return` on !ok)
 *
 * The ownership probe is the same owner-scoped `findFirst({ where: { id, userId } })` the account
 * routes use, so the two can never disagree about what "yours" means.
 */
export async function resolveAccountScope(req: Request, res: Response): Promise<AccountScope> {
  const raw = req.query.accountId;
  // Absent, empty, or a repeated param (array) that isn't a single string ⇒ whole-book. A repeated
  // `?accountId=a&accountId=b` stringifies to "a,b", which cannot match a real id → 404 below.
  if (raw == null || raw === "") return { ok: true, accountId: undefined };
  const accountId = String(raw);
  const userId = req.authUser!.userId;

  const account = await prisma.portfolioAccount.findFirst({
    where: { id: accountId, userId }, // owner-scoped → a foreign id is indistinguishable from a missing one
    select: { id: true },
  });
  if (!account) {
    res.status(404).json({ success: false, error: "account_not_found", message: "Account not found" });
    return { ok: false };
  }
  return { ok: true, accountId: account.id };
}
