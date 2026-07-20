// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE `mf_analytics` CONFINEMENT (Construction v2 Stage 10a batch 3) — THE BOUNDARY, NOT A FILENAME.
//
// ── ★ WHAT IS ACTUALLY BANNED ────────────────────────────────────────────────────────────────────
//
//     THE BAN IS ON THE SCORE, AND THE SCORE IS C1–C6 PLUS HEALTH.
//
// Doc 2 §0 draws the line in one sentence: "FINDINGS MAY USE RETURNS. SCORES MAY NOT." A finding that
// says "this fund's deepest fall was 22.8%" is reporting a fact about an instrument. A score that moved
// because of that 22.8% is rating a user's book on past returns — which is the thing this project has
// refused from the beginning, and the refusal is worth nothing if it is only a habit.
//
// ── ⚠ WHY A FILENAME-SCOPED GREP FAILS ON DAY ONE ───────────────────────────────────────────────
//
// The obvious gate is "no file may import prisma.mfAnalytics". It is wrong before it is written:
// `read-time-catalog.ts` ALREADY imports it — that is batch 2's own code, doing the permitted thing, and
// a gate that fires on it would be deleted within a day for crying wolf. The permitted set is not empty,
// so the gate must ENCODE IT rather than ban the symbol.
//
// ── THE THREE ARMS, AND WHY THE SECOND ONE IS THE REAL GATE ─────────────────────────────────────
//
//   ① TEXT     — inside `src/portfolio/**`, the files that touch `prisma.mfAnalytics` ⊆ PERMITTED.
//                Catches the direct read. Necessary, and NOT sufficient: it only sees what it greps.
//
//   ② REACHABILITY — ★ the FORBIDDEN roots cannot REACH the analytics, TRANSITIVELY, through any chain
//                of imports. This is the arm that matters. Arm ① passes trivially for a file that imports
//                a helper that reads mf_analytics — the symbol never appears in it, and the data arrives
//                anyway. A ban enforced by spelling is a ban on spelling. Import `read-time-catalog.ts`
//                from `entity.ts` and the whole confinement is over, silently, in one line that greps clean.
//
//   ③ SHAPE    — no PI value may reach a deduction. `entity.ts` (C1–C6) and `engine.ts` (Health) must not
//                import the findings that carry those values.
//
//   npx tsx src/scripts/verify-phs-mfanalytics-confinement.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from "fs";
import { globSync } from "fs";
import { dirname, resolve, relative } from "path";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));
const norm = (p: string) => p.replace(/\\/g, "/");

// ── THE PERMITTED SET — the whole point of this file. Two files, each with a reason. ─────────────
const PERMITTED = new Set([
  // The gathering half of the PD/PI split. Its own header explains why it is separate from the pure
  // fire function: purity is what lets a synthetic fixture prove a finding fires.
  "src/portfolio/phs/read-time-catalog.ts",
]);

// ── THE FORBIDDEN ROOTS — the score, named. If any of these can reach mf_analytics, the ban is over. ──
const FORBIDDEN_ROOTS = [
  "src/portfolio/phs/entity.ts",   // C1–C6 — the rules that DEDUCT
  "src/portfolio/phs/engine.ts",   // Health / Quality / Signals
  "src/portfolio/phs/constants.ts", // the thresholds C1–C6 read
];

/** The analytics themselves — anything that IS, or directly reads, the folded returns data. */
const ANALYTICS_SINKS = [
  "src/portfolio/phs/read-time-catalog.ts",
  "src/ingestions/amfi/mf-analytics.ts",
  "src/ingestions/amfi/mf-accumulator.ts",
];

/** A direct read of the table. The symbol Prisma exposes; there is no other way in. */
const DATA_ACCESS = /prisma\s*\.\s*mfAnalytics|\bmfAnalytics\s*\.\s*(findMany|findFirst|findUnique|aggregate|count|groupBy)/;

// ── the import graph, resolved. ESM `./x.js` → `./x.ts` on disk. ─────────────────────────────────
function importsOf(file: string): string[] {
  if (!existsSync(file)) return [];
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
    const spec = m[1]!;
    if (!spec.startsWith(".")) continue; // a package, not our code
    const abs = resolve(dirname(file), spec.replace(/\.js$/, ".ts"));
    if (existsSync(abs)) out.push(norm(relative(process.cwd(), abs)));
  }
  return out;
}

/** Every file reachable from `root` by following relative imports. The closure, not the first hop. */
function reachable(root: string): Map<string, string[]> {
  const seen = new Map<string, string[]>(); // file → the path that reached it
  const walk = (f: string, path: string[]) => {
    if (seen.has(f)) return;
    seen.set(f, path);
    for (const i of importsOf(f)) walk(i, [...path, f]);
  };
  walk(norm(root), []);
  return seen;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("1 · TEXT — inside src/portfolio, who touches `prisma.mfAnalytics`?");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const files = globSync("src/portfolio/**/*.ts").map(norm);
  const touching = files.filter((f) => DATA_ACCESS.test(readFileSync(f, "utf8")));
  console.log(`       scanned ${files.length} files under src/portfolio`);
  for (const f of touching) console.log(`       ${PERMITTED.has(f) ? "✓ permitted" : "✗ FORBIDDEN"}  ${f}`);

  const outside = touching.filter((f) => !PERMITTED.has(f));
  ok("★ every file reading mf_analytics is in the PERMITTED set", outside.length === 0,
    outside.length ? `NOT PERMITTED: ${outside.join(", ")}` : `${touching.length} reader(s), all declared`);

  // ★ The permitted set must not rot into a list of files that no longer read it — a stale allowlist
  // reads as a considered decision and is actually a leftover. Every entry must still be a real reader.
  const phantom = [...PERMITTED].filter((f) => !touching.includes(f));
  ok("★ no phantom permission — every PERMITTED file actually reads it", phantom.length === 0,
    phantom.length ? `PHANTOM: ${phantom.join(", ")} — remove it from PERMITTED` : `${PERMITTED.size} entries, all live`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("2 · ★ REACHABILITY — the score cannot REACH the analytics, through any chain of imports");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  for (const root of FORBIDDEN_ROOTS) {
    const closure = reachable(root);
    const hits = ANALYTICS_SINKS.filter((s) => closure.has(s));
    const detail = hits.length
      ? hits.map((h) => `${h} via ${[...(closure.get(h) ?? []), h].map((p) => p.split("/").pop()).join(" → ")}`).join("; ")
      : `${closure.size} files reachable, none of them the analytics`;
    ok(`★ ${root.split("/").pop()} cannot reach mf_analytics — transitively`, hits.length === 0, detail);
  }

  // ★ THE NEGATIVE CONTROL. An assertion nobody has watched fail is an assertion nobody should trust —
  // and a reachability gate is exactly the kind that passes because the walk is broken, not because the
  // graph is clean. `read-time-findings.ts` IMPORTS entity.ts and read-time-catalog.ts's types, so a walk
  // from IT must find the analytics. If this does not fire, arm ② above is measuring nothing.
  const control = reachable("src/portfolio/phs/read-time-findings.ts");
  ok("negative control: the walk DOES find the analytics from the findings module",
    ANALYTICS_SINKS.some((s) => control.has(s)),
    `${control.size} files reachable from read-time-findings.ts`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("3 · SHAPE — no PI value can reach a deduction");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // C1–C6 live in entity.ts and Health in engine.ts. Neither may import the module that carries the
  // returns-derived findings — not for a type, not for a helper. The findings depend on the score's
  // vocabulary (read-time-findings.ts imports `natureOf` from entity.ts); the arrow must never reverse.
  for (const root of ["src/portfolio/phs/entity.ts", "src/portfolio/phs/engine.ts"]) {
    const closure = reachable(root);
    const hit = closure.has("src/portfolio/phs/read-time-findings.ts");
    ok(`★ ${root.split("/").pop()} does not import the read-time findings — the arrow points one way`, !hit);
  }

  // And the direct textual claim: no C-rule or Health term names a PI input.
  const RETURNS_SYMBOLS = /maxDrawdown|trackingError|ret1y|ret3yCagr|ret5yCagr|sharpe|sortino|rank1y|rank3y|rank5y|alpha1y|beta1y/g;
  for (const root of FORBIDDEN_ROOTS) {
    const src = readFileSync(root, "utf8");
    // Strip comments first: this file's own prose discusses these symbols, and so does constants.ts's
    // (PI_TE_NOTABLE's docstring quotes the measured distribution). A gate that cannot tell code from
    // the comment explaining the code will be satisfied by deleting the comment — the worst possible fix.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const hits = [...new Set([...code.matchAll(RETURNS_SYMBOLS)].map((m) => m[0]))];
    ok(`★ ${root.split("/").pop()} names no returns metric in CODE`, hits.length === 0,
      hits.length ? `FOUND: ${hits.join(", ")}` : "clean (comments excluded — see why)");
  }

  ok("negative control: the symbol scan CATCHES a returns metric in code",
    RETURNS_SYMBOLS.test("const x = a.maxDrawdown5y;"));
}

console.log("\n" + "═".repeat(96));
console.log(fail === 0 ? "  ✅ mf_analytics CONFINEMENT — HOLDS" : `  ❌ ${fail} BREACH(ES)`);
console.log("═".repeat(96));
process.exitCode = fail ? 1 : 0;
