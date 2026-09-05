// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONTROL-CHARACTER GATE — the scar that has now bitten five times, ended.
//
// ── ★ THE DEFECT, AND WHY IT IS ONLY EVER FOUND BY ACCIDENT ───────────────────────────────────────
// A `\b` written into a regex literal THROUGH TOOLING — a Python heredoc, a `sed`, an editor macro —
// arrives in the file as a literal **0x08 BACKSPACE**. The regex then contains a control character
// where a word boundary was intended, and matches nothing at all. It is invisible in every listing,
// every diff and every code review, because a terminal renders 0x08 as nothing or as a cursor move.
//
//   `question-shape.ts`'s header records the first FOUR occurrences and answers them locally, by
//   refusing regex literals in favour of word-membership sets. That fixed those four call sites and
//   nothing else.
//
//   ⚠ THE FIFTH LANDED AT PHASE 2 · BATCH 2, IN `router/route.ts`, AND IT CHANGED A CLASSIFICATION.
//   The health lens pattern was widened so that "why did INDUSINDBK's score fall" would narrow to
//   health; the `\b`s became 0x08, the alternation matched nothing, and the classifier kept returning
//   `lens: null` — so A · Attribution never saw the question and it fell to the planner. The edit
//   looked correct in the file. It was found only because the routing probe was re-run afterwards and
//   still showed the old answer.
//
// ── ★ WHY A SCAN AND NOT MORE DISCIPLINE ──────────────────────────────────────────────────────────
// Five occurrences across five months is not a discipline problem; it is a class of defect that
// discipline cannot see. A scan of the source tree costs milliseconds and ends the class — and unlike
// the local fix, it protects the code nobody thought to protect.
//
// ── ⚠ WHAT COUNTS AS A CONTROL CHARACTER HERE, AND WHY CARRIAGE RETURN DOES NOT ───────────────────
// Everything below 0x20 EXCEPT tab (0x09), newline (0x0A) and CARRIAGE RETURN (0x0D), plus DEL (0x7F).
//
// ⚠ THE FIRST DRAFT INCLUDED CR ON THE ASSUMPTION THAT THIS TREE IS LF-ONLY. IT IS NOT, AND THE GATE
//   MEASURED IT: **1,256 CRLF files, 220 LF files, ZERO mixed.** Every file is internally consistent;
//   the LF minority is essentially the composition layer built across Phases 1–2. Including CR turned
//   a gate about an invisible defect into 237,763 hits across 1,257 files — a line-ending policy
//   argument nobody asked for, which would have buried the one signal that matters under a quarter of
//   a million false ones.
//
// ★ WHAT IS A REAL DEFECT IS A FILE THAT MIXES THEM, and that is asserted separately below. A
//   half-CRLF file breaks byte-level diffs and the gates that read raw source. Measured: zero today,
//   which makes it a true green with a real control rather than a rule nobody has tested.
//
// ⚠ AND IT SCANS EVERY `.ts`/`.tsx` UNDER `src/`, NOT A LIST. A gate keyed to the files somebody
//   remembered would have missed `route.ts`, which is exactly the file the fifth one landed in.
//
// PURE. No DB, no model, no network.
//   npx tsx src/scripts/verify-source-control-chars.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src";

/** Everything below 0x20 except tab and newline, plus DEL. CR included — this tree is LF-only. */
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * ⚠ A FRESH INSTANCE PER USE, NEVER A SHARED `/g/` REGEX — the first draft of this file shared one and
 *   hung the process until V8 ran out of heap.
 *
 *   A global regex carries `lastIndex` as MUTABLE STATE. The scan loop advances it with `.exec()`
 *   while the line-context formatter calls `.replace()` on the same object — and `String.replace` with
 *   a global regex resets `lastIndex` to 0 when it finishes. So every hit sent the outer loop back to
 *   the start of the line and pushed the same match forever: `FATAL ERROR: Ineffective mark-compacts
 *   near heap limit`.
 *
 *   Fitting, for a gate about invisible state inside a regex.
 */
const controlG = (): RegExp => /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Reader-facing names for the ones that actually happen, so a failure says what to look for. */
const NAMED: Record<number, string> = {
  0x00: "NUL", 0x07: "BEL", 0x08: "BACKSPACE — this is the `\\b`-through-tooling defect",
  0x0b: "VERTICAL TAB", 0x0c: "FORM FEED",
  0x1b: "ESC", 0x7f: "DEL",
};

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  c ? pass++ : fail++;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === "generated") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

console.log("═".repeat(100));
console.log("SOURCE CONTROL CHARACTERS — the `\\b` → 0x08 scar, five occurrences, ended");
console.log("═".repeat(100));

const files = walk(ROOT);
interface Hit { file: string; line: number; col: number; code: number; context: string }
const hits: Hit[] = [];

for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (!CONTROL.test(src)) continue;
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    const scan = controlG();
    while ((m = scan.exec(line)) !== null) {
      hits.push({
        file: relative(".", f).replace(/\\/g, "/"),
        line: i + 1,
        col: m.index + 1,
        code: line.charCodeAt(m.index),
        // ⚠ THE CONTEXT IS ESCAPED BEFORE PRINTING. Echoing the raw line would put the control
        //   character straight into the terminal, where it is invisible — reproducing the very
        //   problem the gate exists to surface.
        context: line.slice(Math.max(0, m.index - 32), m.index + 32).replace(controlG(), (c) =>
          `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`),
      });
    }
  });
}

ok(`no control character in any source file under ${ROOT}/`, hits.length === 0,
  hits.length === 0
    ? `${files.length} files scanned, clean`
    : `${hits.length} in ${new Set(hits.map((h) => h.file)).size} file(s)`);

for (const h of hits.slice(0, 20)) {
  const name = NAMED[h.code] ?? `0x${h.code.toString(16).padStart(2, "0")}`;
  console.log(`     ✗ ${h.file}:${h.line}:${h.col}  ${name}`);
  console.log(`       …${h.context}…`);
}
if (hits.length > 20) console.log(`     … and ${hits.length - 20} more`);

// ── LINE ENDINGS: CONSISTENT PER FILE ─────────────────────────────────────────────────────────────
//
// ★ NOT "ALL ONE WAY" — "ALL ONE WAY WITHIN A FILE". Measured, this tree is 1,256 CRLF and 220 LF and
//   nothing is broken by that; a file that mixes them IS broken, because every byte-level gate and
//   every diff then reads noise. This is the assertion the CR exclusion above leaves room for.
console.log("\n" + "─".repeat(100));
{
  const mixed: { file: string; crlf: number; lf: number }[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const crlf = (src.match(/\r\n/g) ?? []).length;
    const total = (src.match(/\n/g) ?? []).length;
    if (crlf > 0 && crlf !== total) {
      mixed.push({ file: relative(".", f).replace(/\\/g, "/"), crlf, lf: total - crlf });
    }
  }
  ok("no source file mixes CRLF and LF line endings", mixed.length === 0,
    mixed.length === 0
      ? `${files.length} files, each internally consistent`
      : mixed.slice(0, 5).map((m) => `${m.file} (${m.crlf} CRLF, ${m.lf} LF)`).join(" · "));
}

// ── THE NEGATIVE CONTROL ──────────────────────────────────────────────────────────────────────────
//
// ⚠ WITHOUT THIS THE GATE IS A GREEN TICK OVER A CLEAN TREE AND NOTHING ELSE. A scan that has never
//   been shown to fire is indistinguishable from a scan whose pattern is wrong — and the pattern here
//   is the one thing that cannot be eyeballed, because the characters it looks for are invisible.
console.log("\n" + "─".repeat(100));
{
  // Built by CODE POINT, never typed — a literal in this file would be the defect it is testing for.
  const backspace = String.fromCharCode(0x08);
  const broken = `const re = /${backspace}its score${backspace}/i;`;
  ok("NEGATIVE CONTROL · a 0x08 written as `\\b`-through-tooling is caught",
    CONTROL.test(broken), `pattern fires on the exact shape that shipped in route.ts`);

  // ⚠ AND A CARRIAGE RETURN MUST **NOT** BE CAUGHT — 1,256 files legitimately carry them. This is the
  //   control that stops someone "tightening" the pattern later and burying the real signal again.
  const cr = `const x = 1;${String.fromCharCode(0x0d)}\nconst y = 2;`;
  ok("NEGATIVE CONTROL · a CRLF file is NOT flagged — the tree is 1,256 CRLF to 220 LF",
    !CONTROL.test(cr), "line endings are a per-file convention, not a control-character defect");

  // ★ AND THE MIXED CHECK MUST FIRE ON A FILE THAT MIXES THEM.
  const halfAndHalf = "a\r\nb\nc\r\n";
  const crlfCount = (halfAndHalf.match(/\r\n/g) ?? []).length;
  const nlCount = (halfAndHalf.match(/\n/g) ?? []).length;
  ok("NEGATIVE CONTROL · a file mixing CRLF and LF is caught",
    crlfCount > 0 && crlfCount !== nlCount, `${crlfCount} CRLF against ${nlCount} newlines`);

  // ★ AND IT MUST BE SILENT ON WHAT SOURCE LEGITIMATELY CONTAINS. A gate that fires on tabs or on the
  //   em dashes and box-drawing characters this codebase's comments are full of would be turned off
  //   within a day, and the class would come back.
  const fine = "\tconst s = \"— ★ ⚠ ═══ • … 'quotes' \\u2014\";\n";
  ok("NEGATIVE CONTROL · silent on tabs, newlines and the comment glyphs this tree uses",
    !CONTROL.test(fine), "tab, newline, em dash, ★, ⚠, box-drawing all pass");
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\n⚠ A CONTROL CHARACTER IN SOURCE IS ALMOST CERTAINLY A REGEX ESCAPE THAT WENT THROUGH");
  console.log("  TOOLING. Rewrite the line with a direct edit rather than a script, or replace the");
  console.log("  regex with a word-membership test — see `router/question-shape.ts`'s header.");
  process.exit(1);
}
