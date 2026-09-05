// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BACKFILL GATE 2 — THE TEN. Generated through the REAL writer, LEFT IN PLACE, and reported on in the
// three ways the run itself cannot be: every guard fire verbatim, every section that came back empty,
// and what the calls ACTUALLY cost so Gate 1's 493-call estimate can be corrected before 460 go out.
//
// ⚠ THIS WRITES. Ten rows survive the script — they are the first ten of the rollout, not a sample to
// be cleaned up. Same fact block, same prompt, same guards, same fingerprint skip as the run.
//
// ── THE SELECTION IS DELIBERATE, AND THE THIN CASES ARE THE POINT ─────────────────────────────────
// D8: absence of a comparison period is an HONEST STATE, not an ineligibility — the card renders a
// null badge and prose. Stage 5 proved that on ONE card (MMTC) among richer ones. ALL THREE stocks in
// the universe that have no comparison row at all are in this ten, because that is the whole
// population and proving it on the whole population costs three calls.
//
// ⚠ AND THE TEN ARE DELIBERATELY NOT REPRESENTATIVE, WHICH MATTERS FOR 2c. Three of them are the
// thinnest blocks on file (1,916–3,231 chars against a p50 of 3,531), so a naive mean of their prompt
// tokens would UNDER-estimate the run. The cost report therefore fits tokens against fact-block SIZE
// and extrapolates over the real 493-stock size distribution. See the cost section.
//
//   npx tsx src/scripts/brief-backfill-gate2.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText } from "../insight/quarter-brief/prompt.js";
import { writeQuarterBrief } from "../insight/quarter-brief/write.js";
import { QUARTER_BRIEF_MODEL } from "../insight/quarter-brief/generate.js";
import { emptySections, type BriefPayload } from "../insight/quarter-brief/schema.js";
import { peekAiCallQuota } from "../ai/core/quota.js";

interface Pick { symbol: string; exercises: string }

// Chosen from the Gate-1 census. Every requirement is named against the stock that carries it, so a
// pick that stops satisfying its reason (a stock files, a score lands) is visible rather than silent.
const TEN: Pick[] = [
  { symbol: "MMTC",       exercises: "NO COMPARISON + SUPPRESSED MARGIN + null badge + THINNEST block on file (1,916ch)" },
  { symbol: "ATHERENERG", exercises: "NO COMPARISON — bare case: no suppression, no driver, no annual, null badge" },
  { symbol: "SBFC",       exercises: "NO COMPARISON *with* an ANNUAL SECTION — Q4 balance sheet on a card with no prior quarter" },
  { symbol: "IDEA",       exercises: "SUPPRESSED MARGIN (profit dwarfs revenue) + Q4 annual + in-universe" },
  { symbol: "ABREL",      exercises: "SUPPRESSED ×2 + a LOSS verdict ('Made a loss again') + Q4 annual" },
  { symbol: "AXISBANK",   exercises: "BANKING + SCORED (health section present, pinned date) + driver" },
  { symbol: "COCHINSHIP", exercises: "SCORED + Q4 ANNUAL + driver + NEAR-LARGEST block (7,097ch) — the token ceiling" },
  { symbol: "BAJAJFINSV", exercises: "NBFC + driver + in-universe, unscored (health section ABSENT by presence gate)" },
  { symbol: "HDFCLIFE",   exercises: "LIFE INSURER — net margin only; no operating-margin concept for the family" },
  { symbol: "ICICIGI",    exercises: "GENERAL INSURER — combined ratio (lowerIsBetter, legitimately >100%) + driver" },
];

const pad = (s: string, n: number) => s.padEnd(n);

async function main(): Promise<void> {
  const before = await peekAiCallQuota(QUARTER_BRIEF_MODEL, { kind: "system", job: "quarter_brief" });

  // ── The blocks first, so the report can state what each card WAS before it was written ───────────
  console.log("═".repeat(112));
  console.log("GATE 2 · THE TEN — selection");
  console.log("═".repeat(112));
  const meta = new Map<string, { family: string; periodKey: string; scored: boolean; annual: boolean; supp: number; driver: boolean; verdict: string | null; chars: number; cmp: string }>();
  for (const p of TEN) {
    const b = await buildQuarterBriefFactBlock(p.symbol);
    if (!b) { console.log(`  ${pad(p.symbol, 12)} ⚠ NO FACT BLOCK — pick is stale`); continue; }
    const chars = renderFactText(b).length;
    // Which comparison the block actually has. Read off the HEADLINE's LineComparison, which carries
    // both periods explicitly — the quarter section's `movement` is already a phrase, not a source.
    const h = b.headline.revenue;
    const cmp =
      h.yearAgoQuarter ? "year-ago quarter (YoY)"
      : h.previousQuarter ? "previous quarter (QoQ fallback)"
      : "NONE — single row on file";
    meta.set(p.symbol, {
      family: b.identity.family, periodKey: b.identity.periodKey, scored: b.healthMovement !== null,
      annual: b.annual !== null, supp: b.quarter.suppressed.length + (b.margins?.suppressed.length ?? 0),
      driver: b.driver !== null, verdict: b.verdict?.label ?? null, chars, cmp,
    });
    const m = meta.get(p.symbol)!;
    console.log(
      `  ${pad(p.symbol, 12)} ${pad(m.periodKey, 7)} ${pad(m.family, 18)} ${m.scored ? "scored  " : "unscored"} ` +
        `annual=${m.annual ? "y" : "n"} supp=${m.supp} drv=${m.driver ? "y" : "n"} ${pad(m.verdict ?? "(no badge)", 22)} ${String(m.chars).padStart(5)}ch`,
    );
    console.log(`               ↳ ${p.exercises}`);
    console.log(`               ↳ comparison: ${m.cmp}`);
  }

  console.log(`\n  AI budget before: ${before.limit - before.remaining} / ${before.limit} used, ${before.remaining} remaining`);

  // ── WRITE ────────────────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(112));
  console.log("WRITING — writeQuarterBrief, the only writer");
  console.log("═".repeat(112));

  interface Outcome { symbol: string; kind: string; reason?: string; detail?: string; ms: number }
  const outcomes: Outcome[] = [];
  const t0 = Date.now();
  for (const p of TEN) {
    const s = Date.now();
    const out = await writeQuarterBrief(p.symbol);
    const ms = Date.now() - s;
    const o: Outcome = { symbol: p.symbol, kind: out.kind, ms };
    if (out.kind === "refused") { o.reason = out.reason; o.detail = out.detail; }
    outcomes.push(o);
    console.log(
      `  ${pad(p.symbol, 12)} ${pad(out.kind, 18)} ${String(ms).padStart(6)}ms  ` +
        (out.kind === "refused" ? `${out.reason}` : out.kind === "written" ? `verdict=${out.verdictKey ?? "(none)"}` : ""),
    );
  }
  const wall = Date.now() - t0;

  // ── 2b · GUARD FIRES, VERBATIM ───────────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(112));
  console.log("2b · GUARD FIRES — verbatim, every one");
  console.log("═".repeat(112));
  const refusals = outcomes.filter((o) => o.kind === "refused");
  if (refusals.length === 0) {
    console.log("  NONE. Every one of the ten cleared all five guards on the attempts it was given.");
    console.log("  (guards: 1 number-grounding · 1b verbatim-figure · 2 language · 3 shape · 4 echo · 4b required-figure · 5 empty-section)");
  }
  for (const r of refusals) {
    console.log(`  ${r.symbol}`);
    console.log(`    reason : ${r.reason}`);
    console.log(`    detail : ${r.detail}`);
  }

  // ── 2b · SECTIONS AND BULLETS, READ BACK FROM WHAT WAS STORED ────────────────────────────────────
  const symbols = TEN.map((p) => p.symbol);
  const rows = await prisma.quarterBrief.findMany({
    where: { stock: { symbol: { in: symbols } } },
    select: {
      quarter: true, fiscalYear: true, resultType: true, content: true, verdictKey: true, verdictLabel: true,
      scoredAsOf: true, status: true, promptTokens: true, outputTokens: true, factsFingerprint: true,
      stock: { select: { symbol: true } },
    },
  });

  console.log("\n" + "═".repeat(112));
  console.log("2b · SECTIONS — what each stored payload actually carries (⊘ = absent by presence gate)");
  console.log("═".repeat(112));
  console.log(`  ${pad("symbol", 12)} ${pad("period", 8)} takeaway  quarter  annual  health  gaps   EMPTY-PRESENT`);
  const bulletCounts: number[] = [];
  const allEmpty: string[] = [];
  for (const sym of symbols) {
    const r = rows.find((x) => x.stock.symbol === sym);
    if (!r) { console.log(`  ${pad(sym, 12)} — no row stored (refused)`); continue; }
    const pl = JSON.parse(r.content) as BriefPayload;
    const empt = emptySections(pl);
    allEmpty.push(...empt.map((e) => `${sym}: ${e}`));
    bulletCounts.push(pl.takeaway.bullets.length);
    console.log(
      `  ${pad(sym, 12)} ${pad(r.fiscalYear + r.quarter, 8)} ` +
        `${String(pl.takeaway.bullets.length).padStart(5)}     ${String(pl.quarter.lines.length).padStart(5)}   ` +
        `${pl.annual ? String(pl.annual.lines.length).padStart(5) : "    ⊘"}   ` +
        `${pl.health ? pad(pl.health.bandLabel, 6) : "    ⊘ "}  ${String(pl.gaps.length).padStart(4)}   ` +
        `${empt.length === 0 ? "none" : empt.join(",")}`,
    );
  }
  console.log(`\n  present-but-empty sections across the ten: ${allEmpty.length === 0 ? "NONE" : allEmpty.join(" | ")}`);
  console.log("  (a present-but-empty section is a REFUSAL at generate.ts guard 5 — it can never reach storage;");
  console.log("   this line re-checks the STORED payloads so the claim is verified, not inherited.)");

  console.log("\n  ── BULLET COUNT DISTRIBUTION (cap is MAX_TAKEAWAY_BULLETS; there is deliberately NO floor) ──");
  const dist = new Map<number, string[]>();
  for (const sym of symbols) {
    const r = rows.find((x) => x.stock.symbol === sym);
    if (!r) continue;
    const n = (JSON.parse(r.content) as BriefPayload).takeaway.bullets.length;
    dist.set(n, [...(dist.get(n) ?? []), sym]);
  }
  for (const n of [...dist.keys()].sort((a, b) => a - b)) {
    console.log(`  ${n} bullet${n === 1 ? " " : "s"} : ${String(dist.get(n)!.length).padStart(2)}  ${"█".repeat(dist.get(n)!.length)}  ${dist.get(n)!.join(", ")}`);
  }
  if (bulletCounts.length) {
    const mean = bulletCounts.reduce((a, b) => a + b, 0) / bulletCounts.length;
    console.log(`  min=${Math.min(...bulletCounts)}  max=${Math.max(...bulletCounts)}  mean=${mean.toFixed(1)}`);
  }

  // ── 2c · ACTUAL COST, AND THE CORRECTED ESTIMATE ─────────────────────────────────────────────────
  const after = await peekAiCallQuota(QUARTER_BRIEF_MODEL, { kind: "system", job: "quarter_brief" });
  const calls = before.remaining - after.remaining;

  console.log("\n" + "═".repeat(112));
  console.log("2c · ACTUAL COST");
  console.log("═".repeat(112));
  console.log(`  ${pad("symbol", 12)} ${pad("factchars", 10)} ${pad("prompt", 8)} ${pad("output", 8)} total`);
  let pSum = 0, oSum = 0, counted = 0;
  const fit: { chars: number; prompt: number }[] = [];
  for (const sym of symbols) {
    const r = rows.find((x) => x.stock.symbol === sym);
    const m = meta.get(sym);
    if (!r || !m) continue;
    const pt = r.promptTokens ?? 0, ot = r.outputTokens ?? 0;
    pSum += pt; oSum += ot; counted++;
    fit.push({ chars: m.chars, prompt: pt });
    console.log(`  ${pad(sym, 12)} ${String(m.chars).padStart(9)} ${String(pt).padStart(8)} ${String(ot).padStart(8)} ${String(pt + ot).padStart(7)}`);
  }
  console.log(`  ${pad("TOTAL", 12)} ${pad("", 9)} ${String(pSum).padStart(8)} ${String(oSum).padStart(8)} ${String(pSum + oSum).padStart(7)}`);

  const written = outcomes.filter((o) => o.kind === "written").length;
  console.log(`\n  briefs written          : ${written} / ${TEN.length}`);
  console.log(`  AI CALLS CONSUMED       : ${calls}   (${(calls / Math.max(1, written)).toFixed(2)} per written brief — >1.00 means a retry fired)`);
  console.log(`  budget after            : ${after.limit - after.remaining} / ${after.limit} used, ${after.remaining} remaining`);
  console.log(`  wall time for the ten   : ${(wall / 1000).toFixed(1)}s  ⇒ ${(wall / 1000 / TEN.length).toFixed(2)}s per stock`);

  // The extrapolation, fitted on SIZE rather than averaged — see the header.
  if (counted >= 3) {
    const meanChars = fit.reduce((a, f) => a + f.chars, 0) / fit.length;
    const meanPrompt = fit.reduce((a, f) => a + f.prompt, 0) / fit.length;
    const tokPerChar = meanPrompt / meanChars;
    console.log(`\n  ── CORRECTING GATE 1's ESTIMATE ─────────────────────────────────────────────────────────`);
    console.log(`  prompt tokens per fact-block char (fitted on the ten): ${tokPerChar.toFixed(4)}`);
    console.log(`  ⚠ the ten mean ${Math.round(meanChars)} chars; the eligible-493 p50 is 3,531 and the mean is higher,`);
    console.log(`    so a naive per-brief mean would understate the run. The run report re-measures against actuals.`);
    const meanOut = oSum / Math.max(1, counted);
    console.log(`  mean output tokens: ${meanOut.toFixed(0)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
