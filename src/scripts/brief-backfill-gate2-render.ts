// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GATE 2 · THE TEN, AS THEY WILL RENDER. Dumps the STORED payload of each — the card as the reader
// meets it, not a summary of it. Read-only: no AI call, no write.
//
// ⚠ THE THIN CARDS ARE PRINTED WHOLE AND FIRST. They are the shape nothing has read at volume, and
// the only question that matters about them — does a short card read as deliberate or as broken — is
// not answerable from a line count. It needs the words.
//
//   npx tsx src/scripts/brief-backfill-gate2-render.ts [SYMBOL ...]
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import type { BriefPayload } from "../insight/quarter-brief/schema.js";
import { readVerdict } from "../insight/quarter-brief/verdict.js";

const DEFAULT = ["MMTC", "ATHERENERG", "SBFC", "HDFCLIFE", "IDEA", "ABREL", "AXISBANK", "COCHINSHIP", "BAJAJFINSV", "ICICIGI"];

async function main(): Promise<void> {
  const symbols = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const set = symbols.length > 0 ? symbols : DEFAULT;

  for (const symbol of set) {
    const row = await prisma.quarterBrief.findFirst({
      where: { stock: { symbol } },
      select: {
        content: true, verdictKey: true, verdictLabel: true, status: true, quarter: true, fiscalYear: true,
        promptTokens: true, outputTokens: true, model: true, scoredAsOf: true, factsFingerprint: true,
      },
    });
    console.log("\n" + "━".repeat(100));
    if (!row) { console.log(`### ${symbol} — NO STORED ROW`); continue; }
    const v = readVerdict(row.verdictKey, row.verdictLabel);
    console.log(`### ${symbol}  ${row.fiscalYear}${row.quarter}   [${row.status}]   badge: ${v ? `“${v.label}”` : "— none —"}`);
    console.log("━".repeat(100));

    const p = JSON.parse(row.content) as BriefPayload;

    console.log("\nTAKEAWAY");
    if (p.takeaway.verdictLabel) console.log(`  ⟦${p.takeaway.verdictLabel}⟧`);
    if (p.takeaway.verdictMeaning) console.log(`  ${p.takeaway.verdictMeaning}`);
    if (!p.takeaway.verdictLabel) console.log(`  (no badge — the card opens on the bullets)`);
    for (const b of p.takeaway.bullets) console.log(`  • ${b}`);

    console.log(`\nTHE QUARTER — ${p.quarter.lines.length} lines`);
    for (const l of p.quarter.lines) {
      console.log(`  ${l.label}: ${l.value}${l.comparison ? ` — ${l.comparison}` : ""}`);
      if (l.anchor) console.log(`      ↳ ${l.anchor}`);
      if (l.note) console.log(`      note: ${l.note}`);
    }

    if (p.annual) {
      console.log(`\nTHE FULL YEAR ${p.annual.fiscalYear} — ${p.annual.lines.length} lines (as of ${p.annual.asOfDate}${p.annual.datesAgree ? ", same date as the quarter" : ""})`);
      for (const l of p.annual.lines) console.log(`  ${l.label}: ${l.value}${l.comparison ? ` — ${l.comparison}` : ""}`);
    } else {
      console.log(`\nTHE FULL YEAR — ⊘ absent (not a Q4, or no annual row on this basis)`);
    }

    if (p.health) {
      console.log(`\nHEALTH — ${p.health.composite} / ${p.health.bandLabel} (as scored on ${p.health.scoredAsOf})`);
      for (const m of p.health.movements) console.log(`  • ${m}`);
    } else {
      console.log(`\nHEALTH — ⊘ absent by presence gate (no score snapshot for this quarter)`);
    }

    console.log(`\nWHAT THIS DOES NOT COVER — ${p.gaps.length} lines`);
    for (const g of p.gaps) console.log(`  · ${g}`);

    console.log(`\n[tokens ${row.promptTokens}/${row.outputTokens} · ${row.model} · fp ${row.factsFingerprint.slice(0, 12)}…]`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
