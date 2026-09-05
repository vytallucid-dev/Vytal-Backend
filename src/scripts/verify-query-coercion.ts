// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUERY-PARAM COERCION GATE — `z.coerce.boolean()` must not reach a query parser.
//
// ── ★ THE DEFECT THIS EXISTS FOR, MEASURED NOT IMAGINED (T-0, 2026-08-31) ─────────────────────────
// `GET /admin/miss-log` parsed its `allSources` flag with `z.coerce.boolean()`. That coerces by JS
// truthiness, and every query-string value is a STRING — so `?allSources=false` arrived as the
// non-empty string "false" and became `true`. The caller who explicitly asked to KEEP the §6.5
// model/lexical split got it switched OFF, silently, by asking for it. Found on the live run.
//
// ── ★ WHY A GATE AND NOT A NOTE ──────────────────────────────────────────────────────────────────
// Twelve controllers already parse boolean query params correctly and identically — `=== "true"`
// (funds, events, alerts, holdings, results-list, …). The convention was never written down anywhere;
// it survived by everyone independently doing the obvious thing. `z.coerce.boolean()` reads like the
// modern, tidier version of exactly that, which is what makes it the shape someone reaches for while
// "cleaning up" — and it is wrong in the one direction nobody tests, because a flag defaulting ON
// looks identical to a flag correctly requested ON.
//
// §6.5's own words about the cache's two rules apply here: enforced in code rather than by convention.
//
// ── ★ SCOPE: QUERY PARSERS ONLY ──────────────────────────────────────────────────────────────────
// `z.boolean()` on a JSON body is CORRECT and untouched — a JSON body carries real booleans. This
// gate looks only at files that parse `req.query`, which is where the string/boolean confusion lives.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/controllers", "src/routes"];
const BANNED = /z\s*\.\s*coerce\s*\.\s*boolean\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const offenders: { file: string; line: number; text: string }[] = [];
let scanned = 0;
let queryParsers = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    scanned++;
    // Only files that actually read the query string can have this defect.
    if (!/req\s*\.\s*query/.test(src)) continue;
    queryParsers++;
    src.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      // ⚠ SKIP COMMENTS, OR THE GATE FLAGS ITS OWN EXPLANATION. Caught on this gate's first run:
      //   the miss-log controller carries a doc comment naming `z.coerce.boolean()` as the thing NOT
      //   to use, and a naive line scan reported that as the defect. A gate whose only finding is the
      //   note describing the defect is a gate nobody will keep.
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (BANNED.test(line)) offenders.push({ file, line: i + 1, text: t });
    });
  }
}

console.log("★ QUERY-PARAM COERCION GATE");
console.log(`   scanned ${scanned} files under ${ROOTS.join(", ")} · ${queryParsers} parse req.query`);

if (offenders.length === 0) {
  console.log("   ✅ no z.coerce.boolean() in a query parser — booleans stay explicit ('true' / '1')");
  process.exit(0);
}

console.log(`   ❌ ${offenders.length} use(s) of z.coerce.boolean() in a query parser:\n`);
for (const o of offenders) {
  console.log(`      ${o.file}:${o.line}`);
  console.log(`        ${o.text}`);
}
console.log(`
   z.coerce.boolean() coerces by JS truthiness, and every query value is a string — so "false"
   becomes true and a caller who explicitly opts OUT is silently opted IN.

   Use instead:
       flag: z.enum(["true", "false", "1", "0"]).optional()
              .transform((v) => v === "true" || v === "1"),
   or the codebase's existing plain form:
       const flag = String(req.query.flag ?? "") === "true";

   (z.boolean() on a JSON BODY is fine and is not what this gate checks.)
`);
process.exit(1);
