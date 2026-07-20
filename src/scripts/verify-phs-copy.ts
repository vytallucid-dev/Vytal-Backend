// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 9 — THE COPY GATES. §3 + §1, ENFORCED, NOT REVIEWED.
//
//   1. Every emitted finding HAS a `doesntMean`  — "a finding without a Doesn't-mean does not ship"
//      must mean THE BUILD FAILS, not that someone notices in review.
//   2. The advice-verb grep at ZERO across every ASSERTIVE string (`read`), via the shared
//      no-forward-guard + PORTFOLIO_ADVICE_DENY_LIST.
//   3. Every `doesntMean` is CLASSIFIED (advice-block / misread-block / misattribution-block).
//   4. The five Constructive ones STATE THEIR SCOPE, not a disclaimer.
//   5. ONE copy module — no copy lives anywhere else.
//
// §1 is the platform's spine and it erodes ONE WELL-MEANING COPY EDIT AT A TIME. A reviewer who reads
// "consider trimming" and thinks "that's helpful" is the threat model. This file is the answer.
//
// PURE. No DB.
//   npx tsx src/scripts/verify-phs-copy.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import {
  firePortfolioFindings,
  NOT_EVALUABLE_UNDECLARED,
  type PfFinding,
} from "../portfolio/phs/patterns.js";
import {
  FINDING_COPY,
  COPY_IDS,
  type DoesntMeanJob,
} from "../portfolio/phs/copy.js";
import {
  scanStringsForForwardLanguage,
  PORTFOLIO_ADVICE_DENY_LIST,
} from "../scoring/lens-patterns/no-forward-guard.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) =>
  console.log("\n" + "═".repeat(92) + "\n" + s + "\n" + "═".repeat(92));

// ── Books chosen to fire as much of the library as possible. Copy is per-ID and book-independent, so
//    this only needs to REACH each id; the reachability PROOFS live in verify-phs-patterns. ──
const seq = new Map<string, string>();
const isinFor = (s: string) => {
  let v = seq.get(s);
  if (!v) {
    v = `INE${(seq.size + 1).toString(36).toUpperCase().padStart(4, "0")}00000`;
    seq.set(s, v);
  }
  return v;
};
const H = (
  symbol: string,
  mv: number,
  tier: PhsHolding["tier"],
  sector: string | null,
  health: number | null,
  findings: PhsHolding["findings"] = [],
): PhsHolding => ({
  symbol,
  marketValue: mv,
  tier,
  sector,
  health,
  findings,
  isin: isinFor(symbol),
  assetClass: "stock",
  category: null,
});
const HF = (
  symbol: string,
  mv: number,
  house: string | null,
  cat: string | null = "Open Ended Schemes(Equity Scheme - Large Cap Fund)",
): PhsHolding => ({
  symbol,
  marketValue: mv,
  tier: "unknown",
  sector: null,
  health: null,
  findings: [],
  isin: isinFor(symbol),
  assetClass: "mutual_fund",
  category: cat,
  fundHouse: house,
  name: `${symbol} Fund - Growth`,
});
const fire = (hs: PhsHolding[], fw: string[] = []) =>
  firePortfolioFindings(hs, computePhs(hs), { fieldWeakSymbols: new Set(fw) });

const BOOKS: PhsHolding[][] = [
  // dominant + thin + unscored
  [
    H("BIG", 45, "small", null, null),
    H("O", 15, "small", null, null),
    H("R", 15, "large", "Energy", 70),
    H("T", 15, "large", "IT", 71),
    H("B", 10, "large", "Defense", 78),
  ],
  // broad + clean + fully covered
  Array.from({ length: 12 }, (_, i) =>
    H(`W${i}`, 100 / 12, "large", `Sec${i}`, 78),
  ),
  // false sector spread
  Array.from({ length: 9 }, (_, i) =>
    H(`N${i}`, 100 / 9, "large", ["Energy", "IT", "Pharma"][i % 3], 70),
  ),
  // heavy-but-not-dominant + a weak name at size + deterioration
  [
    H("HV", 35, "large", "Pharma", 40, ["distress"]),
    H("D2", 25, "large", "IT", 45, ["critical"]),
    H("D3", 20, "large", "Energy", 50, ["high"]),
    H("D4", 20, "large", "Auto", 55, ["medium"]),
  ],
  // sector concentration (50%) without single-sector
  [
    H("P1", 30, "large", "Pharma", 70),
    H("P2", 20, "large", "Pharma", 70),
    H("X1", 25, "large", "IT", 70),
    H("X2", 25, "large", "Energy", 70),
  ],
  // single-sector
  [
    H("S1", 40, "large", "Pharma", 70),
    H("S2", 30, "large", "Pharma", 70),
    H("S3", 30, "large", "IT", 70),
  ],
  // fund house 60% + PB6 category pile-up
  [
    HF("F1", 15, "HDFC AMC"),
    HF("F2", 15, "HDFC AMC"),
    HF("F3", 15, "HDFC AMC"),
    HF("F4", 15, "HDFC AMC"),
    HF(
      "F5",
      40,
      "Kotak AMC",
      "Open Ended Schemes(Equity Scheme - Mid Cap Fund)",
    ),
  ],
  // single-house
  [
    HF("G1", 50, "SBI Funds Management"),
    HF("G2", 40, "SBI Funds Management"),
    HF("G3", 10, "Axis AMC"),
  ],
  // one company, two instruments
  [
    {
      symbol: "NTPC",
      marketValue: 11,
      tier: "large",
      sector: "Energy",
      health: 70,
      findings: [],
      isin: "INE733E01010",
      assetClass: "stock",
    },
    {
      symbol: "NTPC-NCD",
      marketValue: 8,
      tier: "unknown",
      sector: null,
      health: null,
      findings: [],
      isin: "INE733E07AB1",
      assetClass: "bond",
    },
    ...Array.from({ length: 9 }, (_, i) => H(`Z${i}`, 9, "large", `Q${i}`, 70)),
  ],
  // recognized-unscored + broad strength + weak field
  [
    H("A1", 30, "large", "IT", 85),
    H("A2", 30, "large", "Energy", 84),
    H("A3", 25, "large", "Pharma", 83),
    H("A4", 15, "mid", "Auto", null),
  ],
];
const fired: PfFinding[] = BOOKS.flatMap((b) => fire(b));
fired.push(
  ...fire(
    [H("FW1", 50, "large", "IT", 70), H("FW2", 50, "large", "Energy", 70)],
    ["FW1"],
  ),
); // PX5
const firedIds = [...new Set(fired.map((f) => f.id))].sort();

async function main() {
  rule(
    "1 · EVERY EMITTED FINDING HAS A `doesntMean` — the build fails, nobody 'notices in review'",
  );
  console.log(
    `  reached ${firedIds.length} distinct ids across ${BOOKS.length + 1} books: [${firedIds.join(", ")}]`,
  );
  const missing = fired.filter(
    (f) => !f.doesntMean || f.doesntMean.trim() === "",
  );
  ok(
    "every FIRED finding carries a non-empty doesntMean",
    missing.length === 0,
    missing.length
      ? `MISSING: ${[...new Set(missing.map((f) => f.id))].join(",")}`
      : `all ${fired.length} fired instances`,
  );

  // The catalog must cover the EMITTED set, not merely the reached one — an id this suite fails to reach
  // must still ship with copy, or the gate would pass by not exercising the gap.
  const emitted = [
    ...new Set(
      readFileSync("src/portfolio/phs/patterns.ts", "utf8")
        .match(/id: "P[A-Z][0-9]+"/g)!
        .map((m) => m.slice(5, -1)),
    ),
  ].sort();
  const expected = [
    ...new Set([...emitted, ...NOT_EVALUABLE_UNDECLARED]),
  ].sort();
  console.log(
    `  emitted by patterns.ts: ${emitted.length} · + PQ2/PQ3 (undeclared, honest-empty) = ${expected.length}`,
  );
  ok(
    `copy.ts covers ALL ${expected.length} ids (24 original + PC6/PC7/PC8/PB6/PB7 built this stage + PQ2/PQ3)`,
    expected.every((id) => COPY_IDS.includes(id)),
    expected.filter((id) => !COPY_IDS.includes(id)).join(",") ||
      `${COPY_IDS.length} entries`,
  );
  ok(
    "copy.ts carries NO ORPHANS (every entry maps to a real finding — PV3 stays retired with the ceiling)",
    COPY_IDS.every((id) => expected.includes(id)),
    COPY_IDS.filter((id) => !expected.includes(id)).join(",") || "none",
  );

  rule(
    "2 · THE ADVICE-VERB GREP AT ZERO — §1: describes what the book IS; never what to DO or what is NEXT",
  );
  // SCOPE, NOT AN ALLOWLIST: `doesntMean` NEGATES advice by construction ("≠ trim it", "≠ it will fall")
  // and legitimately contains every forbidden verb. It is never handed to the scanner. We scan what
  // ASSERTS. An allowlist would need a new entry for every future negation; scope needs none, ever.
  const violations = fired.flatMap((f) =>
    scanStringsForForwardLanguage(
      f.id,
      [f.read ?? ""],
      PORTFOLIO_ADVICE_DENY_LIST,
    ),
  );
  ok(
    "ZERO advice/forward verbs in any emitted `read`",
    violations.length === 0,
    violations.length
      ? violations.map((v) => `${v.id}: "${v.term}" (${v.why})`).join(" · ")
      : `${fired.filter((f) => f.read).length} reads scanned · ${PORTFOLIO_ADVICE_DENY_LIST.length} portfolio terms + the shared forward list`,
  );
  // The catalog's raw templates too — a placeholder-bearing Read must be clean BEFORE interpolation.
  const tmplViolations = COPY_IDS.flatMap((id) =>
    scanStringsForForwardLanguage(
      id,
      [FINDING_COPY[id].read ?? ""],
      PORTFOLIO_ADVICE_DENY_LIST,
    ),
  );
  ok(
    "ZERO advice/forward verbs in copy.ts's raw `read` templates",
    tmplViolations.length === 0,
    tmplViolations.map((v) => `${v.id}:${v.term}`).join(",") || "clean",
  );

  // PROVE THE GATE BITES — a guard nobody has seen fail is a guard nobody knows works. (Five guards this
  // session read as coverage and could not fire; this one gets a live negative control.)
  const bait = scanStringsForForwardLanguage(
    "BAIT",
    ["38% is too concentrated — consider trimming."],
    PORTFOLIO_ADVICE_DENY_LIST,
  );
  ok(
    "NEGATIVE CONTROL — the gate CATCHES '38% is too concentrated — consider trimming.'",
    bait.length > 0,
    bait.map((v) => v.term).join(",") || "DID NOT FIRE — the gate is dead",
  );
  const bait2 = scanStringsForForwardLanguage(
    "BAIT2",
    ["Switch to Direct to save on fees."],
    PORTFOLIO_ADVICE_DENY_LIST,
  );
  ok(
    "NEGATIVE CONTROL — the gate CATCHES 'Switch to Direct to save on fees.'",
    bait2.length > 0,
    bait2.map((v) => v.term).join(",") || "DID NOT FIRE",
  );
  // …and does NOT bite the negations, which is why scope beats an allowlist.
  const negations = COPY_IDS.flatMap((id) =>
    scanStringsForForwardLanguage(
      id,
      [FINDING_COPY[id].doesntMean],
      PORTFOLIO_ADVICE_DENY_LIST,
    ),
  );
  ok(
    "…and `doesntMean` is OUT OF SCOPE by construction — it would trip the gate, which is it doing its job",
    negations.length > 0,
    `${negations.length} would-be hits across ${COPY_IDS.length} negations (e.g. "≠ trim it", "≠ it will fall") — never scanned`,
  );

  rule(
    "3 · EVERY `doesntMean` IS CLASSIFIED — the taxonomy is a required field, not a comment",
  );
  const JOBS: DoesntMeanJob[] = [
    "advice-block",
    "misread-block",
    "misattribution-block",
  ];
  ok(
    "every entry declares ≥1 job",
    COPY_IDS.every((id) => FINDING_COPY[id].job.length > 0),
    COPY_IDS.filter((id) => !FINDING_COPY[id].job.length).join(",") ||
      "all classified",
  );
  ok(
    "every declared job is one of the three",
    COPY_IDS.every((id) => FINDING_COPY[id].job.every((j) => JOBS.includes(j))),
    "closed set",
  );
  for (const j of JOBS) {
    const ids = COPY_IDS.filter((id) => FINDING_COPY[id].job.includes(j));
    console.log(
      `     ${j.padEnd(20)} ×${String(ids.length).padStart(2)} — ${ids.join(" ")}`,
    );
  }

  rule(
    "4 · THE FIVE CONSTRUCTIVE ONES STATE THEIR SCOPE — their failure mode is INACTION",
  );
  // ODL cv2-s9-constructive-most-conditioned. A Caution that misfires is noise the user dismisses; a
  // Constructive that misfires is a FALSE ALL-CLEAR and the user STOPS LOOKING. So its doesntMean is the
  // only one whose job is to stop the user relaxing — the inverse of every other finding's.
  const CONSTRUCTIVE = ["PQ1", "PB1", "PS5", "PV1", "PX4"];
  ok(
    "the five Constructive ids are exactly PQ1/PB1/PS5/PV1/PX4",
    [
      ...new Set(
        fired.filter((f) => f.tone === "Constructive").map((f) => f.id),
      ),
    ]
      .sort()
      .every((id) => CONSTRUCTIVE.includes(id)),
    "matches doc 1 §B.8",
  );
  // "≠ this is a recommendation" is the LAZY version — a non-sentence: nobody was about to act on good
  // news. Assert the sentence does the real job instead: name what the finding does NOT cover.
  ok(
    "none is the lazy disclaimer ('≠ a recommendation' — nobody was about to act on good news)",
    CONSTRUCTIVE.every(
      (id) =>
        !/≠\s*(this is )?a recommendation/i.test(FINDING_COPY[id].doesntMean),
    ),
    "no non-sentences",
  );
  // Asserted PER-ID, on the actual scope claim — NOT by grepping for scope-ish words. A vocabulary
  // heuristic ("does it contain 'means'/'reads'?") is a PROXY: it passes a bad sentence that happens to
  // say "means" and fails a good one that says "It says". It did exactly that on PB1, whose
  // "spread is a fact about shape, not about the companies in it" IS the scope, stated. A gate that
  // mislabels a correct sentence trains people to edit copy until the gate shuts up — which is how §1
  // erodes. Name the claim you actually want, per finding.
  ok(
    "PQ1 scopes to the SCORED holdings, as they are TODAY (not the whole book, not what is next)",
    /holdings we scored/i.test(FINDING_COPY.PQ1.doesntMean) &&
      /today/i.test(FINDING_COPY.PQ1.doesntMean),
    FINDING_COPY.PQ1.doesntMean.slice(0, 62) + "…",
  );
  ok(
    "PB1 scopes to SHAPE, explicitly not to the quality of the names in it",
    /about shape, not about the companies/i.test(FINDING_COPY.PB1.doesntMean),
    FINDING_COPY.PB1.doesntMean.slice(0, 62) + "…",
  );
  ok(
    "PV1 says 'verified' is about US, not about the book being good",
    /could READ|could read/i.test(FINDING_COPY.PV1.doesntMean) &&
      /≠ your holdings are good/i.test(FINDING_COPY.PV1.doesntMean),
    FINDING_COPY.PV1.doesntMean.slice(0, 66) + "…",
  );
  ok(
    "PX4 says 'nothing is CURRENTLY firing', not 'nothing can go wrong'",
    /≠ nothing can go wrong/i.test(FINDING_COPY.PX4.doesntMean) &&
      /today/i.test(FINDING_COPY.PX4.doesntMean),
    FINDING_COPY.PX4.doesntMean.slice(0, 60) + "…",
  );
  ok(
    "PS5 separates 'nothing is wrong' from 'nothing is visible' (absence has two causes)",
    /unscored holding cannot raise a flag/i.test(FINDING_COPY.PS5.doesntMean),
    FINDING_COPY.PS5.doesntMean.slice(-72),
  );
  for (const id of CONSTRUCTIVE)
    console.log(`     ${id}: ${FINDING_COPY[id].doesntMean.slice(0, 104)}…`);

  rule("5 · ONE COPY MODULE — no sentence lives anywhere else");
  const patternsSrc = readFileSync("src/portfolio/phs/patterns.ts", "utf8");
  ok(
    "patterns.ts authors NO doesntMean of its own (every one reads FINDING_COPY)",
    !/doesntMean:\s*["'`](?!\$)/.test(
      patternsSrc.replace(
        /doesntMean: FINDING_COPY\[[^\]]+\]\.doesntMean/g,
        "",
      ),
    ),
    "all from the module",
  );
  ok(
    "patterns.ts imports the module (one home, imported by the engine — §3)",
    /from "\.\/copy\.js"/.test(patternsSrc),
    "imported",
  );
  // There is NO `phs/catalog.ts` — the Stage-9 instruction to delete its phantom-"Findings Map"-citing
  // prose was itself citing a phantom (the string appears in ZERO .ts files; doc 2's "catalog.ts:31"
  // means lens-patterns/catalog.ts, a different library). Asserted so the claim stays checkable.
  let catalogExists = true;
  try {
    readFileSync("src/portfolio/phs/catalog.ts", "utf8");
  } catch {
    catalogExists = false;
  }
  ok(
    "there is no phs/catalog.ts (the prose ruled for deletion never existed — nothing was lost)",
    !catalogExists,
    "confirmed absent",
  );

  console.log(
    `\n${fail === 0 ? "✅ COPY GATES PASS — every finding says what it does not mean, and nothing says what to do" : `❌ ${fail} FAILURE(S)`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
