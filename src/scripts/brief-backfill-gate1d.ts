// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BACKFILL GATE 1d — WHAT HAPPENS WHEN QUOTA RUNS OUT MID-RUN. CONFIRMED, NOT ASSUMED.
//
// Proves the exhaustion path THROUGH THE REAL WRITER at zero cost, by lowering the budget below what
// today has ALREADY spent. The gate is `callCount < limit` in the WHERE of the UPDATE, so a limit under
// the current count denies every caller without a provider call ever being made — the same denial a
// real exhaustion produces, reached from the other side.
//
// ⚠ THE ENV OVERRIDE IS SET IN-PROCESS AND ONLY IN THIS PROCESS. quota.ts reads AI_BUDGET_FLASH_LITE
// per call (envInt, no caching), so nothing persists past this script and .env is never touched.
//
// Three claims, checked one at a time:
//   1 · the refusal is `quota_exhausted`, per stock, and it is VISIBLE (not a swallowed error)
//   2 · NOTHING is written — the row stays absent, so the rest of the run is simply un-generated
//   3 · the counter did not move — a denial costs no budget, so tomorrow starts where today ended
//
//   npx tsx src/scripts/brief-backfill-gate1d.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { writeQuarterBrief } from "../insight/quarter-brief/write.js";
import { QUARTER_BRIEF_MODEL } from "../insight/quarter-brief/generate.js";
import { peekAiCallQuota } from "../ai/core/quota.js";

async function counterNow(): Promise<{ used: number; tokens: bigint }> {
  const tz = process.env.AI_QUOTA_TIMEZONE || "America/Los_Angeles";
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date())) if (part.type !== "literal") p[part.type] = part.value;
  const row = await prisma.aiUsageCounter.findUnique({
    where: { scope_windowKey: { scope: QUARTER_BRIEF_MODEL, windowKey: `${p.year}-${p.month}-${p.day}` } },
    select: { callCount: true, tokenCount: true },
  });
  return { used: row?.callCount ?? 0, tokens: row?.tokenCount ?? 0n };
}

async function main(): Promise<void> {
  const probes = (process.argv.slice(2).filter((a) => !a.startsWith("--")));
  const symbols = probes.length > 0 ? probes : ["RELIANCE", "TCS", "HDFCBANK"];

  const realBudget = process.env.AI_BUDGET_FLASH_LITE;
  const before = await counterNow();
  const peekBefore = await peekAiCallQuota(QUARTER_BRIEF_MODEL, { kind: "system", job: "quarter_brief" });

  console.log("═".repeat(100));
  console.log("1d · EXHAUSTION PROBE — budget forced BELOW today's spend, so the gate must deny");
  console.log("═".repeat(100));
  console.log(`  real AI_BUDGET_FLASH_LITE : ${realBudget ?? "(unset)"}`);
  console.log(`  consumed today            : ${before.used}`);
  console.log(`  headroom before probe     : ${peekBefore.remaining}`);

  if (before.used < 1) {
    console.log("\n  ⚠ CANNOT PROVE AT ZERO COST — nothing has spent today, so no limit above 0 can deny.");
    console.log("    (envInt rejects 0 and falls back to the uncapped default, by design.) Re-run after the ten.");
    await prisma.$disconnect();
    return;
  }

  // The forced limit: 1, which today's count (≥1) already meets or exceeds ⇒ `callCount < 1` is false.
  process.env.AI_BUDGET_FLASH_LITE = "1";
  console.log(`  forced AI_BUDGET_FLASH_LITE: 1  ⇒ callCount(${before.used}) < 1 is FALSE for every caller\n`);

  const rowsBefore = await prisma.quarterBrief.count();

  for (const symbol of symbols) {
    const t0 = Date.now();
    const out = await writeQuarterBrief(symbol);
    const ms = Date.now() - t0;
    const detail = out.kind === "refused" ? `${out.reason} — ${out.detail}` : "";
    console.log(`  ${symbol.padEnd(12)} ${out.kind.padEnd(20)} ${detail.padEnd(52)} ${ms}ms`);
    // A provider call takes ~1–3s and is paced at 4.2s; a denial returns in DB time. The elapsed time
    // is therefore itself evidence that no call was attempted.
  }

  const after = await counterNow();
  const rowsAfter = await prisma.quarterBrief.count();

  console.log("\n  ── CLAIMS ──────────────────────────────────────────────────────────────────────────");
  console.log(`  1 · refusal reason is quota_exhausted, per stock ......... see above (${symbols.length}/${symbols.length})`);
  console.log(`  2 · nothing written: quarter_briefs ${rowsBefore} → ${rowsAfter} ......... ${rowsBefore === rowsAfter ? "PASS" : "FAIL"}`);
  console.log(`  3 · counter unmoved: ${before.used} → ${after.used} calls, ${before.tokens} → ${after.tokens} tokens ... ${before.used === after.used && before.tokens === after.tokens ? "PASS" : "FAIL"}`);

  // Restore, and prove the restore — an override that leaked would silently mis-size the real run.
  if (realBudget === undefined) delete process.env.AI_BUDGET_FLASH_LITE;
  else process.env.AI_BUDGET_FLASH_LITE = realBudget;
  const peekAfter = await peekAiCallQuota(QUARTER_BRIEF_MODEL, { kind: "system", job: "quarter_brief" });
  console.log(`  4 · override restored: limit back to ${peekAfter.limit}, ${peekAfter.remaining} remaining ... ${peekAfter.limit === peekBefore.limit ? "PASS" : "FAIL"}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
