// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE THREE-LENS SEPARATION GATE — the section's direction map, its ordering, and its copy.
//
// ★★ PURE. No DB, no filesystem, no sibling repo — it is wired into `build` through verify:copy and
//    has to stay inside the rule verify-build-gate-hygiene.ts enforces. ★★
//
// ── 1 · THE DIRECTION MAP IS CHECKED AGAINST THE PRIMITIVE, NOT TRUSTED ───────────────────────────
// field-side.ts states, as data, which side of the peer field each LM face puts its member on. That
// is a SECOND statement of something lens-pattern.ts already encodes as an `if` ladder, and a table
// echoing a ladder is the shape that drifts silently: the ladder gains a cell, the table does not,
// and the new face reads as "neither side" while nothing errors.
//
// So §1 ENUMERATES the closed cell space — 3 L1 states × 4 L2 × 4 L3, against both values of the LM8
// anti-mask opt — fires the REAL primitive on each, and asserts the returned face's declared side is
// exactly what that cell's own L2 state implies. Both directions are also reconciled: every face the
// primitive can return is in the map, and every id in the map is reachable from some cell.
//
// ── 2 · WHAT THE SECTION NEEDS FROM THE MAP ───────────────────────────────────────────────────────
// The two escalating METRIC faces must both carry a side, or a finding that fires would head no
// block and would leave the page entirely (it is partitioned out of the census). LM3 → above,
// LM7 → below, asserted by name.
//
// ── 3 · THE COPY, THROUGH THE EXISTING SCANS ──────────────────────────────────────────────────────
// Every sentence the composer can produce — both sides × every (n, outOf) a pond can present — plus
// the empty-state sentence and the section's boundary, through scanForwardLanguage (R2/R3) and the
// SHARED MOVEMENT_PROMISE / LAG_NUMBER / INSTRUCTION lists, imported from the same module the two
// results-season gates import them from. Sharing the objects is what makes "the existing scans apply
// to the new copy" a fact rather than an intention. The figure ban is applied too — a section about
// counts is exactly where a percentage would sneak in.
//
// Number agreement is asserted rather than eyeballed: "One of the eight SIT above" is precisely the
// seam a fragment assembler produces, and it is invisible until a reader hits the one-member case —
// which is 10 of the 23 live rows.
//
// ── 4 · SHAPE AND ORDER ───────────────────────────────────────────────────────────────────────────
// Blocks descending by members caught; ties on the metric key so the order is stable across reads.
// Poles heavier-first, `below` on a tie. One metric caught at BOTH ends is ONE block with two poles —
// the case that carries the strongest statement a group can make and that no live pond has today,
// which is exactly why it is proved on a fixture rather than left to be discovered.
//
//   npx tsx src/scripts/verify-lens-separation.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { lensPattern } from "../scoring/lens-patterns/lens-pattern.js";
import { LM_L2_CELL, lensFieldSide, sideOfL2 } from "../scoring/lens-patterns/field-side.js";
import type { L1State, L2State, L3State } from "../scoring/lens-patterns/types.js";
import {
  buildLensSeparation,
  poleSentence,
  EMPTY_SENTENCE,
  SEPARATION_DOESNT_MEAN,
  type LensSeparationRow,
} from "../scoring/read/lens-separation.js";
import { scanForwardLanguage } from "../scoring/findings/trajectory/regime-tier.js";
import { scanCopyConstraints } from "./lib/results-season-scans.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

const L1: L1State[] = ["above_bar", "below_bar", "not_evaluable"];
const L2: L2State[] = ["above_peer", "near_peer", "below_peer", "not_evaluable"];
const L3: L3State[] = ["improving", "flat", "declining", "not_evaluable"];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("1 · ★ THE DIRECTION MAP AGREES WITH THE PRIMITIVE — every cell, both anti-mask options");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const disagreements: string[] = [];
  const seenFaces = new Set<string>();
  let cells = 0;

  for (const l1 of L1)
    for (const l2 of L2)
      for (const l3 of L3)
        for (const mask of [true, false]) {
          cells++;
          const fired = lensPattern(l1, l2, l3, { pillarReadsAcceptable: mask });
          if (!fired) continue;
          seenFaces.add(fired.id);
          // The cell's OWN L2 state is the ground truth. The map claims to encode it; this is the
          // comparison that makes the claim checkable rather than a comment.
          const expected = sideOfL2(l2);
          const declared = lensFieldSide(fired.id);
          if (expected !== declared) {
            disagreements.push(
              `${fired.id} on (${l1}·${l2}·${l3}, mask=${mask}): cell implies ${expected}, map says ${declared}`,
            );
          }
        }

  ok(`enumerated the closed cell space (${cells} cells)`, cells === L1.length * L2.length * L3.length * 2);
  ok(
    "every fired face's declared side matches its cell's own L2 state",
    disagreements.length === 0,
    disagreements.slice(0, 3).join(" · ") || "no disagreement",
  );

  // Reconcile BOTH ways, the same discipline the catalogue gate uses for keys with no emitter.
  const mapped = Object.keys(LM_L2_CELL);
  const unmapped = [...seenFaces].filter((f) => !mapped.includes(f));
  const unreachable = mapped.filter((f) => !seenFaces.has(f));
  ok("every face the primitive can return is in the map", unmapped.length === 0, unmapped.join(", ") || "none missing");
  ok("every id in the map is reachable from some cell", unreachable.length === 0, unreachable.join(", ") || "none dead");

  // ⚠ NEGATIVE CONTROL — the comparison must be able to fail, or §1 proves nothing.
  ok(
    "NEGATIVE CONTROL — a wrong side IS detected",
    sideOfL2("below_peer") !== lensFieldSide("LM3"),
    "LM3 is above; below_peer is below",
  );
  ok("near_peer is NOT a side (LM6 sits AT the field)", lensFieldSide("LM6") === null);
  ok("an unknown id has no side", lensFieldSide("LP2") === null && lensFieldSide("nonsense") === null);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("2 · THE TWO ESCALATING METRIC FACES BOTH CARRY A SIDE");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // These two are the only metric-level faces that escalate to a finding card (databank §5.2), and
  // they are partitioned OUT of the pathology census — so a face without a side would not fall back
  // to the old card, it would leave the page.
  ok("LM3 → above the field", lensFieldSide("LM3") === "above");
  ok("LM7 → below the field", lensFieldSide("LM7") === "below");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("3 · THE COPY — every sentence the composer can produce, through the existing scans");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Every pole sentence a pond can present: both sides, every n within every roster size. Ponds run to
 *  ten members today; the range is deliberately wider so the copy is proved past the live shape. */
function everySentence(): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const side of ["above", "below"] as const)
    for (let outOf = 1; outOf <= 12; outOf++)
      for (let n = 1; n <= outOf; n++)
        out.push({ label: `${side} ${n}/${outOf}`, text: poleSentence(side, n, outOf) });
  out.push({ label: "empty state", text: EMPTY_SENTENCE });
  out.push({ label: "section boundary", text: SEPARATION_DOESNT_MEAN });
  return out;
}

{
  const all = everySentence();
  ok(`composed every sentence in the space (${all.length})`, all.length > 150);

  const fwd: string[] = [];
  for (const s of all) for (const v of scanForwardLanguage(s.text)) fwd.push(`${s.label}: ${v.rule} "${v.matched}"`);
  ok("all pass scanForwardLanguage (R2/R3)", fwd.length === 0, fwd.slice(0, 3).join(" · ") || "clean");

  const constraints: string[] = [];
  for (const s of all)
    for (const v of scanCopyConstraints(s.text)) constraints.push(`${s.label}: ${v.scan} "${v.matched}"`);
  ok(
    "all pass the SHARED movement-promise / lag-number / instruction scans",
    constraints.length === 0,
    constraints.slice(0, 3).join(" · ") || "clean",
  );

  // The figure ban from the copy register (rule 3). Re-stated as the two shapes that could reach a
  // sentence built out of counts; the register's own gate owns the D/S/T card corpus.
  const FIGURES: { re: RegExp; why: string }[] = [
    { re: /[-+−]?\d+(?:\.\d+)?\s*%/, why: "a percentage" },
    { re: /\bn\s*=\s*\d+/i, why: "a sample size" },
  ];
  const figures: string[] = [];
  for (const s of all)
    for (const f of FIGURES) {
      const m = f.re.exec(s.text);
      if (m) figures.push(`${s.label}: ${f.why} "${m[0]}"`);
    }
  ok("no figure reaches any sentence", figures.length === 0, figures.slice(0, 3).join(" · ") || "clean");

  // ⚠ NEGATIVE CONTROLS — the scans must bite THIS copy's own register, or they prove nothing here.
  ok(
    "NEGATIVE CONTROL — a planted instruction IS caught",
    scanCopyConstraints("Four of the ten sit below the field. Check the ones below.").length > 0,
  );
  ok(
    "NEGATIVE CONTROL — a planted movement promise IS caught",
    scanCopyConstraints("Two sit below the field and the score will move.").length > 0,
  );
  ok(
    "NEGATIVE CONTROL — a planted R2 phrase IS caught",
    scanForwardLanguage("This metric leads the composite by a quarter.").length > 0,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("4 · ⚠ NUMBER AGREEMENT — baked in, not patched at the join");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const singular = [poleSentence("above", 1, 8), poleSentence("below", 1, 6)];
  const plural = [poleSentence("above", 4, 7), poleSentence("below", 2, 6)];

  ok("n=1 uses 'sits'", singular.every((s) => / sits /.test(s)), singular[0]);
  ok("n>1 uses 'sit'", plural.every((s) => / sit /.test(s) && !/ sits /.test(s)), plural[0]);
  ok("n=1 possessive is 'its own past readings'", poleSentence("below", 1, 6).includes("its own past readings"));
  ok("n>1 possessive is 'their own past readings'", poleSentence("below", 2, 6).includes("their own past readings"));
  ok(
    "the count is a WORD, not a numeral, at every pond size",
    poleSentence("above", 4, 7).startsWith("Four of the seven") && poleSentence("below", 10, 10).startsWith("Ten of the ten"),
  );

  // ★ THE TWO SIDES OPEN IDENTICALLY AND DIVERGE AFTER — two poles of one metric, not two unrelated
  //   sentences. And they are never the same sentence.
  const a = poleSentence("above", 3, 7);
  const b = poleSentence("below", 3, 7);
  ok("both sides open with the same clause", a.startsWith("Three of the seven sit") && b.startsWith("Three of the seven sit"));
  ok("the two sides are distinct sentences", a !== b);
  ok("neither side names a quality", ![a, b].some((s) => /\b(good|bad|strong|weak|poor|healthy)\b/i.test(s)));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("5 · SHAPE AND ORDER — blocks by members caught, poles inside a block, both directions");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const row = (face: string, metricKey: string, members: string[]): LensSeparationRow => ({
    face,
    metricKey,
    pillar: "foundation",
    members,
  });

  const sep = buildLensSeparation(
    [
      row("LM3", "F7", ["AAA"]),
      row("LM7", "F3", ["BBB", "CCC"]),
      row("LM3", "F6", ["DDD", "EEE", "FFF", "GGG"]),
      row("LM3", "F3", ["HHH", "III", "JJJ"]),
    ],
    10,
  );

  ok("blocks are ordered by members caught, descending", sep.blocks.map((b) => b.memberCount).join(",") === "5,4,1");
  ok("a metric caught at both ends is ONE block", sep.blocks[0].metricKey === "F3" && sep.blocks[0].poles.length === 2);
  ok(
    "★ BOTH DIRECTIONS render, heavier pole first",
    sep.blocks[0].poles.map((p) => `${p.side}:${p.memberCount}`).join(" ") === "above:3 below:2",
  );
  ok(
    "the two-pole block's total spans both poles",
    sep.blocks[0].memberCount === 5 && sep.blocks[0].poles.reduce((a, p) => a + p.memberCount, 0) === 5,
  );
  ok(
    "a member never appears on both poles of one metric",
    sep.blocks.every((b) => {
      const all = b.poles.flatMap((p) => p.members);
      return new Set(all).size === all.length;
    }),
  );
  ok("every pole carries its own composed sentence", sep.blocks.every((b) => b.poles.every((p) => p.sentence.length > 0)));
  ok("outOf is the cross-section size on every block", sep.blocks.every((b) => b.outOf === 10));

  // A tie on member count breaks on the metric key, so two reads of one pond order identically.
  const tied = buildLensSeparation([row("LM3", "F9", ["X"]), row("LM3", "F2", ["Y"])], 6);
  ok("ties break on the metric key", tied.blocks.map((b) => b.metricKey).join(",") === "F2,F9");

  // Faces with no side head no block. LM6 sits AT the field; the LP faces are pillar roll-ups. Both
  // would otherwise arrive as a block with a direction nobody can state.
  const sideless = buildLensSeparation([row("LM6", "F1", ["Z"]), row("LP2", "foundation", ["Z"])], 6);
  ok("a face with no side heads no block", sideless.blocks.length === 0);

  ok("empty ⇒ the empty sentence, and only then", sideless.emptySentence === EMPTY_SENTENCE && sep.emptySentence === null);
  ok("the boundary is always present", sep.doesntMean === SEPARATION_DOESNT_MEAN && sideless.doesntMean === SEPARATION_DOESNT_MEAN);
  ok("a row with no members is dropped", buildLensSeparation([row("LM3", "F1", [])], 6).blocks.length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
console.log("");
if (fail > 0) {
  console.error(`❌ verify-lens-separation: ${fail} failure(s)`);
  process.exit(1);
}
console.log("✅ verify-lens-separation: all checks passed");
