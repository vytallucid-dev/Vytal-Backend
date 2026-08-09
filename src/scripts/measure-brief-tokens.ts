// STAGE 5 — MEASURE prompt and output tokens per family under the schema, and the guard fires.
// Generates through the REAL path (same prompt, same fact block, same five guards) and WRITES NOTHING.
//
// This is what MAX_OUTPUT_TOKENS and the TPM note in generate.ts are fitted to. Do not guess either
// number again without re-running this.
//
//   npx tsx src/scripts/measure-brief-tokens.ts NMDC:FY26Q4 HDFCBANK:FY26Q4

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText, QUARTER_BRIEF_SYSTEM } from "../insight/quarter-brief/prompt.js";
import { generateQuarterBrief } from "../insight/quarter-brief/generate.js";

const DEFAULTS = ["NMDC:FY26Q4", "HDFCBANK:FY26Q4", "BAJFINANCE:FY26Q4", "HDFCLIFE:FY26Q4", "GICRE:FY26Q4"];

async function main(): Promise<void> {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;
  const rows: { target: string; family: string; factChars: number; prompt: number; output: number; bullets: number; note: string }[] = [];

  for (const t of targets) {
    const [symbol, period] = t.split(":");
    const block = await buildQuarterBriefFactBlock(symbol, period || undefined);
    if (!block) { console.log(`? ${t} — no fact block`); continue; }

    const facts = renderFactText(block);
    const res = await generateQuarterBrief(block);

    if (!res.ok) {
      console.log(`⛔ ${t} REFUSED — ${res.reason}\n   ${res.detail}`);
      if (res.rejectedText) console.log(`   | ${res.rejectedText.slice(0, 400)}`);
      rows.push({ target: t, family: block.identity.family, factChars: facts.length, prompt: 0, output: 0, bullets: 0, note: `REFUSED ${res.reason}` });
      continue;
    }

    console.log(`\n═══ ${t} · ${block.identity.family} ═══`);
    for (const b of res.payload.takeaway.bullets) console.log(`  - ${b}`);
    console.log(
      `  [tokens] prompt=${res.promptTokens} output=${res.outputTokens} | facts=${facts.length} chars, system=${QUARTER_BRIEF_SYSTEM.length} chars` +
        ` | leaves=${res.audit.leavesScanned} numbers=${res.audit.numbersChecked}/${res.audit.numbersSkipped} attempts=${res.audit.attempts}`,
    );
    console.log(`  [payload] quarter=${res.payload.quarter.lines.length} annual=${res.payload.annual?.lines.length ?? "-"} health=${res.payload.health ? res.payload.health.movements.length : "-"} gaps=${res.payload.gaps.length} json=${JSON.stringify(res.payload).length} chars`);
    rows.push({
      target: t, family: block.identity.family, factChars: facts.length,
      prompt: res.promptTokens ?? 0, output: res.outputTokens ?? 0,
      bullets: res.payload.takeaway.bullets.length, note: "",
    });
  }

  console.log("\n" + "═".repeat(90));
  console.log("family                target            factChars  prompt  output  bullets");
  for (const r of rows) {
    console.log(
      `${r.family.padEnd(20)}  ${r.target.padEnd(18)} ${String(r.factChars).padStart(8)} ${String(r.prompt).padStart(7)} ${String(r.output).padStart(7)} ${String(r.bullets).padStart(8)}  ${r.note}`,
    );
  }
  const ok = rows.filter((r) => r.prompt > 0);
  if (ok.length) {
    const p = ok.map((r) => r.prompt).sort((a, b) => a - b);
    const o = ok.map((r) => r.output).sort((a, b) => a - b);
    console.log(`\nprompt  min=${p[0]} max=${p[p.length - 1]}`);
    console.log(`output  min=${o[0]} max=${o[o.length - 1]}`);
    console.log(`worst-case per call ≈ ${p[p.length - 1] + o[o.length - 1]} tokens; at 14.3 calls/min ⇒ ~${Math.round((p[p.length - 1] + o[o.length - 1]) * 14.3).toLocaleString("en-IN")} tokens/min sustained`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
