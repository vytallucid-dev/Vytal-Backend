// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// EVERY `await import()` IN src/ — RESOLVED AND LOADED, NOT READ.
//
// ★ WHY THIS FILE EXISTS. The src/ai/core/ move (C-2) had to rewrite four dynamic import specifiers:
//   two in the router's model path, two in the meta family. `tsc --noEmit` does not check the string
//   inside `await import()`. A rewrite that touched only `from "…"` compiles perfectly green and then
//   throws ERR_MODULE_NOT_FOUND at runtime, on the router's hot path, for real readers.
//
//   The rule this encodes, stated during that move and general beyond it:
//   ANYTHING INVISIBLE TO THE TYPE CHECKER AND ONLY EXERCISED AT RUNTIME NEEDS AN EXPLICIT CHECK
//   AFTER A MOVE, NOT JUST A GREEN BUILD.
//
// ★ IT LOADS THE MODULE AND ASSERTS THE BINDINGS. A path check alone would pass if the file existed
//   but the destructured names had changed. Each site's `const { a, b } = await import(x)` is parsed
//   for BOTH halves, and the check fails if `x` will not load or if `a`/`b` come back undefined.
//
// ★ NOT SCOPED TO THE MOVE. It sweeps every dynamic import in src/, so the next file to travel is
//   covered by a gate rather than by whoever remembers this class exists.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

// A plain walk rather than a glob dependency — this gate should not add a package to the tree.
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== "generated") walk(p, out); }
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail: string) {
  if (cond) { pass++; console.log(`  PASS  ${label} — ${detail}`); }
  else { fail++; console.log(`  FAIL  ${label} — ${detail}`); }
}

// A destructured dynamic import, and the bare form alike.
const SITE = /(?:(?:const|let|var)\s*\{([^}]*)\}\s*=\s*)?await\s+import\(\s*["'](\.[^"']+)["']\s*\)/g;

// ⚠ ONLY REAL CODE. A dynamic import written inside a COMMENT (this file's own header) or inside a
//   STRING (verify-build-gate-hygiene passes one as a fixture, to prove its matcher does not bite a
//   literal specifier) is documentation, not a call. Loading those reported three failures that were
//   entirely my scanner's — so positions are classified before matching, rather than after.
function codeMask(src: string): boolean[] {
  const mask = new Array<boolean>(src.length).fill(true);
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//" || two === "/*") {
      const end = two === "//"
        ? (src.indexOf("\n", i) === -1 ? src.length : src.indexOf("\n", i))
        : (src.indexOf("*/", i + 2) === -1 ? src.length : src.indexOf("*/", i + 2) + 2);
      for (let j = i; j < end; j++) mask[j] = false;
      i = end;
      continue;
    }
    if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const q = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== q) {
        if (src[j] === "\\") j++;
        else if (src[j] === "\n" && q !== "`") break;   // an unterminated quote is not a string
        j++;
      }
      for (let k = i; k <= Math.min(j, src.length - 1); k++) mask[k] = false;
      i = j + 1;
      continue;
    }
    i++;
  }
  return mask;
}

const files = walk("src").sort();

type Site = { file: string; line: number; spec: string; names: string[] };
const sites: Site[] = [];
const documented: string[] = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const mask = codeMask(src);
  for (const m of src.matchAll(SITE)) {
    const line = src.slice(0, m.index).split("\n").length;
    if (!mask[m.index!]) { documented.push(`${file}:${line} → ${m[2]}`); continue; }
    const names = (m[1] ?? "")
      .split(",")
      .map((n) => n.split(":")[0].trim())          // `{ a: b }` — the EXPORT is the left half
      .filter((n) => n.length > 0 && n !== "default");
    sites.push({ file, line, spec: m[2], names });
  }
}

console.log(`DYNAMIC IMPORTS — ${sites.length} live site(s) across ${files.length} source files\n`);
// Stated, not silent: what was classified as prose is listed, so a real import wrongly excluded is
// visible here rather than absent from the count.
if (documented.length > 0) {
  console.log(`  (${documented.length} in comments or string fixtures, not loaded: ${documented.join("; ")})\n`);
}

for (const s of sites) {
  // Resolve exactly as Node would: relative to the IMPORTING file, `.js` specifier → the `.ts` on disk.
  const abs = path.resolve(path.dirname(s.file), s.spec).replace(/\\/g, "/");
  const onDisk = abs.replace(/\.js$/, ".ts");
  const where = `${s.file}:${s.line} → ${s.spec}`;
  let mod: Record<string, unknown> | null = null;
  try {
    mod = (await import(pathToFileURL(onDisk).href)) as Record<string, unknown>;
  } catch (err) {
    // ⚠ NOT swallowed into a pass. A module that will not load is the exact failure this gate exists
    //   for, so the error is REPORTED and counted, never absorbed into an empty result.
    ok(where, false, `will not load — ${(err as Error).message.split("\n")[0].slice(0, 120)}`);
    continue;
  }
  const missing = s.names.filter((n) => mod![n] === undefined);
  ok(
    where,
    missing.length === 0,
    missing.length === 0
      ? `loads; ${s.names.length > 0 ? `exports ${s.names.join(", ")}` : "no named bindings destructured"}`
      : `loads but does NOT export: ${missing.join(", ")}`,
  );
}

// ── the four the move touched, named explicitly ────────────────────────────────────────────────────
// A sweep that found zero sites would print "ALL PASS" and prove nothing. These four are asserted to
// EXIST and to point into src/ai/core/ — so the gate fails if a later edit drops the site or reverts
// the path, rather than quietly having nothing left to check.
console.log("\nTHE FOUR THE src/ai/core/ MOVE REWROTE — asserted present, not merely swept\n");
for (const [file, mod] of [
  ["src/composition/families/meta-general-half.ts", "quota"],
  ["src/composition/families/meta-general-half.ts", "registry"],
  ["src/router/route.ts", "quota"],
  ["src/router/route.ts", "registry"],
] as const) {
  const hit = sites.find((s) => s.file === file && s.spec.endsWith(`ai/core/${mod}.js`));
  ok(`${file} still reaches ai/core/${mod}.js dynamically`, hit !== undefined,
     hit ? `line ${hit.line}` : "SITE MISSING or not repointed at src/ai/core/");
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
