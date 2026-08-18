// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE GATE ON THE GATES — what `build` is allowed to reach. RUNS FIRST IN verify:copy. ★★
//
// ── THE INCIDENT THIS EXISTS FOR ──────────────────────────────────────────────────────────────────
// verify-boundary-render.ts imports Vytal-Frontend/lib/findings/boundary.ts and was wired into
// verify:copy, which is wired into `build`. The two repos are SEPARATE GitHub repositories; they sit
// side by side only in the operator's local folder. Railway checks out ONE repo. So the gate passed on
// every machine that had both checkouts and could never pass on the deploy box:
//
//     ❌ frontend transform not found at /Vytal-Frontend/lib/findings/boundary.ts
//
// The deploy failed on a path that does not exist, not on a fact about the copy it was guarding.
//
// ── AND IT HAD ALREADY BEEN GOT RIGHT ONCE ────────────────────────────────────────────────────────
// verify:copy-fresh — the frontend fallback staleness gate, which reaches across in exactly the same
// way — was DELIBERATELY kept out of `build` for exactly this reason, and gen-frontend-fallback.ts
// says so in its own header. That reasoning was written down, was correct, and did not stop the next
// one, because A COMMENT IS NOT A MECHANISM. Nothing read it at wiring time. This file is what reads
// it at wiring time.
//
// ── THE RULE, STATED ONCE ─────────────────────────────────────────────────────────────────────────
//   A BUILD GATE MAY READ ONLY THIS CHECKOUT.
//
//   Not a sibling directory. Not a path from an env var that exists only on a developer's machine.
//   Not the database. Not the network. If a check needs anything else, it is not a build gate — it
//   belongs to `verify:cross-repo`, and this file FAILS THE BUILD if it is wired into one anyway.
//
// ── WHAT IS ASSERTED, AND HOW EACH THING IS DISCOVERED ────────────────────────────────────────────
//   1. THE BUILD-REACHABLE SET is derived by expanding package.json's `build` through every
//      `npm run` it names. There is NO hand-kept list of gates here — a list would go stale the first
//      time someone added a gate, which is precisely the failure being prevented. Same discipline
//      verify-catalogue.ts uses when it discovers emitted keys from engine.ts's imports.
//   2. CROSS-REPO REACH is scanned over each gate's TRANSITIVE local import graph, not just its own
//      source, because reaching out through a helper is the same reach.
//   3. THE CROSS-REPO CLASS is discovered from source across ALL of src/scripts and asserted DISJOINT
//      from the build-reachable set. That is the load-bearing assertion: it catches a script nobody
//      declared, nobody named, and nobody filed in the right directory.
//   4. DB / ENV reach is DECLARED in ENV_OR_DB_ALLOWANCE with a reason, and reconciled both ways —
//      an undeclared reacher fails, and a declaration that no longer describes anything also fails.
//      "Explained by a declaration, never by a wildcard" is the same shape §4 of verify-catalogue.ts
//      uses for keys with no emitter.
//   5. NEGATIVE CONTROLS run the real rules against the real cross-repo file, so a scan that has gone
//      dead is visible. A guard nobody has watched fire is a guard nobody knows works.
//
// ── ⚠ WHAT THIS CANNOT PROVE ──────────────────────────────────────────────────────────────────────
// It is a SOURCE scan, not a sandbox. It cannot stop a gate that assembles an outside path at runtime
// from bytes this scan never sees, and it does not sandbox the filesystem. What it does guarantee is
// that the three shapes the escape has ever actually taken — a sibling-repo path literal, an
// env-configured directory, and a cwd-relative parent escape — FAIL THE BUILD AT THE MOMENT SOMEONE
// WIRES THEM IN, on the author's own machine, with the reason printed. The stronger form (run the
// build gates in a mirrored checkout with no siblings and no .env, so the local build cannot see what
// the deploy box cannot see) is noted at the foot of this file.
//
//   npx tsx src/scripts/verify-build-gate-hygiene.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const ROOT = process.cwd();
const rel = (p: string) => relative(ROOT, p).split("\\").join("/");

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CROSS-REPO REACH PATTERNS — the three shapes the escape has actually taken, plus the env one.
//
// These are CODE shapes, not prose. A comment that says "this was moved from Vytal-Frontend/lib/…"
// is documentation and appears in five backend modules; none of them carries a `../` prefix, an env
// read, or a cwd escape. Matching reach rather than mention is what makes this scan usable
// transitively without an allowlist — and an allowlist would need upkeep forever.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const REACH: { re: RegExp; why: string }[] = [
  { re: /\.\.\/Vytal-[A-Za-z]/, why: "a path literal stepping into a SIBLING REPO" },
  { re: /process\.env\.[A-Z0-9_]*_DIR\b/, why: "an env-configured DIRECTORY — a local-layout dependency, unset on the deploy box" },
  { re: /(?:resolve|join)\(\s*process\.cwd\(\)\s*,\s*["'`]\.\./, why: "resolves OUT of the checkout, relative to cwd" },
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE SHAPES BELOW ARE ASSEMBLED FROM FRAGMENTS ON PURPOSE — DO NOT "TIDY" THEM INTO LITERALS.
//
// §3 scans EVERY script under src/scripts, and this file is one of them. Written as literals, the
// negative-control strings would make the scanner the single file that trips its own rule — and the
// only repair for that is an exemption. An exempt scanner is exactly how a scan goes dead: the next
// person adds a second exemption because the first one existed. So the guard holds itself to the rule
// it enforces, and the shapes it must quote are built at runtime instead of typed.
//
// The REACH patterns above are safe as literals: an escaped regex source (`\.\.\/Vytal-`) does not
// match the path it describes (`../Vytal-`). The negative controls below are the strings that would.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const F_SIBLING = ".." + "/Vytal-Frontend";
const F_ENV_READ = "process.env." + "VYTAL_FRONTEND_DIR";
const F_CWD_ESCAPE = 'resolve(process.cwd(), "' + "..";
/** The line, verbatim, that shipped in the gate which broke the deploy. */
const SHIPPED_LINE = `const FRONTEND_DIR = ${F_ENV_READ} ?? ${F_CWD_ESCAPE}/Vytal-Frontend");`;
/** A computed dynamic import, verbatim — the shape ENTRY_ONLY exists to catch. */
const COMPUTED_IMPORT = "await " + "import(" + "pathToFileURL(MODULE_PATH).href)";

/** Applied to gate ENTRY files only — a computed dynamic import is how a gate loads a file no static
 *  resolver can see. Legitimate elsewhere in the codebase (main-module checks, lazy adapters), which
 *  is why the scope is the entry script rather than the whole graph. */
const ENTRY_ONLY: { re: RegExp; why: string }[] = [
  { re: /\bimport\s*\(\s*(?!["'`])/, why: "dynamic import of a COMPUTED specifier — static resolution cannot see where it points" },
];

/** Build steps that are not tsx gates. Anything else in `build` is unreviewed and fails. */
const NON_GATE_STEPS: { cmd: string; why: string }[] = [
  { cmd: "prisma generate", why: "reads prisma/schema.prisma, writes src/generated/prisma — checkout only, no datasource URL needed" },
  { cmd: "tsc", why: "reads tsconfig.json + src/**; rootDir/outDir both pin inside the checkout" },
];

/**
 * ⚠ DECLARED DB / ENV REACH. A build gate that imports the prisma client or the env module is reaching
 * for something the build container is not guaranteed to have. Each one is named here WITH ITS REASON
 * or the build fails. Adding a gate that reaches without adding a line here is the failure this catches.
 */
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ §7 — THE CLAIM MUST BE TRUE. A script that SAYS it enforces at build time must RUN at build time.
//
// ── THE INCIDENT THIS EXISTS FOR ──────────────────────────────────────────────────────────────────
// scoring/inputs/score-input-columns.ts carried, for months: "src/scripts/verify-score-input-columns.ts
// asserts that against prisma/schema.prisma and fails the build otherwise." The script existed. It was
// correct. package.json never called it. A newly-added column could silently default to cosmetic —
// exactly the failure the comment promised was impossible. Three more were then found by hand:
// mf-analytics.ts:1133 cites verify-t5-omission-keys.ts, ai/guardrail.ts:411 cites
// verify-evaluative-tier.ts, and verify-phs-pd-readtime.ts / verify-number-grounding.ts claim it of
// themselves. Four false promises, all discovered by a person reading rather than by a machine.
//
// §1-§6 above are ONE-WAY: they assert that nothing WRONG is reachable from `build`. Nothing asserted
// that something PROMISED is reachable. This is that assertion, and it is the mirror image.
//
// ── THE CLAIM PREDICATE, STATED ───────────────────────────────────────────────────────────────────
// A script CLAIMS build enforcement when a BUILD_CLAIM pattern matches either
//   · its OWN source (a self-claim), or
//   · a ±2-line window around its filename in ANY src/ file (a claim made ABOUT it from elsewhere —
//     the mf-analytics / guardrail shape, which a self-source scan cannot see).
// The window matters: a file that names a script in one place and says "fails the build" about
// something else 200 lines away is not making a claim about that script.
//
// ── WHY AN ALLOWLIST, AND WHY IT CARRIES A REASON ─────────────────────────────────────────────────
// Some claiming scripts CANNOT be build gates — §2 forbids a build gate from reaching the database,
// and four of these query it. Their claim text is loose, but the scripts are real and they do run;
// they run in `verify:all`, not in `build`. That is a legitimate state and it must be DECLARED with
// its reason rather than skipped silently, the same discipline §4 uses for env/DB reach. Reconciled
// both ways: an undeclared claimer fails, and a declaration that no longer describes a claiming
// script also fails. Cross-repo scripts are exempt BY CONSTRUCTION — §3 has already proven they must
// not be reachable from `build`, so requiring them to be would contradict it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const BUILD_CLAIM: { re: RegExp; why: string }[] = [
  { re: /\bfails?\s+the\s+build\b/i, why: '"fails the build"' },
  { re: /\bthe\s+build\s+(?:fails|stops|breaks|halts)\b/i, why: '"the build fails/stops/breaks"' },
  { re: /\bbreaks?\s+the\s+build\b/i, why: '"breaks the build"' },
  { re: /\bBUILD\s+GATE\b/, why: '"BUILD GATE"' },
];
/** ±N lines around a filename mention that count as "a claim about THAT script". */
const CLAIM_WINDOW = 2;

/**
 * ⚠ DECLARED NON-BUILD CLAIMERS. Each names WHY the claim is true-ish but the script is not a build
 * gate, and WHERE it actually runs. Adding a claiming script without adding a line here fails.
 */
const BUILD_CLAIM_EXEMPT: Record<string, string> = {
  "src/scripts/verify-personal-section.ts":
    "DELIBERATELY WIRED NOWHERE, and its own header says so at :5 — it reaches the frontend, so §3 " +
    "would reject it from `build`. The 'fails the build' phrase in it describes verify-build-gate-hygiene, " +
    "not itself. This is what a correct un-wired script looks like; it is the reference case.",
  "src/scripts/verify-projection-parity.ts":
    "Imports src/db/prisma.ts and compares LIVE projections — §2 forbids a build gate from reading the " +
    "database. Runs in `npm run verify:read-parity`, which `verify:all` chains. Its 'BUILD GATE' phrase " +
    "is describing the class it belongs to, not a claim to be in `build`.",
  "src/scripts/verify-t5-omission-keys.ts":
    "Imports src/db/prisma.ts and scans live omission keys — cannot be a build gate (§2). The claim is " +
    "made ABOUT it from src/ingestions/amfi/mf-analytics.ts:1133 ('now fails the build on any omission " +
    "key that is not a column'), which overstates it. Runs in `npm run verify:live`.",
  "src/scripts/verify-evaluative-tier.ts":
    "Imports src/db/prisma.ts and scans the live chat corpus, and reads A/B arm files from an absolute " +
    "temp path — twice disqualified from `build` (§2). Claimed of at src/ai/guardrail.ts:411. " +
    "Runs in `npm run verify:live`.",
  "src/scripts/verify-number-grounding.ts":
    "Imports src/db/prisma.ts and grounds numbers against live instrument rows — cannot be a build gate " +
    "(§2). Its 'fails the build' at :156 describes its own negative controls. Runs in `npm run verify:live`.",
  "src/scripts/verify-phs-pd-readtime.ts":
    "Reaches src/db/prisma.ts TRANSITIVELY (via controllers/me/portfolio-snapshot-controller.ts, a " +
    "131-module closure) — §4 flagged it the moment it was wired into verify:copy, which is how this was " +
    "found. Runs in `npm run verify:live`.",
  "src/scripts/brief-mobile-height.ts":
    "Not a gate at all. Its :28 'a gate that fails the build because a padding changed would…' is " +
    "HYPOTHETICAL prose arguing AGAINST making it one. Kept in the scan rather than pattern-excluded, " +
    "because narrowing the predicate to spare one file is how a scan starts going blind.",
};

const ENV_OR_DB_ALLOWANCE: Record<string, string> = {
  "src/scripts/verify-catalogue-endpoint.ts":
    "boots the real app in-process to assert the SERIALISED bytes. app.ts's router imports pull in " +
    "db/prisma.ts (a pg Pool is constructed but never connected — the pool is lazy) and config/env.ts. " +
    "The one route it exercises, /api/v1/catalogue, is assembled from frozen constants and reads no DB. " +
    "Module load must stay env-free: see the lazy JWKS note in src/middleware/auth.ts.",
  "src/scripts/dryrun-session-date.ts":
    "drives the REAL providers' processBhavcopyBody / processIndexBody / parseUdiff against synthetic " +
    "CSV+zip bodies, so importing them pulls ingestions/shared/ingestion-error.ts → db/prisma.ts. Same " +
    "shape as the allowance above: a pg Pool is CONSTRUCTED but never connected, because the pool is " +
    "lazy and this script issues no query. It cannot reach the DB even by accident — reportIngestionError " +
    "is the only writer on those paths and it is reached ONLY by a GUARD 1 (shape) or GUARD 2 (skip-rate) " +
    "breach, and no fixture here breaches either. Its own subject, the session-date check, returns BEFORE " +
    "GUARD 2 by construction. Unlike its dryrun-* siblings (dryrun-ingestion-guards / dryrun-indices-guards, " +
    "which insert sentinel rows and are correctly NOT build gates) this one writes nothing at all.",
};
const ENV_OR_DB_MODULES = ["src/config/env.ts", "src/db/prisma.ts"];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WIRING — expand package.json's `build` through every `npm run` it names.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const SCRIPTS = pkg.scripts ?? {};

interface Step {
  raw: string;
  gate?: string;
  run?: string;
}
const stepsOf = (cmd: string): Step[] =>
  cmd
    .split(/\s*&&\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const run = /^npm\s+run\s+([\w:.-]+)/.exec(raw);
      if (run) return { raw, run: run[1] };
      const gate = /^(?:npx\s+)?tsx\s+(\S+)/.exec(raw);
      if (gate) return { raw, gate: gate[1] };
      return { raw };
    });

interface Expanded {
  gates: string[];
  plain: string[];
  scripts: string[];
}
function expand(name: string, seen = new Set<string>()): Expanded {
  const out: Expanded = { gates: [], plain: [], scripts: [] };
  if (seen.has(name) || SCRIPTS[name] === undefined) return out;
  seen.add(name);
  out.scripts.push(name);
  for (const st of stepsOf(SCRIPTS[name])) {
    if (st.gate) out.gates.push(st.gate);
    else if (st.run) {
      const sub = expand(st.run, seen);
      out.gates.push(...sub.gates);
      out.plain.push(...sub.plain);
      out.scripts.push(...sub.scripts);
    } else out.plain.push(st.raw);
  }
  return out;
}

const BUILD = expand("build");
const BUILD_SCRIPTS = new Set(BUILD.scripts);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE IMPORT CLOSURE — every backend module a gate pulls in, transitively.
//
// src/generated/** is not descended into: it is prisma's emitted client, it is megabytes, and it is a
// build ARTEFACT of prisma/schema.prisma rather than authored source. Stated rather than silent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const SKIP = (p: string) => rel(p).startsWith("src/generated/");
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']*)["']/g;

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

function resolveSpec(fromDir: string, spec: string): string | null {
  const base = resolve(fromDir, spec);
  for (const c of [base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), `${base}.ts`, base, `${base}/index.ts`]) {
    if (isFile(c)) return c;
  }
  return null;
}

function closureOf(entryAbs: string): string[] {
  const seen = new Set<string>();
  const stack = [entryAbs];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || !isFile(f)) continue;
    seen.add(f);
    if (SKIP(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const next = resolveSpec(dirname(f), m[1]);
      if (next && !seen.has(next)) stack.push(next);
    }
  }
  return [...seen];
}

const hits = (src: string, table: { re: RegExp; why: string }[]) =>
  table.filter((t) => t.re.test(src)).map((t) => `${t.why} [${src.match(t.re)![0].trim().slice(0, 48)}]`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  rule("1 · THE BUILD-REACHABLE SET — expanded from package.json, never a hand-kept list");
  console.log(`  build            → ${SCRIPTS.build ?? "(absent)"}`);
  console.log(`  scripts expanded → ${BUILD.scripts.join(" → ")}`);
  console.log(`  non-gate steps   → ${BUILD.plain.join(" · ") || "none"}`);
  console.log(`  gates (${BUILD.gates.length}):`);
  for (const g of BUILD.gates) console.log(`     ${g}`);

  ok("`build` reaches at least one gate (a chain nobody runs is not a chain)", BUILD.gates.length > 0, `${BUILD.gates.length} gates`);
  const missing = BUILD.gates.filter((g) => !isFile(resolve(ROOT, g)));
  ok("every build gate resolves to a real file", missing.length === 0, missing.join(",") || "all present");
  const outsideScripts = BUILD.gates.filter((g) => !g.startsWith("src/scripts/"));
  ok("every build gate lives under src/scripts/", outsideScripts.length === 0, outsideScripts.join(",") || "all in place");
  const unknownSteps = BUILD.plain.filter((s) => !NON_GATE_STEPS.some((n) => n.cmd === s));
  ok(
    "every NON-gate build step is one of the two reviewed commands",
    unknownSteps.length === 0,
    unknownSteps.join(" · ") || NON_GATE_STEPS.map((n) => n.cmd).join(" · "),
  );
  for (const n of NON_GATE_STEPS) console.log(`     ${n.cmd.padEnd(16)} ↳ ${n.why}`);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ⚠ NO BUILD GATE REACHES OUTSIDE THIS CHECKOUT — scanned over the TRANSITIVE import graph");
  const gateAbs = BUILD.gates.map((g) => resolve(ROOT, g)).filter(isFile);
  const closures = new Map<string, string[]>(gateAbs.map((g) => [rel(g), closureOf(g)]));

  const reaches: string[] = [];
  for (const [gate, files] of closures) {
    for (const f of files) {
      for (const why of hits(readFileSync(f, "utf8"), REACH)) reaches.push(`${gate} → ${rel(f)}: ${why}`);
    }
  }
  for (const [gate, files] of closures) console.log(`     ${gate.padEnd(48)} ${String(files.length).padStart(4)} modules`);
  ok(
    "ZERO cross-repo reach across every build gate's import graph",
    reaches.length === 0,
    reaches.join("\n       ") || `${[...closures.values()].reduce((n, f) => n + f.length, 0)} module reads · ${REACH.length} reach patterns`,
  );

  const entryReaches = gateAbs.flatMap((g) => hits(readFileSync(g, "utf8"), ENTRY_ONLY).map((w) => `${rel(g)}: ${w}`));
  ok(
    "no build gate loads a COMPUTED dynamic specifier — the escape static resolution cannot see",
    entryReaches.length === 0,
    entryReaches.join(" · ") || `${gateAbs.length} entry scripts`,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · ★ THE CROSS-REPO CLASS — discovered from source, asserted DISJOINT from the build");
  //
  // This is the assertion that generalises. It does not ask whether a script is filed in the right
  // directory or carries the right comment; it reads every script in src/scripts and finds the ones
  // that reach. Then it demands that none of them is reachable from `build`. A new one, written by
  // someone who never read a line of this, is caught the moment it is wired in.
  const allScripts = readdirSync(resolve(ROOT, "src/scripts"), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".ts"))
    .map((d) => rel(resolve(d.parentPath ?? (d as unknown as { path: string }).path, d.name)))
    .sort();

  const crossRepo = allScripts.filter((s) => hits(readFileSync(resolve(ROOT, s), "utf8"), REACH).length > 0);
  console.log(`  scripts scanned: ${allScripts.length} · CROSS-REPO (reach found in source): ${crossRepo.length}`);
  for (const s of crossRepo) {
    const why = hits(readFileSync(resolve(ROOT, s), "utf8"), REACH);
    console.log(`     ${s}`);
    for (const w of why) console.log(`        ↳ ${w}`);
  }

  const buildGateSet = new Set(BUILD.gates);
  const wired = crossRepo.filter((s) => buildGateSet.has(s));
  ok(
    "★ NOT ONE cross-repo script is reachable from `build`",
    wired.length === 0,
    wired.join(",") || `${crossRepo.length} cross-repo scripts, ${BUILD.gates.length} build gates, disjoint`,
  );

  // The group directory is the documented home. Membership is not what the rule keys on — reach is —
  // but a member that is wired NOWHERE has silently stopped running, which is its own failure.
  const GROUP = "src/scripts/cross-repo";
  const groupFiles = existsSync(resolve(ROOT, GROUP))
    ? readdirSync(resolve(ROOT, GROUP)).filter((f) => f.endsWith(".ts")).map((f) => `${GROUP}/${f}`)
    : [];
  const referencedBy = (script: string) =>
    Object.entries(SCRIPTS)
      .filter(([, cmd]) => stepsOf(cmd).some((st) => st.gate === script))
      .map(([name]) => name);
  const orphans = groupFiles.filter((f) => referencedBy(f).length === 0);
  ok(
    `every file in ${GROUP}/ is wired into a script (re-homed, not deleted by accident)`,
    orphans.length === 0,
    orphans.join(",") || groupFiles.map((f) => `${f.split("/").pop()} → ${referencedBy(f).join("/")}`).join(" · ") || "(empty)",
  );
  const groupInBuild = groupFiles.filter((f) => buildGateSet.has(f));
  ok(
    `…and NOTHING in ${GROUP}/ is reachable from \`build\``,
    groupInBuild.length === 0,
    groupInBuild.join(",") || "structurally out",
  );
  const crossRepoScripts = [...new Set(crossRepo.flatMap(referencedBy))];
  ok(
    "the scripts that DO run the cross-repo class are themselves out of the build",
    crossRepoScripts.every((s) => !BUILD_SCRIPTS.has(s)),
    crossRepoScripts.filter((s) => BUILD_SCRIPTS.has(s)).join(",") || crossRepoScripts.join(" · ") || "none wired",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · DB + ENV REACH — declared with a reason, reconciled both ways");
  const reachesEnvOrDb = [...closures.entries()]
    .filter(([, files]) => files.some((f) => ENV_OR_DB_MODULES.includes(rel(f))))
    .map(([gate]) => gate)
    .sort();
  for (const g of reachesEnvOrDb) {
    const via = closures.get(g)!.filter((f) => ENV_OR_DB_MODULES.includes(rel(f))).map(rel);
    console.log(`     ${g}\n        ↳ imports ${via.join(" + ")}`);
  }
  const undeclared = reachesEnvOrDb.filter((g) => !ENV_OR_DB_ALLOWANCE[g]);
  ok(
    "every gate that imports the env module or the DB client is DECLARED, with a reason",
    undeclared.length === 0,
    undeclared.join(",") || reachesEnvOrDb.join(" · ") || "none reach",
  );
  const stale = Object.keys(ENV_OR_DB_ALLOWANCE).filter((g) => !reachesEnvOrDb.includes(g));
  ok(
    "…and no declaration describes a gate that no longer reaches (a stale allowance is a lie)",
    stale.length === 0,
    stale.join(",") || `${Object.keys(ENV_OR_DB_ALLOWANCE).length} declared`,
  );
  for (const [g, why] of Object.entries(ENV_OR_DB_ALLOWANCE)) console.log(`     ${g}\n        ↳ ${why}`);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · NETWORK — a build gate may talk to itself and to nothing else");
  const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::|\/|$)/;
  const urls = gateAbs.flatMap((g) =>
    [...readFileSync(g, "utf8").matchAll(/["'`](https?:\/\/[^"'`\s]*)["'`]/g)].map((m) => ({ gate: rel(g), url: m[1] })),
  );
  ok(
    "every URL literal in a build gate is loopback",
    urls.every((u) => LOOPBACK.test(u.url)),
    urls.filter((u) => !LOOPBACK.test(u.url)).map((u) => `${u.gate}: ${u.url}`).join(" · ") ||
      urls.map((u) => u.url).join(" · ") || "no URL literals",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · NEGATIVE CONTROLS — the rules, run against the real thing they were written for");
  const BOUNDARY = "src/scripts/cross-repo/verify-boundary-render.ts";
  const boundarySrc = existsSync(resolve(ROOT, BOUNDARY)) ? readFileSync(resolve(ROOT, BOUNDARY), "utf8") : "";
  ok(
    `the reach scan FIRES on ${BOUNDARY} (the gate that broke the deploy)`,
    hits(boundarySrc, REACH).length > 0,
    hits(boundarySrc, REACH).join(" · ") || "DID NOT FIRE — the scan is dead",
  );
  ok(
    "…and it is found by the class discovery, so §3 would catch it if it were wired in",
    crossRepo.includes(BOUNDARY),
    crossRepo.includes(BOUNDARY) ? "in the discovered class" : "MISSED — §3 is dead",
  );
  ok(
    "the entry-only scan FIRES on its computed dynamic import",
    hits(boundarySrc, ENTRY_ONLY).length > 0,
    hits(boundarySrc, ENTRY_ONLY).join(" · ") || "DID NOT FIRE",
  );
  // The exact line that shipped, asserted shape by shape — so no pattern can be softened past it.
  ok(
    "the scan catches the SHIPPED line verbatim, on all three of its shapes",
    hits(SHIPPED_LINE, REACH).length === 3,
    `${hits(SHIPPED_LINE, REACH).length}/3 patterns fired on \`${SHIPPED_LINE}\``,
  );
  ok(
    "…each shape independently, so a partial rewrite cannot slip through on the others' backs",
    REACH.every((t) => t.re.test(SHIPPED_LINE)) &&
      [F_SIBLING, F_ENV_READ, F_CWD_ESCAPE].every((frag) => REACH.some((t) => t.re.test(frag))),
    "sibling path · env directory · cwd escape",
  );
  ok(
    "the entry-only scan catches a COMPUTED dynamic import verbatim",
    hits(COMPUTED_IMPORT, ENTRY_ONLY).length === 1,
    `fired on \`${COMPUTED_IMPORT}\``,
  );
  ok(
    "…and does NOT bite a literal one (every static import in this build would else be a finding)",
    hits('await import("./catalogue/index.js")', ENTRY_ONLY).length === 0,
    "a string-literal specifier is statically resolvable and stays legal",
  );
  ok(
    "a backend-only gate is NOT flagged (the scan discriminates — reach, not mention)",
    hits(readFileSync(resolve(ROOT, "src/scripts/verify-phs-copy.ts"), "utf8"), REACH).length === 0,
    "verify-phs-copy.ts clean",
  );
  // Prose mention is deliberately not reach: five backend modules cite the frontend in comments.
  ok(
    "…and neither is a module that merely NAMES the frontend in a comment",
    hits(readFileSync(resolve(ROOT, "src/scoring/findings/verdicts.ts"), "utf8"), REACH).length === 0,
    "verdicts.ts cites Vytal-Frontend in its header and is clean",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · ★ THE CLAIM MUST BE TRUE — a script that SAYS it enforces at build time must RUN at build time");
  //
  // The mirror of §3. §3 asks "is anything WRONG reachable from build?"; this asks "is everything
  // PROMISED reachable from build?". Reuses BUILD.gates (§1), allScripts + crossRepo + referencedBy
  // (§3). No second resolver — the reachable set is the one the whole file already computed.
  // ⚠ NORMALISE BEFORE MATCHING, and this is not cosmetic — it is the bug the negative control below
  // caught on its first run. The comment that started this whole item WRAPS mid-phrase:
  //     // …asserts that against prisma/schema.prisma and fails
  //     // the build otherwise — so a newly-added column can never DEFAULT to cosmetic.
  // Raw, that reads "fails\n// the build" and no pattern matches. A claim split by a line break and a
  // comment marker is still a claim — arguably the likeliest form of one, since these are prose blocks.
  // Strip leading //, *, -- markers and collapse whitespace, then match.
  const normalise = (s: string) => s.replace(/^[ \t]*(?:\/\/+|\*+|--+)[ \t]?/gm, " ").replace(/\s+/g, " ");
  const claimHits = (s: string) => {
    const n = normalise(s);
    return BUILD_CLAIM.filter((t) => t.re.test(n)).map((t) => t.why);
  };

  // Every .ts under src/, excluding the generated client — the corpus for "claimed ABOUT it".
  const srcTree: string[] = [];
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "generated") walk(p); }
      else if (e.name.endsWith(".ts")) srcTree.push(p);
    }
  })(resolve(ROOT, "src"));

  /** Where a claim about `script` was found: its own source, and/or a ±CLAIM_WINDOW window elsewhere. */
  function claimsFor(script: string): string[] {
    const base = script.split("/").pop()!;
    const out = claimHits(readFileSync(resolve(ROOT, script), "utf8")).map((w) => `self ${w}`);
    for (const f of srcTree) {
      if (rel(f) === script) continue;
      const src = readFileSync(f, "utf8");
      if (!src.includes(base)) continue; // cheap reject before the line walk
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes(base)) continue;
        const w = claimHits(lines.slice(Math.max(0, i - CLAIM_WINDOW), i + CLAIM_WINDOW + 1).join(" "));
        if (w.length) out.push(`${rel(f)}:${i + 1} ${w.join("+")}`);
      }
    }
    return out;
  }

  const crossRepoSet = new Set(crossRepo); // §3 already proved these must NOT be in `build`
  const claimers = allScripts
    .filter((s) => !crossRepoSet.has(s))
    .map((s) => ({ script: s, why: claimsFor(s) }))
    .filter((c) => c.why.length > 0);

  console.log(`  scripts scanned: ${allScripts.length} · CLAIM build enforcement: ${claimers.length} · cross-repo exempt by construction: ${crossRepo.length}`);
  for (const c of claimers) {
    const state = buildGateSet.has(c.script) ? "IN BUILD" : BUILD_CLAIM_EXEMPT[c.script] ? "declared" : "★ UNWIRED";
    console.log(`     ${state.padEnd(9)} ${c.script}`);
    for (const w of c.why) console.log(`        ↳ ${w}`);
  }

  const brokenPromises = claimers.filter((c) => !buildGateSet.has(c.script) && !BUILD_CLAIM_EXEMPT[c.script]);
  ok(
    "★ every script CLAIMING build-time enforcement is reachable from `build` (or declared below)",
    brokenPromises.length === 0,
    brokenPromises.map((c) => `${c.script} — claims [${c.why.join("; ")}] but nothing in package.json runs it`).join("\n       ") ||
      `${claimers.filter((c) => buildGateSet.has(c.script)).length} wired · ${Object.keys(BUILD_CLAIM_EXEMPT).length} declared`,
  );
  // Reconciled the other way: a declaration that describes nothing is a lie, exactly as in §4.
  const staleClaims = Object.keys(BUILD_CLAIM_EXEMPT).filter(
    (s) => !isFile(resolve(ROOT, s)) || claimsFor(s).length === 0 || buildGateSet.has(s),
  );
  ok(
    "…and no declaration describes a script that is missing, no longer claims, or is now IN the build",
    staleClaims.length === 0,
    staleClaims.join(", ") || `${Object.keys(BUILD_CLAIM_EXEMPT).length} declarations, all live`,
  );
  for (const [s, why] of Object.entries(BUILD_CLAIM_EXEMPT)) console.log(`     ${s}\n        ↳ ${why}`);

  // Negative controls — the §6 discipline applied to this scan, so a dead predicate is visible.
  ok(
    "the claim predicate FIRES on the comment that started this (score-input-columns.ts)",
    claimHits(readFileSync(resolve(ROOT, "src/scoring/inputs/score-input-columns.ts"), "utf8")).length > 0,
    claimHits(readFileSync(resolve(ROOT, "src/scoring/inputs/score-input-columns.ts"), "utf8")).join(" · ") || "DID NOT FIRE — the scan is dead",
  );
  ok(
    "…and on a claim made ABOUT a script from another module (the shape a self-scan cannot see)",
    claimsFor("src/scripts/verify-t5-omission-keys.ts").some((w) => w.startsWith("src/ingestions/amfi/mf-analytics.ts")),
    claimsFor("src/scripts/verify-t5-omission-keys.ts").join(" · ") || "MISSED the mf-analytics citation",
  );
  ok(
    "…and does NOT fire on prose that merely mentions building",
    claimHits("this module is built from the manifest and the build order matters").length === 0,
    "mention is not a claim",
  );

  console.log(
    `\n${fail === 0 ? "✅ BUILD-GATE HYGIENE PASSES — the build reads this checkout and nothing else, and every promised gate runs" : `❌ ${fail} FAILURE(S) — a build gate is reaching outside the checkout, or a promised gate never runs`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE STRONGER FORM, IF THIS EVER PROVES INSUFFICIENT
//
// A source scan catches the shapes it knows. The airtight version removes the ACCIDENT instead: run
// the build gates from a mirrored checkout — a temp directory holding only this repo (symlink/junction
// src, node_modules, prisma; no .env, no siblings) — so a sibling-repo path resolved from cwd lands in
// a directory that does not exist ON THE AUTHOR'S MACHINE, exactly as on Railway. Then a cross-repo
// gate cannot pass locally at all, and the layout accident that hid this one is gone.
//
// It is not done here because the mirror itself becomes a build step that can fail for an environment
// reason on the deploy box, which is the class this file exists to remove. That trade is worth
// revisiting only if a reach shape gets past the scan above.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
