// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// verify-rule-thresholds.ts — THE GATE ON WHERE A THRESHOLD IS ALLOWED TO LIVE.
//
// Last session moved ~40 constants out of rule files and into FINDING_FACTS (catalogue/finding-facts.ts
// + pattern-facts.ts). Nothing stops rule #46 from being written the way R1 originally was:
//
//     export const R46_SOME_CUT_PP = 12;   // a bare local literal, one file, no catalogue entry
//
// verify-evidence-facts.ts's §1 checks that the ~40 constants it already knows by name still hold their
// pre-relocation VALUE. It cannot see a new bare constant it was never told to import — its RELOCATED
// array is a hand-kept list of names. This gate does not keep a list of names: it reads every REGISTERED
// rule file from disk and asks, of every module-scope constant declared in it, "is this number this
// file's OWN, or does it come from somewhere with one home?" A rule that answers "own" is exactly rule
// #46 written R1's way, and this gate is what objects.
//
// ── ★ WHAT COUNTS AS "THE RULE FILE'S OWN NUMBER" ─────────────────────────────────────────────────────
// A module-scope declaration
//     (export )?const NAME = <RHS>;
// on ONE line (this codebase's actual style for every real threshold constant — verified by a full
// audit of the 43 registered files before this gate was written; not one spans multiple lines). RHS
// counts as the file's OWN number when, trimmed of a trailing `// comment` and a trailing `as const`, it
// is a bare numeric literal and NOTHING else — `50`, `-8`, `0.5`, `3.0` — the exact shape
// `R1_PLEDGE_RATIO_PCT = 50` had before relocation, and the exact shape the still-unregistered P2 / P3 /
// C-over-time / G rule files still declare today (§0 proves the scan actually fires on those).
//
// It does NOT match RHS that merely CONTAINS a digit — `Math.round(x * 100) / 100` (r6-distribution.ts,
// p1-clean-rotation.ts, and others' rounding helpers) has a `100` in it and is not a threshold; it is an
// operator constant a formatter uses on a value the rule already computed. Matching "RHS has a digit"
// instead of "RHS IS a digit" was the first draft of this gate and it flagged every `r2`/`round` rounding
// helper in the registered set — eleven false positives before this line was tightened. A threshold and
// a rounding divisor are different categories of number: one is compared against something to decide an
// outcome, the other reshapes a number already decided. §2 below is what actually tells them apart.
//
// RHS counts as TRACED — not the file's own — when it references `FACTS` / `ENTRY.facts` /
// `STOCK_FINDINGS` (the catalogue: `FACTS.thresholds.foo`, `FACTS.evidencedTier`,
// `FACTS.legs.find(...)!.value`) OR `NATIVE_ZONES` (findings/thresholds.ts's pillar native-zone table —
// see the note at RECOGNISED_HOMES below for why a second home is legitimate here and is not this gate
// quietly giving up).
//
// ── ★ §2 · WHY A BARE MAGNITUDE CONSTANT IS NOT A THRESHOLD, AND HOW THE GATE KNOWS ──────────────────
// `p11-margin-compression.ts` declares `export const P11_MAGNITUDE = -8;` — bare, module-scope, exactly
// the shape above. It is NOT flagged, and not because its name contains the word "magnitude" (a
// name-based exemption is exactly the kind of thing a future rule could dodge the gate with by choosing
// a different name). It is excluded because of what it DOES: `-8` is written once into
// `magnitude: P11_MAGNITUDE` — FiredFinding.magnitude, the finding's fixed §5E score effect — and is
// NEVER an operand of a comparison anywhere in the file. A THRESHOLD, by construction, is a number
// something is measured AGAINST — it appears beside `<`, `<=`, `>`, `>=`, `===` or `!==`, deciding
// whether the pattern fires, what tier it reads at, or (T7's case below) which sentence it may print.
// A magnitude is assigned unconditionally once the rule has already decided to fire; it settles nothing.
// So the test is structural, not lexical: a bare constant is a THRESHOLD requiring provenance iff its
// name appears next to a comparison operator anywhere in its own file. `T7_LARGE_MOVE_PP` in
// t7-momentum-improving-while-weak.ts is compared (`m.delta >= T7_LARGE_MOVE_PP`) — it fails this gate.
// `P11_MAGNITUDE` is not — it passes, visibly (§2 logs every exclusion it grants, with the reason).
//
// ── ★ WHY THIS STRUCTURALLY CANNOT FLAG AN ARRAY INDEX, A ROW-COUNT GUARD OR A LOOP BOUND ────────────
// All three live INSIDE a rule's function body — `rows.length < 2`, `arr[0]`, `for (let i = 0; i < n;
// i++)` — never as a hoisted, named, module-scope `const`. A data-presence guard is an implementation
// detail of how much history one rule's arithmetic needs; it is not a fact about the pattern, was never
// a relocation candidate, and nothing in this codebase hoists one to module scope (checked: every
// `.length <` / `.length >=` guard across all 43 registered files is inline). Scoping this gate to
// module-scope declarations ONLY is what makes that true by construction rather than by a list of
// excluded shapes that would need maintaining. If a future rule DID hoist a guard to a named module
// constant, this gate would flag it — correctly forcing a second look, because a number worth naming at
// module scope is a number someone thought was worth sharing, which is exactly what a threshold is.
//
// ── FOUR THINGS THIS GATE MUST NOT DO (the brief) ─────────────────────────────────────────────────────
//   1. Flag a legitimate non-threshold literal.                    → §1's bareness test + §2's
//      comparison test, both proven against synthetic + real cases in §0/§4.
//   2. Cover the unregistered rule files.                          → §3: scanned files come from
//      engine.ts's own imports, never a hand-kept list; the unregistered set is asserted, not assumed.
//   3. Silently pass a registered rule with no facts record.       → §5.
//   4. Be worked around by loosening the check to force a pass.    → not done; see the report.
//
//   npx tsx src/scripts/verify-rule-thresholds.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from "fs";
import { FINDING_FACTS } from "../catalogue/finding-facts.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(103) + "\n" + s + "\n" + "═".repeat(103));

const RULES_DIR = "src/scoring/findings/rules";
const ENGINE_FILE = "src/scoring/findings/engine.ts";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// §3 · WHICH FILES ARE IN SCOPE — derived, never hand-kept. Same discipline verify-evidence-register.ts
// uses for the same directory: a rule that stops being imported by engine.ts falls out of scope the
// moment that happens, with no second list to remember to edit.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function registeredRuleFiles(): string[] {
  const engine = readFileSync(ENGINE_FILE, "utf8");
  return [...engine.matchAll(/from "\.\/rules\/([a-z0-9-]+)\.js"/g)].map((m) => m[1]);
}

/**
 * ⚠ THE EIGHT-VERSUS-TEN CHECK. The brief describes "the eight unregistered rule files — P2, P3, C1–C3,
 * C-over-time, G, the old B/D/I." Counted out, that list is P2, P3, C1, C2, C3, C-over-time, G, B, D,
 * I — TEN files, not eight, and findings/types.ts's own RETIRED RULES header agrees: "Ten rule files
 * survive on disk as a record of what was tried." retired-findings.ts's RETIRED_FINDING_KEYS lists all
 * ten keys by name. This gate asserts the true, derived count below rather than the brief's arithmetic —
 * a gate that trusted the brief's count over the tree would itself be the R1 mistake one level up.
 */
const EXPECTED_UNREGISTERED: readonly [string, string][] = [
  ["p2-distribution-retail", "P2 — consolidated into R6 (retired-findings.ts wave 1)"],
  ["p3-promoter-stress", "P3 — consolidated into R1 (retired-findings.ts wave 1)"],
  ["c1-divergence", "C1 — superseded by D1/D2 (retired-findings.ts wave 2)"],
  ["c2-ownership-divergence", "C2 — superseded by D3/D4 (retired-findings.ts wave 2)"],
  ["c3-floor-trajectory-split", "C3 — superseded by S2 (retired-findings.ts wave 2)"],
  ["c-over-time", "C-over-time — excluded, −1.1%/44% positive (retired-findings.ts wave 2)"],
  ["g-convergence", "G — excluded, +0.2%/51% positive, 'indistinguishable from nothing' (wave 2)"],
  ["b-deterioration", "old B — superseded by T2/T3/T6/T9 (retired-findings.ts wave 3)"],
  ["d-recovery", "old D — superseded by T1/T4/T5/T7/T8 (retired-findings.ts wave 3)"],
  ["i-band-transition", "old I — superseded by T3 (retired-findings.ts wave 3)"],
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// §1 · THE EXTRACTION — every module-scope `const NAME = <RHS>;` on one line, anywhere in a file.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
interface ConstDecl { name: string; rhs: string; line: number }

const CONST_DECL = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+)?=\s*([^\n]+?);/gm;

function moduleConsts(src: string): ConstDecl[] {
  const out: ConstDecl[] = [];
  for (const m of src.matchAll(CONST_DECL)) {
    const before = src.slice(0, m.index ?? 0);
    out.push({ name: m[1], rhs: m[2], line: before.split("\n").length });
  }
  return out;
}

/** RHS trimmed of a trailing line comment and a trailing `as const`. */
function rhsExpr(rhsRaw: string): string {
  return rhsRaw.replace(/\/\/.*$/, "").trim().replace(/\s+as\s+const$/, "").trim();
}

/** Is this RHS a bare numeric literal — the WHOLE expression, not merely containing a digit? See the
 *  header for why "contains a digit" was rejected (it caught rounding helpers). */
function isBareNumericLiteral(rhsRaw: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(rhsExpr(rhsRaw));
}

/**
 * ★ RECOGNISED HOMES for a numeric threshold OTHER than a bare literal. FINDING_FACTS is the primary
 * one this gate exists to route rules toward — `FACTS.*` / `ENTRY.facts` / `STOCK_FINDINGS.*`. But
 * `NATIVE_ZONES` (findings/thresholds.ts) is a SECOND, pre-existing, already-centralised table — File 1
 * §0's pillar native weak/strong marks, shared by health-view.service.ts and composite/label.ts long
 * before this catalogue existed. p10-promoter-defense.ts reads `NATIVE_ZONES.market.strong` instead of
 * a second literal `74`, with its own comment explaining exactly why: "read from the ONE shared table
 * rather than typed as a second literal." Refusing that reference — insisting it ALSO appear inside
 * FINDING_FACTS — would ask a maintainer to duplicate a fact that already has a home, which is the
 * defect this whole architecture exists to prevent. The gate accepts both homes, not neither.
 */
const TRACED_RE = /\b(?:FACTS|STOCK_FINDINGS|NATIVE_ZONES)\b/;
function isTraced(rhsRaw: string): boolean {
  return TRACED_RE.test(rhsExpr(rhsRaw));
}

/** Does NAME appear, anywhere in the file, adjacent to a comparison operator? This is what separates a
 *  THRESHOLD (compared against something to decide an outcome) from an assigned-only constant like a
 *  magnitude (see the header's §2). */
const CMP_OPS = "(?:>=|<=|===|!==|==|!=|>|<)";
function isComparedSomewhere(name: string, src: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b\\s*${CMP_OPS}|${CMP_OPS}\\s*\\b${esc}\\b`);
  return re.test(src);
}

interface ScanResult {
  flagged: { file: string; name: string; value: string; line: number }[];
  excludedAssignedOnly: { file: string; name: string; value: string; line: number }[];
}

/** The whole gate, as one pure function of (file list, file-reader) — so §0's negative controls and the
 *  real §4 scan below are provably the SAME code path, not a rule re-explained in prose next to a
 *  different rule that actually runs. */
function scan(files: { path: string; src: string }[]): ScanResult {
  const flagged: ScanResult["flagged"] = [];
  const excludedAssignedOnly: ScanResult["excludedAssignedOnly"] = [];
  for (const { path, src } of files) {
    for (const decl of moduleConsts(src)) {
      if (isTraced(decl.rhs)) continue; // sourced from FINDING_FACTS or NATIVE_ZONES — not this file's own
      if (!isBareNumericLiteral(decl.rhs)) continue; // not a plain literal — a helper, an array, etc.
      const value = rhsExpr(decl.rhs);
      if (isComparedSomewhere(decl.name, src)) {
        flagged.push({ file: path, name: decl.name, value, line: decl.line });
      } else {
        excludedAssignedOnly.push({ file: path, name: decl.name, value, line: decl.line });
      }
    }
  }
  return { flagged, excludedAssignedOnly };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// §5 · THE KEY A RULE FILE EMITS, AND WHETHER FINDING_FACTS CARRIES IT. Same three shapes
// verify-evidence-register.ts already resolved keys by (inline literal / const shorthand / the
// `STOCK_FINDINGS.<key>` catalogue binding) — reused rather than re-invented, because a second,
// slightly-different key resolver is exactly the kind of duplicate that drifts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function keyOf(src: string): string | null {
  const inline = src.match(/\bkey:\s*"([A-Za-z0-9_]+)"/);
  if (inline) return inline[1];
  const named = src.match(/\bkey:\s*([A-Za-z_]\w*)\s*,/);
  if (named) {
    const constDecl = src.match(new RegExp(`\\bconst\\s+${named[1]}\\s*=\\s*"([A-Za-z0-9_]+)"`));
    if (constDecl) return constDecl[1];
  }
  const bound = src.match(/\bSTOCK_FINDINGS\.([A-Za-z_$][\w$]*)/);
  return bound ? bound[1] : null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  console.log("════ RULE THRESHOLDS · EVERY BAR IN A REGISTERED RULE FILE TRACES TO ONE HOME ════");

  // ═══════════════════════ §0 · NEGATIVE CONTROLS — prove the scan is not dead, first ═══════════════
  rule("§0 · NEGATIVE CONTROLS — the extraction + classification, run against known shapes before the real scan");

  const BAD_BARE = [
    `export const FAKE_R46_CUT_PP = 12; // no catalogue entry — exactly R1's pre-relocation shape`,
    `export const ruleFake = (ctx) => {`,
    `  if (ctx.value >= FAKE_R46_CUT_PP) return null;`,
    `  return { key: "fake" };`,
    `};`,
  ].join("\n");
  const GOOD_TRACED = [
    `const FACTS = STOCK_FINDINGS.foundation_fake.facts;`,
    `export const FAKE_MIN = FACTS.thresholds.min;`,
    `export const ruleFake = (ctx) => { if (ctx.value < FAKE_MIN) return null; return { key: "fake" }; };`,
  ].join("\n");
  const GOOD_NATIVE_ZONES = [
    `export const FAKE_NOT_STRONG = NATIVE_ZONES.market.strong;`,
    `export const ruleFake = (ctx) => { if (ctx.mkt >= FAKE_NOT_STRONG) return null; return { key: "fake" }; };`,
  ].join("\n");
  const GOOD_MAGNITUDE_ONLY = [
    `export const FAKE_MAGNITUDE = -8; // §5E Red — never compared, only assigned`,
    `export const ruleFake = (ctx) => { return { key: "fake", magnitude: FAKE_MAGNITUDE }; };`,
  ].join("\n");
  const GOOD_ROUNDING_HELPER = [
    `const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100); // r6-distribution.ts's actual shape`,
    `export const ruleFake = (ctx) => { return { key: "fake", evidence: { v: r2(ctx.value) } }; };`,
  ].join("\n");

  const S0 = (label: string, src: string, path = `synthetic:${label}`) => scan([{ path, src }]);
  const badResult = S0("bad-bare", BAD_BARE);
  ok("fires on a bare local constant used in a comparison (R1's original shape)", badResult.flagged.length === 1 && badResult.flagged[0].name === "FAKE_R46_CUT_PP", `${badResult.flagged.length} flagged`);
  ok("does NOT fire on a constant traced through FACTS/STOCK_FINDINGS", S0("good-traced", GOOD_TRACED).flagged.length === 0, "clean");
  ok("does NOT fire on a constant traced through NATIVE_ZONES (findings/thresholds.ts)", S0("good-native", GOOD_NATIVE_ZONES).flagged.length === 0, "clean");
  const magResult = S0("good-magnitude", GOOD_MAGNITUDE_ONLY);
  ok("does NOT fire on a bare constant that is only ever ASSIGNED (magnitude), never compared", magResult.flagged.length === 0, "clean");
  ok("…but DOES still see it and logs the exclusion (visible, not silent)", magResult.excludedAssignedOnly.length === 1, `${magResult.excludedAssignedOnly.length} logged`);
  ok("does NOT fire on a rounding helper whose RHS merely CONTAINS a digit (Math.round(x*100)/100)", S0("good-rounding", GOOD_ROUNDING_HELPER).flagged.length === 0, "clean — the false positive this header describes, closed");

  // §0b — the scan is not blind to the real unregistered files either. If it were, excluding them in
  // §3 would be excluding nothing, and the exclusion would be unverifiable by construction.
  const realUnregisteredHits = scan(
    EXPECTED_UNREGISTERED.map(([f]) => ({ path: `${RULES_DIR}/${f}.ts`, src: readFileSync(`${RULES_DIR}/${f}.ts`, "utf8") })),
  );
  ok(
    "the scan FIRES on the real unregistered files' own bare constants (P2/P3/C-over-time/G still have them)",
    realUnregisteredHits.flagged.length > 0,
    `${realUnregisteredHits.flagged.length} bare constants found in the ten unregistered files — confirms §3's exclusion is doing real work`,
  );

  // ═══════════════════════ §3 · SCOPE — derived from engine.ts, the unregistered set asserted ═══════
  rule("§3 · SCOPE — every REGISTERED rule file, derived from engine.ts's own imports; unregistered set asserted, not assumed");
  const registered = registeredRuleFiles();
  const onDisk = readdirSync(RULES_DIR).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, "")).sort();
  const registeredSet = new Set(registered);
  const unregisteredOnDisk = onDisk.filter((f) => !registeredSet.has(f)).sort();
  const expectedNames = EXPECTED_UNREGISTERED.map(([f]) => f).sort();

  console.log(`  rule files on disk: ${onDisk.length} · registered (engine.ts imports): ${registered.length} · unregistered: ${unregisteredOnDisk.length}`);
  ok("43 rule files are registered (FILING_RULES + SCORING_RULES)", registered.length === 43, `${registered.length}`);
  const missingExpected = expectedNames.filter((f) => !unregisteredOnDisk.includes(f));
  const unexpectedExtra = unregisteredOnDisk.filter((f) => !expectedNames.includes(f));
  ok(
    "the unregistered set is EXACTLY the ten named in EXPECTED_UNREGISTERED — no fewer, no more",
    missingExpected.length === 0 && unexpectedExtra.length === 0,
    [
      unregisteredOnDisk.length !== 10 ? `${unregisteredOnDisk.length} unregistered on disk, not the brief's claimed 8 — see the ⚠ note above CONST_DECL/EXPECTED_UNREGISTERED` : "",
      missingExpected.length ? `expected-but-registered-now: ${missingExpected.join(",")}` : "",
      unexpectedExtra.length ? `unregistered-but-undeclared: ${unexpectedExtra.join(",")}` : "",
    ].filter(Boolean).join(" · ") || "10/10 match, exactly as retired-findings.ts + types.ts's own header describe",
  );
  for (const [f, why] of EXPECTED_UNREGISTERED) console.log(`     excluded: ${f}.ts — ${why}`);

  // ═══════════════════════ §4 · THE REAL SCAN ═══════════════════════════════════════════════════════
  rule("§4 · THE SCAN — every registered rule file, every module-scope bare numeric constant");
  const files = registered.map((f) => ({ path: `${RULES_DIR}/${f}.ts`, src: readFileSync(`${RULES_DIR}/${f}.ts`, "utf8") }));
  const result = scan(files);

  console.log(`  ${files.length} registered files scanned`);
  for (const e of result.excludedAssignedOnly) {
    const key = keyOf(files.find((f) => f.path === e.file)!.src);
    console.log(`     excluded (assigned-only, never compared) ${e.file}:${e.line} ${e.name} = ${e.value}  [${key ?? "?"}]`);
  }
  ok(
    "no registered rule file declares a bare, untraced numeric threshold",
    result.flagged.length === 0,
    result.flagged.length === 0
      ? `${files.length} files clean`
      : result.flagged
          .map((f) => {
            const key = keyOf(files.find((x) => x.path === f.file)!.src);
            return `${f.file}:${f.line} \`${f.name} = ${f.value}\` — compared against something in this file, but "${key ?? "?"}" carries no such value in FINDING_FACTS`;
          })
          .join("\n       "),
  );

  // ═══════════════════════ §5 · EVERY REGISTERED RULE'S KEY CARRIES A FACTS RECORD ══════════════════
  rule("§5 · every registered rule's emitted key resolves to a FINDING_FACTS entry (the gate's first finding, if one is missing)");
  const unresolved: string[] = [];
  const noFacts: string[] = [];
  for (const { path, src } of files) {
    const key = keyOf(src);
    if (!key) { unresolved.push(path); continue; }
    if (!(key in FINDING_FACTS)) noFacts.push(`${path} → "${key}"`);
  }
  ok("every registered rule file's emitted key was resolvable from its source", unresolved.length === 0, unresolved.join(",") || `${files.length}/${files.length} resolved`);
  ok("every resolved key carries a FINDING_FACTS record", noFacts.length === 0, noFacts.join(",") || "none missing");

  console.log(
    fail === 0
      ? `\n════ VERDICT: ✅ every registered rule file's numeric thresholds trace to FINDING_FACTS or NATIVE_ZONES; nothing bare, nothing local, nothing silent ════`
      : `\n════ VERDICT: ❌ ${fail} FAILURE(S) — see above. This gate does not loosen to pass; fix the rule file or give the constant a declared home ════`,
  );
}

await main();
process.exit(fail === 0 ? 0 : 1);
