// THE ANNUAL REVIEW SET — Q4 cards that carry the FULL-YEAR section, across families.
//
// ⚠ THIS WRITES. Four rows, chosen so the annual section is exercised on every shape it has: a
// non-financial balance sheet, a lender's, an NBFC's, and one where the balance sheet is the story.
//
// The annual section has the least production experience of anything on the card — it was built
// against 3 briefs and there are 2,058 Q4 rows in the universe. This set exists to shorten that gap.
//
//   npx tsx src/scripts/brief-annual-set.ts
//   npx tsx src/scripts/brief-annual-set.ts --force

import { prisma } from "../db/prisma.js";
import { writeQuarterBrief } from "../insight/quarter-brief/write.js";
import { QUARTER_BRIEF_MODEL } from "../insight/quarter-brief/generate.js";
import { peekAiCallQuota } from "../ai/quota.js";
import { emptySections, type BriefPayload } from "../insight/quarter-brief/schema.js";

const SET: { symbol: string; period: string; exercises: string }[] = [
  { symbol: "TCS", period: "FY26Q4", exercises: "NON-FINANCIAL · 19 annual lines — the baseline Q4 card, already in the 12" },
  { symbol: "HDFCBANK", period: "FY26Q4", exercises: "★ BANKING · 15 annual lines — a lender's margin and credit cost, a shape no other family has" },
  { symbol: "BAJFINANCE", period: "FY26Q4", exercises: "★ NBFC · 14 annual lines — operating cash flow is NEGATIVE because the business lent the money out (the `flow` money sense)" },
  { symbol: "IDEA", period: "FY26Q4", exercises: "★★ NEGATIVE NET WORTH · 17 annual lines — the balance sheet IS the story; exercises the `level` money sense and the guard suppressions" },
  // ★ THE FULL-YEAR GROUP AT FULL STRENGTH. Measured across all 106 annual cards, TMPV is one of four
  // on which FOUR of the seven annual rules fire at once — borrowed more while cash fell, free cash
  // flow below zero, thin interest cover, and the return on shareholders' money moved. It is the card
  // that proves group 5 end to end, and the one where the bullet cap has to choose.
  { symbol: "TMPV", period: "FY26Q4", exercises: "★★ THE FULL-YEAR GROUP · 4 of the 7 annual rules fire — the richest group 5 in the universe" },
];

const BASE = "https://vytal.app";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const actor = { kind: "system", job: "quarter_brief" } as const;
  const before = await peekAiCallQuota(QUARTER_BRIEF_MODEL, actor);
  console.log(`AI budget before: used ${before.limit - before.remaining} / ${before.limit}, remaining ${before.remaining}, resets ${before.resetAt}`);

  const fires: string[] = [];
  const empties: string[] = [];
  const rows: { symbol: string; period: string; exercises: string; outcome: string; verdict: string; shape: string }[] = [];

  for (const item of SET) {
    const t0 = Date.now();
    const out = await writeQuarterBrief(item.symbol, item.period, { force });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    if (out.kind === "refused") {
      fires.push(`${item.symbol} ${item.period} — ${out.reason}: ${out.detail}`);
      console.log(`⛔ ${item.symbol} ${item.period} REFUSED — ${out.reason} (${secs}s)\n     ${out.detail}`);
      rows.push({ ...item, outcome: `REFUSED ${out.reason}`, verdict: "-", shape: "-" });
      continue;
    }

    const stock = await prisma.stock.findUnique({ where: { symbol: item.symbol }, select: { id: true } });
    const row = await prisma.quarterBrief.findFirst({
      where: { stockId: stock!.id, fiscalYear: item.period.slice(0, 4), quarter: item.period.slice(4) },
      select: { content: true, verdictLabel: true, status: true, promptTokens: true, outputTokens: true },
    });
    if (!row) { console.log(`·  ${item.symbol} ${item.period} — ${out.kind}, no row (${secs}s)`); continue; }

    const p = JSON.parse(row.content) as BriefPayload;
    const e = emptySections(p);
    if (e.length) empties.push(`${item.symbol} ${item.period}: ${e.join(", ")}`);

    const shape =
      `bullets=${p.takeaway.bullets.length} quarter=${p.quarter.lines.length} ` +
      `annual=${p.annual ? p.annual.lines.length : "-"} health=${p.health ? p.health.movements.length : "-"} gaps=${p.gaps.length}`;
    console.log(`${out.kind === "written" ? "✓ " : "· "} ${item.symbol} ${item.period} — ${out.kind}, ${shape}, tokens ${row.promptTokens}/${row.outputTokens} (${secs}s)`);
    for (const b of p.takeaway.bullets) console.log(`     • ${b}`);
    if (p.annual) {
      console.log(`     ── THE FULL YEAR · ${p.annual.fiscalYear} (as at ${p.annual.asOfDate}, datesAgree=${p.annual.datesAgree})`);
      for (const l of p.annual.lines) {
        console.log(`        ${l.label}: ${l.value}${l.comparison ? ` — ${l.comparison}` : ""}`);
        if (l.note) console.log(`            ${l.note}`);
      }
    }
    console.log(`     ── GAPS`);
    for (const g of p.gaps) console.log(`        - ${g}`);
    rows.push({ ...item, outcome: out.kind, verdict: row.verdictLabel || "(none)", shape });
  }

  const after = await peekAiCallQuota(QUARTER_BRIEF_MODEL, actor);
  console.log("\n" + "═".repeat(110));
  console.log("THE ANNUAL URLS");
  console.log("═".repeat(110));
  for (const r of rows) {
    console.log(`${BASE}/results/${r.symbol}?period=${r.period}&tab=snapshot`);
    console.log(`    ${r.exercises}`);
    console.log(`    badge: ${r.verdict}   ${r.shape}   [${r.outcome}]`);
  }
  console.log("\n" + (fires.length ? "GUARD FIRES, VERBATIM:\n  " + fires.join("\n  ") : "GUARD FIRES: none"));
  console.log(empties.length ? "EMPTY SECTIONS:\n  " + empties.join("\n  ") : "EMPTY SECTIONS: none");
  console.log(`\nAI calls consumed: ${before.remaining - after.remaining} (budget ${after.limit}, remaining ${after.remaining}, resets ${after.resetAt})`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
