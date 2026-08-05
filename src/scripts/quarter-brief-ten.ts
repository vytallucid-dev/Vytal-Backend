// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE TEN — generate ten briefs and LEAVE THEM IN PLACE for the operator to read in the card.
//
// ⚠ THIS ONE WRITES. Every earlier proof script in this feature deliberately did not: Stage 5's
// sample generated through the real path and stored nothing, and P1–P9 cleaned up after themselves.
// This is the opposite by instruction — the rows exist so a human can open the page and read the
// prose in the card it ships in, which is the only gate that can judge whether it reads like
// something Vytal should put its name on. No harness proves that.
//
// It goes through writeQuarterBrief, the ONLY writer — same fact block, same prompt, same four
// guards, same fingerprint skip. Nothing here is a special path for a sample.
//
// Cleanup is the operator's call after the read: either delete these ten, or keep them as the first
// ten of the rollout. Both are one decision away; this script makes neither.
//
//   npx tsx src/scripts/quarter-brief-ten.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText } from "../insight/quarter-brief/prompt.js";
import { writeQuarterBrief } from "../insight/quarter-brief/write.js";
import { QUARTER_BRIEF_MODEL } from "../insight/quarter-brief/generate.js";
import { peekAiCallQuota } from "../ai/quota.js";
import type { QuarterBriefFactBlock } from "../insight/quarter-brief/types.js";

interface Pick { symbol: string; exercises: string }

async function main(): Promise<void> {
  const stocks = await prisma.stock.findMany({ select: { symbol: true } });
  const blocks = new Map<string, QuarterBriefFactBlock>();
  for (const s of stocks) {
    const b = await buildQuarterBriefFactBlock(s.symbol);
    if (b) blocks.set(s.symbol, b);
  }
  console.log(`fact blocks built: ${blocks.size} of ${stocks.length} stocks\n`);

  const picks: Pick[] = [];
  const taken = new Set<string>();
  const add = (symbol: string | undefined, exercises: string): boolean => {
    if (!symbol || taken.has(symbol) || !blocks.has(symbol)) return false;
    taken.add(symbol);
    picks.push({ symbol, exercises });
    return true;
  };
  const find = (pred: (b: QuarterBriefFactBlock) => boolean): string | undefined =>
    [...blocks.values()].find((b) => !taken.has(b.identity.symbol) && pred(b))?.identity.symbol;

  // ── NAMED FIRST. These are the conditions that exist on ONE stock, so a discovery pass that ran
  //    first would take their slot with an ordinary example and the rare case would go unread.
  add("MMTC", "NULL BADGE — prose with no verdict; the badge-absent branch of the card");
  add("IDEA", "SUPPRESSED MARGIN — profit dwarfs revenue, so the series is withheld WITH its reason");
  add("DIXON", 'VERDICT "Lifted by one-offs" — the B-4 guardrail section, and its FINDING line');
  add("GLENMARK", "CLEARED FINDING — a flag that stopped firing between quarters");
  if (!add("HDFCBANK", "HEADLINE-vs-HEALTH DIVERGENCE — profit and score point opposite ways")) {
    add("ASHOKLEY", "HEADLINE-vs-HEALTH DIVERGENCE — profit and score point opposite ways");
  }

  // ── DISCOVERED. Families and scored/unscored, so the health section is exercised both present
  //    (pinned date on the heading) and absent (presence gate).
  add(
    find((b) => b.identity.family === "non_financial" && b.healthMovement !== null),
    "SCORED NON-FINANCIAL — health section present; pinned `as scored on` date on the heading",
  );
  add(
    find((b) => b.identity.family === "banking"),
    "BANK — NII as the top line, GNPA on the verdict axis",
  );
  add(
    find((b) => b.identity.family === "nbfc" && b.healthMovement === null),
    "UNSCORED NBFC — health section ABSENT by presence gate; card must not leave a hole",
  );
  add(
    find((b) => b.identity.family === "general_insurance"),
    "GENERAL INSURER — combined ratio: lowerIsBetter, legitimately >100%, plain-words gloss",
  ) || add(
    find((b) => b.identity.family === "life_insurance"),
    "LIFE INSURER — net margin only; no operating-margin concept for the family",
  );

  // Thinnest fact block last — the omit-don't-pad rule made visible in the card.
  const thin = [...blocks.values()]
    .filter((b) => !taken.has(b.identity.symbol))
    .map((b) => ({ s: b.identity.symbol, n: renderFactText(b).length }))
    .sort((a, b) => a.n - b.n)[0];
  add(thin?.s, `THINNEST BLOCK (${thin?.n} chars) — omit-don't-pad; a short card, honestly short`);

  const ten = picks.slice(0, 10);

  console.log("═".repeat(100));
  console.log(`THE TEN — ${ten.length} briefs`);
  console.log("═".repeat(100));
  for (const p of ten) {
    const b = blocks.get(p.symbol)!;
    console.log(
      `  ${p.symbol.padEnd(11)} ${b.identity.periodKey.padEnd(8)} ${b.identity.family.padEnd(18)} ` +
        `${(b.verdict?.label ?? "(no verdict)").padEnd(21)} ${b.healthMovement ? "scored  " : "unscored"}  ${p.exercises}`,
    );
  }

  const before = await peekAiCallQuota(QUARTER_BRIEF_MODEL, { kind: "system", job: "quarter_brief" });
  console.log(`\nAI budget before: ${before.limit - before.remaining} / ${before.limit} used\n`);

  console.log("═".repeat(100));
  console.log("WRITING (real path — writeQuarterBrief)");
  console.log("═".repeat(100));
  for (const p of ten) {
    const out = await writeQuarterBrief(p.symbol);
    const detail =
      out.kind === "written" ? `verdict=${out.verdictKey ?? "(none)"}`
      : out.kind === "refused" ? `${out.reason} — ${out.detail}`
      : "";
    console.log(`  ${p.symbol.padEnd(11)} ${out.kind.padEnd(20)} ${detail}`);
  }

  const after = await peekAiCallQuota(QUARTER_BRIEF_MODEL, { kind: "system", job: "quarter_brief" });
  const spent = before.remaining - after.remaining;

  const rows = await prisma.quarterBrief.findMany({
    select: { stock: { select: { symbol: true } }, quarter: true, fiscalYear: true, verdictKey: true, verdictLabel: true, scoredAsOf: true, status: true, content: true },
    orderBy: { generatedAt: "asc" },
  });

  console.log("\n" + "═".repeat(100));
  console.log("STORED — what the operator will open");
  console.log("═".repeat(100));
  for (const r of rows) {
    console.log(
      `  /results/${r.stock.symbol}?tab=snapshot`.padEnd(40) +
        `${r.fiscalYear}${r.quarter}  ${r.status.padEnd(6)}  ` +
        `${(r.verdictLabel || "(no verdict)").padEnd(21)} ` +
        `scoredAsOf=${r.scoredAsOf ? r.scoredAsOf.toISOString().slice(0, 10) : "null"}  ${r.content.length}ch`,
    );
  }

  console.log("\n" + "─".repeat(100));
  console.log(`quarter_briefs rows: ${rows.length}`);
  console.log(`AI calls consumed: ${spent}`);
  console.log(`AI budget after: ${after.limit - after.remaining} / ${after.limit} used — ${after.remaining} left today (resets ${after.resetAt.toISOString()})`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
