// STAGE 5 · 5f — RENDER 12 BRIEFS AS THE CARD, THROUGH THE REAL PATH. WRITES NOTHING.
//
// Same fact block, same prompt, same five guards, same assembly. What is printed is what the
// frontend renders, in the order it renders it — the sections, the lines, the gaps, and (where a
// reader is supplied) their own position. Every guard fire is printed verbatim; every present-but-
// empty section is named.
//
//   npx tsx src/scripts/brief-schema-sample.ts
//   npx tsx src/scripts/brief-schema-sample.ts NMDC:FY26Q4

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { generateQuarterBrief } from "../insight/quarter-brief/generate.js";
import { emptySections } from "../insight/quarter-brief/schema.js";

/** Deliberate coverage — one per family, plus every shape the card can take. */
const SAMPLE: { target: string; why: string }[] = [
  { target: "NMDC:FY26Q4", why: "non-financial · Q4 WITH an annual section" },
  { target: "HDFCBANK:FY26Q4", why: "banking · annual + HEALTH section + peers" },
  { target: "BAJFINANCE:FY26Q4", why: "nbfc · annual + driver" },
  { target: "HDFCLIFE:FY26Q4", why: "life insurance · annual, no driver (family has none)" },
  { target: "GICRE:FY26Q4", why: "general insurance · annual" },
  { target: "IDEA:FY26Q4", why: "★ negative net worth — two guarded metrics withheld" },
  { target: "LICHSGFIN:FY22Q4", why: "★ no balance sheet — the annual section is ABSENT on a Q4" },
  { target: "SIEMENS:FY24Q4", why: "★ date divergence — the second clock renders" },
  { target: "SBILIFE:FY27Q1", why: "★ suppressed metrics — five persistency ratios withheld" },
  { target: "DIXON:FY27Q1", why: "non-Q4 · no annual section at all" },
  { target: "MMTC:FY27Q1", why: "★ the NULL-BADGE case — a brief with no verdict" },
  { target: "TTML:FY27Q1", why: "a thin one — few metrics, little to say" },
];

function card(label: string, lines: { label: string; value: string; comparison?: string; note?: string }[]) {
  console.log(`\n  ${label}`);
  for (const l of lines) {
    console.log(`    ${l.label.padEnd(42)} ${l.value}${l.comparison ? `   — ${l.comparison}` : ""}`);
    if (l.note) console.log(`      > ${l.note}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sample = args.length ? args.map((t) => ({ target: t, why: "" })) : SAMPLE;

  let refused = 0;
  const fires: string[] = [];
  const empties: string[] = [];

  for (const { target, why } of sample) {
    const [symbol, period] = target.split(":");
    console.log("\n" + "═".repeat(100));
    console.log(`${target}${why ? `   — ${why}` : ""}`);
    console.log("═".repeat(100));

    const block = await buildQuarterBriefFactBlock(symbol, period || undefined);
    if (!block) { console.log("  (no fact block — unknown symbol or that period is not on file)"); continue; }

    const res = await generateQuarterBrief(block);
    if (!res.ok) {
      refused++;
      fires.push(`${target} — ${res.reason}: ${res.detail}`);
      console.log(`⛔ REFUSED — ${res.reason}`);
      console.log(`   ${res.detail}`);
      if (res.rejectedText) console.log(`   | ${res.rejectedText.slice(0, 600)}`);
      continue;
    }

    const p = res.payload;
    const e = emptySections(p);
    if (e.length) empties.push(`${target}: ${e.join(", ")}`);

    console.log(`  ${block.identity.name} · ${block.identity.family} · ${block.identity.basis} · ${block.identity.quarter} of ${block.identity.fiscalYear}`);
    console.log(`  BADGE: ${p.takeaway.verdictLabel ?? "(none — the null-badge case)"}`);
    if (p.takeaway.verdictMeaning) console.log(`         ${p.takeaway.verdictMeaning}`);

    console.log("\n  THE TAKEAWAY");
    for (const b of p.takeaway.bullets) console.log(`    • ${b}`);

    card(`THIS QUARTER (${p.quarter.lines.length} lines)`, p.quarter.lines);
    if (p.annual) {
      card(`THE FULL YEAR · ${p.annual.fiscalYear}${p.annual.datesAgree ? "" : `   [as at ${p.annual.asOfDate} — SECOND CLOCK]`} (${p.annual.lines.length} lines)`, p.annual.lines);
    } else {
      console.log(`\n  THE FULL YEAR — absent (${block.identity.quarter === "Q4" ? "Q4, but no annual row or no balance sheet in it" : "not Q4"})`);
    }
    if (p.health) {
      console.log(`\n  VYTAL HEALTH SCORE   [as scored on ${p.health.scoredAsOf}]`);
      console.log(`    ${p.health.composite} out of 100 — ${p.health.bandLabel}`);
      for (const m of p.health.movements) console.log(`    · ${m}`);
    } else {
      console.log("\n  VYTAL HEALTH SCORE — absent (not scored for this period)");
    }

    console.log("\n  WHAT THIS DOES NOT COVER");
    for (const g of p.gaps) console.log(`    - ${g}`);

    console.log(
      `\n  [audit] leaves=${res.audit.leavesScanned} numbers=${res.audit.numbersChecked}/${res.audit.numbersSkipped}` +
        ` attempts=${res.audit.attempts} tokens=${res.promptTokens}/${res.outputTokens} json=${JSON.stringify(p).length} chars`,
    );
  }

  console.log("\n" + "═".repeat(100));
  console.log(`cards=${sample.length}  refused=${refused}`);
  console.log(fires.length ? "\nGUARD FIRES, VERBATIM:\n  " + fires.join("\n  ") : "\nGUARD FIRES: none");
  console.log(empties.length ? "\nEMPTY SECTIONS:\n  " + empties.join("\n  ") : "EMPTY SECTIONS: none");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
