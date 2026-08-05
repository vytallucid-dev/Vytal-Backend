// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE TRAJECTORY COPY GATE — Part 4's R1/R2/R3, and the claim rule.
//
// ── ⚠ THIS FILE WAS CITED BY FIVE SOURCE COMMENTS AND DID NOT EXIST ──────────────────────────────
// `regime-tier.ts`, `t6-momentum-breaking-into-weak.ts`, `t7-momentum-improving-while-weak.ts` and
// `verdicts.ts` all said, in as many words, that "scripts/verify-trajectory.ts fails on this" — and
// nothing did. `scanForwardLanguage` and `FORWARD_LANGUAGE_BANS` were exported from regime-tier.ts and
// imported by NOTHING. Part 4's constraints were enforced by the comments claiming they were enforced.
//
// That is worse than an unenforced rule: a reviewer reading "a violation fails a gate rather than
// depending on someone remembering Part 4" stops checking, correctly, because the file says a machine
// is checking. This closes the gap the comments already promised was closed.
//
// ── WHAT IT ASSERTS ───────────────────────────────────────────────────────────────────────────────
//   R3   no clause implies the reader is early on a large positive Momentum move
//   R2   no clause presents Momentum as leading the composite
//   R1   no clause presents a LARGER move as a STRONGER signal
//   ★    no relaxed-tier finding emits a claim (`size`) or a `phase` clause
//
// It scans the CLAUSE SET, not just the joined string — a clause that is emitted is a clause a surface
// may render on its own, so each one is linted in isolation as well as joined. Every trajectory
// description in the catalogue is scanned too: R2/R3 bind static copy exactly as they bind instance
// copy, and the static copy is what renders on the evidence-free surfaces.
//
// PURE. No DB.
//   npx tsx src/scripts/verify-trajectory.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { composeVerdict, CLAUSE_ORDER, type VerdictClause } from "../scoring/findings/verdicts.js";
import { scanForwardLanguage, TRAJECTORY_KEYS, trajectorySeverity } from "../scoring/findings/trajectory/regime-tier.js";
import { PATTERN_KEYS, PATTERN_FACTS, isPatternKey } from "../catalogue/pattern-facts.js";
import { STOCK_FINDINGS, findingDescription } from "../catalogue/index.js";
import { VERDICT_FIXTURES } from "./lib/verdict-fixtures.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// R1 — "a bigger move is a stronger signal" is the INVERSE of what was measured, and it is the one
// constraint with no home in FORWARD_LANGUAGE_BANS (those cover R2/R3). Declared here because R1 is a
// COPY constraint as well as a structural one: `trajectorySeverity`'s signature already makes a
// magnitude-scaled BADGE impossible, and this makes a magnitude-scaled SENTENCE impossible.
//
//   Foundation gain 1–3 pts → +1.9%, 64% positive   ·   15+ → −0.5%, 50% (n=4)
//   Momentum gain   4–10    → +0.1%, 52%            ·   15+ → −1.1% same-day, 31% positive
//
// ⚠ THE BANS ARE NARROW ON PURPOSE. "On a move this size the price has usually already run" is T7's
// R3-mandated copy and must NOT trip an R1 ban — it says a large move is WEAKER, which is the finding.
// Matching "this size" or "large move" generically would fail the one sentence Part 4 requires.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const MAGNITUDE_SCALING_BANS: readonly { re: RegExp; why: string }[] = [
  { re: /\b(?:bigger|larger|greater)\b[^.]{0,40}\b(?:stronger|more reliable|better)\b/i, why: "R1 — measured the reverse: the largest gains carried no drift" },
  { re: /\bthe (?:bigger|larger)\b[^.]{0,30}\bthe (?:stronger|better|more)\b/i, why: "R1 — bigger-is-better construction" },
  { re: /\bstronger\b[^.]{0,30}\bthe (?:bigger|larger)\b/i, why: "R1 — bigger-is-better, inverted phrasing" },
  { re: /\ba (?:big|large|substantial) move\b[^.]{0,40}\b(?:strong|reliable|convincing) signal\b/i, why: "R1 — scales the signal by the move" },
  { re: /\b(?:more|most) convincing\b[^.]{0,30}\bthe (?:bigger|larger)\b/i, why: "R1 — bigger-is-better" },
];

function scanMagnitudeScaling(text: string): { why: string; matched: string }[] {
  const out: { why: string; matched: string }[] = [];
  for (const b of MAGNITUDE_SCALING_BANS) {
    const m = b.re.exec(text);
    if (m) out.push({ why: b.why, matched: m[0] });
  }
  return out;
}

/** Every clause a pattern can emit, over every fixture that names it, plus the lifecycle-less path. */
function clausesFor(key: string): { label: string; clauses: VerdictClause[]; text: string }[] {
  const out: { label: string; clauses: VerdictClause[]; text: string }[] = [];
  for (const fx of VERDICT_FIXTURES) {
    if (fx.key !== key) continue;
    const c = composeVerdict(key, fx.evidence, null);
    out.push({ label: fx.label, clauses: c.clauses, text: c.text });
  }
  if (out.length === 0) {
    const c = composeVerdict(key, {}, null);
    out.push({ label: `${key} (no fixture — empty evidence)`, clauses: c.clauses, text: c.text });
  }
  return out;
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · THE MODULE IS WIRED — scanForwardLanguage / FORWARD_LANGUAGE_BANS have a consumer");
  ok(
    "FORWARD_LANGUAGE_BANS is non-empty and reachable from a gate (it was exported and imported by nothing)",
    scanForwardLanguage("you're early").length > 0,
    "the R2/R3 lint runs here",
  );
  ok(
    "every trajectory key declares a severity (the R1 structural guard's own checklist)",
    TRAJECTORY_KEYS.every((k) => !!trajectorySeverity(k)),
    `${TRAJECTORY_KEYS.length} keys`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · R2 / R3 — no clause implies the reader is early, or that Momentum leads the composite");
  const r23: string[] = [];
  for (const key of PATTERN_KEYS) {
    for (const { label, clauses, text } of clausesFor(key)) {
      // each clause in ISOLATION — a surface may render one alone
      for (const c of clauses) {
        for (const v of scanForwardLanguage(c.text)) {
          r23.push(`${label} · clause[${c.type}] · ${v.rule}: "${v.matched}" — ${v.why}`);
        }
      }
      // and the joined sentence, in case a violation only forms across a seam
      for (const v of scanForwardLanguage(text)) {
        if (!clauses.some((c) => scanForwardLanguage(c.text).some((x) => x.matched === v.matched))) {
          r23.push(`${label} · JOINED · ${v.rule}: "${v.matched}" — ${v.why}`);
        }
      }
    }
  }
  ok("no R2/R3 violation in any emitted clause, or across a clause seam", r23.length === 0, r23.join("\n       ") || "clean");

  const descViolations: string[] = [];
  for (const key of PATTERN_KEYS) {
    const d = findingDescription(key) ?? "";
    for (const v of scanForwardLanguage(d)) descViolations.push(`${key} · ${v.rule}: "${v.matched}" — ${v.why}`);
    const dm = STOCK_FINDINGS[key]?.doesntMean ?? "";
    for (const v of scanForwardLanguage(dm)) descViolations.push(`${key} · doesntMean · ${v.rule}: "${v.matched}"`);
  }
  ok(
    "…and none in the STATIC copy either (description + boundary, which render on evidence-free surfaces)",
    descViolations.length === 0,
    descViolations.join("\n       ") || `${PATTERN_KEYS.length} keys`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · R1 — no clause presents a LARGER move as a STRONGER signal");
  const r1: string[] = [];
  for (const key of PATTERN_KEYS) {
    for (const { label, clauses } of clausesFor(key)) {
      for (const c of clauses) {
        for (const v of scanMagnitudeScaling(c.text)) r1.push(`${label} · clause[${c.type}]: "${v.matched}" — ${v.why}`);
      }
    }
    for (const v of scanMagnitudeScaling(findingDescription(key) ?? "")) r1.push(`${key} · description: "${v.matched}" — ${v.why}`);
  }
  ok("no magnitude-scaling claim in any clause or description", r1.length === 0, r1.join("\n       ") || "clean");

  // NEGATIVE CONTROLS — the bans bite, and they do NOT bite T7's mandated R3 sentence.
  ok(
    "NEGATIVE CONTROL — a bigger-is-stronger sentence IS caught",
    scanMagnitudeScaling("A larger move here is a stronger signal.").length > 0,
    "caught",
  );
  ok(
    "…and T7's REQUIRED R3 sentence is NOT caught (the bans discriminate)",
    scanMagnitudeScaling("On a move this size the price has usually already run before the reading catches up.").length === 0,
    "not a false positive",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · ★ THE CLAIM RULE — a relaxed-tier finding emits NO size clause and NO phase clause");
  //
  // The record says which patterns HAVE a relaxed register; the rule stamps `strong` to say a firing
  // is in it. Only D3/D4 can reach it (D1/D2 declare one but gate at their evidenced tier — see
  // atEvidencedTier's note in verdicts.ts), so those two are exercised directly, both ways.
  const relaxedCapable = PATTERN_KEYS.filter((k) => PATTERN_FACTS[k].relaxedTier !== null);
  console.log(`  patterns declaring a relaxed register: ${relaxedCapable.join(", ")}`);

  const relaxedProbe: { key: string; ev: Record<string, unknown> }[] = [
    {
      key: "divergence_D3_ownership_building_weak_foundation",
      ev: { foundation: 48, ownershipDeltaPp: 2, ownershipFrom: 60, ownershipTo: 62, strong: false, driver: "The shareholding filing is unchanged.", regimeTier: "magnitude_caveat", regimeReadPhases: null, regimeAtEvent: { regime: "HOT" } },
    },
    {
      key: "divergence_D4_ownership_exiting_healthy",
      ev: { foundation: 74, ownershipDeltaPp: -3, ownershipFrom: 72, ownershipTo: 69, strong: false, driver: "The shareholding filing is unchanged.", regimeTier: "magnitude_caveat", regimeReadPhases: null, regimeAtEvent: { regime: "HOT" } },
    },
  ];
  // ★ THE BUILDING STATE — the same suppression, reached by a different route. A Building card is a
  //   shape that HOLDS with a leg not yet across; there is no evidenced claim for it because its stock
  //   is not in the measured population. Probed with a HOT regime stamp on purpose: without the rule,
  //   a card asserting nothing would still pick up "the sector is running hot, which flatters the size
  //   of moves like this one".
  const buildingProbe: { key: string; ev: Record<string, unknown> }[] = [
    {
      key: "divergence_D1_price_ahead_quality",
      ev: { state: "building", market: 66.4, foundation: 41.2, gapPp: 25, tier: "extreme", sharedN: 79,
            legs: [{ pillar: "market", reading: 66.4, threshold: 68, shortfall: 1.6, crossed: false }],
            regimeTier: "magnitude_caveat", regimeReadPhases: null, regimeAtEvent: { regime: "HOT" } },
    },
    {
      key: "divergence_D2_price_ahead_trajectory",
      ev: { state: "building", market: 87.4, momentum: 63.9, gapPp: 24, tier: "stretched", sharedN: 79,
            legs: [{ pillar: "momentum", reading: 63.9, threshold: 58, shortfall: 5.9, crossed: false }],
            regimeTier: "magnitude_caveat", regimeReadPhases: null, regimeAtEvent: { regime: "HOT" } },
    },
  ];
  const buildingLeaks: string[] = [];
  for (const b of buildingProbe) {
    const c = composeVerdict(b.key, b.ev, null);
    for (const cl of c.clauses) {
      if (cl.type === "size" || cl.type === "phase") buildingLeaks.push(`${b.key} emitted a ${cl.type} clause: "${cl.text}"`);
    }
    if (/running hot/.test(c.text)) buildingLeaks.push(`${b.key} leaked a regime flourish into a BUILDING card`);
  }
  ok(
    "a BUILDING finding emits neither a claim nor a phase clause (the shape is named; nothing is asserted)",
    buildingLeaks.length === 0,
    buildingLeaks.join(" · ") || `${buildingProbe.length} building probes, observation+movement+boundary only`,
  );
  // POSITIVE CONTROL — the SAME stock, FORMED, does speak.
  const formedSpeaks = composeVerdict("divergence_D1_price_ahead_quality",
    { ...buildingProbe[0].ev, state: "formed" }, null).clauses.some((c) => c.type === "size");
  ok("POSITIVE CONTROL — the same evidence marked FORMED DOES emit its claim", formedSpeaks, formedSpeaks ? "speaks" : "MUTED");

  const relaxedLeaks: string[] = [];
  for (const p of relaxedProbe) {
    const c = composeVerdict(p.key, p.ev, null);
    for (const cl of c.clauses) {
      if (cl.type === "size" || cl.type === "phase") relaxedLeaks.push(`${p.key} emitted a ${cl.type} clause: "${cl.text}"`);
    }
  }
  ok(
    "a RELAXED-tier finding emits neither a claim nor a phase clause (the card describes and stops)",
    relaxedLeaks.length === 0,
    relaxedLeaks.join("\n       ") || `${relaxedProbe.length} relaxed probes, observation+boundary only`,
  );
  // ⚠ AND THE PHASE SUPPRESSION IS THE POINT — the probes above carry a HOT regime stamp on purpose.
  //   Without the rule they would append "the sector is running hot, which flatters the size of moves
  //   like this one" to a card that asserted no size at all.
  const hotLeak = relaxedProbe.some((p) => composeVerdict(p.key, p.ev, null).text.includes("running hot"));
  ok("…specifically, a HOT stamp on a relaxed finding does NOT produce a regime flourish", !hotLeak, hotLeak ? "LEAKED" : "suppressed");

  // The positive control: at the evidenced tier, the same patterns DO speak.
  const strongLeaks: string[] = [];
  for (const p of relaxedProbe) {
    const c = composeVerdict(p.key, { ...p.ev, strong: true, evidencedN: 11 }, null);
    if (!c.clauses.some((cl) => cl.type === "size")) strongLeaks.push(`${p.key} emitted NO size clause at the evidenced tier`);
  }
  ok(
    "POSITIVE CONTROL — at the EVIDENCED tier the same patterns DO emit their claim (the rule gates, it does not mute)",
    strongLeaks.length === 0,
    strongLeaks.join("\n       ") || "both speak when strong",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · CLAUSE ORDER + SHAPE — fixed order, no empty clause, boundary never joined into text");
  const shape: string[] = [];
  // ⚠ READ THE COMPOSER'S OWN ORDER, never a second copy of it. This was a hardcoded five-element
  //   array and it went stale the moment `band_context` was added — the gate then failed every card
  //   carrying the new clause, reporting "out of fixed order" for a set that was in exactly the order
  //   the composer declares. A gate with its own copy of the thing it checks tests the copy.
  const ORDER: readonly string[] = CLAUSE_ORDER;
  for (const key of PATTERN_KEYS) {
    for (const { label, clauses, text } of clausesFor(key)) {
      const idx = clauses.map((c) => ORDER.indexOf(c.type));
      if (idx.some((v, i) => i > 0 && v <= idx[i - 1])) shape.push(`${label}: clauses out of fixed order — ${clauses.map((c) => c.type).join(",")}`);
      for (const c of clauses) if (!c.text.trim()) shape.push(`${label}: empty ${c.type} clause`);
      const b = clauses.find((c) => c.type === "boundary");
      if (b && text.includes(b.text)) shape.push(`${label}: the boundary clause leaked into the joined text (it would render twice)`);
    }
  }
  ok("every clause set is in fixed order, non-empty, with the boundary out of the joined text", shape.length === 0, shape.join("\n       ") || "clean");

  ok(
    "every D/S/T pattern that can fire emits an observation clause",
    PATTERN_KEYS.filter((k) => STOCK_FINDINGS[k].status !== "never_emitted").every((k) =>
      clausesFor(k).every((c) => c.clauses.some((x) => x.type === "observation")),
    ),
    "observation is unconditional",
  );
  ok(
    "isPatternKey agrees with PATTERN_KEYS (the gate scans the same closed set the composer does)",
    PATTERN_KEYS.every((k) => isPatternKey(k)),
    `${PATTERN_KEYS.length} keys`,
  );

  console.log(
    `\n${fail === 0 ? "✅ TRAJECTORY COPY GATES PASS — R1/R2/R3 enforced, and the claim rule holds" : `❌ ${fail} FAILURE(S)`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
