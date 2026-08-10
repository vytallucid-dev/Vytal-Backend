// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIVERSE BOUNDARY — the ONE place the "not covered" message is authored.
//
// ★ THE CHECK STAYS PER-TOOL; THE MESSAGE IS SHARED. Every stock read service already does its own live
// `prisma.stock.findUnique({ where: { symbol } })` and returns null for a symbol outside Vytal's covered
// universe (health-view.service.ts, etc.) — so the boundary is enforced independently by each tool from
// LIVE data, never a hardcoded list, and expands automatically as the universe grows. What must NOT be
// duplicated is the WORDING: a tool that invents its own "not covered" sentence will drift from the trust
// statement this represents. So the check is many; the message is one, here.
//
// ⚠ IT IS A TRUST STATEMENT, NOT AN APOLOGY, AND NOT A CLAIM THE COMPANY ISN'T REAL. `searchStocks` (and a
// bare findUnique) cannot tell "no such company" from "real company, outside our coverage" — so the message
// must assert only what is true: the symbol is outside the set Vytal has vetted, and we don't show data we
// haven't verified. This text is a TOOL RESULT read by the model, so it is framed as an instruction to the
// model about how to relay the boundary in its own voice — never invent facts, never apologise.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { filingFactsText } from "../../ai/filing-facts.js";
import type { FilingFindingsSection } from "../../filing/read.types.js";

/** The covered-universe boundary message for a symbol the read service returned null for. */
export function notInUniverse(symbol: string): string {
  const s = symbol.trim().toUpperCase() || "that symbol";
  return (
    `NOT COVERED: ${s} is not in Vytal's covered universe, so Vytal has no verified health facts, score, ` +
    `pillars, or findings for it. This is a coverage boundary, not a claim about whether the company exists. ` +
    `Tell the reader plainly that Vytal only shows data for the names it has vetted and that ${s} sits outside ` +
    `that set — do not apologise for it, do not guess, and do not state any number or fact about ${s}.`
  );
}

/**
 * The in-universe-but-not-yet-scored message (the read service returned a snapshot whose `scored` is
 * false — a real, informative state that is NOT the same as "not covered").
 *
 * ── ★ IT USED TO SAY "no composite, pillars, or findings exist for it", AND THE THIRD WAS FALSE ────
 * A filing finding is a statement about what the company FILED — pledging, a promoter exit, an
 * earnings-quality run — and is true whether or not anyone ever computed a health score for it. The
 * caller is already holding that section (`HealthSnapshotView.filingFindings` is populated on the
 * not-scored branch by construction), so the message takes it rather than claiming its absence: on
 * 360ONE this sentence stood in front of a critical red flag over 90% of the promoter holding.
 *
 * `filing` is required, not optional. An optional parameter would let a future call site quietly
 * restore the old sentence by omitting it — which is the defect, spelled `undefined`.
 */
export function inUniverseButUnscored(
  symbol: string,
  name: string | null,
  filing: FilingFindingsSection | null,
): string {
  const s = symbol.trim().toUpperCase() || "that symbol";
  const who = name ? `${name} (${s})` : s;
  return [
    `IN UNIVERSE, NOT SCORED: ${who} is covered by Vytal but does not have a computed health score yet — no ` +
      `composite, pillars, peer standing, or score-derived findings exist for it at this time. Say so honestly; ` +
      `do not fabricate a score or any pillar values.`,
    `⚠ THAT IS NOT THE SAME AS "nothing to report", and it is not a clean bill of health. Vytal's filing checks ` +
      `run on ${s} whether or not it is scored, and their result is below.`,
    "",
    filingFactsText(filing, { subject: s }),
  ].join("\n");
}
