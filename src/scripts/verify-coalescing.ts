// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE COALESCING GATE — one move, one entry, and nothing hidden.
//
// Asserts the Master Spec Ruling (Coalescing Crossings from a Single Move) mechanically:
//
//   1 · EVERY REACHABLE CASE MERGES. The §5 table's four pattern coalescings, from fixtures — three of
//       them do not occur in the live universe and D6+D7 never has, so a live-data check would assert
//       nothing about them and they would ship unverified.
//   2 · CONSOLIDATE, NEVER SUPPRESS. Every constituent survives inside the merged entry as a named
//       fact, and every mark the move passed is carried. This is the assertion that stops "coalescing"
//       from quietly becoming "dropping".
//   3 · AT MOST ONE CLAIM. `claim_source` names one constituent or is null; where it is null the entry
//       is `described` and its copy carries NO consequence clause.
//   4 · NEGATIVE CONTROLS. A lone constituent does not become the entry, and an unrelated pattern is
//       never consumed — without these, a rule that merged everything would pass.
//   5 · THE RULING'S UNREACHABLE SET stays unreachable, checked against the rules' own thresholds.
//
// PURE. No DB.
//   npx tsx src/scripts/verify-coalescing.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { PATTERN_FACTS, type PatternKey } from "../catalogue/pattern-facts.js";
import { coalesceFindings, claimSourceFor, claimantOf, COALESCE_CASES } from "../scoring/findings/coalesce.js";
import { composeVerdict } from "../scoring/findings/verdicts.js";
import { COALESCE_FIXTURES, COALESCE_NEGATIVE_FIXTURES } from "./lib/coalesce-fixtures.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

const ev = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · ★ EVERY REACHABLE CASE MERGES — the §5 table, from fixtures");
  for (const f of COALESCE_FIXTURES) {
    const out = coalesceFindings(f.fired);
    const keys: string[] = out.map((x) => x.key);
    const entry = out.find((x) => x.key === f.expectEntry);

    ok(`${f.label} — merges into one entry`, !!entry, entry ? f.expectEntry : `got: ${keys.join(", ")}`);
    ok(
      "…and the constituents no longer appear separately",
      f.expectAbsent.every((k) => !keys.includes(k)),
      f.expectAbsent.filter((k) => keys.includes(k)).join(",") || "consumed",
    );
    // Anything that was NOT a constituent must survive untouched — the merge is surgical.
    const untouched = f.fired
      .map((x) => x.key)
      .filter((k) => !f.expectAbsent.includes(k));
    ok(
      "…and every non-constituent survives untouched",
      untouched.every((k) => keys.includes(k)),
      untouched.filter((k) => !keys.includes(k)).join(",") || `${untouched.length} untouched`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ★ CONSOLIDATE, NEVER SUPPRESS — every constituent named, every mark carried");
  for (const f of COALESCE_FIXTURES) {
    const entry = coalesceFindings(f.fired).find((x) => x.key === f.expectEntry);
    if (!entry) { ok(`${f.label} — (no entry to inspect)`, false); continue; }

    const constituents = ev(entry.evidence, "constituents") as { patternKey: string }[] | undefined;
    ok(
      `${f.label} — every constituent is named as a fact inside the entry`,
      Array.isArray(constituents) && f.expectAbsent.every((k) => constituents.some((c) => c.patternKey === k)),
      constituents?.map((c) => c.patternKey).join(", ") ?? "MISSING",
    );
    // Each constituent keeps its OWN evidence — the merge must not flatten them into the parent.
    ok(
      "…and each keeps its own evidence payload",
      Array.isArray(constituents) && constituents.every((c) => !!(c as { evidence?: unknown }).evidence),
      "evidence retained per constituent",
    );
    const marks = ev(entry.evidence, "marksCrossed") as number[] | undefined;
    ok(
      "…and every mark the one move passed is carried",
      JSON.stringify(marks) === JSON.stringify(f.expectMarks),
      `${JSON.stringify(marks)} (expected ${JSON.stringify(f.expectMarks)})`,
    );
    ok(
      "…and `coalescedFrom` records what fired",
      JSON.stringify(ev(entry.evidence, "coalescedFrom")) === JSON.stringify(f.expectAbsent),
      JSON.stringify(ev(entry.evidence, "coalescedFrom")),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · ★ AT MOST ONE CLAIM — claim_source, and the silence that must follow a null one");
  for (const f of COALESCE_FIXTURES) {
    const entry = coalesceFindings(f.fired).find((x) => x.key === f.expectEntry);
    if (!entry) continue;
    ok(
      `${f.label} — claim_source is as ruled`,
      (ev(entry.evidence, "claimSource") ?? null) === f.expectClaimSource,
      `${String(ev(entry.evidence, "claimSource") ?? null)} (expected ${String(f.expectClaimSource)})`,
    );
    ok(
      "…and evidenceBasis is as ruled",
      ev(entry.evidence, "evidenceBasis") === f.expectEvidenceBasis,
      `${String(ev(entry.evidence, "evidenceBasis"))} (expected ${f.expectEvidenceBasis})`,
    );
  }

  // ★ THE SILENCE ITSELF. A `described` entry must emit NO claim clause in ANY phase — this is the
  //   assertion that would catch a future edit giving D6+D7 a consequence sentence.
  const describedEntries = COALESCE_CASES.map((c) => c.entry).filter(
    (k) => (PATTERN_FACTS[k].confidence as string) === "described",
  );
  const spoke: string[] = [];
  for (const key of describedEntries) {
    for (const phase of [null, "HOT", "NORMAL", "STRESSED"]) {
      const evidence: Record<string, unknown> = {
        state: "formed", foundation: 72, momentum: 53, gapPp: 19,
        ...(phase ? { regimeAtEvent: { regime: phase } } : {}),
      };
      const clauses = composeVerdict(key, evidence, null).clauses;
      if (clauses.some((c) => c.type === "size")) spoke.push(`${key} in ${phase ?? "unknown"}`);
    }
  }
  ok(
    "a `described` coalesced entry emits NO claim clause in any phase",
    spoke.length === 0,
    spoke.join(" · ") || `${describedEntries.length} described entries, silent in all four branches`,
  );

  // ★ AND THE CONVERSE — an entry that DOES name a claim source must actually be able to speak, or
  //   `claim_source` is decorative.
  const mute: string[] = [];
  for (const c of COALESCE_CASES) {
    const facts = PATTERN_FACTS[c.entry];
    const declared = "coalesced" in facts ? facts.coalesced?.claimSource ?? null : null;
    if (declared === null) continue;
    const anySpeaks = ["HOT", "NORMAL", "STRESSED"].some((p) => claimSourceFor(c.entry, p) !== null);
    if (!anySpeaks) mute.push(c.entry);
  }
  ok(
    "…and an entry declaring a claim source can speak in at least one phase",
    mute.length === 0,
    mute.join(",") || "every claiming entry has a phase it speaks in",
  );

  // ★ T2+T3's COMPLEMENTARY MAPS — the case the ruling says resolves without a query. Exactly one
  //   constituent speaks in every phase, and never both.
  const t2t3 = "trajectory_B_T2_T3_deterioration_out_of_top_band" as PatternKey;
  const perPhase = (["HOT", "NORMAL", "STRESSED"] as const).map((p) => [p, claimSourceFor(t2t3, p)] as const);
  ok(
    "T2+T3 names exactly one speaker in every phase (complementary regime maps)",
    perPhase.every(([, s]) => s !== null),
    perPhase.map(([p, s]) => `${p}→${String(s).replace(/^trajectory_._/, "")}`).join(" · "),
  );
  ok(
    "…and it is T3 in HOT, T2 otherwise — never one in the other's phase",
    perPhase.find(([p]) => p === "HOT")?.[1] === "trajectory_B_T3_falling_out_of_pristine" &&
      perPhase.filter(([p]) => p !== "HOT").every(([, s]) => s === "trajectory_B_T2_deterioration_high_base"),
    "T3 in HOT · T2 in NORMAL/STRESSED",
  );
  // ⚠ AN UNKNOWN PHASE LICENSES NOBODY. With no phase we cannot tell which map permits speech, and
  //   guessing would speak a masked claim.
  ok(
    "…and an unknown phase licenses no speaker at all",
    claimSourceFor(t2t3, null) === null,
    "null phase ⇒ null speaker",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · ★ NEGATIVE CONTROLS — a merge rule with none is indistinguishable from merging everything");
  const entryKeys = COALESCE_CASES.map((c) => c.entry as string);
  for (const f of COALESCE_NEGATIVE_FIXTURES) {
    const out = coalesceFindings(f.fired);
    const keys: string[] = out.map((x) => x.key);
    ok(
      f.label,
      !keys.some((k) => entryKeys.includes(k)) && keys.length === f.fired.length,
      keys.join(", "),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · ★ THE UNREACHABLE SET STAYS UNREACHABLE — checked against the rules' own thresholds");
  // D5 against D6/D7: D5 needs ΔMomentum ≥ +5 (rising); both crossings need Momentum falling through a
  // mark from at-or-above it. One reading cannot have Momentum both rising and falling.
  const d5Rise = PATTERN_FACTS.divergence_D5_laggard_catching_up.movementFloor;
  ok(
    "D5 cannot co-fire with D6/D7 — its movement floor requires a RISE, the crossings require a FALL",
    typeof d5Rise === "number" && d5Rise > 0,
    `D5 movementFloor=+${d5Rise}`,
  );
  // D3/D4: mutually exclusive by their Foundation legs.
  const d3F = PATTERN_FACTS.divergence_D3_ownership_building_weak_foundation.legs?.[0];
  const d4F = PATTERN_FACTS.divergence_D4_ownership_exiting_healthy.legs?.[0];
  ok(
    "D3 and D4 are mutually exclusive by their Foundation legs",
    !!d3F && !!d4F && d3F.op === "<" && d4F.op === ">=" && d3F.value <= d4F.value,
    `D3 foundation ${d3F?.op}${d3F?.value} · D4 foundation ${d4F?.op}${d4F?.value}`,
  );
  // Single-pattern pairs cannot produce any combination at all.
  const pairCounts = new Map<string, number>();
  for (const k of Object.keys(PATTERN_FACTS) as PatternKey[]) {
    const f = PATTERN_FACTS[k];
    if ("coalesced" in f && f.coalesced) continue; // the merged entries are not candidates themselves
    const key = [...f.pillarPair].sort().join("+");
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  ok(
    "Market↔Foundation and Market↔Momentum each carry exactly one pattern (no combination possible)",
    pairCounts.get("foundation+market") === 1 && pairCounts.get("market+momentum") === 1,
    `foundation+market=${pairCounts.get("foundation+market")} · market+momentum=${pairCounts.get("market+momentum")}`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · ★ claimantOf IS THE GENERAL RULE — a single pattern is the case where the speaker is itself");
  ok(
    "a single measured pattern is its own claimant",
    claimantOf("divergence_D1_price_ahead_quality" as PatternKey, "NORMAL") === "divergence_D1_price_ahead_quality",
    "D1 → D1",
  );
  ok(
    "a single `described` pattern has no claimant (T4 — sample never preserved)",
    claimantOf("trajectory_D_T4_recovering_out_of_below_par" as PatternKey, "NORMAL") === null,
    "T4 → null",
  );
  ok(
    "a coalesced entry defers to its claim source",
    claimantOf(t2t3, "HOT") === "trajectory_B_T3_falling_out_of_pristine",
    "T2+T3 in HOT → T3",
  );

  console.log(
    `\n${fail === 0 ? "✅ COALESCING GATES PASS — one move one entry, every constituent named, at most one claim" : `❌ ${fail} FAILURE(S)`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
