// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CATALOGUE GATES — Stage 1.
//
// Mirrors scripts/verify-phs-copy.ts, which already does exactly this job for the portfolio library:
// prove in CI what a reviewer would otherwise have to notice.
//
//   1. REGISTRY INTEGRITY   — every entry complete, every boundary non-empty, no empty strings.
//   2. TOTALITY             — the compile-error proof, documented + re-asserted at runtime.
//   3. LENS MIRROR          — LENS_FACE_IDS still mirrors the pattern library it claims to mirror.
//   4. KEY RECONCILIATION   — every EMITTED key vs every CATALOGUE key, both directions, differences
//                             explained by status (dormant / synthesised) and never by a wildcard.
//   5. NO CALIBRATION LEAK  — nothing served reveals a metric bar, a pillar weight, a nativeZone
//                             bound or a peer formula. (Stage 4c re-runs this over the endpoint.)
//   6. §5C CONSOLIDATION    — the ported divergence rule behaves as the frontend's does.
//   7. THE THRESHOLD RULE   — ⚠ the two-sided one. NOT ONE DIGIT in any guardrail string (their bars
//                             ARE the detector for gamed reporting); the nine finding descriptions
//                             that name a public trigger bar KEEP it. Both directions asserted, so
//                             neither can be "harmonised" away by someone who sees only one side.
//
// PURE. No DB.
//   npx tsx src/scripts/verify-catalogue.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from "fs";
import {
  CATALOGUE,
  GUARDRAIL_SIGNATURES,
  GUARDRAIL_SIGNATURE_KEYS,
  LENS_FACES,
  LENS_FACE_IDS,
  PHS_FINDINGS,
  PHS_FINDING_IDS,
  STOCK_FINDINGS,
  STOCK_FINDING_KEYS,
  FAMILY_DOESNT_MEAN,
  LENS_DOESNT_MEAN,
  consolidateDivergence,
  consolidatedKeyCount,
  DIVERGENCE_SUB_TYPE_KEYS,
  faceIdOfLensKey,
  doesntMean,
  findingName,
  type CatalogueEntry,
} from "../catalogue/index.js";
import { consequenceForBehaviour } from "../catalogue/guardrail-signatures.js";
import { LM_CATALOG, LP_CATALOG } from "../scoring/lens-patterns/catalog.js";
import {
  GUARDRAIL_BEHAVIOUR,
  isEvaluable,
  type GuardrailBehaviour,
} from "../scoring/guardrail/signatures/registry.js";
import type { SignatureKey } from "../scoring/guardrail/types.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// EMITTED-KEY DISCOVERY — read the SOURCE, not a hand-kept list.
//
// ★ ONLY REGISTERED RULES COUNT. p2-distribution-retail.ts and p3-promoter-stress.ts still exist on
// disk and still contain a `key:` literal, but engine.ts does not import them, so they cannot fire.
// Scanning the rules DIRECTORY would "discover" two keys that can never arrive and then demand copy
// for them — the exact wrong answer. So the walk starts from engine.ts's imports.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const SRC = "src";
const RULES_DIR = `${SRC}/scoring/findings/rules`;

/** A finding key looks like `<family-prefix>_<something>_<something>`; a bare pillar name does not. */
const KEY_SHAPE = /^(?:ownership|foundation|momentum|trajectory|divergence|composition)_.+_.+/;

function registeredRuleFiles(): string[] {
  const engine = readFileSync(`${SRC}/scoring/findings/engine.ts`, "utf8");
  return [...engine.matchAll(/from "\.\/rules\/([a-z0-9-]+)\.js"/g)].map((m) => m[1]);
}

/**
 * Every finding key a rule file emits, discovered FROM SOURCE (never from a maintained list).
 *
 * Two forms are recognised, because both are in use:
 *   key: "divergence_D1_price_ahead_quality"     — the literal form
 *   const KEY = "trajectory_D_T1_…"; … key: KEY  — the const form, used by the T-family so the same
 *                                                  identifier feeds both `key:` and
 *                                                  trajectorySeverity(KEY) with no chance of the two
 *                                                  drifting apart
 *
 * ⚠ Resolving the const form matters to this gate's PURPOSE. A rule whose key it cannot see reads as
 * "catalogued but never emitted", which fails §4 — so without this the gate would push authors back
 * to duplicating the key string inside each rule, which is exactly the drift it exists to prevent.
 * Only same-file, single-quoted-or-double-quoted string consts are resolved; anything computed stays
 * invisible and will (correctly) fail the reconciliation.
 */
function keysInFile(path: string): string[] {
  const src = readFileSync(path, "utf8");
  const consts = new Map<string, string>();
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*["']([^"']+)["']\s*;/g)) {
    consts.set(m[1], m[2]);
  }
  const out: string[] = [];
  for (const m of src.matchAll(/\bkey:\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))/g)) {
    const k = m[1] ?? consts.get(m[2]);
    if (k && KEY_SHAPE.test(k)) out.push(k);
  }
  return out;
}

const registered = registeredRuleFiles();
const ruleKeys = [...new Set(registered.flatMap((f) => keysInFile(`${RULES_DIR}/${f}.ts`)))];

/** R1 is NOT a FireRule — the ownership persist path writes it. Discovered the same way, from source. */
const ownershipFlagKeys = [
  ...new Set(
    [...readFileSync(`${SRC}/scoring/ownership/primary.ts`, "utf8").matchAll(/\bflagKey:\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((k) => KEY_SHAPE.test(k)),
  ),
];

const EMITTED = [...new Set([...ruleKeys, ...ownershipFlagKeys])].sort();

// On-disk rule files that are NOT registered — reported so "absent by design" stays checkable.
const allRuleFiles = readdirSync(RULES_DIR).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));
const unregistered = allRuleFiles.filter((f) => !registered.includes(f));
const unregisteredKeys = [...new Set(unregistered.flatMap((f) => keysInFile(`${RULES_DIR}/${f}.ts`)))].sort();

// ── every string the catalogue would serve, for the scans below ───────────────────────────────────
function servedStrings(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const push = (e: CatalogueEntry, field: string, text: string) =>
    out.push({ where: `${e.registry}/${e.key}.${field}`, text });
  for (const e of Object.values(STOCK_FINDINGS)) {
    push(e, "name", e.name);
    push(e, "description", e.description);
    push(e, "doesntMean", e.doesntMean);
  }
  for (const e of Object.values(LENS_FACES)) {
    push(e, "name", e.name);
    push(e, "description", e.description);
    push(e, "doesntMean", e.doesntMean);
    push(e, "tone", e.tone);
  }
  for (const e of Object.values(PHS_FINDINGS)) push(e, "doesntMean", e.doesntMean);
  for (const e of Object.values(GUARDRAIL_SIGNATURES)) {
    push(e, "name", e.name);
    push(e, "description", e.description);
    push(e, "consequence", e.consequence);
    push(e, "doesntMean", e.doesntMean);
  }
  for (const [f, s] of Object.entries(FAMILY_DOESNT_MEAN)) out.push({ where: `family/${f}`, text: s });
  for (const [f, s] of Object.entries(LENS_DOESNT_MEAN)) out.push({ where: `lens/${f}`, text: s });
  return out;
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · REGISTRY INTEGRITY — no entry ships half-written, no boundary ships empty");
  console.log(
    `  registries assembled: ${Object.keys(CATALOGUE).join(" · ")}`,
  );
  console.log(
    `  stock_finding ${STOCK_FINDING_KEYS.length} · lens_face ${LENS_FACE_IDS.length} · phs_finding ${PHS_FINDING_IDS.length} · guardrail_signature ${GUARDRAIL_SIGNATURE_KEYS.length}`,
  );

  const stock = Object.values(STOCK_FINDINGS);
  const lens = Object.values(LENS_FACES);
  const phs = Object.values(PHS_FINDINGS);
  const guard = Object.values(GUARDRAIL_SIGNATURES);

  const blank = (s: string) => !s || s.trim() === "";
  ok(
    "every stock finding has a non-empty name · description · doesntMean",
    stock.every((e) => !blank(e.name) && !blank(e.description) && !blank(e.doesntMean)),
    stock.filter((e) => blank(e.name) || blank(e.description) || blank(e.doesntMean)).map((e) => e.key).join(",") ||
      `${stock.length} entries`,
  );
  ok(
    "every lens face has a non-empty name · description · doesntMean",
    lens.every((e) => !blank(e.name) && !blank(e.description) && !blank(e.doesntMean)),
    lens.filter((e) => blank(e.name) || blank(e.description) || blank(e.doesntMean)).map((e) => e.key).join(",") ||
      `${lens.length} faces (LP1/LP3/LP4/LP6 resolve the blank library line to the family boundary)`,
  );
  ok(
    "every PHS finding has a non-empty doesntMean and ≥1 declared job",
    phs.every((e) => !blank(e.doesntMean) && e.job.length > 0),
    phs.filter((e) => blank(e.doesntMean) || !e.job.length).map((e) => e.key).join(",") || `${phs.length} entries`,
  );
  ok(
    "every guardrail signature has a non-empty name · description · doesntMean",
    guard.every((e) => !blank(e.name) && !blank(e.description) && !blank(e.doesntMean)),
    guard.filter((e) => blank(e.name) || blank(e.description) || blank(e.doesntMean)).map((e) => e.key).join(",") ||
      `${guard.length} entries`,
  );
  ok(
    "every entry's `key` matches the map key it is filed under (no transposition)",
    [...stock, ...lens, ...phs, ...guard].every(
      (e) => (CATALOGUE as Record<string, Record<string, CatalogueEntry>>)[e.registry][e.key] === e,
    ),
    "self-consistent",
  );
  ok(
    "FAMILY_DOESNT_MEAN is total over A–I + N (no family can render a blank boundary)",
    ["A", "B", "C", "D", "E", "F", "G", "H", "I", "N"].every((f) => !blank((FAMILY_DOESNT_MEAN as Record<string, string>)[f])),
    `${Object.keys(FAMILY_DOESNT_MEAN).length} families`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · TOTALITY — a pattern without copy is UNREPRESENTABLE, not merely discouraged");
  console.log(
    "  The registries are Record<ClosedKeyUnion, Entry>. Adding a key to STOCK_FINDING_KEYS without",
  );
  console.log("  adding its copy does not compile. VERIFIED by adding \"foundation_N8_margin_durability\"");
  console.log("  to the vocabulary and NOTHING else, then running `npx tsc --noEmit`:");
  console.log("");
  console.log("    src/catalogue/stock-findings.ts(194,7): error TS2741: Property");
  console.log("    'foundation_N8_margin_durability' is missing in type '{ ownership_R1_pledge: {…};");
  console.log("    … 32 more …; ownership_N7_pledge_release: StockFindingCopy; }' but required in type");
  console.log("    'Readonly<Record<\"ownership_R1_pledge\" | … 29 more … |");
  console.log("    \"foundation_N8_margin_durability\", StockFindingCopy>>'.");
  console.log("");
  ok(
    "runtime re-assertion — every key in the vocabulary resolves to an entry",
    STOCK_FINDING_KEYS.every((k) => STOCK_FINDINGS[k] !== undefined),
    `${STOCK_FINDING_KEYS.length}/${STOCK_FINDING_KEYS.length}`,
  );
  ok(
    "…and every entry in the map is in the vocabulary (no key smuggled past the union)",
    Object.keys(STOCK_FINDINGS).every((k) => (STOCK_FINDING_KEYS as readonly string[]).includes(k)),
    "no strays",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · LENS MIRROR — the face list still mirrors the pattern library it references");
  const libraryIds = [...Object.keys(LM_CATALOG), ...Object.keys(LP_CATALOG)].sort();
  ok(
    "LENS_FACE_IDS === the library's own ids (a face added to the library cannot go uncatalogued)",
    JSON.stringify([...LENS_FACE_IDS].sort()) === JSON.stringify(libraryIds),
    libraryIds.join(" "),
  );
  ok(
    "labels + reads are the library's strings, not a copy (identity, not equality)",
    LENS_FACE_IDS.every((id) => {
      const src = LM_CATALOG[id] ?? LP_CATALOG[id];
      return LENS_FACES[id].name === src.label && LENS_FACES[id].description === src.read;
    }),
    "referenced in place",
  );
  ok(
    "exactly LM3/LM7/LP2/LP5 escalate (the four that ever compose a lens_* key)",
    LENS_FACE_IDS.filter((id) => LENS_FACES[id].escalates).join(",") === "LM3,LM7,LP2,LP5",
    LENS_FACE_IDS.filter((id) => LENS_FACES[id].escalates).join(","),
  );
  // 1e — the composed-key transform, proved on the real shapes lens-findings.ts builds.
  const composed: [string, string | null][] = [
    ["lens_lm3_NII", "LM3"],
    ["lens_lm7_CASA", "LM7"],
    ["lens_lp2_foundation", "LP2"],
    ["lens_lp5_momentum", "LP5"],
    ["lens_lm3_NPyoy", "LM3"],
    ["ownership_R1_pledge", null],
    ["lens_zz9_thing", null],
  ];
  ok(
    "composed key → FACE ID resolves for every shape the engine builds (and only those)",
    composed.every(([k, want]) => faceIdOfLensKey(k) === want),
    composed.map(([k]) => `${k}→${faceIdOfLensKey(k) ?? "—"}`).join(" · "),
  );
  ok(
    "…and a composed lens key resolves its BOUNDARY without a registry entry existing for it",
    doesntMean("lens_lm3_NII") === LENS_DOESNT_MEAN.lm3 && doesntMean("lens_lp5_foundation") === LENS_DOESNT_MEAN.lp5,
    "boundary by face, never by composed key",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · KEY RECONCILIATION — every emitted key vs every catalogue key, both directions");
  console.log(`  registered rule files (engine.ts imports): ${registered.length}`);
  console.log(`  keys emitted by registered rules:          ${ruleKeys.length}`);
  console.log(`  keys written by the ownership persist path: ${ownershipFlagKeys.join(", ")}`);
  console.log(`  ⇒ EMITTED total: ${EMITTED.length}`);
  console.log(`  CATALOGUE total: ${STOCK_FINDING_KEYS.length}`);
  console.log("");

  const catalogued = new Set<string>(STOCK_FINDING_KEYS);
  const emittedSet = new Set(EMITTED);

  const missingCopy = EMITTED.filter((k) => !catalogued.has(k));
  ok(
    "EVERY EMITTED KEY HAS A CATALOGUE ENTRY (the Stage-6 build gate, asserted early)",
    missingCopy.length === 0,
    missingCopy.join(",") || `all ${EMITTED.length}`,
  );

  const noEmitter = [...catalogued].filter((k) => !emittedSet.has(k)).sort();
  const explained = noEmitter.filter((k) => STOCK_FINDINGS[k as keyof typeof STOCK_FINDINGS].status === "synthesised");
  ok(
    "every catalogue key with no emitter is EXPLAINED by status, never by a wildcard",
    noEmitter.every((k) => explained.includes(k)),
    noEmitter.length
      ? noEmitter.map((k) => `${k} [${STOCK_FINDINGS[k as keyof typeof STOCK_FINDINGS].status}]`).join(" · ")
      : "none",
  );

  // The dormant set: registered and emitting, but not observed in live data (operator-established).
  const dormant = STOCK_FINDING_KEYS.filter((k) => STOCK_FINDINGS[k].status === "dormant");
  console.log(`  dormant (registered + copy-bearing, not currently firing): ${dormant.join(", ")}`);
  ok(
    "every DORMANT key is still emitted by a registered rule (dormant ≠ deregistered)",
    dormant.every((k) => emittedSet.has(k)),
    dormant.filter((k) => !emittedSet.has(k)).join(",") || "all still registered",
  );
  ok(
    "every dormant key carries full copy (historical rows still render — this is the point of dormant)",
    dormant.every((k) => !blank(STOCK_FINDINGS[k].description) && !blank(STOCK_FINDINGS[k].doesntMean)),
    "copy mandatory regardless of status",
  );

  console.log("");
  console.log(`  UNREGISTERED rule files on disk: ${unregistered.join(", ") || "none"}`);
  console.log(`  their keys (must NOT be catalogued): ${unregisteredKeys.join(", ") || "none"}`);
  ok(
    "RETIRED keys (P2 → R6, P3 → R1) are ABSENT from the catalogue — copy for a key that cannot fire is a lie",
    unregisteredKeys.every((k) => !catalogued.has(k)),
    unregisteredKeys.filter((k) => catalogued.has(k)).join(",") || "absent, as designed",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · NO CALIBRATION LEAK — the catalogue carries vocabulary, never mechanism values");
  //
  // ⚠ SCOPE, STATED HONESTLY. This does NOT ban numbers. The ~8 A/E descriptions deliberately name
  // their trigger bars (pledge over half, D/E past 3×, coverage under 1.5×, promoter −5pp) because
  // those bars read FILED PUBLIC DISCLOSURES and cannot be gamed by restructuring — see 2c. What is
  // banned is anything that would let a reader reconstruct OUR MACHINE: a metric bar value, a pillar
  // weight, a nativeZone bound, or a peer-comparison formula.
  const LEAK_TERMS: { re: RegExp; why: string }[] = [
    { re: /native\s*zone/i, why: "nativeZone bound" },
    { re: /\bpillar\s+weight/i, why: "pillar weight" },
    { re: /\bweighted\s+at\b/i, why: "pillar weight" },
    { re: /\bz-?score\b/i, why: "peer formula" },
    { re: /\bstd\s*dev\b|\bstandard\s+deviation\b/i, why: "peer formula" },
    { re: /[μσ]\s*[=:]/, why: "peer μ/σ value" },
    { re: /\bN\s*=\s*\d/, why: "peer sample size" },
    { re: /\bbar\s*[=:]\s*-?\d/i, why: "metric bar value" },
    { re: /\bcalibrat(?:ion|ed)\s*[=:]/i, why: "calibration value" },
  ];
  const served = servedStrings();
  const leaks = served.flatMap((s) =>
    LEAK_TERMS.filter((t) => t.re.test(s.text)).map((t) => `${s.where}: ${t.why}`),
  );
  ok(
    "ZERO metric-bar / pillar-weight / nativeZone / peer-formula values in any served string",
    leaks.length === 0,
    leaks.join(" · ") || `${served.length} strings scanned · ${LEAK_TERMS.length} leak patterns`,
  );
  // Negative control — a guard nobody has seen fire is a guard nobody knows works.
  const bait = LEAK_TERMS.filter((t) => t.re.test("Foundation's nativeZone strong bound is 68 and its pillar weight is 25%."));
  ok(
    "NEGATIVE CONTROL — the scan CATCHES 'nativeZone strong bound is 68 … pillar weight is 25%'",
    bait.length > 0,
    bait.map((t) => t.why).join(",") || "DID NOT FIRE — the scan is dead",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · §5C CONSOLIDATION — the ported rule, behaving as the frontend's does");
  const four = DIVERGENCE_SUB_TYPE_KEYS.map((key, i) => ({ key, severity: i === 1 ? "high" : "medium" }));
  const c = consolidateDivergence(four);
  ok("four fired sub-types consolidate to ONE row", c !== null && c.key === "divergence_consolidated", c?.key ?? "null");
  ok("…showing at most TWO sub-type sentences", c!.shown.length === 2, `${c!.shown.length} shown of ${c!.count} fired`);
  ok("…led by the WIDEST (high before medium)", c!.lead.key === DIVERGENCE_SUB_TYPE_KEYS[1], c!.lead.key);
  ok("…ordered into slot 3 when any sub-type is wide", c!.orderRank === 3, `rank ${c!.orderRank}`);
  ok('…titled "Divergence — two gaps at once" when two are shown', c!.name === "Divergence — two gaps at once", c!.name);

  // ⚠ Uses DIVERGENCE_SUB_TYPE_KEYS[0], never a hardcoded key: the sub-type set was repointed from
  // the retired C family to the price-ahead pair (D1/D2), and a literal here would have kept
  // asserting the behaviour of a key that can no longer fire.
  const one = consolidateDivergence([{ key: DIVERGENCE_SUB_TYPE_KEYS[0], severity: "medium" }]);
  ok("a single notable sub-type → slot 5, titled plain \"Divergence\"", one!.orderRank === 5 && one!.name === "Divergence", `rank ${one!.orderRank} · "${one!.name}"`);
  ok("no divergence fired → null (the caller leaves the set untouched)", consolidateDivergence([{ key: "ownership_R1_pledge", severity: "critical" }]) === null, "null");
  ok(
    "THE CONTRADICTION IS CLOSED — a census of 4 C keys + 2 others reads as 3 rows, on both sides",
    consolidatedKeyCount([...DIVERGENCE_SUB_TYPE_KEYS, "ownership_R1_pledge", "foundation_P7_accruals"]) === 3,
    `${consolidatedKeyCount([...DIVERGENCE_SUB_TYPE_KEYS, "ownership_R1_pledge", "foundation_P7_accruals"])} rows`,
  );
  ok(
    "the consolidated row's own copy resolves (it is a catalogue member, not a special case)",
    findingName("divergence_consolidated") === "Divergence" && !blank(doesntMean("divergence_consolidated")),
    `"${findingName("divergence_consolidated")}"`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · ⚠ THE THRESHOLD RULE — two-sided, because the data is opposite on the two sides");
  //
  // GUARDRAIL: not one digit. A guardrail signature detects DISTORTED OR GAMED REPORTING; publishing
  // "profit up more than 100% YoY with operating margin flat within ±3pp" hands a company the exact
  // shape to structure under. The bar IS the detector.
  //
  // FINDINGS: nine descriptions name their bar and MUST keep it. Those bars read filed,
  // regulator-mandated disclosures — a pledge ratio the exchange publishes cannot be dodged by
  // restructuring — so naming them costs nothing and buys the reader an exact definition.
  //
  // ★ BOTH DIRECTIONS ARE ASSERTED. A one-sided gate would let someone who has only read the guardrail
  // rule "harmonise" the finding bars away, silently losing precision on nine live cards.
  const THRESHOLD_PATTERNS: { re: RegExp; why: string }[] = [
    { re: /\b\d+\s*(?:\w+\s+){0,2}(?:days?|quarters?|years?|sessions?|periods?|rows?)\b/i, why: "count-of-window threshold" },
    { re: /\d+\s*%/, why: "percentage threshold" },
    { re: /\bpercent(age)?\b/i, why: "percentage threshold, spelled" },
    { re: /\b\d+\s*pp\b|\bpercentage points?\b/i, why: "pp band" },
    { re: /\bmore than (?:half|a third|a quarter)\b/i, why: "fraction threshold, spelled" },
    { re: /\b(?:over|above|below|under|past|exceeds?)\s+\d/i, why: "explicit numeric bar" },
    { re: /\b\d+(?:\.\d+)?\s*(?:×|x)\b/i, why: "multiple threshold" },
    { re: /\bat least \d|\bfewer than \d|\bmore than \d/i, why: "explicit numeric bar" },
  ];
  const guardStrings = guard.flatMap((e) => [
    { where: `${e.key}.name`, text: e.name },
    { where: `${e.key}.description`, text: e.description },
    { where: `${e.key}.consequence`, text: e.consequence },
    { where: `${e.key}.doesntMean`, text: e.doesntMean },
  ]);
  const guardLeaks = guardStrings.flatMap((s) =>
    THRESHOLD_PATTERNS.filter((t) => t.re.test(s.text)).map((t) => `${s.where}: "${s.text.match(t.re)![0]}" (${t.why})`),
  );
  ok(
    "GUARDRAIL — zero threshold constants across every string (description AND doesntMean)",
    guardLeaks.length === 0,
    guardLeaks.join(" · ") || `${guardStrings.length} strings · ${THRESHOLD_PATTERNS.length} patterns · not one digit`,
  );
  ok(
    "…not a single digit anywhere in the guardrail registry, the strongest form of the rule",
    !guardStrings.some((s) => /\d/.test(s.text)),
    guardStrings.filter((s) => /\d/.test(s.text)).map((s) => s.where).join(",") || "confirmed digit-free",
  );
  // NEGATIVE CONTROL — the real header sentences this rule exists to keep out of the product.
  const headerBait = [
    "profitYoy > +100% in a period AND operatingMargin change within ±3pp over the same period",
    "latest expected quarter's row absent > 45 days after the expected report date",
    "no DailyPrice row for > 10 consecutive trading days",
    "revenue OR totalAssets changes > 30% YoY in a single period",
    "netWorth falls > 25% YoY AND promoter holding > 50%",
  ];
  const caught = headerBait.map((b) => THRESHOLD_PATTERNS.some((t) => t.re.test(b)));
  ok(
    "NEGATIVE CONTROL — the scan catches all five raw header sentences it protects against",
    caught.every(Boolean),
    `${caught.filter(Boolean).length}/${headerBait.length} caught`,
  );

  // THE OTHER DIRECTION — the nine that keep their bar. Named individually: a count would pass if one
  // description were softened and another gained a number, which is exactly the drift being prevented.
  //
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ READ THIS BEFORE EDITING A ROW. THIS LIST WAS PINNING SIX WRONG BARS (fixed 2026-08-01).
  //
  // This gate proves a description STILL NAMES a bar. It has never proved the bar is CORRECT — it
  // compares copy against a regex written from the same copy, so a description and its assertion
  // drift from the engine together, in lockstep, and the gate goes green the whole way. Six of the
  // nine rows below were transcribed from descriptions that did not match their rule:
  //
  //   R3   "four or more consecutive periods"                    → the rule is ANNUAL-only ("years")
  //   R4   "crossed 3× for the first time in five years"         → the window is the last five annual
  //                                                                ROWS ON FILE, which is often fewer
  //   R5   "less than 1.5 times for two or more consecutive       → EBIT (incl. other income), measured
  //         quarters"                                              on a TTM basis, over two quarters
  //   P11  "three or more consecutive TTM windows"               → TWO consecutive SINGLE-QUARTER
  //                                                                margin declines (P11_MIN_DECLINES=2)
  //   P12  "two or more consecutive TTM windows"                 → single-quarter, not TTM
  //   P13  "at least 3 percentage points"                        → P13_INFLECTION_PP = 5
  //
  // ⚠ SO THE ROW IS NOT THE AUTHORITY — THE RULE BODY IS. When you touch a row here, open the rule
  // and read its CONSTANT, not its header comment (p7-accruals.ts carried "< 70%" above a 0.50
  // constant for months). The regex should quote the phrase that states the bar and nothing more,
  // so that softening the bar fails the gate while ordinary re-wording does not.
  //
  // ⚠ AND KEEP THIS PAIRED: P11 and P12 are written as mirrors and share a grain. A change to one
  // that is not made to the other reintroduces exactly the split this fix closed.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const BAR_NAMING: [string, RegExp][] = [
    ["ownership_R1_pledge", /more than half their stake/],
    ["ownership_R2_promoter_exit", /more than 5 percentage points/],
    ["foundation_R3_earnings_quality", /four or more consecutive years/],
    ["foundation_R4_debt_explosion", /crossed 3× for the first time/],
    ["foundation_R5_interest_coverage", /less than 1\.5 times, measured over the trailing twelve months, for two consecutive quarters/],
    ["momentum_P11_margin_compression", /fallen for two or more consecutive quarters/],
    ["momentum_P12_margin_recovery", /risen for two or more consecutive quarters/],
    ["momentum_P13_revenue_inflection", /at least 5 percentage points/],
    // ⚠ trajectory_B_deterioration's "at least two snapshots" bar is GONE WITH THE RULE. It was a
    //   SUSTAIN requirement, and the T-family that replaces it has none — the Trajectory spec's
    //   triggers compare the current reading with the immediately-prior one and ask for no run
    //   length. There is no successor bar to protect here, so the entry is removed rather than
    //   re-pointed at a threshold no T pattern actually applies.
  ];
  const softened = BAR_NAMING.filter(([k, re]) => !re.test(STOCK_FINDINGS[k as keyof typeof STOCK_FINDINGS].description));
  ok(
    "FINDINGS — all nine public trigger bars are still named (never 'harmonised' down to the guardrail rule)",
    softened.length === 0,
    softened.map(([k]) => k).join(",") || `${BAR_NAMING.length}/${BAR_NAMING.length} intact`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("8 · ⚠ GUARDRAIL COPY DESCRIBES THE SYSTEM WE ACTUALLY RUN (0a · 0b · 0c · 0d)");
  //
  // The failure this prevents: eleven descriptions asserting that readings "stand down" and peer
  // comparisons are "withheld", written against a layer whose suppress set is EMPTY, whose A-1/A-4/C-2
  // are never evaluated, and whose review tier has no workflow. Copy describing a system we turned off
  // is the same class of untruth as a methodology page describing pillars that are not computed.
  const guardSrc = readFileSync("src/catalogue/guardrail-signatures.ts", "utf8");
  const copyBlock = guardSrc.slice(guardSrc.indexOf("const COPY:"), guardSrc.indexOf("export const GUARDRAIL_SIGNATURE_KEYS"));

  // ── 0a · no authored consequence clause in any description ──
  const CONSEQUENCE_CLAIMS: { re: RegExp; why: string }[] = [
    { re: /\bstands? down\b/i, why: "asserts suppression — the suppress set is EMPTY" },
    { re: /\bstood down\b/i, why: "asserts suppression" },
    { re: /\bwithheld\b|\bwithhold\b/i, why: "asserts peer-exclusion — C-1 is detect-only, never applied" },
    { re: /\bexcluded from\b/i, why: "asserts suppression" },
    { re: /\bset aside\b/i, why: "asserts suppression" },
    { re: /\bare flagged\b|\bis flagged\b/i, why: "asserts an applied O3 annotation" },
    { re: /\bescalat(e|es|ing)\b/i, why: "asserts an O5→O6 escalation — both are dead ends" },
    { re: /\bheld for a (?:human|person)\b/i, why: "asserts a review workflow — none exists" },
    { re: /\bhuman ruling\b/i, why: "asserts a review workflow" },
    { re: /\bapplied automatically\b/i, why: "asserts an applied directive" },
    { re: /\bscored as usual\b|\bscored normally\b/i, why: "asserts a scoring response" },
    { re: /\bcomparisons resume\b/i, why: "asserts a lifecycle nothing implements" },
  ];
  const authoredConsequence = guard.flatMap((e) =>
    CONSEQUENCE_CLAIMS.filter((t) => t.re.test(e.description)).map((t) => `${e.key}: "${e.description.match(t.re)![0]}" — ${t.why}`),
  );
  ok(
    "0a · NO description asserts a consequence (shape only — the consequence is generated)",
    authoredConsequence.length === 0,
    authoredConsequence.join(" · ") || `${guard.length} descriptions · ${CONSEQUENCE_CLAIMS.length} claim patterns`,
  );
  ok(
    "NEGATIVE CONTROL — the scan catches the withdrawn draft's own clause",
    CONSEQUENCE_CLAIMS.some((t) => t.re.test("Profit-based readings stand down for the period.")) &&
      CONSEQUENCE_CLAIMS.some((t) => t.re.test("growth comparisons are withheld from the peer cross-section")),
    "both caught",
  );

  // ── 0b · the consequence is DERIVED, never authored ──
  ok(
    "0b · guardrail-signatures.ts authors NO consequence string of its own",
    !/\bconsequence:\s*["'`]/.test(copyBlock),
    "every one comes from CONSEQUENCE_BY_BEHAVIOUR",
  );
  ok(
    "0b · every entry's consequence EQUALS the sentence its live behaviour maps to",
    guard.every((e) => e.consequence === consequenceForBehaviour(GUARDRAIL_BEHAVIOUR[e.key as SignatureKey])),
    "derived at read time from the enforced contract",
  );
  const BEHAVIOURS: GuardrailBehaviour[] = ["suppress", "annotate", "detect", "disabled"];
  ok(
    "0b · the map is TOTAL over GuardrailBehaviour — a fifth behaviour without a sentence will not compile",
    BEHAVIOURS.every((b) => !blank(consequenceForBehaviour(b))),
    `${BEHAVIOURS.length} behaviours`,
  );
  for (const b of BEHAVIOURS) {
    const keys = guard.filter((e) => GUARDRAIL_BEHAVIOUR[e.key as SignatureKey] === b).map((e) => e.key);
    console.log(`     ${b.padEnd(9)} ×${String(keys.length).padStart(2)} ${keys.join(" ") || "— (none today)"}`);
    console.log(`               ↳ "${consequenceForBehaviour(b)}"`);
  }

  // ── 0c · status is DERIVED from isEvaluable ──
  ok(
    "0c · guardrail-signatures.ts authors NO status of its own",
    !/\bstatus:\s*["'`]/.test(copyBlock),
    "derived from isEvaluable",
  );
  ok(
    "0c · every entry's status matches isEvaluable (disabled ⇒ not_running)",
    guard.every((e) => e.status === (isEvaluable(e.key as SignatureKey) ? "active" : "not_running")),
    "in step with the contract",
  );
  const notRunning = guard.filter((e) => e.status === "not_running").map((e) => e.key).sort();
  ok(
    "0c · exactly A-1, A-4, C-2 are marked not_running (the three `disabled` signatures)",
    JSON.stringify(notRunning) === JSON.stringify(["A-1", "A-4", "C-2"]),
    notRunning.join(", "),
  );

  // ── 0d · prose register, no "≠" ──
  // There is no "Doesn't mean:" label in the product — every render site prints the string RAW into an
  // italic <p>. So a glyph in the string reaches the reader as a glyph.
  const glyphs = guardStrings.filter((s) => /≠/.test(s.text)).map((s) => s.where);
  ok(
    '0d · NO "≠" in any guardrail string (it renders literally — there is no label to carry it)',
    glyphs.length === 0,
    glyphs.join(",") || "prose throughout",
  );
  ok(
    "0d · every guardrail doesn't-mean is a full sentence (starts uppercase, ends with a stop)",
    guard.every((e) => /^[A-Z]/.test(e.doesntMean) && /[.]$/.test(e.doesntMean.trim())),
    guard.filter((e) => !/^[A-Z]/.test(e.doesntMean) || !/[.]$/.test(e.doesntMean.trim())).map((e) => e.key).join(",") ||
      `${guard.length} sentences`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("9 · ⚠ THE BUILD GATE — EVERY REGISTRY, and what each one can and cannot prove");
  //
  // §4 above is the strong form, and it only exists for ONE registry. This section states, per
  // registry, what is actually being enforced — because three of the four have no persisted emitter
  // trace to diff against, and pretending otherwise would be a gate that reports coverage it does not
  // have. The limits are named rather than papered over.

  // ── stock_finding — the FULL bidirectional gate (§4 proves it; restated here as the contract) ──
  console.log("  stock_finding    ⇄  BOTH DIRECTIONS, from source");
  console.log("                      emitted → entry : engine.ts's imports → each rule's `key:` literal + the");
  console.log("                                        ownership persist path's `flagKey:`. 34 keys.");
  console.log("                      entry → emitted : every catalogue key must be emitted, EXCEPT a");
  console.log("                                        documented status (synthesised / dormant).");
  const emittedOk = EMITTED.every((k) => catalogued.has(k));
  const reverseOk = [...catalogued].every(
    (k) => emittedSet.has(k) || STOCK_FINDINGS[k as keyof typeof STOCK_FINDINGS].status === "synthesised",
  );
  ok("stock_finding · the bidirectional gate holds", emittedOk && reverseOk, `${EMITTED.length} emitted ⇄ ${STOCK_FINDING_KEYS.length} catalogued`);

  // ── lens_face — a MIRROR check, and that is the strongest available ──
  //    Lens keys are composed at runtime (`lens_${id}_${metricKey}`), so the emitted key set is
  //    unbounded and cannot be enumerated from source. What CAN be proved is that the catalogue
  //    mirrors the pattern library exactly, and that every id the composer can produce resolves.
  console.log("\n  lens_face        ⇄  MIRROR ONLY — and this is the ceiling, not a shortcut");
  console.log("                      CAN prove   : the 14 ids mirror the library; all 4 escalating ids resolve.");
  console.log("                      CANNOT prove: which composed keys exist. `lens_lm3_<metricKey>` is one key");
  console.log("                                    per metric that has ever fired — unbounded, and no static");
  console.log("                                    list can enumerate it. Copy is keyed on the FACE for exactly");
  console.log("                                    this reason, which is what makes the mirror sufficient.");
  ok(
    "lens_face · every escalating id resolves a face, so every composable key resolves copy",
    ["LM3", "LM7", "LP2", "LP5"].every((id) => !!LENS_FACES[id as keyof typeof LENS_FACES]),
    "4/4 escalating · 14/14 mirrored (§3)",
  );

  // ── guardrail_signature — TOTALITY over a closed union; there is no emitter to diff ──
  console.log("\n  guardrail_signature ⇄ TOTALITY ONLY");
  console.log("                      CAN prove   : total over SignatureKey — the SAME union GUARDRAIL_BEHAVIOUR");
  console.log("                                    is total over, so a 12th signature is a compile error twice.");
  console.log("                      CANNOT prove: that a signature ever fires. Nothing suppresses today and");
  console.log("                                    three are `disabled`, so there is no persisted trace at all.");
  console.log("                                    That is a fact about the layer, not a hole in the gate.");
  ok(
    "guardrail_signature · total over the live SignatureKey union",
    (Object.keys(GUARDRAIL_BEHAVIOUR) as SignatureKey[]).every((k) => !!GUARDRAIL_SIGNATURES[k]),
    `${GUARDRAIL_SIGNATURE_KEYS.length}/${Object.keys(GUARDRAIL_BEHAVIOUR).length}`,
  );

  // ── phs_finding — DERIVED, so drift is structurally impossible; its own gate does the rest ──
  console.log("\n  phs_finding      ⇄  DERIVED — drift is impossible by construction");
  console.log("                      CAN prove   : the registry is Object.entries() over copy.ts, so an id");
  console.log("                                    added there appears here on the next build and one removed");
  console.log("                                    disappears. There is no second list to fall behind.");
  console.log("                      CANNOT prove: emitter coverage — that is verify-phs-copy.ts's job and it");
  console.log("                                    already does it (emitted set parsed from patterns.ts).");
  console.log("                                    Duplicating it here would be two gates for one rule.");
  ok(
    "phs_finding · derived from copy.ts, no independent key list exists to drift",
    PHS_FINDING_IDS.length === Object.keys(PHS_FINDINGS).length && PHS_FINDING_IDS.length > 0,
    `${PHS_FINDING_IDS.length} ids, derived`,
  );

  console.log(
    `\n${fail === 0 ? "✅ CATALOGUE GATES PASS — one home, four registries, every key reconciled" : `❌ ${fail} FAILURE(S)`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
