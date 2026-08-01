// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PART 3d — THE KNOWN GAP, COUNTED. The evaluative tier binds every verdict to a DETERMINER
// ("a generous payout", "the ratio is impressive"). Live output does not: it writes "robust margins",
// "excellent cash conversion", "exceptionally strong cash generation" — attributive verdicts with no
// determiner, and adjectives that are also shipped vocabulary.
//
// ★ THIS SCRIPT DOES NOT WIDEN THE TIER. It measures two things and refuses to guess at a third:
//   1. FREQUENCY — how often each gap family appears in the measured before/after arms. A gap nobody
//      hits is not a gap; a gap the depth directive makes MORE common is a calibration input.
//   2. SEPARABILITY — for each candidate widening, how many of the ~1,190 SHIPPED strings it would fire
//      on. A candidate that fires on our own copy is not a candidate: the standing rule for this tier is
//      that a fire on shipped copy is a bug in the PATTERN, so a pattern that cannot avoid shipped copy
//      cannot be adopted at all.
// If nothing separates, the honest output is "nothing separates" — not a pattern invented to fill the
// table on one build's evidence.
//
//   npx tsx src/scripts/probe-evaluative-gap.ts [before.json] [after.json]
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { scanExplanationText, scanEvaluativeWith, type Term } from "../ai/guardrail.js";
import { VYTAL_CONTEXT_LAYER } from "../ai/context-layer.js";
import { resolveTone, EXPLANATORY_DEPTH, COMPANY_ANSWER_SHAPE, NON_ADVISORY_SPINE, CONVERSATIONAL_PRECISION, LANGUAGE_MIRROR } from "../ai/tone.js";
import { CHAT_USE_DONT_NARRATE, CHAT_WRITE_DISCIPLINE, ANTI_ADVICE_REMINDER } from "../chat/voice.js";
import { toolSpecs, makeToolContext } from "../chat/tools/registry.js";
import { getFindingsForSymbolsTool } from "../chat/tools/get-findings-for-symbols.js";
import * as cat from "../catalogue/index.js";
import { FINDING_COPY, READ_TIME_COPY } from "../portfolio/phs/copy.js";

// The tier's own vocabulary, restated here so the probe can vary it without touching the shipped file.
const SUBJ = String.raw`payouts?|dividends?|yields?|ratios?|margins?|returns?|profits?|revenues?|growth|records?|track\s+record|balance\s+sheets?|cash\s+flows?|cash\s+conversion|cash\s+generation|coverage|scores?|compan(?:y|ies)|business(?:es)?|stocks?|shares?|results?|performance|valuations?|fundamentals|footing|confidence|momentum`;
const INT = String.raw`(?:very|quite|rather|fairly|pretty|remarkably|particularly|genuinely|exceptionally|especially)\s+`;
const CLEAN = String.raw`generous|impressive|attractive|remarkable|superb|stellar|disappointing|worrying|reassuring`;
const SHIPPED_WORDS = String.raw`strong|weak|poor|excellent|solid|healthy|steady`;

/** The gap FAMILIES, as observed. Each is a shape the shipped tier cannot reach. */
const FAMILIES: [string, RegExp][] = [
  ["determiner-less + shipped-vocabulary adjective  ('robust margins')", new RegExp(String.raw`(?<!\b(?:a|an|the|its|their|no|any)\s)(?:${INT})?\b(?:robust|${SHIPPED_WORDS})\s+(?:${SUBJ})\b`, "gi")],
  ["determiner-less + clean adjective               ('impressive margins')", new RegExp(String.raw`(?<!\b(?:a|an|the|its|their|no|any)\s)(?:${INT})?\b(?:${CLEAN})\s+(?:${SUBJ})\b`, "gi")],
  ["copula + `robust`                                ('is robust at 20%')", /\b(?:is|are|was|were|sat|sits|stands?|runs?|remains?)\s+(?:\w+\s+)?robust\b/gi],
  ["intervening adjective breaks the bound form      ('a strong, growing business')", new RegExp(String.raw`\b(?:a|an)\s+(?:${SHIPPED_WORDS}|robust)\s*,\s*[\w-]+\s+(?:${SUBJ})\b`, "gi")],
];

// ★ THE CANDIDATES ARE RUN THROUGH THE TIER, NOT THROUGH `re.test`. See guardrail.ts
// §scanEvaluativeWith — the mention spans, the interrogative skip and the `whether`/`if` frame are part
// of what a term MEANS, and the last build rejected a workable widening by measuring without them.
const CANDIDATES: [string, RegExp][] = [
  ["A · drop the determiner, CLEAN adjectives only", new RegExp(String.raw`\b(?:${INT})?(?:${CLEAN})\s+(?:${SUBJ})\b`, "i")],
  ["B · add `robust` to the bound vocabulary", new RegExp(String.raw`\b(?:a|an)\s+(?:${INT})?robust\s+(?:${SUBJ})\b`, "i")],
  ["C · add `robust` unbound (any use of the word)", /\brobust\b/i],
  ["D · drop the determiner for `strong|excellent`", new RegExp(String.raw`\b(?:${INT})?(?:strong|excellent)\s+(?:${SUBJ})\b`, "i")],
  ["E · determiner-less, shipped-vocabulary adjectives", new RegExp(String.raw`\b(?:${INT})?(?:${SHIPPED_WORDS}|robust)\s+(?:${SUBJ})\b`, "i")],
  ["F · allow ONE intervening adjective after the determiner", new RegExp(String.raw`\b(?:a|an)\s+(?:${INT})?(?:${SHIPPED_WORDS}|robust)\s*,?\s+[\w-]+\s+(?:${SUBJ})\b`, "i")],
];

async function shippedStrings(): Promise<{ src: string; text: string }[]> {
  const out: { src: string; text: string }[] = [];
  const push = (src: string, t: unknown) => { if (typeof t === "string" && t.length > 3) out.push({ src, text: t }); };
  for (const k of cat.STOCK_FINDING_KEYS)
    for (const [f, fn] of [["name", cat.findingName], ["description", cat.findingDescription], ["concern", cat.findingConcern], ["doesntMean", cat.doesntMean]] as [string, (k: string) => unknown][])
      { try { push(`finding.${k}.${f}`, fn(k)); } catch { /* not in this registry */ } }
  for (const id of cat.LENS_FACE_IDS) { const e = cat.lensFace(id) as Record<string, unknown> | null; if (e) for (const [f, v] of Object.entries(e)) push(`lens.${id}.${f}`, v); }
  for (const k of cat.GUARDRAIL_SIGNATURE_KEYS) { const e = cat.guardrailSignature(k) as Record<string, unknown> | null; if (e) for (const [f, v] of Object.entries(e)) push(`guardrail.${k}.${f}`, v); }
  for (const id of cat.PHS_FINDING_IDS) { const e = cat.phsFinding(id) as Record<string, unknown> | null; if (e) for (const [f, v] of Object.entries(e)) push(`phs.${id}.${f}`, v); }
  for (const [n, reg] of [["FINDING_COPY", FINDING_COPY], ["READ_TIME_COPY", READ_TIME_COPY]] as [string, Record<string, unknown>][])
    for (const [id, e] of Object.entries(reg))
      for (const [f, v] of Object.entries(e as Record<string, unknown>)) { push(`${n}.${id}.${f}`, v); if (Array.isArray(v)) for (const s of v) push(`${n}.${id}.${f}[]`, s); }
  push("VYTAL_CONTEXT_LAYER", VYTAL_CONTEXT_LAYER);
  push("tone.EXPLANATORY_DEPTH", EXPLANATORY_DEPTH);
  push("tone.COMPANY_ANSWER_SHAPE", COMPANY_ANSWER_SHAPE);
  push("tone.NON_ADVISORY_SPINE", NON_ADVISORY_SPINE);
  push("tone.CONVERSATIONAL_PRECISION", CONVERSATIONAL_PRECISION);
  push("tone.LANGUAGE_MIRROR", LANGUAGE_MIRROR);
  push("voice.CHAT_USE_DONT_NARRATE", CHAT_USE_DONT_NARRATE);
  push("voice.CHAT_WRITE_DISCIPLINE", CHAT_WRITE_DISCIPLINE);
  push("voice.ANTI_ADVICE_REMINDER", ANTI_ADVICE_REMINDER);
  for (const s of toolSpecs()) { push(`toolDesc.${s.name}`, s.description); push(`toolParams.${s.name}`, JSON.stringify(s.parameters)); }
  const syms = (await prisma.stock.findMany({ take: 60, select: { symbol: true }, where: { scoreSnapshots: { some: {} } } })).map((s) => s.symbol);
  for (let i = 0; i < syms.length; i += 6) {
    const r = await getFindingsForSymbolsTool.handler({ symbols: syms.slice(i, i + 6) }, makeToolContext({ userId: "probe", sessionId: "probe", userMessage: "" } as never));
    if (r.ok) for (const line of r.content.split("\n")) if (line.trim()) push("ENGINE findings verdict", line);
  }
  return out;
}

async function main() {
  const T = (process.env.TEMP ?? ".").replace(/\\/g, "/");
  const arms: [string, { id: string; reply: string }[]][] = [];
  for (const [label, path] of [["BEFORE", process.argv[2] ?? `${T}/depth-before.json`], ["AFTER", process.argv[3] ?? `${T}/depth-after.json`]] as [string, string][]) {
    try { arms.push([label, JSON.parse(readFileSync(path, "utf8"))]); } catch { console.log(`  ⚠ ${label} arm absent (${path})`); }
  }

  console.log("═".repeat(104));
  console.log("3d · HOW OFTEN THE GAP IS ACTUALLY HIT — per arm, counted over the delivered replies\n");
  console.log(`  ${"gap family".padEnd(62)}${arms.map(([l]) => l.padStart(9)).join("")}`);
  console.log("  " + "─".repeat(62 + 9 * arms.length));
  const examples: string[] = [];
  for (const [label, re] of FAMILIES) {
    const counts = arms.map(([, turns]) => {
      let n = 0;
      for (const t of turns) {
        const ms = t.reply.match(new RegExp(re.source, "gi")) ?? [];
        n += ms.length;
        for (const m of ms.slice(0, 2)) examples.push(`    [${label.slice(0, 34)}…] "${m.trim()}"`);
      }
      return n;
    });
    console.log(`  ${label.padEnd(62)}${counts.map((c) => String(c).padStart(9)).join("")}`);
  }
  console.log(`\n  a sample of what was matched (these are REAL delivered sentences):`);
  for (const e of [...new Set(examples)].slice(0, 14)) console.log(e);

  // What the SHIPPED tier saw on the same replies — the gap is the difference between these numbers.
  console.log(`\n  ${"".padEnd(62)}${arms.map(([l]) => l.padStart(9)).join("")}`);
  console.log(
    `  ${"★ what the SHIPPED tier actually logged (all terms)".padEnd(62)}` +
      arms.map(([, t]) => String(t.reduce((n, x) => n + scanExplanationText(x.reply).evaluativeHits.length, 0)).padStart(9)).join(""),
  );

  console.log(`\n${"═".repeat(104)}`);
  console.log("3d · WOULD ANY WIDENING SEPARATE? — each candidate against every shipped string\n");
  const shipped = await shippedStrings();
  console.log(`  shipped strings scanned: ${shipped.length}\n`);
  console.log(`  ${"candidate".padEnd(56)}${"shipped fires".padEnd(16)}verdict`);
  console.log("  " + "─".repeat(96));
  for (const [label, re] of CANDIDATES) {
    const asTerm: Term[] = [{ term: "candidate", re, why: "candidate widening" }];
    const hits = shipped.filter((s) => scanEvaluativeWith(asTerm, s.text).length > 0);
    const verdict = hits.length === 0 ? "✅ separates — adoptable on evidence" : `❌ unusable — fires on our own copy`;
    console.log(`  ${label.padEnd(56)}${String(hits.length).padEnd(16)}${verdict}`);
    // ⚠ PRINT THE TIER'S OWN HIT, NOT THE FIRST REGEX MATCH. They differ: a pattern can match three
    //   times in one string and have two of them skipped as quoted or interrogative, so `text.search(re)`
    //   points at an occurrence the tier ignored and names the wrong blocker.
    for (const h of hits.slice(0, 3))
      for (const hit of scanEvaluativeWith(asTerm, h.text).slice(0, 1))
        console.log(`      └ [${h.src}] "${hit.match}" in: …${hit.context.trim().replace(/\s+/g, " ").slice(0, 108)}…`);
  }
  console.log("═".repeat(104));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
