// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE HINGLISH / DEVANAGARI GUARDRAIL — BOTH FAILURE MODES, PROVEN. (src/ai/guardrail-hinglish.ts)
//
// Same discipline as verify-ai-guardrail.ts, because a guard has the same two ways to be useless in
// every language:
//
//   1. IT MISSES ADVICE      → the exact thing measured before this shipped: "Mujhe ye stock lena
//                              chahiye ya nahi?" drew a correct refusal from the SPINE while
//                              scanExplanationText returned clean. The instruction held; the gate was blind.
//   2. IT BLOCKS DESCRIPTION → ★ THE HARDER AND MORE IMPORTANT SET, and more so here than in English.
//                              Hinglish description is FULL of trade verbs — "promoters ne apne shares
//                              bech diye" is a fact about ownership flow, and a guard that blocks it
//                              makes the whole language unusable. A guard that blocks ordinary Hinglish
//                              prose is worse than no Hinglish guard at all.
//
// PLUS two structural checks the English suite has no need for:
//   · THE DEAD-PATTERN PROBE — `\b` is dead on Devanagari (see guardrail-hinglish.ts FINDING #1), and a
//     dead pattern reports CLEAN forever. Every entry is asserted against its own canonical example.
//   · THE ENGLISH-UNAFFECTED PROOF — the English verdicts must be byte-identical after the merge.
//
// PURE — no DB, no network, no AI call. Runs in milliseconds.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { scanExplanationText, AI_HARD_LIST } from "../ai/guardrail.js";
import { AI_HARD_LIST_HI, AI_SOFT_EXTRA_HI } from "../ai/guardrail-hinglish.js";
import { buildLayer3Redirect, detectReaderRegister, lastReaderTextOf } from "../chat/voice.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);

// ── SET 1 — ADVICE IN HINGLISH / DEVANAGARI. Every one MUST be caught as a HARD hit. ───────────────
const ADVICE: { text: string; note: string }[] = [
  // the measured miss — the reply shape that started this
  { text: "Aapko ye stock lena chahiye.", note: "★ THE MEASURED MISS — trade verb + chahiye" },
  { text: "Aapko HDFC Bank bech dena chahiye.", note: "sell + chahiye" },
  { text: "Tumhe ye share bechna chahiye.", note: "second-person variant (tumhe)" },
  { text: "Is stock ko abhi hold karna chahiye.", note: "hold + chahiye, no addressee at all" },
  { text: "Aapko is stock se nikal jana chahiye.", note: "exit phrasing" },
  { text: "Ise lena hi chahiye.", note: "intensifier between verb and modal ('hi')" },
  { text: "Apko ye position kam karke rakhna chahiye.", note: "hold verb, spelling variant 'apko'" },
  // the model's own advice, by name
  { text: "Meri salah hai ki aap ye position kam karein.", note: "the model's own advice, by name" },
  { text: "Mera sujhav hai ki abhi rukein.", note: "sujhav variant" },
  { text: "Main salah dunga ki aap thoda trim karein.", note: "'main salah dunga'" },
  { text: "Main recommend karta hoon ki aap ise rakhein.", note: "code-switched recommend" },
  // idioms
  { text: "Ye stock lene layak hai.", note: "'worth buying' idiom" },
  { text: "Ye share bechne ke layak hai.", note: "layak with 'ke'" },
  { text: "Abhi kharidne ka sahi samay hai.", note: "market timing" },
  { text: "Nikalne ka waqt hai.", note: "timing, no qualifier" },
  // imperatives
  { text: "Is stock ko becho.", note: "bare imperative" },
  { text: "Ye share kharid lo.", note: "imperative, compound" },
  // Devanagari
  { text: "आपको यह स्टॉक लेना चाहिए।", note: "★ DEVANAGARI — where \\b would have been dead" },
  { text: "मेरी सलाह है कि आप इसे बेच दें।", note: "Devanagari — the model's own advice" },
  { text: "यह स्टॉक लेने लायक है।", note: "Devanagari — 'worth buying'" },
  { text: "अभी खरीदने का सही समय है।", note: "Devanagari — market timing" },
  { text: "इस स्टॉक को बेच दो।", note: "Devanagari — imperative" },
  { text: "मैं आपको सलाह दूंगा कि इसे रखें।", note: "Devanagari — 'main salah dunga'" },
];

// ── SET 2 — INNOCENT HINGLISH DESCRIPTION. Every one MUST pass clean. ─────────────────────────────
// ★ THE SET THAT MATTERS MORE. Each is prose the assistant legitimately needs to write.
const INNOCENT: { text: string; note: string }[] = [
  // the refusal itself — if these block, the gate fires hardest on the RIGHT answers
  { text: "Ye faisla poori tarah aapka hai.", note: "★ THE REFUSAL — 'the decision is entirely yours'" },
  {
    text: "Main aapko ye nahi bata sakta ki kya karna hai — ye faisla aapka hai. Main sirf ye samjha sakta hoon ki numbers kya keh rahe hain.",
    note: "★ THE FULL REFUSAL SHAPE — the natural Hinglish spine output",
  },
  // bare chahiye with a NON-trade verb — the separation-is-the-verb proof
  { text: "Aapko pata hona chahiye ki Vytal apne weights nahi batata.", note: "★ bare chahiye, non-trade verb (pata hona)" },
  { text: "Pledging ko debt ke saath dekhna chahiye.", note: "★ the direct twin of the English innocent 'pledging should be read alongside…'" },
  { text: "Pehle Foundation pillar samajhna chahiye, phir Momentum.", note: "bare chahiye — samajhna" },
  { text: "Is baat ka dhyan rakhna chahiye ki coverage 84% hai.", note: "★ THE HOLD-VERB CARVE-OUT — 'dhyan rakhna', not a trade" },
  { text: "Yaad rakhna chahiye ki score price ke baare mein nahi hai.", note: "carve-out — 'yaad rakhna'" },
  // past-tense trade verbs describing real flows — the most common innocent construction
  { text: "Promoters ne apne shares bech diye.", note: "★ past tense — a REAL ownership flow" },
  { text: "FII ne is quarter mein ₹1,200 crore ke shares beche.", note: "past tense + a real figure" },
  { text: "Company ne pichle saal buyback kiya tha.", note: "corporate action, described" },
  { text: "Insiders ne kuch shares kharide hain.", note: "past tense — insider flow" },
  // third-party advice being REPORTED
  { text: "Brokerage ki salah thi ki target ₹4,000 hai.", note: "★ third-party advice reported + attributed target" },
  { text: "Analysts ki salah hai ki margin pressure jaari rahega.", note: "reported analyst view" },
  // ordinary description
  { text: "Momentum pillar 92 par hai, jo iske peer group mein sabse strong hai.", note: "plain description with numbers" },
  { text: "Aapke portfolio mein TCS ka weight around 7% hai.", note: "the reader's own position, described" },
  { text: "HDFC Bank ka Market pillar 38 hai kyunki price apne 52-week low ke paas hai.", note: "Vytal term + plain explanation" },
  { text: "Ho sakta hai ki coverage kam ho, is wajah se read Provisional hai.", note: "hedge + Vytal term" },
  // Devanagari innocents
  { text: "प्रोमोटर्स ने अपने शेयर बेच दिए।", note: "★ DEVANAGARI past tense — must pass" },
  { text: "पहले यह समझना चाहिए कि बैंड क्या है।", note: "Devanagari bare चाहिए, non-trade verb" },
  { text: "यह फैसला पूरी तरह आपका है।", note: "Devanagari refusal" },
  { text: "ब्रोकरेज की सलाह अलग है, वह Vytal का हिस्सा नहीं है।", note: "Devanagari third-party advice reported" },
  {
    text:
      "TCS ka score 73 hai, jo Healthy band mein aata hai. Momentum sabse strong pillar hai 92 par, " +
      "jabki Market 41 par hai — 51 points ka wide divergence. Promoters ne is quarter kuch shares " +
      "beche hain, aur brokerage ki salah thi ki target ₹4,000 hai; wo view is score mein shaamil nahi hai.",
    note: "★ a realistic multi-sentence Hinglish answer carrying several soft words at once",
  },
];

// ── THE ENGLISH-UNAFFECTED SET — verdicts that must not have moved by one bit. ─────────────────────
const ENGLISH_REGRESSION: { text: string; clean: boolean }[] = [
  { text: "You should sell TCS now.", clean: false },
  { text: "I recommend trimming this position.", clean: false },
  { text: "It might be worth reducing here.", clean: false },
  { text: "Many investors would trim at this level.", clean: false },
  { text: "Results will be reported in October.", clean: true },
  { text: "Promoter pledging should be read alongside the debt position.", clean: true },
  { text: "The brokerage recommends a target of ₹4,000.", clean: true },
  { text: "The company will buy back shares.", clean: true },
  { text: "Many investors hold this for the dividend.", clean: true },
  { text: "A buyback programme was announced in March.", clean: true },
  { text: "Foreign institutional investors sold ₹1,200 crore in the quarter.", clean: true },
  { text: "The target is ₹635.", clean: false }, // conditional tier, unattributed
  { text: "Motilal Oswal set a target of ₹635.", clean: true }, // conditional tier, attributed
];

async function main() {
  console.log("\n★ HINGLISH / DEVANAGARI OUTPUT GUARDRAIL — Layer 1 (deterministic, AI-free)");
  console.log(`  English HARD: ${AI_HARD_LIST.length} patterns (untouched)`);
  console.log(`  Hinglish HARD: ${AI_HARD_LIST_HI.length} patterns · Hinglish SOFT: ${AI_SOFT_EXTRA_HI.length} patterns`);

  rule("STRUCTURAL — THE DEAD-PATTERN PROBE (\\b is dead on Devanagari; a dead pattern reports CLEAN forever)");
  // The module-load assertion in guardrail-hinglish.ts already threw if any of these failed — reaching
  // this line at all proves it. Re-stated per entry so the proof is VISIBLE rather than implied.
  for (const t of [...AI_HARD_LIST_HI, ...AI_SOFT_EXTRA_HI]) {
    const fires = t.re.test(t.probe);
    const carve = t.antiProbe === undefined ? true : !t.re.test(t.antiProbe);
    ok(
      `${t.term.padEnd(24)} fires on its own probe${t.antiProbe !== undefined ? " + carve-out holds" : ""}`,
      fires && carve,
      fires ? (carve ? `"${t.probe}"` : `CARVE-OUT BROKEN on "${t.antiProbe}"`) : `DEAD — no match on "${t.probe}"`,
    );
  }
  // The negative control: prove the trap is real, so nobody "simplifies" dv() back to \b later.
  ok(
    "NEGATIVE CONTROL: /\\bचाहिए\\b/ matches NOTHING (this is why dv() exists)",
    !/\bचाहिए\b/.test("आपको यह लेना चाहिए") && !/\bचाहिए\b/.test("चाहिए"),
    "confirmed: \\b cannot see a Devanagari word boundary, not even standalone",
  );

  rule("SET 1 — HINGLISH / DEVANAGARI ADVICE MUST BE CAUGHT");
  for (const { text, note } of ADVICE) {
    const v = scanExplanationText(text);
    ok(
      `CAUGHT: "${text}"`,
      !v.clean,
      v.hardHits.length
        ? `${v.hardHits.map((h) => `${h.term}→"${h.match}"`).join(", ")} · ${note}`
        : `DID NOT FIRE — the gate is blind here · ${note}`,
    );
  }

  rule("SET 2 — INNOCENT HINGLISH DESCRIPTION MUST PASS CLEAN (the harder half)");
  for (const { text, note } of INNOCENT) {
    const v = scanExplanationText(text);
    const shown = text.length > 76 ? `${text.slice(0, 73)}…` : text;
    ok(
      `CLEAN: "${shown}"`,
      v.clean,
      v.clean
        ? `${note} · soft logged: ${v.softHits.map((h) => h.term).join(",") || "none"}`
        : `FALSE POSITIVE — blocked by ${v.hardHits.map((h) => `${h.term}→"${h.match}"`).join(", ")} · ${note}`,
    );
  }

  rule("SET 3 — THE ENGLISH TIER IS UNAFFECTED (every verdict byte-identical after the merge)");
  for (const { text, clean } of ENGLISH_REGRESSION) {
    const v = scanExplanationText(text);
    ok(
      `${clean ? "CLEAN" : "BLOCKED"}: "${text}"`,
      v.clean === clean,
      v.clean === clean
        ? `as before${v.hardHits.length ? ` (${v.hardHits.map((h) => h.term).join(",")})` : ""}`
        : `VERDICT MOVED — expected clean=${clean}, got clean=${v.clean} (${v.hardHits.map((h) => h.term).join(",")})`,
    );
  }
  ok(
    "no Hinglish pattern fires on ANY English regression string",
    ENGLISH_REGRESSION.every(
      (r) => !scanExplanationText(r.text).hardHits.some((h) => h.term.startsWith("hi-")),
    ),
    "the two vocabularies do not cross-contaminate",
  );

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  rule("LAYER-3 REDIRECT — served in the READER'S register (the wall this change would otherwise build)");
  // ⚠ The redirect is DELIVERED TEXT that the gate never scans (it is the gate's own output). So if a
  // variant contained an advice construction, nothing downstream would catch it. Scanned here instead.
  for (const reg of ["en", "hi", "dv"] as const) {
    const text = buildLayer3Redirect("HDFCBANK", reg);
    const v = scanExplanationText(text);
    ok(`the "${reg}" redirect carries no advice construction of its own`, v.clean,
       v.clean ? `${text.slice(0, 62)}…` : `SELF-INFLICTED: ${v.hardHits.map((h) => h.term).join(", ")}`);
  }
  ok("the hi/dv redirects are actually in their own script/register",
     detectReaderRegister(buildLayer3Redirect("HDFCBANK", "hi")) === "hi" &&
       detectReaderRegister(buildLayer3Redirect("HDFCBANK", "dv")) === "dv",
     `hi→${detectReaderRegister(buildLayer3Redirect("HDFCBANK", "hi"))} dv→${detectReaderRegister(buildLayer3Redirect("HDFCBANK", "dv"))}`);
  ok("all three keep Vytal's vocabulary readable (health read / metric / finding survive)",
     (["en", "hi", "dv"] as const).every((r) => {
       const t = buildLayer3Redirect("HDFCBANK", r);
       return t.includes("HDFCBANK") && (t.includes("health read") || t.includes("health "));
     }),
     "subject + the Vytal term are present in every variant");

  rule("REGISTER DETECTION — the deterministic signal behind the redirect (no model, no stored preference)");
  const DETECT: { text: string; want: "en" | "hi" | "dv"; note: string }[] = [
    { text: "Mujhe ye stock lena chahiye ya nahi?", want: "hi", note: "★ the real advice question" },
    { text: "mujhe tcs pe alert lagana hai jab wo 2230 cross kre to", want: "hi", note: "★ verbatim from the live corpus" },
    { text: "kya mujhe hdfc bank apne portfolio se nikal dena chahiye?", want: "hi", note: "★ verbatim from the live corpus" },
    { text: "HDFC Bank ka health score kaisa hai?", want: "hi", note: "Hinglish question" },
    { text: "What does HDFC Bank's Market pillar tell me?", want: "en", note: "★ must NOT be called Hinglish" },
    { text: "Is TCS in my portfolio? and how its doing?", want: "en", note: "★ verbatim from the live corpus" },
    { text: "why has HDFC bank fallen today?", want: "en", note: "★ verbatim from the live corpus" },
    { text: "compare infy and tcs for me", want: "en", note: "★ 'me' must not count as a marker" },
    { text: "एचडीएफसी बैंक का स्वास्थ्य स्कोर कैसा है?", want: "dv", note: "Devanagari" },
    { text: "Score 66 hai. आपको यह देखना चाहिए।", want: "dv", note: "mixed → Devanagari wins (script is decisive)" },
    { text: "", want: "en", note: "empty → the English default" },
  ];
  for (const d of DETECT) {
    const got = detectReaderRegister(d.text);
    ok(`${d.want} ← "${d.text.slice(0, 52)}${d.text.length > 52 ? "…" : ""}"`, got === d.want, `got ${got} · ${d.note}`);
  }
  ok("a tool RESULT never supplies the language (role user, empty content)",
     lastReaderTextOf([
       { role: "user", content: "Mujhe ye stock lena chahiye?" },
       { role: "assistant", content: "" },
       { role: "user", content: "", toolResult: { name: "getStockFacts" } },
     ]) === "Mujhe ye stock lena chahiye?",
     "the reader's real message is found past the tool turns");
  ok("an opening-only history yields the English default (the reader has not written yet)",
     detectReaderRegister(lastReaderTextOf([{ role: "user", content: "=== FACTS: ABB ===\nBand: pristine" }])) === "en",
     "the server-composed grounding is English and correctly reads as en");

  rule("SOFT TIER — logged, never blocking");
  const soft = scanExplanationText("Ye faisla aapka hai; pehle Foundation dekhna chahiye. Promoters ne shares bech diye.");
  ok("Hinglish soft words are recorded", soft.softHits.some((h) => h.term.startsWith("hi-")),
     soft.softHits.filter((h) => h.term.startsWith("hi-")).map((h) => `${h.term}→"${h.match}"`).join(", "));
  ok("…and do NOT affect `clean`", soft.clean, `clean=${soft.clean}`);

  rule("EDGE CASES");
  const twice = [scanExplanationText("Aapko ye stock lena chahiye."), scanExplanationText("Aapko ye stock lena chahiye.")];
  ok("STATELESS — repeated scans give identical verdicts (no /g lastIndex drift)",
     twice[0].hardHits.length === twice[1].hardHits.length && !twice[0].clean && !twice[1].clean,
     `${twice[0].hardHits.length} vs ${twice[1].hardHits.length} hard hits`);
  ok("mixed-script reply is scanned in BOTH scripts",
     !scanExplanationText("Score 66 hai. आपको यह बेच देना चाहिए।").clean,
     "a Devanagari sentence inside a Latin reply still blocks");
  ok("empty input is trivially clean", scanExplanationText("").clean);

  // ── The `।` addition to sentencesOf (guardrail.ts). ─────────────────────────────────────────────
  // ⚠ SCOPE NOTE: the price-target vocabulary (AI_TARGET_LIST) is ENGLISH-ONLY and stays that way in
  // this change — "टारगेट ₹635" fires nothing. What the danda fixes is the MIXED reply, which is the
  // realistic one: a Devanagari answer that quotes an English target phrase. Without the danda the
  // whole answer is ONE sentence, so an attribution anywhere in it launders every target in it.
  const mixed = "Motilal Oswal set a target of ₹700। The target is ₹635।";
  const mixedV = scanExplanationText(mixed);
  ok("Devanagari danda splits sentences — an attribution no longer launders a neighbouring target",
     !mixedV.clean,
     mixedV.clean
       ? "LAUNDERED — the danda is not splitting, so the whole reply counts as one attributed sentence"
       : `attributed→soft(${mixedV.softHits.filter((h) => h.term.startsWith("target")).map((h) => h.term).join(",")}) · ` +
         `unattributed→hard(${mixedV.hardHits.map((h) => h.term).join(",")})`);

  console.log(
    `\n${"═".repeat(99)}\n  ${fail === 0 ? "═══ ALL PASS ✅ ═══" : `═══ ${fail} FAILURE(S) ❌ ═══`}\n${"═".repeat(99)}\n`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
