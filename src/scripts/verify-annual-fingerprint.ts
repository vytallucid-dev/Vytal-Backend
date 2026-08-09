// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 4f · DOES A LATE-ARRIVING ANNUAL ROW SELF-HEAL AN ALREADY-WRITTEN BRIEF?
//
// The question this answers, exactly as asked: when the annual filing lands AFTER its own Q4 — 24 NBFC
// filings and 193 non-financial ones do, by up to 89 and 325 days — the Q4 brief has already been
// generated WITHOUT the annual section. The new ingest hook enqueues that brief again. But
// writeQuarterBrief does not regenerate on being asked; it regenerates only when `factsFingerprint`
// differs from what is stored. So the hook is worthless unless the fingerprint MOVES.
//
// It should: the fingerprint is a hash of the exact fact text, and the fact text gains a whole block
// plus loses and gains gap sentences. This proves it rather than assuming it, by building both fact
// texts for a real stock and hashing them — the WITHOUT case by rebuilding the block with `annual`
// forced to null, which is precisely the state the brief was generated in before the annual landed.
//
// ⚠ READS THE DATABASE. Not a build gate; run by hand.
//   npx tsx src/scripts/verify-annual-fingerprint.ts BAJFINANCE:FY26Q4
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText } from "../insight/quarter-brief/prompt.js";
import { fingerprintOf } from "../insight/quarter-brief/write.js";
import type { QuarterBriefFactBlock } from "../insight/quarter-brief/types.js";

const DEFAULTS = ["BAJFINANCE:FY26Q4", "HDFCBANK:FY26Q4", "NMDC:FY26Q4", "GICRE:FY26Q4", "IDEA:FY26Q4"];

/** The block as it WOULD have been built the moment the Q4 quarterly landed and no annual row yet
 *  existed. The presence gate returns null in exactly that situation, so forcing null reproduces it.
 *
 *  ⚠ THE GAPS ARE LEFT AS THEY ARE, WHICH MAKES THIS A CONSERVATIVE TEST. A genuine pre-annual block
 *  would also carry a different first gap ("No full-year balance sheet is on file…"), so the real
 *  before-and-after differ by MORE than what is measured here. A pass under this construction is
 *  therefore a pass under the real one; a fail would not have been. */
function withoutAnnual(block: QuarterBriefFactBlock): QuarterBriefFactBlock {
  return { ...block, annual: null };
}

async function main(): Promise<void> {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;
  let fail = 0;

  for (const t of targets) {
    const [symbol, period] = t.split(":");
    const block = await buildQuarterBriefFactBlock(symbol, period || undefined);
    if (!block) { console.log(`  ? ${t} — no fact block`); continue; }
    if (!block.annual) { console.log(`  · ${t} — no annual section, nothing to prove here`); continue; }

    const withText = renderFactText(block);
    const withoutText = renderFactText(withoutAnnual(block));
    const a = fingerprintOf(withText);
    const b = fingerprintOf(withoutText);

    const moved = a !== b;
    if (!moved) fail++;
    console.log(
      `  ${moved ? "✓" : "✗"} ${t}: fingerprint ${moved ? "MOVES" : "IS UNCHANGED"} when the annual lands ` +
        `(${b.slice(0, 12)} → ${a.slice(0, 12)}), fact text ${withoutText.length} → ${withText.length} chars, ` +
        `+${block.annual.lines.length} annual lines`,
    );
  }

  // The whole point: a brief written before its annual arrived is stale the moment it does, and
  // writeQuarterBrief's hash comparison is what turns the new hook into an actual regeneration.
  console.log(
    `\n${fail === 0
      ? "✅ THE LATE ANNUAL SELF-HEALS — every fingerprint moved, so the enqueue from ingestAnnual reaches generation rather than being skipped as unchanged."
      : `❌ ${fail} case(s) did NOT move — the hook would enqueue and writeQuarterBrief would skip, leaving the brief permanently without its annual section.`}`,
  );
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
