// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AN ALIAS TWO ENTRIES CLAIM IS A WRONG DEFINITION WAITING TO SHIP.
//
// ── ⚠ WHY THIS GATE EXISTS ────────────────────────────────────────────────────────────────────────
// `MetricGloss.aliases` was added because readers type acronyms and the lookup matched only `label`
// and `key` — "what is ROE" returned "we hold no written definition for it yet" while `returnOnEquity`
// sat fully authored in the same registry. The fix reaches authored content, and it introduces exactly
// one new failure mode: an acronym that names two metrics.
//
// `returnOnAssetsQuarterly` and `returnOnAssetsAnnual` are both "ROA". `grossNpaAmount` and
// `grossNpaRatio` both answer to "GNPA". `costToIncomeRatio` and `costToIncomeAnnual` both answer to
// "cost-to-income". Aliasing either side of those pairs would answer a question about the full year
// with a quarter — and every figure in the answer would be real, which is what makes it dangerous.
//
// ── ★ SO THE LOOKUP REFUSES ON A TIE, AND THIS GATE STOPS THE TIE BEING CREATED ────────────────────
// `searchVocabularies` returns nothing when two entries match at the same length, which is safe but
// silent. This is the loud half: a duplicated alias fails the build with both claimants named.
//
// ⚠ IT ALSO FORBIDS AN ALIAS THAT COLLIDES WITH ANOTHER ENTRY'S LABEL OR KEY, because those are
//   matched by the same loop — an alias is not a separate namespace.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { QUARTER_METRIC_GLOSSES } from "../catalogue/quarter-metrics.js";
import { ANNUAL_METRIC_GLOSSES } from "../catalogue/annual-metrics.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = ""): void => {
  if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); }
};

type G = { label: string; meaning: string; doesntMean: string; aliases?: readonly string[] };
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function main(): void {
  console.log("★ METRIC ALIASES — one name, one metric\n");
  const all = new Map<string, G>();
  for (const [k, v] of Object.entries(QUARTER_METRIC_GLOSSES as Record<string, G>)) all.set(k, v);
  for (const [k, v] of Object.entries(ANNUAL_METRIC_GLOSSES as Record<string, G>)) all.set(k, v);

  ok("there are glosses to check", all.size > 0, `${all.size} entries`);

  // ── 1 · every NAME a metric answers to, and who claims it ─────────────────────────────────────
  const claims = new Map<string, string[]>();
  for (const [key, g] of all) {
    for (const n of [g.label, key, ...(g.aliases ?? [])]) {
      const k = norm(n);
      if (!k) continue;
      claims.set(k, [...(claims.get(k) ?? []), key]);
    }
  }
  const dupes = [...claims].filter(([, owners]) => new Set(owners).size > 1);
  // ⚠ THE TWO PRE-EXISTING LABEL COLLISIONS ARE NAMED, NOT SILENTLY TOLERATED. Both are one reader
  //   label used by two INDUSTRY FAMILIES for their own cost line, so the honest fix needs the
  //   family in the lookup, not an alias. Recorded here so the gate guards everything else.
  const KNOWN_LABEL_COLLISIONS = new Set(["total costs", "running costs"]);
  const fresh = dupes.filter(([name]) => !KNOWN_LABEL_COLLISIONS.has(name));
  ok("no name is claimed by two metrics", fresh.length === 0,
    fresh.length
      ? fresh.map(([n, o]) => `"${n}" claimed by ${[...new Set(o)].join(" + ")}`).join(" · ")
      : `${claims.size} distinct names across ${all.size} metrics`);

  ok("the known label collisions are still exactly the two industry-family pairs",
    dupes.length === fresh.length + KNOWN_LABEL_COLLISIONS.size,
    [...KNOWN_LABEL_COLLISIONS].join(", "));

  // ── 2 · an alias must not be blank, and must not merely restate the label ─────────────────────
  const junk: string[] = [];
  for (const [key, g] of all)
    for (const a of g.aliases ?? []) {
      if (!norm(a)) junk.push(`${key}: blank alias`);
      if (norm(a) === norm(g.label)) junk.push(`${key}: alias "${a}" repeats the label`);
    }
  ok("no alias is blank or a restatement of its own label", junk.length === 0, junk.join(" · ") || "clean");

  // ── 3 · NEGATIVE CONTROLS ─────────────────────────────────────────────────────────────────────
  const probe = (entries: Record<string, G>): number => {
    const c = new Map<string, string[]>();
    for (const [key, g] of Object.entries(entries))
      for (const n of [g.label, key, ...(g.aliases ?? [])]) c.set(norm(n), [...(c.get(norm(n)) ?? []), key]);
    return [...c].filter(([, o]) => new Set(o).size > 1).length;
  };
  const bad: Record<string, G> = {
    a: { label: "Alpha", meaning: "m", doesntMean: "d", aliases: ["ROA"] },
    b: { label: "Beta", meaning: "m", doesntMean: "d", aliases: ["roa"] },
  };
  ok("NEGATIVE CONTROL · two entries claiming one alias is caught, case-insensitively",
    probe(bad) === 1, "ROA vs roa");
  const good: Record<string, G> = {
    a: { label: "Alpha", meaning: "m", doesntMean: "d", aliases: ["AAA"] },
    b: { label: "Beta", meaning: "m", doesntMean: "d", aliases: ["BBB"] },
  };
  ok("NEGATIVE CONTROL · distinct aliases are silent", probe(good) === 0, "no false positive");

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
