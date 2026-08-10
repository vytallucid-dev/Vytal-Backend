// STAGE 5 — THE 12-CARD REVIEW SET. Generates through the REAL path and STORES, so the operator
// reads them on the page rather than in a terminal.
//
// ⚠ THIS WRITES. It writes exactly twelve rows, chosen to cover every shape a reader can meet, and it
// touches nothing else. quarter_briefs was purged on 2026-08-09 (scripts/purge-quarter-briefs.ts), so
// these twelve are normally the only rows in the table.
//
// ⚠ DO NOT CLEAN THESE UP. Earlier stages deleted their proof rows correctly; this set is the review
// itself and stays until it has been read.
//
//   npx tsx src/scripts/brief-review-set.ts
//   npx tsx src/scripts/brief-review-set.ts --force
//
// ⚠⚠ `--force` IS NOT A CONVENIENCE, IT IS THE ONLY WAY TO SEE A PROMPT CHANGE. `factsFingerprint` is
// a hash of `renderFactText(block)` and NOTHING ELSE — so a change to the SYSTEM PROMPT, to the
// response schema, or to the bullet cap leaves every stored brief looking current, and all twelve
// cards return `skipped_unchanged`. That is correct for the daily job (the facts really have not
// moved) and useless for reviewing an instruction change. Found by raising the cap 5 → 8 and getting
// twelve skips.

import { prisma } from "../db/prisma.js";
import { writeQuarterBrief } from "../insight/quarter-brief/write.js";
import { QUARTER_BRIEF_MODEL } from "../insight/quarter-brief/generate.js";
import { peekAiCallQuota } from "../ai/quota.js";
import { emptySections, type BriefPayload } from "../insight/quarter-brief/schema.js";

const SET: { symbol: string; period: string; exercises: string }[] = [
  { symbol: "RELIANCE", period: "FY27Q1", exercises: "FAMILY · non-financial — 12 metrics, driver, 6 peers, health +0.9" },
  { symbol: "HDFCBANK", period: "FY27Q1", exercises: "FAMILY · banking — 22 metrics, the richest quarter section" },
  { symbol: "BAJFINANCE", period: "FY27Q1", exercises: "FAMILY · NBFC — 17 metrics, driver, 7 peers" },
  { symbol: "HDFCLIFE", period: "FY27Q1", exercises: "FAMILY · life insurance — 24 metrics, no driver (structural)" },
  { symbol: "ICICIGI", period: "FY27Q1", exercises: "FAMILY · general insurance — 20 metrics, combined ratio in plain words" },
  { symbol: "TCS", period: "FY26Q4", exercises: "★ Q4 WITH THE ANNUAL SECTION — 19 balance-sheet lines" },
  { symbol: "MMTC", period: "FY26Q1", exercises: "★ NULL BADGE — no verdict, 2 suppressed metrics, 7 gaps" },
  { symbol: "HINDUNILVR", period: "FY27Q1", exercises: "★ DRIVER BULLET — a named cause of the profit move" },
  { symbol: "ITC", period: "FY27Q1", exercises: "★ PEER CONTEXT — 8 filed peers, no driver, so peers leads" },
  { symbol: "SBILIFE", period: "FY26Q4", exercises: "★ SUPPRESSED METRICS — 5 persistency ratios withheld (PB-1)" },
  { symbol: "MARUTI", period: "FY26Q4", exercises: "★ HEALTH MOVEMENT — score moved 9.4 points, plus annual + contrast" },
  { symbol: "TTML", period: "FY27Q1", exercises: "★ THIN BLOCK — no driver, no peers, no score, loss in both periods" },
];

const BASE = "https://vytal.app"; // path shape only — the operator opens it on whatever host he runs

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const actor = { kind: "system", job: "quarter_brief" } as const;
  const before = await peekAiCallQuota(QUARTER_BRIEF_MODEL, actor);
  console.log(`AI budget before: used ${before.limit - before.remaining} / ${before.limit}, remaining ${before.remaining}, resets ${before.resetAt}`);

  const fires: string[] = [];
  const empties: string[] = [];
  const results: { symbol: string; period: string; exercises: string; outcome: string; verdict: string; shape: string }[] = [];

  for (const item of SET) {
    const t0 = Date.now();
    const out = await writeQuarterBrief(item.symbol, item.period, { force });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    if (out.kind === "refused") {
      fires.push(`${item.symbol} ${item.period} — ${out.reason}: ${out.detail}`);
      console.log(`⛔ ${item.symbol} ${item.period} REFUSED — ${out.reason} (${secs}s)\n     ${out.detail}`);
      results.push({ ...item, outcome: `REFUSED ${out.reason}`, verdict: "-", shape: "-" });
      continue;
    }
    if (out.kind !== "written") {
      console.log(`·  ${item.symbol} ${item.period} — ${out.kind} (${secs}s)`);
      results.push({ ...item, outcome: out.kind, verdict: "-", shape: "-" });
      continue;
    }

    // Read the row back and inspect what was actually stored — the same bytes the card will render.
    const stock = await prisma.stock.findUnique({ where: { symbol: item.symbol }, select: { id: true } });
    const row = await prisma.quarterBrief.findFirst({
      where: { stockId: stock!.id, fiscalYear: item.period.slice(0, 4), quarter: item.period.slice(4) },
      select: { content: true, verdictLabel: true, status: true, promptTokens: true, outputTokens: true },
    });
    const p = JSON.parse(row!.content) as BriefPayload;
    const e = emptySections(p);
    if (e.length) empties.push(`${item.symbol} ${item.period}: ${e.join(", ")}`);

    const shape =
      `bullets=${p.takeaway.bullets.length} quarter=${p.quarter.lines.length} ` +
      `annual=${p.annual ? p.annual.lines.length : "-"} health=${p.health ? p.health.movements.length : "-"} gaps=${p.gaps.length}`;
    console.log(`✓  ${item.symbol} ${item.period} — ${row!.status}, ${shape}, tokens ${row!.promptTokens}/${row!.outputTokens} (${secs}s)`);
    for (const b of p.takeaway.bullets) console.log(`     • ${b}`);
    results.push({ ...item, outcome: "written", verdict: row!.verdictLabel || "(none)", shape });
  }

  const after = await peekAiCallQuota(QUARTER_BRIEF_MODEL, actor);
  console.log("\n" + "═".repeat(110));
  console.log("THE 12 URLS");
  console.log("═".repeat(110));
  for (const r of results) {
    console.log(`${BASE}/results/${r.symbol}?period=${r.period}&tab=snapshot`);
    console.log(`    ${r.exercises}`);
    console.log(`    badge: ${r.verdict}   ${r.shape}   [${r.outcome}]`);
  }

  console.log("\n" + "═".repeat(110));
  console.log(fires.length ? "GUARD FIRES, VERBATIM:\n  " + fires.join("\n  ") : "GUARD FIRES: none");
  console.log(empties.length ? "EMPTY SECTIONS:\n  " + empties.join("\n  ") : "EMPTY SECTIONS: none");
  console.log(
    `\nAI calls consumed: ${(before.remaining - after.remaining)} (budget ${after.limit}, remaining ${after.remaining}, resets ${after.resetAt})`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
