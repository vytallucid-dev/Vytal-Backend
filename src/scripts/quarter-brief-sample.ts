// STAGE 5 — HUMAN REVIEW SAMPLE. Generates through the REAL path (same prompt, same fact block, same
// four guards) and WRITES NOTHING. This is a read, not a rollout.
//
// It also runs the OMISSION CHECK, which no guard can do: the guards verify what is PRESENT, never
// what is MISSING. A dropped FINDING line passed every guard at Stage 3.
//
//   npx tsx src/scripts/quarter-brief-sample.ts

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText } from "../insight/quarter-brief/prompt.js";
import { generateQuarterBrief } from "../insight/quarter-brief/generate.js";
import { scanExplanationText } from "../ai/core/guardrail.js";
import type { QuarterBriefFactBlock } from "../insight/quarter-brief/types.js";

interface Pick { symbol: string; why: string }

const STOP = new Set(["the", "a", "an", "of", "in", "to", "and", "is", "was", "for", "on", "by", "it", "its", "this", "that", "from", "at", "as", "with"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z%]+/).filter((w) => w.length > 2 && !STOP.has(w));
const nums = (s: string) => (s.match(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?![\w])/g) ?? []).map((x) => x.replace(/,/g, ""));

/** 5c — what the guards structurally cannot check. */
function omissions(facts: string, prose: string): string[] {
  const out: string[] = [];
  const lower = prose.toLowerCase();
  const proseNums = new Set(nums(prose));

  for (const raw of facts.split("\n")) {
    const l = raw.trim();

    if (l.startsWith("FINDING:")) {
      const name = l.slice(8).trim();
      const w = words(name);
      const hit = w.filter((x) => lower.includes(x)).length;
      if (w.length && hit / w.length < 0.6) out.push(`FINDING DROPPED — "${name}"`);
    }

    if (l.startsWith("MUST SAY:")) {
      const body = l.slice(9).trim();
      const n = nums(body);
      // A reworded MUST SAY still carries its figures; if none survive, the point was dropped.
      if (n.length > 0) {
        if (!n.some((x) => proseNums.has(x))) out.push(`MUST SAY DROPPED — "${body.slice(0, 110)}…"`);
      } else {
        const w = words(body);
        if (w.length && w.filter((x) => lower.includes(x)).length / w.length < 0.5) {
          out.push(`MUST SAY DROPPED — "${body.slice(0, 110)}…"`);
        }
      }
    }
  }

  // Every [SECTION: X] in the facts must appear as a heading in the prose.
  for (const m of facts.matchAll(/\[SECTION: ([^\]]+)\]/g)) {
    if (!lower.includes(m[1].toLowerCase())) out.push(`SECTION DROPPED — "${m[1]}"`);
  }

  // A heading with nothing under it.
  const lines = prose.split("\n").map((x) => x.trim());
  for (let i = 0; i < lines.length; i++) {
    const isHead = /^(#{1,6}\s*)?[A-Z][^.!?]{4,60}$/.test(lines[i]) && !lines[i].startsWith("-");
    if (!isHead) continue;
    const next = lines.slice(i + 1).find((x) => x.length > 0);
    if (!next || /^(#{1,6}\s*)?[A-Z][^.!?]{4,60}$/.test(next)) out.push(`EMPTY HEADING — "${lines[i]}"`);
  }
  return out;
}

async function main(): Promise<void> {
  // ── Deliberate selection: cover families, scored/unscored, every live bucket, and the rare
  //    conditions. Buckets are discovered from real blocks rather than assumed.
  const stocks = await prisma.stock.findMany({ select: { symbol: true, industryType: true } });
  const blocks = new Map<string, QuarterBriefFactBlock>();
  for (const s of stocks) {
    const b = await buildQuarterBriefFactBlock(s.symbol);
    if (b) blocks.set(s.symbol, b);
  }

  const byKey = (k: string) => [...blocks.values()].filter((b) => b.verdict?.key === k).map((b) => b.identity.symbol);
  const fam = (f: string) => [...blocks.values()].filter((b) => b.identity.family === f).map((b) => b.identity.symbol);
  const has = (pred: (b: QuarterBriefFactBlock) => boolean) =>
    [...blocks.values()].filter(pred).map((b) => b.identity.symbol);

  const picks: Pick[] = [];
  const add = (symbol: string | undefined, why: string) => {
    if (symbol && !picks.some((p) => p.symbol === symbol)) picks.push({ symbol, why });
  };

  // Rare buckets first — they are the constraint.
  add(byKey("lifted_by_one_offs")[0], 'bucket: Lifted by one-offs (rare, 0.4%) + B-4 guardrail');
  add(byKey("lifted_by_one_offs")[1], "bucket: Lifted by one-offs (second instance)");
  add(byKey("grew_bad_loans_up")[0], "bucket: Grew, bad loans up (banking-only axis)");
  add(byKey("grew_bad_loans_up")[1], "bucket: Grew, bad loans up (second instance)");
  add(byKey("loss_both_periods")[0], "bucket: Made a loss again (no percentage is meaningful)");
  add(byKey("loss_both_periods")[1], "bucket: Made a loss again (second instance)");
  add(byKey("held")[0], "bucket: Held");
  add(byKey("pulled_both_ways")[0], "bucket: Pulled both ways (QoQ/YoY oppose)");
  add(byKey("fell_back")[0], "bucket: Fell back");
  add(byKey("grew")[0], "bucket: Grew (margin flat or unavailable)");
  add(byKey("grew_margins_thinner")[0], "bucket: Grew, margins thinner");
  add(byKey("grew_margins_wider")[0], "bucket: Grew, margins wider (largest bucket, 39%)");

  // Named conditions.
  add(has((b) => b.headlineHealthDivergence !== null && b.identity.family === "banking")[0], "condition: headline-vs-health divergence (banking)");
  add(has((b) => b.headlineHealthDivergence !== null && b.identity.family === "non_financial")[0], "condition: headline-vs-health divergence (non-financial)");
  add(has((b) => (b.healthMovement?.findingsCleared.length ?? 0) > 0)[0], "condition: a finding CLEARED between quarters");
  add(has((b) => (b.healthMovement?.findingsFired.length ?? 0) > 0)[0], "condition: a finding newly FIRED");
  add(has((b) => b.headline.disagreements.length > 0)[0], "condition: QoQ/YoY disagreement stated as a fact");

  // Families that would otherwise be missed.
  add(fam("life_insurance")[0], "family: life insurance (unscored; net margin only)");
  add(fam("general_insurance")[0], "family: general insurance (combined ratio, lowerIsBetter)");
  add(fam("nbfc")[0], "family: NBFC (unscored — health section absent by presence gate)");

  // Thinnest fact block — the omit-don't-pad rule made visible.
  const thin = [...blocks.values()]
    .map((b) => ({ s: b.identity.symbol, n: renderFactText(b).length }))
    .sort((a, b) => a.n - b.n)[0];
  add(thin?.s, `condition: THINNEST fact block (${thin?.n} chars) — omit-don't-pad`);

  const sample = picks.slice(0, 20);
  console.log("═".repeat(100));
  console.log(`SAMPLE COMPOSITION — ${sample.length} briefs`);
  console.log("═".repeat(100));
  for (const p of sample) {
    const b = blocks.get(p.symbol)!;
    console.log(`  ${p.symbol.padEnd(12)} ${b.identity.family.padEnd(18)} ${(b.verdict?.label ?? "(none)").padEnd(22)} ${b.healthMovement ? "scored" : "unscored"}  ${p.why}`);
  }

  let totalPrompt = 0, totalOutput = 0, refusals = 0, omissionCount = 0;
  const t0 = Date.now();
  const gaps: number[] = [];
  let prev = 0;

  for (const p of sample) {
    const block = blocks.get(p.symbol)!;
    const facts = renderFactText(block);
    // ⚠ START-to-START. The first version measured end-of-call to start-of-next, which is ~0 in a
    // sequential loop whether pacing works or not — an instrument that reads 0 when the mechanism is
    // healthy will read 0 when it is broken, so it can never detect the failure it exists to detect.
    const started = Date.now();
    if (prev) gaps.push(started - prev);
    prev = started;
    const res = await generateQuarterBrief(block);

    console.log("\n" + "─".repeat(100));
    console.log(`${p.symbol} · ${block.identity.periodKey} · ${block.identity.family} · VERDICT: ${block.verdict?.label ?? "(none)"}`);
    console.log(`why chosen: ${p.why}`);
    console.log("─".repeat(100));

    if (!res.ok) {
      refusals++;
      console.log(`⛔ REFUSED — ${res.reason}\n   ${res.detail}`);
      if (res.rejectedText) console.log(res.rejectedText.split("\n").map((l) => `   | ${l}`).join("\n"));
      continue;
    }
    totalPrompt += res.promptTokens ?? 0;
    totalOutput += res.outputTokens ?? 0;
    // ★ THE AUTHORED TEXT IS THE BULLETS. Everything else in the payload is a display string
    // the backend rendered; printing that back would report the fact block, not the generation.
    const authored: string[] = res.payload.takeaway.bullets;
    for (const b of authored) console.log(`   - ${b}`);

    const joined = authored.join(" ");
    const g = scanExplanationText(joined);
    if (g.softHits.length || g.evaluativeHits.length) {
      console.log(`\n   [tiers] soft=${g.softHits.length} evaluative=${g.evaluativeHits.length}`);
      for (const h of g.softHits) console.log(`     SOFT  ${h.term}: "${h.match}" — ${h.context}`);
      for (const h of g.evaluativeHits) console.log(`     EVAL  ${h.term}: "${h.match}"`);
    }
    const om = omissions(facts, joined);
    omissionCount += om.length;
    if (om.length) for (const o of om) console.log(`   ⚠ OMISSION: ${o}`);
  }

  const secs = (Date.now() - t0) / 1000;
  console.log("\n" + "═".repeat(100));
  console.log(`generated=${sample.length - refusals}  refused=${refusals}  omissions=${omissionCount}`);
  console.log(`tokens: prompt=${totalPrompt} output=${totalOutput} total=${totalPrompt + totalOutput}`);
  console.log(`wall=${secs.toFixed(1)}s  avg=${(secs / sample.length).toFixed(1)}s/brief`);
  const minGap = gaps.length ? Math.min(...gaps) : 0;
  console.log(`observed START-to-START gap: min=${minGap}ms  median=${gaps.length ? gaps.sort((a,b)=>a-b)[Math.floor(gaps.length/2)] : 0}ms  (MIN_CALL_SPACING_MS=4200)`);
  console.log(`sustained rate: ${(60000 / Math.max(minGap, 1)).toFixed(2)} req/min (ceiling 15)`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
