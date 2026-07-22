// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE AI OUTPUT GUARDRAIL — BOTH FAILURE MODES, PROVEN. (Layer 1, src/ai/guardrail.ts)
//
// A guard has TWO ways to be useless and this file refuses to test only one of them:
//
//   1. IT MISSES ADVICE      → the spine is instruction-only and Flash-Lite ignores it.
//   2. IT BLOCKS DESCRIPTION → every user gets nothing instead of the truth, and the guard gets
//                              routed around by the first person it inconveniences.
//
// ★ THE SECOND SET IS THE HARDER AND MORE IMPORTANT ONE. Catching "You should sell TCS now" is easy;
// ANY word list does it. Passing "Results will be reported in October", "margins reduced 200bps" and
// "the brokerage recommends a target of ₹4,000" — all of which trip the EXISTING scoring/portfolio
// deny-lists — is what proves the AI-surface vocabulary was actually re-derived rather than copied.
//
// Proof style is the house one (verify-phs-copy.ts §"PROVE THE GATE BITES"): a guard nobody has seen
// fail is a guard nobody knows works, so every assertion is a live call with the verdict printed.
//
// PURE — no DB, no network, no AI call. Runs in milliseconds.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { scanExplanationText, AI_HARD_LIST } from "../ai/guardrail.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);

// ── SET 1 — ADVICE. Every one MUST be caught as a HARD hit. ────────────────────────────────────────
const ADVICE: string[] = [
  // blatant (operator-specified)
  "You should sell TCS now.",
  "I recommend trimming this position.",
  // hedged (operator-specified) — the ones with no banned verb in them
  "It might be worth reducing here.",
  "The obvious next step is to exit.",
  "You'll want to keep an eye on the debt.",
  "Many investors would trim at this level.", // ← the probation CATCH case
  // added
  "Consider trimming your position in HDFC Bank.",
  "This is a good time to buy.",
  "It would be prudent to reduce exposure here.",
  "My recommendation is to hold for now.",
  "Worth adding at these levels.",
  "If you're looking to reduce risk, this is the name to own.",
  "Investors should be cautious here.",
  "Something to watch before you invest.",
  "We advise a smaller allocation.",
  "The takeaway here is to wait for the next quarter.",
  "Sell the stock and rotate into large caps.",
  "It makes sense to wait for the results.",
];

// ── SET 2 — INNOCENT DESCRIPTIVE PROSE. Every one MUST pass clean. ────────────────────────────────
// Several of these deliberately trip the EXISTING lists — that is the point of the tiering.
const INNOCENT: { text: string; note: string }[] = [
  // operator-specified
  { text: "Results will be reported in October.", note: "bare 'will' — FORWARD list would block" },
  { text: "This is a reading expected of a company at this stage.", note: "bare 'expected' — FORWARD list would block" },
  { text: "Promoter pledging should be read alongside the debt position.", note: "bare 'should' — PORTFOLIO list would block" },
  { text: "The brokerage recommends a target of ₹4,000.", note: "THIRD-PARTY recommendation — PORTFOLIO list would block" },
  { text: "The company will buy back shares.", note: "bare 'will' + bare 'buy' — FORWARD list would block twice" },
  { text: "Many investors hold this for the dividend.", note: "★ THE PROBATION TEST — describing behaviour, not advising" },
  // added — each one trips at least one existing list term
  { text: "Margins reduced by 200bps year on year.", note: "'reduced' — PORTFOLIO list would block" },
  { text: "Promoter pledging increased to 12% this quarter.", note: "'increased' — PORTFOLIO list would block" },
  { text: "The fund switched its benchmark in April.", note: "'switched' — PORTFOLIO list would block" },
  { text: "The board will consider a dividend at the next meeting.", note: "'consider' — PORTFOLIO list would block" },
  { text: "A buyback programme was announced in March.", note: "word-boundary check: 'buyback' must NOT match \\bbuy\\b" },
  { text: "The next step in the scoring pipeline is the peer comparison.", note: "'next step' WITHOUT 'to' — must not trip next-step-to" },
  { text: "Foreign institutional investors sold ₹1,200 crore in the quarter.", note: "past-tense 'sold' describing real flows" },
  { text: "Analysts expect margin pressure to continue.", note: "'expect' attributed to a third party" },
  { text: "Its diversification across sectors is limited.", note: "'diversification' the noun is descriptive" },
  { text: "The stock is unlikely to re-enter the peer group this quarter.", note: "'unlikely' — FORWARD list would block" },
  {
    text:
      "TCS scores 74, which lands in the Healthy band. Momentum is the strongest pillar at 92 while " +
      "Market sits at 41 — a wide divergence of 51 points. Results will be reported in October, and " +
      "the brokerage recommends a target of ₹4,000; that view is not reflected in this score.",
    note: "a realistic multi-sentence explanation carrying several soft words",
  },
];

async function main() {
  console.log("\n★ AI OUTPUT GUARDRAIL — Layer 1 (deterministic, AI-free)");
  console.log(`  HARD vocabulary: ${AI_HARD_LIST.length} patterns`);

  rule("SET 1 — ADVICE MUST BE CAUGHT (blatant + hedged)");
  for (const s of ADVICE) {
    const v = scanExplanationText(s);
    ok(
      `CAUGHT: "${s}"`,
      !v.clean,
      v.hardHits.length ? v.hardHits.map((h) => `${h.term}→"${h.match}"`).join(", ") : "DID NOT FIRE — the gate is dead",
    );
  }

  rule("SET 2 — INNOCENT DESCRIPTIVE PROSE MUST PASS CLEAN (the harder half)");
  let probationTripped = false;
  for (const { text, note } of INNOCENT) {
    const v = scanExplanationText(text);
    const shown = text.length > 78 ? `${text.slice(0, 75)}…` : text;
    ok(
      `CLEAN: "${shown}"`,
      v.clean,
      v.clean
        ? `${note} · soft logged: ${v.softHits.map((h) => h.term).join(",") || "none"}`
        : `FALSE POSITIVE — blocked by ${v.hardHits.map((h) => `${h.term}→"${h.match}"`).join(", ")}`,
    );
    if (!v.clean && v.hardHits.some((h) => h.term === "many-investors-would")) probationTripped = true;
  }

  rule("PROBATION VERDICT — 'many investors …' (operator ruling: demote to SOFT if innocent prose trips)");
  const catchCase = scanExplanationText("Many investors would trim at this level.");
  const innocentCase = scanExplanationText("Many investors hold this for the dividend.");
  ok("CATCHES the speculative modal ('…would trim at this level')", !catchCase.clean,
     catchCase.hardHits.map((h) => `${h.term}→"${h.match}"`).join(", ") || "did not fire");
  ok("PASSES the present-tense description ('…hold this for the dividend')", innocentCase.clean,
     innocentCase.clean ? "clean" : `blocked by ${innocentCase.hardHits.map((h) => h.term).join(",")}`);
  ok("VERDICT: the two are separable ⇒ entry SURVIVES probation", !catchCase.clean && innocentCase.clean && !probationTripped,
     !probationTripped ? "no innocent string tripped it" : "an innocent string tripped it — DEMOTE to SOFT");

  rule("SOFT TIER — logged, never blocking");
  const soft = scanExplanationText("Results will be reported in October and margins should recover.");
  ok("soft words are recorded", soft.softHits.length > 0, soft.softHits.map((h) => `${h.term}→"${h.match}"`).join(", "));
  ok("…and do NOT affect `clean`", soft.clean, `clean=${soft.clean}`);
  ok("soft hits carry surrounding context for the promotion corpus", soft.softHits.every((h) => h.context.length > 0),
     `e.g. "${soft.softHits[0]?.context ?? ""}"`);

  rule("EDGE CASES");
  const empty = scanExplanationText("");
  ok("empty input is trivially clean", empty.clean && empty.hardHits.length === 0);
  ok("blank input is trivially clean", scanExplanationText("   \n  ").clean);
  const twice = [scanExplanationText("You should sell TCS now."), scanExplanationText("You should sell TCS now.")];
  ok("STATELESS — repeated scans give identical verdicts (no /g lastIndex drift)",
     twice[0].hardHits.length === twice[1].hardHits.length && !twice[0].clean && !twice[1].clean,
     `${twice[0].hardHits.length} vs ${twice[1].hardHits.length} hard hits`);

  console.log(
    `\n${"═".repeat(99)}\n  ${fail === 0 ? "═══ ALL PASS ✅ ═══" : `═══ ${fail} FAILURE(S) ❌ ═══`}\n${"═".repeat(99)}\n`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
