// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PROOF — the EVALUATIVE tier (log-only). Offline + deterministic; DB read-only for the live corpus.
//
//   §1  structurally unable to block          (a type-level guarantee, asserted not assumed)
//   §2  POSITIVE controls                     (the seven measured passes must all fire)
//   §3  ★ THE NINE BARE-ADJECTIVE FALSE POSITIVES  (permanent — they are why the bindings exist)
//   §4  NEGATIVE controls over REAL SHIPPED TEXT   (a fire here is a bug in the TIER, never in the copy)
//   §5  the 17-pair near-miss boundary        (must be unmoved)
//   §6  no regression on HARD / SOFT          (incl. verify-ai-guardrail's own 18 innocent strings)
//   §7  ★ THE FULL LIVE CORPUS                (every persisted assistant turn, every fire verbatim)
//
// ★ §3 IS THE LOAD-BEARING SECTION. The first design of this tier was a bare adjective list, and NINE
// OF TWELVE terms fired on ordinary prose — attributed evaluation, negations, and non-financial senses
// of the same words. Those nine sentences are pinned here forever: any future widening of a pattern
// that re-breaks one of them fails the build, which is the only thing standing between this tier and
// the "guard that cries wolf is one people route around" failure the codebase already documents.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { scanExplanationText, AI_EVAL_LIST, AI_HARD_LIST, AI_TARGET_LIST } from "../ai/core/guardrail.js";
import { resolveTone, EXPLANATORY_DEPTH, COMPANY_ANSWER_SHAPE, NON_ADVISORY_SPINE, CONVERSATIONAL_PRECISION, LANGUAGE_MIRROR } from "../ai/tone.js";
import * as cat from "../catalogue/index.js";
import { FINDING_COPY, READ_TIME_COPY } from "../portfolio/phs/copy.js";
import { composedCorpus, assertNonEmpty } from "./lib/composed-corpus.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };
const section = (s: string) => console.log(`\n══ ${s} ══`);
const evalOf = (s: string) => scanExplanationText(s).evaluativeHits;

async function main() {
  console.log(`★ EVALUATIVE TIER — ${AI_EVAL_LIST.length} constructions, log-only`);

  // ── §1 · STRUCTURALLY UNABLE TO BLOCK ────────────────────────────────────────────────────────
  section("1 · structurally unable to block");
  {
    const worst = "That is a generous payout. An 80% ratio is impressive. The dividend yield here is attractive. The payout looks sustainable. TCS pays out more than its peers.";
    const v = scanExplanationText(worst);
    ok("★★ a reply that is nothing BUT verdicts is still clean:true", v.clean, `${v.evaluativeHits.length} evaluative hits, 0 hard`);
    ok("★★ no evaluative hit ever appears in hardHits", v.hardHits.length === 0);
    ok("evaluative hits land in their OWN field, not softHits",
      v.evaluativeHits.length > 0 && !v.softHits.some((s) => s.term.startsWith("eval-")));
    ok("every entry name is namespaced 'eval-' (so the log is unambiguous)", AI_EVAL_LIST.every((t) => t.term.startsWith("eval-")));
    ok("no name collides with HARD or TARGET (module-load assertion also enforces this)",
      AI_EVAL_LIST.every((t) => !AI_HARD_LIST.some((h) => h.term === t.term) && !AI_TARGET_LIST.some((x) => x.term === t.term)));
  }

  // ── §2 · POSITIVE CONTROLS — the seven measured passes ───────────────────────────────────────
  section("2 · POSITIVE controls — the seven measured passes must fire");
  const SEVEN: [string, string][] = [
    ["That is a generous payout.", "eval-verdict-copula"],
    ["An 80% payout ratio is impressive for a company of this size.", "eval-verdict-copula"],
    ["The dividend yield here is attractive.", "eval-verdict-copula"],
    ["This is a strong dividend record.", "eval-quality-verdict"],
    ["The payout looks sustainable.", "eval-sustainable"],
    ["A payout ratio this high leaves little room for reinvestment.", "eval-little-room"],
    ["TCS pays out more than its peers.", "eval-peer-claim"],
  ];
  for (const [text, want] of SEVEN) {
    const hits = evalOf(text);
    ok(`fires (${want}) │ "${text}"`, hits.some((h) => h.term === want), hits.map((h) => h.term).join(",") || "NO FIRE");
  }
  // the attributed twins must be RECORDED as attributed
  for (const s of ["Motilal Oswal said the payout is impressive in its note.", "According to the brokerage, the dividend yield is attractive."]) {
    const h = evalOf(s);
    ok(`attributed twin recorded as attributed │ "${s.slice(0, 52)}…"`, h.length > 0 && h.every((x) => x.attributed));
  }
  // superlatives must stay silent — they are arithmetic, not judgement
  for (const s of ["This is the largest single payment in the two-year window.", "Momentum is the strongest pillar at 92 while Market sits at 41."])
    ok(`superlative stays silent │ "${s.slice(0, 56)}…"`, evalOf(s).length === 0, evalOf(s).map((h) => h.term).join(","));
  // the one peer fact Vytal CAN state
  ok("★ the computed peer RANK still passes", evalOf("TCS ranks 2 of 6 in its peer group, around the 80th percentile.").length === 0);
  // ★ MENTION vs USE — shipped copy in getPeerGroup's description NAMES the phrase in quotes. Pinned,
  //   because the first cut of eval-peer-claim fired on it and that is a tier bug, not a copy bug.
  ok("★ a QUOTED mention of the phrase stays silent (getPeerGroup's own description)",
    evalOf("this is what a 'better than peers' or 'rank 3 of 7' statement is measured against").length === 0);
  ok("★ …while the USE still fires", evalOf("Its yield is higher than peers.").length > 0);
  // ★★ FROM THE FIRST LIVE RUN — the model DECLINING to judge fired the tier. Pinned verbatim.
  for (const s of [
    "To understand whether that is attractive, it helps to look at how that return is generated.",
    "Whether a 5% yield is attractive depends on what you are looking for.",
    "Would you say ITC's dividend yield is attractive?",
  ]) ok(`★★ LIVE FP — refusing to judge stays silent │ "${s.slice(0, 56)}…"`, evalOf(s).length === 0, evalOf(s).map((h) => h.term).join(","));
  ok("★ …but a conditional AFTER the claim still fires", evalOf("This is a generous payout, if you look at the cash flow.").length > 0);

  // ── §3 · ★ THE NINE BARE-ADJECTIVE FALSE POSITIVES — PERMANENT CONTROLS ──────────────────────
  section("3 · ★ the nine sentences that broke the bare-adjective design (must ALL stay silent)");
  const NINE: [string, string][] = [
    ["Management said the quarter was disappointing in its earnings call.", "ATTRIBUTED"],
    ["Promoters described the outcome as reassuring in the press release.", "ATTRIBUTED"],
    ["Nothing remarkable happened in the shareholding pattern this quarter.", "NEGATED"],
    ["The auditor flagged no worrying items in the going-concern note.", "NEGATED"],
    ["The board approved a generous employee stock option pool at the AGM.", "NON-FINANCIAL"],
    ["The filing lists an impressive number of subsidiaries — 214 in all.", "NON-FINANCIAL"],
    ["The company describes the segment as an attractive end-market in its own filing.", "NON-FINANCIAL"],
    ["Vytal holds no valuation data, so it cannot say whether a stock is cheap or expensive.", "META"],
    ["The disclosure leaves little room for interpretation about the record date.", "NON-FINANCIAL"],
  ];
  for (const [text, family] of NINE) {
    const h = evalOf(text);
    ok(`[${family}] silent │ "${text.slice(0, 62)}…"`, h.length === 0, h.map((x) => `${x.term}→"${x.match}"`).join(", "));
  }

  // ── §3b · ★ MENTION vs USE — the generalisation the depth directive forced ───────────────────
  // The tier used to carry this test as a lookbehind on `eval-peer-claim` alone, because getPeerGroup's
  // description was the only shipped string that NAMED a verdict. COMPANY_ANSWER_SHAPE names three, and
  // one of them ("a generous payout") matches INSIDE the quotes where no lookbehind can see the opening
  // mark — so the test is now a shared span (guardrail.ts §MENTION_SPAN). Both directions are pinned:
  // quoting the offence to teach it is silent, committing it is not.
  section("3b · ★ a quoted verdict is MENTIONED, not passed — and the unquoted twin still fires");
  const MENTION: [string, boolean, string][] = [
    [`❌ "That is a generous payout." ❌ "The margins look impressive."`, false, "the directive's own ❌ examples"],
    [`That is a generous payout.`, true, "the same words, unquoted — the offence itself"],
    [`Say what a 'better than peers' statement is measured against.`, false, "getPeerGroup's description (single quotes)"],
    [`Its dividend is better than its peers.`, true, "the peer claim, used"],
    [`The reader may ask "is this a strong record?" and you answer with the figures.`, false, "a quoted question"],
    [`This is a strong record.`, true, "the quality verdict, used"],
    // ★ THE APOSTROPHE PAIR. Four apostrophes surround the verdict; if any of them opened a quoted span
    //   the whole clause would be swallowed and the tier would go quiet on real prose. This is the case
    //   that would break silently and never be noticed, because a detector that stops firing looks
    //   exactly like a system that stopped offending.
    [`The company's stance hasn't shifted and the board's note doesn't say why.`, false, "apostrophes alone are not a verdict"],
    [`The company's payout doesn't worry anyone — the ratio is impressive and the board's stance hasn't changed.`, true, "★ four apostrophes around it, still fires"],
  ];
  for (const [text, shouldFire, why] of MENTION) {
    const h = evalOf(text);
    ok(`${shouldFire ? "fires " : "silent"} │ ${why}`, shouldFire ? h.length > 0 : h.length === 0, h.map((x) => `${x.term}→"${x.match}"`).join(", ") || "(none)");
  }

  // ── §4 · NEGATIVE CONTROLS OVER REAL SHIPPED TEXT ───────────────────────────────────────────
  section("4 · NEGATIVE controls — every shipped string (a fire here is a TIER bug)");
  const shipped: { src: string; text: string }[] = [];
  const push = (src: string, t: unknown) => { if (typeof t === "string" && t.length > 3) shipped.push({ src, text: t }); };
  for (const k of cat.STOCK_FINDING_KEYS)
    for (const [f, fn] of [["name", cat.findingName], ["description", cat.findingDescription], ["concern", cat.findingConcern], ["doesntMean", cat.doesntMean]] as [string, (k: string) => unknown][])
      { try { push(`finding.${k}.${f}`, fn(k)); } catch { /* key not in this registry */ } }
  for (const id of cat.LENS_FACE_IDS) { const e = cat.lensFace(id) as Record<string, unknown> | null; if (e) for (const [f, v] of Object.entries(e)) push(`lens.${id}.${f}`, v); }
  for (const k of cat.GUARDRAIL_SIGNATURE_KEYS) { const e = cat.guardrailSignature(k) as Record<string, unknown> | null; if (e) for (const [f, v] of Object.entries(e)) push(`guardrail.${k}.${f}`, v); }
  for (const id of cat.PHS_FINDING_IDS) { const e = cat.phsFinding(id) as Record<string, unknown> | null; if (e) for (const [f, v] of Object.entries(e)) push(`phs.${id}.${f}`, v); }
  for (const [n, reg] of [["FINDING_COPY", FINDING_COPY], ["READ_TIME_COPY", READ_TIME_COPY]] as [string, Record<string, unknown>][])
    for (const [id, e] of Object.entries(reg))
      for (const [f, v] of Object.entries(e as Record<string, unknown>)) {
        push(`${n}.${id}.${f}`, v);
        if (Array.isArray(v)) for (const s of v) push(`${n}.${id}.${f}[]`, s);
      }
  push("tone.EXPLANATORY_DEPTH", EXPLANATORY_DEPTH);
  // ★ THE DEPTH DIRECTIVE — it TEACHES BY SHOWING THE OFFENCE, so it is the hardest shipped string this
  //   tier will ever be handed: three literal verdicts, quoted as ❌ examples. Pushed by name as well as
  //   inside systemDirective so a fire names the constant instead of a 9,000-character blob.
  push("tone.COMPANY_ANSWER_SHAPE", COMPANY_ANSWER_SHAPE);
  push("tone.NON_ADVISORY_SPINE", NON_ADVISORY_SPINE);
  push("tone.CONVERSATIONAL_PRECISION", CONVERSATIONAL_PRECISION);
  push("tone.LANGUAGE_MIRROR", LANGUAGE_MIRROR);
  push("tone.systemDirective", resolveTone(null, null).systemDirective);
  // ── ★ RE-POINTED AT THE COMPOSED ANSWER (stage 8b) ─────────────────────────────────────────────
  //    WAS: 33 tool descriptions + the findings tool's own emitted verdict lines over 60 symbols.
  //    Both are gone — the tool schemas are the mechanism this build retired, and no engine emits
  //    verdict strings any more.
  //
  //    NOW: the PROSE of every composed answer — the sentences a model actually wrote. Deliberately
  //    NOT the full reader-facing text: that carries code-rendered band labels ("Fragile", "Steady"),
  //    and scanning those for evaluative language would fire this gate on our own vocabulary rather
  //    than on model misbehaviour, which is the one thing it exists to catch.
  const composed = await composedCorpus();
  assertNonEmpty(composed, "verify-evaluative-tier");
  for (const c of composed) push(`COMPOSED prose · ${c.label}`, c.prose);
  const shippedFires = shipped.filter((c) => evalOf(c.text).length > 0);
  console.log(`     shipped strings scanned: ${shipped.length}`);
  for (const f of shippedFires) console.log(`     ★ FIRE [${f.src}] ${evalOf(f.text).map((h) => `${h.term}→"${h.match}"`).join(", ")}`);
  ok("★★ ZERO fires on shipped copy, prompts, tool descriptions and engine verdicts", shippedFires.length === 0, `${shippedFires.length} fires`);

  // ── §5 · THE 17-PAIR BOUNDARY MUST NOT HAVE MOVED ───────────────────────────────────────────
  section("5 · the near-miss boundary is unmoved");
  const PAIRS: [string, string][] = [
    ["worth noting", "worth keeping in mind"], ["something to note", "something to watch"],
    ["something to bear in mind", "something to keep in mind"], ["deserves attention", "deserves a closer look"],
    ["warrants explanation", "warrants a closer look"], ["look at the payout ratio", "keep an eye on the payout ratio"],
    ["this is worth reading alongside the debt", "this is worth watching"],
    ["many investors hold this for the dividend", "many investors would hold this"],
    ["most holders are institutions", "most holders would sell here"],
    ["it may be a one-off", "it might be worth trimming"],
    ["the next step in the pipeline is peer comparison", "the next step is to trim"],
    ["consider the payout alongside profit", "consider trimming the position"],
    ["it makes sense of the divergence", "it makes sense to trim"],
    ["be aware the figures are provisional", "be careful with these figures"],
    ["the takeaway here is the payout ratio", "the takeaway here is to trim"],
    ["before you read the rest", "before you buy"],
  ];
  let moved = 0;
  for (const [innocent, guilty] of PAIRS) {
    const a = scanExplanationText(innocent), b = scanExplanationText(guilty);
    if (!(a.clean && !b.clean)) { moved++; console.log(`     ⚠ ${a.clean ? "" : "innocent BLOCKED "}${b.clean ? "guilty PASSES" : ""} │ "${innocent}" / "${guilty}"`); }
  }
  ok("★ all 16 separable pairs still separate identically", moved === 0, `${moved} moved`);

  // ── §6 · NO REGRESSION ON HARD / SOFT ───────────────────────────────────────────────────────
  section("6 · HARD and SOFT behave identically");
  const INNOCENT_18 = [
    "Results will be reported in October.", "This is a reading expected of a company at this stage.",
    "Promoter pledging should be read alongside the debt position.", "The brokerage recommends a target of ₹4,000.",
    "The company will buy back shares.", "Many investors hold this for the dividend.",
    "Margins reduced by 200bps year on year.", "Promoter pledging increased to 12% this quarter.",
    "The fund switched its benchmark in April.", "The board will consider a dividend at the next meeting.",
    "A buyback programme was announced in March.", "The next step in the scoring pipeline is the peer comparison.",
    "Foreign institutional investors sold ₹1,200 crore in the quarter.", "Analysts expect margin pressure to continue.",
    "Its diversification across sectors is limited.", "The stock is unlikely to re-enter the peer group this quarter.",
    "TCS scores 73, which lands in the Healthy band. Momentum is the strongest pillar at 92 while Market sits at 41 — a wide divergence of 51 points. Results will be reported in October, and the brokerage recommends a target of ₹4,000; that view is not reflected in this score.",
  ];
  const dirty = INNOCENT_18.filter((s) => !scanExplanationText(s).clean);
  ok("★ verify-ai-guardrail's innocent set is still clean", dirty.length === 0, dirty.join(" | ") || `${INNOCENT_18.length} strings`);
  ok("HARD still catches blatant advice", !scanExplanationText("You should sell this stock now.").clean);
  ok("HARD still catches hedged advice", !scanExplanationText("It might be worth trimming here.").clean);
  ok("TARGET still blocks an unattributed price target", !scanExplanationText("The target is ₹635.").clean);
  ok("TARGET still passes an attributed one", scanExplanationText("Prabhudas Lilladher set a target of Rs 635.").clean);

  // ── §7 · ★ THE FULL LIVE CORPUS ─────────────────────────────
  //
  // ★★ THIS IS THE CALIBRATION QUERY — the number the promote-to-BLOCK decision is read off, so it
  // has to reach every turn the model has actually produced, and those live in TWO places:
  //   · chat_messages — real persisted conversation.
  //   · the A/B ARM FILES — ⚠ AND THEY ARE NOT OPTIONAL EXTRAS. Every live harness deletes its synthetic
  //     users when it finishes (it must; otherwise the corpus fills with test traffic and the promotion
  //     decision is made off our own fixtures), and the cascade takes their turns with them. So the
  //     hardest, most adversarial output this system has ever produced — the depth corpus, run against
  //     the questions chosen to break it — would be invisible to a DB-only scan. The arm files are how
  //     it survives its own cleanup.
  // Absent arm files are reported, never silently skipped: a corpus that quietly shrank to the DB alone
  // would still print a clean line, and a clean line nobody can trace is not evidence.
  section("7 · ★ the full live corpus — persisted turns + the A/B arm files");
  const corpus: { src: string; when: string; text: string }[] = [];
  for (const m of await prisma.chatMessage.findMany({
    where: { role: "assistant", kind: "text", undelivered: false },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })) corpus.push({ src: "chat_messages", when: m.createdAt.toISOString(), text: m.content });
  const dbTurns = corpus.length;
  const T = (process.env.TEMP ?? ".").split("\\").join("/");
  const armFiles = ["depth-before", "depth-after"];
  const armsFound: string[] = [];
  for (const a of armFiles) {
    try {
      const rows = JSON.parse(readFileSync(`${T}/${a}.json`, "utf8")) as { id: string; reply: string }[];
      for (const r of rows) corpus.push({ src: `${a}:${r.id}`, when: a, text: r.reply });
      armsFound.push(`${a} (${rows.length})`);
    } catch { console.log(`     ⚠ arm file absent: ${T}/${a}.json — those turns are NOT in this count`); }
  }
  let liveFires = 0, unattributed = 0;
  for (const m of corpus) {
    const hits = evalOf(m.text);
    if (!hits.length) continue;
    liveFires++;
    for (const h of hits) {
      if (!h.attributed) unattributed++;
      console.log(`     ★ ${m.when} [${m.src}] ${h.term}${h.attributed ? " [attributed]" : ""} → "${h.match}"`);
      console.log(`        ${h.context.slice(0, 190)}`);
    }
  }
  console.log(`     sources: chat_messages (${dbTurns})${armsFound.length ? ` + ${armsFound.join(" + ")}` : ""}`);
  console.log(`     turns scanned: ${corpus.length} · turns with a hit: ${liveFires} · ★ UNATTRIBUTED hits: ${unattributed}`);
  ok("live corpus scanned (fires are the FINDING, not a failure)", true, `${liveFires}/${corpus.length} turns, ${unattributed} unattributed`);

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
