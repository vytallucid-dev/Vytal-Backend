// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — GUARD VERIFICATION.
//
// §1 (PURE) proves the number-grounding haystack actually contains the DISPLAY forms the model is
// given, and that a fabricated figure fires. This runs without an API key and without a model call —
// a guard nobody has proved fires is not a guard.
//
// §2 (LIVE, opt-in with --live) generates real briefs and reports every guard fire VERBATIM, so the
// evaluative-tier threshold is read off real output rather than guessed. Every scan in this project
// has been wrong on first contact with real output; a fire on CORRECT text is the finding.
//
//   npx tsx src/scripts/verify-quarter-brief-guards.ts
//   npx tsx src/scripts/verify-quarter-brief-guards.ts --live DIXON HDFCBANK SBICARD
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText, QUARTER_BRIEF_SYSTEM } from "../insight/quarter-brief/prompt.js";
import { generateQuarterBrief } from "../insight/quarter-brief/generate.js";
import { scanUngroundedNumbers } from "../ai/core/number-grounding.js";
import { scanExplanationText } from "../ai/core/guardrail.js";

let failures = 0;
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);

async function pureGrounding(): Promise<void> {
  console.log("\n" + "═".repeat(96));
  console.log("§1 · NUMBER-GROUNDING HAYSTACK (pure — no model call)");
  console.log("═".repeat(96));

  const block = await buildQuarterBriefFactBlock("DIXON");
  if (!block) { fail("could not build the DIXON fact block"); return; }

  const facts = renderFactText(block);
  const haystack = `${QUARTER_BRIEF_SYSTEM}\n${facts}`;

  // ── The display strings must be IN the haystack, literally. ──
  const revenue = block.headline.revenue.current;          // e.g. "₹15,548 crore"
  const profit = block.headline.profit.current;
  for (const f of [revenue, profit]) {
    if (!haystack.includes(f.display)) fail(`haystack is missing the display string "${f.display}"`);
  }
  if (failures === 0) pass(`haystack contains the display forms verbatim ("${revenue.display}", "${profit.display}")`);

  // ── ★ THE CLAIM UNDER TEST: the DISPLAY form grounds. ──
  // The model is given "₹15,548 crore" and never sees 15547.66, so the display form is the ONLY form
  // it can legitimately write. If that failed to ground, every correct brief would be refused.
  const good = `Revenue was ${revenue.display} for the quarter, and net profit was ${profit.display}.`;
  const goodScan = scanUngroundedNumbers(good, haystack);
  if (!goodScan.clean) fail(`the display form does NOT ground: ${JSON.stringify(goodScan.hits)}`);
  else pass(`display form grounds (${goodScan.checked} checked, ${goodScan.skipped} skipped by the blind spot)`);

  // ── The raw underlying value must ALSO ground, so a faithful restatement is not punished. ──
  const rawForm = `Revenue was ${revenue.value} crore.`;
  const rawScan = scanUngroundedNumbers(rawForm, haystack);
  if (!rawScan.clean) {
    console.log(`  · note: the RAW value ${revenue.value} does not ground — expected, it is never shown to the model`);
  } else {
    pass(`the raw value ${revenue.value} also grounds (via rounding tolerance against the display)`);
  }

  // ── NEGATIVE CONTROL: a fabricated figure MUST fire, or the guard is a rubber stamp. ──
  const bad = `Revenue was ₹47,318 crore and the order book stood at ₹92,455 crore.`;
  const badScan = scanUngroundedNumbers(bad, haystack);
  if (badScan.clean) fail("NEGATIVE CONTROL FAILED — fabricated figures scanned clean");
  else pass(`value scan fires on fabrication (${badScan.hits.map((h) => h.raw).join(", ")})`);

  // ── ★ THE LAUNDERING CASE, MEASURED. ───────────────────────────────────────────────────────────
  // "₹47,318 crore" is pure fabrication and the VALUE scan passes it: the block contains 48 (from
  // "up 48%"), and 48 × 1000 = 48,000 sits inside the scan's 2% relative tolerance of 47,318. This
  // is not a bug in that scan — the tolerance and the unit factors are right for chat, where units
  // are legitimately converted. It is the reason this feature needs a second, verbatim guard.
  const laundered = badScan.hits.map((h) => h.raw.replace(/,/g, ""));
  if (!laundered.includes("47318")) {
    console.log(
      `  ⚠ CONFIRMED: "47,318" is fabricated and the VALUE scan passes it ` +
        `(48 × 1000 = 48,000, within 2% of 47,318). Verbatim guard required.`,
    );
  }

  // The verbatim guard must catch BOTH fabricated figures and neither real one.
  const factFigures = new Set((facts.match(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?![\w])/g) ?? []).map((s) => s.replace(/,/g, "")));
  const caught = ["47318", "92455"].filter((f) => !factFigures.has(f));
  const kept = [revenue.display, profit.display]
    .flatMap((d) => (d.match(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?![\w])/g) ?? []).map((s) => s.replace(/,/g, "")))
    .filter((f) => !factFigures.has(f));
  if (caught.length !== 2) fail(`verbatim guard would miss a fabricated figure (caught ${caught.join(", ")})`);
  else if (kept.length > 0) fail(`verbatim guard would wrongly reject real figures: ${kept.join(", ")}`);
  else pass("verbatim guard catches BOTH fabricated figures and rejects neither real one");

  // ── The blind spot, restated as a MEASURED fact rather than a comment. ──
  const count = `Three findings started flagging and 4 pillars moved.`;
  const countScan = scanUngroundedNumbers(count, haystack);
  console.log(
    `  ⚠ BLIND SPOT (measured, not asserted): "${count}" scans clean=${countScan.clean}, ` +
      `checked=${countScan.checked}, skipped=${countScan.skipped}. Small integers are invisible — ` +
      `a clean scan is NOT proof the counts are right.`,
  );
}

async function live(symbols: string[]): Promise<void> {
  console.log("\n" + "═".repeat(96));
  console.log(`§2 · LIVE GENERATION — ${symbols.length} briefs (guard calibration)`);
  console.log("═".repeat(96));

  for (const symbol of symbols) {
    const block = await buildQuarterBriefFactBlock(symbol);
    if (!block) { console.log(`\n${symbol}: no fact block`); continue; }

    const res = await generateQuarterBrief(block);

    console.log("\n" + "─".repeat(96));
    console.log(`${symbol} · ${block.identity.periodKey} · verdict: ${block.verdict?.label ?? "(none)"}`);
    console.log("─".repeat(96));

    if (!res.ok) {
      console.log(`REFUSED — ${res.reason}`);
      console.log(`  detail: ${res.detail}`);
      if (res.rejectedText) {
        console.log("  ── rejected text, verbatim ──");
        console.log(res.rejectedText.split("\n").map((l) => `  | ${l}`).join("\n"));
      }
      continue;
    }

    // ★ THE AUTHORED TEXT IS THE BULLETS. Everything else in the payload is a display string

    // the backend rendered; printing that back would report the fact block, not the generation.

    const authored: string[] = res.payload.takeaway.bullets;

    console.log(authored.map((l) => `  | ${l}`).join("\n"));
    console.log(`\n  [audit] numbers checked=${res.audit.numbersChecked} skipped=${res.audit.numbersSkipped} attempts=${res.audit.attempts} tokens=${res.promptTokens}/${res.outputTokens}`);

    // Re-scan the ACCEPTED text and report what the tiers saw, including the channels that did NOT
    // block — a fire on correct text is the finding, and it is invisible if only refusals are printed.
    const g = scanExplanationText(authored.join(" "));
    console.log(`  [tiers] hard=${g.hardHits.length} soft=${g.softHits.length} evaluative=${g.evaluativeHits.length}`);
    for (const h of g.softHits) console.log(`    SOFT  ${h.term}: "${h.match}" — ${h.context}`);
    for (const h of g.evaluativeHits) console.log(`    EVAL  ${h.term}: "${h.match}"`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const liveIdx = args.indexOf("--live");
  await pureGrounding();
  if (liveIdx >= 0) {
    const symbols = args.slice(liveIdx + 1);
    await live(symbols.length ? symbols : ["DIXON", "HDFCBANK", "SBICARD"]);
  } else {
    console.log("\n(no --live flag: model calls skipped)");
  }

  console.log("\n" + "─".repeat(96));
  if (failures > 0) { console.error(`FAILED — ${failures}`); await prisma.$disconnect(); process.exit(1); }
  console.log("PURE GUARD CHECKS PASSED.");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
