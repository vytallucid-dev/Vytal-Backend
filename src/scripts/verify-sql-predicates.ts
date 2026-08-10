// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SQL-PREDICATE SPLICE GATE — the suppression fragments, and how every raw-SQL caller splices them.
//
// ── ★ THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────────
// `retiredKeysSqlPredicate` and `notCoveredKeysSqlPredicate` return SQL TEXT typed as `string`. Whether
// that text reaches Postgres AS SQL depends entirely on which raw API the caller is feeding, and the
// two call shapes are visually identical:
//
//   $queryRawUnsafe(PLAIN_TEMPLATE)   `${pred}` splices SQL text.                                  ✅
//   $queryRaw`… ${pred} …`            TAGGED template ⇒ `${pred}` BINDS A PARAMETER. Postgres gets
//                                     `WHERE $1` with a text value where a boolean belongs and
//                                     rejects the statement with 22P02.                            ⚠
//
// relational/reader-context.ts shipped the second form on 2026-08-02 and the book-wide echo census
// failed on every authenticated request for seven days. Nothing surfaced: the census catches its own
// error, returns null, and the UE family is dropped by design — a card that renders four entries
// instead of five looks exactly like a card that had nothing else to say. `string` cannot enforce the
// distinction and TypeScript cannot see it, so it is enforced here.
//
// ── WHAT THIS GATE CHECKS ──────────────────────────────────────────────────────────────────────────
//   1 · FRAGMENT SHAPE — both helpers emit exactly the fragment their contract promises, over the full
//       live key list, with no key able to break out of its quoting.
//   2 · SPLICE MECHANICS — reproduced against the REAL Prisma.Sql composer, not asserted from memory:
//       the unwrapped form is shown to produce a bound parameter and the Prisma.raw form is shown to
//       produce SQL. This is the actual defect, executed.
//   3 · CALL SITES — every reference to either helper anywhere in src/ is located, classified as
//       inside-a-tagged-template or not, and required to carry Prisma.raw exactly when it must.
//   4 · BOUNDARY ROSTER — the known raw-SQL boundaries still apply BOTH suppressions, and a new file
//       reaching for either helper fails until it is added here deliberately.
//
// PURE. No DB.
//   npx tsx src/scripts/verify-sql-predicates.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Prisma } from "../generated/prisma/client.js";
import { RETIRED_FINDING_KEYS, retiredKeysSqlPredicate } from "../catalogue/retired-findings.js";
import { NOT_COVERED_KEY_PREFIX, notCoveredKeysSqlPredicate } from "../catalogue/not-covered.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

const SRC = join(process.cwd(), "src");
const posix = (p: string) => p.split(sep).join("/");

// ═════════════════════════════════════════════════════════════════════════════════════════════════
rule("1 · FRAGMENT SHAPE — the text each helper emits");

const retired = retiredKeysSqlPredicate("p.pattern_key");
const notCovered = notCoveredKeysSqlPredicate("p.pattern_key");

ok(
  "retiredKeysSqlPredicate emits `<column> NOT IN (<quoted list>)`",
  /^p\.pattern_key NOT IN \('.+'\)$/.test(retired),
  retired.length > 90 ? retired.slice(0, 90) + "…" : retired,
);
ok(
  "…listing every live retired key, and only those",
  RETIRED_FINDING_KEYS.every((k) => retired.includes(`'${k}'`)) &&
    (retired.match(/'/g)?.length ?? 0) === RETIRED_FINDING_KEYS.length * 2,
  `${RETIRED_FINDING_KEYS.length} keys`,
);
// The fragment is spliced as SQL, so a key carrying a quote or a backslash would end the literal and
// change the statement. The keys are compile-time constants — this asserts they stay that way.
const unsafeKeys = RETIRED_FINDING_KEYS.filter((k) => !/^[a-z0-9_]+$/i.test(k));
ok(
  "no retired key can break out of its quoting (identifier charset only)",
  unsafeKeys.length === 0,
  unsafeKeys.join(", ") || "all [A-Za-z0-9_]",
);
ok(
  "notCoveredKeysSqlPredicate emits `<column> NOT LIKE '<prefix>%'` on the declared prefix",
  notCovered === `p.pattern_key NOT LIKE '${NOT_COVERED_KEY_PREFIX}%'`,
  notCovered,
);
ok(
  "both helpers honour the column they are given (no hardcoded column)",
  retiredKeysSqlPredicate("x.k").startsWith("x.k ") && notCoveredKeysSqlPredicate("x.k").startsWith("x.k "),
  "parameterised on column",
);

// ═════════════════════════════════════════════════════════════════════════════════════════════════
rule("2 · ★ SPLICE MECHANICS — the defect itself, reproduced against the real Prisma.Sql composer");
//
// Not a string assertion about what Prisma "would" do. `Prisma.sql` is the exact tagged-template
// composer `$queryRaw` uses, and its output object exposes both halves of the split: `.values` is what
// gets sent as bind parameters, `.sql` is the statement text. If the predicate lands in `.values` the
// query is already broken, whatever the SQL around it looks like.

const bound = Prisma.sql`SELECT 1 FROM score_patterns p WHERE ${retired}`;
ok(
  "⚠ UNWRAPPED in a tagged template: the predicate is BOUND, not spliced (this is the 22P02 bug)",
  bound.values.length === 1 && bound.values[0] === retired && !bound.sql.includes("NOT IN"),
  `values=[${bound.values.length}], sql="${bound.sql.trim()}"`,
);

const spliced = Prisma.sql`SELECT 1 FROM score_patterns p WHERE ${Prisma.raw(retired)}`;
ok(
  "✅ Prisma.raw in a tagged template: the predicate becomes SQL, nothing is bound",
  spliced.values.length === 0 && spliced.sql.includes("NOT IN") && spliced.sql.includes("p.pattern_key"),
  `values=[${spliced.values.length}]`,
);

// Both suppressions together, plus a genuine user-supplied value — the real echo-census shape. The
// value must STILL bind (it is user input and must never be spliced), while both predicates must not.
const userId = "00000000-0000-0000-0000-000000000000";
const census = Prisma.sql`
  SELECT p.pattern_key FROM score_patterns p JOIN holdings h ON h.user_id = ${userId}
  WHERE ${Prisma.raw(retired)} AND ${Prisma.raw(notCovered)}`;
ok(
  "the composed census keeps user input BOUND while both predicates are SQL",
  census.values.length === 1 &&
    census.values[0] === userId &&
    census.sql.includes("NOT IN") &&
    census.sql.includes("NOT LIKE"),
  `values=[${census.values.length}] (userId only)`,
);
// A bound parameter placeholder inside the predicate region would mean a predicate leaked into values.
ok(
  "no placeholder sits where a predicate belongs in the composed statement",
  !/WHERE\s+\$\d/.test(census.sql) && !/AND\s+\$\d/.test(census.sql),
  census.sql.replace(/\s+/g, " ").trim().slice(-88),
);

// ═════════════════════════════════════════════════════════════════════════════════════════════════
rule("3 · ★ CALL SITES — every reference in src/, classified and held to the splice rule");

const HELPERS = ["retiredKeysSqlPredicate", "notCoveredKeysSqlPredicate"] as const;

/** Every .ts file under src/, excluding the generated client (megabytes, and not ours). */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "generated") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * The character ranges of every TAGGED raw-SQL template literal in a source file.
 *
 * Tagged is the whole point: `$queryRawUnsafe(...)` takes a finished string and is matched here only
 * so it is NOT mistaken for a tagged site. Walks `${…}` depth so a nested `Prisma.sql\`…\`` (as in
 * scoring/findings/trajectory/load-series.ts) does not close the outer template early.
 */
function taggedSqlRanges(src: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  // $queryRaw / $executeRaw immediately followed (past any generic) by a backtick = tagged template.
  // $queryRawUnsafe / $executeRawUnsafe take a parenthesised string and never match this.
  const opener = /\$(?:queryRaw|executeRaw)(?!Unsafe)\s*(?:<[^`<>]*(?:<[^`<>]*>[^`<>]*)*>)?\s*`/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(src)) !== null) {
    const start = m.index + m[0].length - 1; // index of the opening backtick
    let i = start + 1;
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "\\") { i++; continue; }
      if (c === "$" && src[i + 1] === "{") { depth++; i++; continue; }
      if (c === "}" && depth > 0) { depth--; continue; }
      if (c === "`" && depth === 0) break;
    }
    ranges.push({ start, end: i });
    opener.lastIndex = i; // never re-scan inside a template we have already consumed
  }
  return ranges;
}

/** Is this offset inside a `Prisma.raw( … )` call? Scans back for the opener, tracking paren depth. */
function insidePrismaRaw(src: string, at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0 && at - i < 400; i--) {
    const c = src[i];
    if (c === ")") depth++;
    else if (c === "(") {
      if (depth === 0) return /Prisma\.raw\s*$/.test(src.slice(Math.max(0, i - 20), i));
      depth--;
    }
  }
  return false;
}

type Site = { file: string; line: number; helper: string; tagged: boolean; wrapped: boolean };
const sites: Site[] = [];

/** Files the scan must not treat as call sites, each for a different structural reason. */
const NOT_A_CALL_SITE = new Set([
  // The definitions. `export function retiredKeysSqlPredicate(` matches the call regex but declares
  // the helper rather than splicing it — and the declaration files touch no SQL.
  "src/catalogue/retired-findings.ts",
  "src/catalogue/not-covered.ts",
  // This gate. It carries BOTH the correct and the defective form on purpose (the §2 negative control
  // and the §3 scanner self-test probe), so scanning itself would report its own fixtures as defects.
  "src/scripts/verify-sql-predicates.ts",
]);

for (const file of walk(SRC)) {
  const src = readFileSync(file, "utf8");
  if (!HELPERS.some((h) => src.includes(h))) continue;
  const rel = posix(relative(process.cwd(), file));
  if (NOT_A_CALL_SITE.has(rel)) continue;
  const ranges = taggedSqlRanges(src);
  for (const helper of HELPERS) {
    // Calls only — `helper(` — so the import statement and prose mentions are not counted as sites.
    const re = new RegExp(`\\b${helper}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const at = m.index;
      // Belt and braces for the declaration case, in case a helper is ever defined outside the two
      // catalogue files above.
      if (/\b(?:function|const|let|var)\s+$/.test(src.slice(Math.max(0, at - 24), at))) continue;
      sites.push({
        file: rel,
        line: src.slice(0, at).split("\n").length,
        helper,
        tagged: ranges.some((r) => at > r.start && at < r.end),
        wrapped: insidePrismaRaw(src, at),
      });
    }
  }
}

ok("the scanner found call sites at all (a silent zero would pass everything below)", sites.length > 0, `${sites.length} sites`);

// Self-test: the scanner must be able to see the shape it exists to catch, in both directions.
const probe = [
  "const a = await prisma.$queryRaw`WHERE ${retiredKeysSqlPredicate('c')}`;",
  "const b = await prisma.$queryRaw<{x:string}[]>`WHERE ${Prisma.raw(notCoveredKeysSqlPredicate('c'))}`;",
  "const c = `WHERE ${retiredKeysSqlPredicate('c')}`; await prisma.$queryRawUnsafe(c);",
].join("\n");
const probeRanges = taggedSqlRanges(probe);
const at = (needle: string) => probe.indexOf(needle);
ok(
  "scanner self-test: catches a bare helper inside a tagged template",
  probeRanges.some((r) => at("retiredKeysSqlPredicate('c')}`;") > r.start && at("retiredKeysSqlPredicate('c')}`;") < r.end) &&
    !insidePrismaRaw(probe, at("retiredKeysSqlPredicate('c')}`;")),
  "tagged + unwrapped ⇒ flagged",
);
ok(
  "scanner self-test: accepts a Prisma.raw-wrapped helper inside a tagged template",
  insidePrismaRaw(probe, at("notCoveredKeysSqlPredicate('c')")),
  "tagged + wrapped ⇒ clean",
);
ok(
  "scanner self-test: does not mistake a $queryRawUnsafe plain literal for a tagged template",
  !probeRanges.some((r) => at("retiredKeysSqlPredicate('c')}`; await") > r.start && at("retiredKeysSqlPredicate('c')}`; await") < r.end),
  "plain literal ⇒ not tagged",
);

// ★ THE RULE. Inside a tagged template the fragment MUST be Prisma.raw'd, or it binds and dies 22P02.
const unwrapped = sites.filter((s) => s.tagged && !s.wrapped);
ok(
  "every helper call inside a tagged $queryRaw/$executeRaw template is wrapped in Prisma.raw",
  unwrapped.length === 0,
  unwrapped.length
    ? unwrapped.map((s) => `${s.file}:${s.line} ${s.helper}() is BOUND, not spliced — wrap it in Prisma.raw()`).join(" · ")
    : `${sites.filter((s) => s.tagged).length} tagged site(s), all wrapped`,
);

// The inverse: a Prisma.Sql object interpolated into a PLAIN template literal stringifies to junk, so
// Prisma.raw outside a tagged template is equally a defect.
const strayRaw = sites.filter((s) => !s.tagged && s.wrapped);
ok(
  "no helper call is Prisma.raw-wrapped outside a tagged template (it would stringify, not splice)",
  strayRaw.length === 0,
  strayRaw.map((s) => `${s.file}:${s.line}`).join(" · ") || "none",
);

for (const s of sites) {
  console.log(`     · ${s.file}:${s.line} ${s.helper}() ${s.tagged ? (s.wrapped ? "tagged+Prisma.raw ✅" : "tagged+BARE ❌") : "plain string ✅"}`);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
rule("4 · BOUNDARY ROSTER — the known raw-SQL readers, and nothing else, reach for these helpers");
//
// Both suppressions are per-boundary and explicit BY DESIGN (retired-findings.ts rejects a Prisma
// client extension precisely because it would miss these raw readers). Explicit means a boundary can
// quietly lose one, so the roster is pinned: a file that drops a suppression fails, and a NEW file
// picking up either helper fails until it is added here with its splice form confirmed.

// `both` marks a REAL read boundary against score_patterns, where dropping either suppression is a
// correctness defect. A gate that exercises one helper in isolation is not held to it.
const ROSTER: { file: string; tagged: boolean; both: boolean; why: string }[] = [
  { file: "src/relational/base-rates.ts", tagged: false, both: true, why: "boundary 7 of 9 — universe base rates, plain template → $queryRawUnsafe" },
  { file: "src/relational/reader-context.ts", tagged: true, both: true, why: "boundary 8 of 9 — book-wide echo census, tagged $queryRaw → needs Prisma.raw" },
  { file: "src/scripts/verify-not-covered.ts", tagged: false, both: false, why: "the not-covered gate — asserts that helper's fragment text only" },
];

const rosterFiles = new Set(ROSTER.map((r) => r.file));
const seenFiles = new Set(sites.map((s) => s.file));

const strangers = [...seenFiles].filter((f) => !rosterFiles.has(f));
ok(
  "no unrostered file calls a suppression predicate",
  strangers.length === 0,
  strangers.length
    ? `${strangers.join(", ")} — add to ROSTER in this file once its splice form is confirmed`
    : `${seenFiles.size} rostered file(s)`,
);

for (const r of ROSTER) {
  const mine = sites.filter((s) => s.file === r.file);
  const helpers = new Set(mine.map((s) => s.helper));
  if (r.both) {
    ok(
      `${r.file} applies BOTH suppressions`,
      HELPERS.every((h) => helpers.has(h)),
      HELPERS.filter((h) => !helpers.has(h)).map((h) => `MISSING ${h}`).join(", ") || r.why,
    );
  } else {
    ok(`${r.file} still reaches a suppression helper`, mine.length > 0, r.why);
  }
  if (mine.length === 0) continue;
  ok(
    `${r.file} splices them in the ${r.tagged ? "TAGGED (Prisma.raw)" : "PLAIN (bare string)"} form`,
    mine.every((s) => s.tagged === r.tagged && s.wrapped === r.tagged),
    mine.map((s) => `${s.line}:${s.tagged ? "tagged" : "plain"}${s.wrapped ? "+raw" : ""}`).join(" "),
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log(
  `\n${"═".repeat(100)}\nSQL PREDICATE SPLICE GATE — ${fail === 0 ? "all checks passed" : `${fail} FAILURE(S)`}\n${"═".repeat(100)}`,
);
process.exit(fail === 0 ? 0 : 1);
