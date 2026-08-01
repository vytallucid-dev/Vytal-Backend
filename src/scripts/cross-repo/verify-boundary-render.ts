// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// verify-boundary-render.ts — THE GATE FOR THE `doesntMean` RENDER TRANSFORM.
//
// ★★ CROSS-REPO. THIS GATE NEEDS BOTH CHECKOUTS, SO IT IS NOT — AND MUST NEVER BE — IN `build`. ★★
//
// It lives in src/scripts/cross-repo/ for exactly that reason. `npm run verify:cross-repo` is its home;
// verify-build-gate-hygiene.ts FAILS THE BUILD if anything in this directory is ever wired into the
// build chain, and fails it again if this directory is wired into nothing at all. See the foot of this
// file for what stops being proved when it does not run, and where the check should end up.
//
// The transform lives in the FRONTEND (Vytal-Frontend/lib/findings/boundary.ts) because it is a render
// concern; the corpus it must be total over lives in the BACKEND (the portfolio copy module and the
// stock-finding registry). This script is the join. It imports the frontend module directly — the same
// cross-repo reach gen-frontend-fallback.ts already uses, and possible only because boundary.ts is
// import-free by construction. That reach is why it cannot be a build gate: a Railway deploy checks out
// the backend ALONE, so on the deploy box the frontend path does not exist and the gate fails for a
// reason that has nothing to do with the copy it is guarding.
//
// WHAT IT PROVES
//   1. Total     — every one of the 41 portfolio strings and every stock/lens boundary parses.
//   2. Lossless  — clauses + prose reassemble to the original with only the markers and their
//                  separators removed. A transform that silently drops a clause is the failure mode
//                  that matters, and a count check would not catch it.
//   3. Glyph-free— the glyph reaches no rendered field. This is the whole point: a screen reader must
//                  never be handed "not equal to".
//   4. Shape     — portfolio strings classify as "negations", stock/lens strings as "scope". A stock
//                  boundary that came out "negations" would get the wrong label, which is worse than
//                  the raw glyph because it would be confidently wrong.
//
// WHAT IT CANNOT PROVE
//   That the LABELS are the right words. That is a copy judgement; see the note at the foot of
//   boundary.ts for why one label cannot serve both registers.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FINDING_COPY } from "../../portfolio/phs/copy.js";
import { STOCK_FINDINGS, FAMILY_DOESNT_MEAN, LENS_DOESNT_MEAN } from "../../catalogue/stock-findings.js";

const FRONTEND_DIR = process.env.VYTAL_FRONTEND_DIR ?? resolve(process.cwd(), "../Vytal-Frontend");
const MODULE_PATH = resolve(FRONTEND_DIR, "lib/findings/boundary.ts");

const NE = String.fromCharCode(0x2260);

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

if (!existsSync(MODULE_PATH)) {
  console.error(`❌ frontend transform not found at ${MODULE_PATH}`);
  console.error(`   Set VYTAL_FRONTEND_DIR to the checkout path, or place the repos side by side.`);
  console.error(`   This is a CROSS-REPO gate (npm run verify:cross-repo) and needs both checkouts.`);
  console.error(`   If you are seeing this inside a deploy, something wired it into \`build\`: that is`);
  console.error(`   the failure verify-build-gate-hygiene.ts exists to catch — unwire it, do not set the var.`);
  process.exit(1);
}

type Parts = { shape: "negations" | "scope"; label: string; clauses: string[]; prose: string };
const { boundaryParts } = (await import(pathToFileURL(MODULE_PATH).href)) as {
  boundaryParts: (t: string) => Parts;
};

/** Strip everything the notation contributes, so what remains is the words a reader gets. */
const words = (s: string) =>
  s
    .split(NE)
    .join(" ")
    .replace(/[\s,.;]+/g, " ")
    .trim()
    .toLowerCase();

console.log("\n══ 1 · PORTFOLIO REGISTER (the glyph corpus) ══════════════════════════════════════════");
const phs = Object.entries(FINDING_COPY);
const phsParsed = phs.map(([k, c]) => [k, c.doesntMean, boundaryParts(c.doesntMean)] as const);

ok(
  "every portfolio boundary classifies as `negations`",
  phsParsed.every(([, , p]) => p.shape === "negations"),
  `${phsParsed.filter(([, , p]) => p.shape === "negations").length}/${phs.length}`,
);
ok(
  "every one produces at least one clause",
  phsParsed.every(([, , p]) => p.clauses.length > 0),
  phsParsed.filter(([, , p]) => !p.clauses.length).map(([k]) => k).join(",") || `${phs.length} parsed`,
);
ok(
  "no clause is blank or whitespace",
  phsParsed.every(([, , p]) => p.clauses.every((c) => c.trim().length > 0)),
);
ok(
  "the marker count equals the clause count — not one clause dropped",
  phsParsed.every(([, raw, p]) => (raw.match(new RegExp(NE, "g")) ?? []).length === p.clauses.length),
  phsParsed
    .filter(([, raw, p]) => (raw.match(new RegExp(NE, "g")) ?? []).length !== p.clauses.length)
    .map(([k]) => k)
    .join(",") || `${phsParsed.reduce((n, [, , p]) => n + p.clauses.length, 0)} clauses over ${phs.length} strings`,
);
const lossy = phsParsed.filter(([, raw, p]) => words([...p.clauses, p.prose].join(" ")) !== words(raw));
ok(
  "LOSSLESS — clauses + prose reassemble to the original, markers and separators aside",
  lossy.length === 0,
  lossy.map(([k]) => k).join(",") || `${phs.length}/${phs.length} round-trip`,
);
ok(
  "the glyph reaches NO rendered field",
  phsParsed.every(([, , p]) => !p.label.includes(NE) && !p.prose.includes(NE) && p.clauses.every((c) => !c.includes(NE))),
);

console.log("\n══ 2 · STOCK REGISTER (the bare-fragment corpus) ══════════════════════════════════════");
const stockStrings = [
  ...Object.entries(STOCK_FINDINGS).map(([k, e]) => [k, e.doesntMean] as const),
  ...Object.entries(FAMILY_DOESNT_MEAN).map(([f, s]) => [`family:${f}`, s] as const),
  ...Object.entries(LENS_DOESNT_MEAN).map(([f, s]) => [`lens:${f}`, s] as const),
];
const stockParsed = stockStrings.map(([k, s]) => [k, s, boundaryParts(s)] as const);
ok(
  "every stock/family/lens boundary classifies as `scope`",
  stockParsed.every(([, , p]) => p.shape === "scope"),
  stockParsed.filter(([, , p]) => p.shape !== "scope").map(([k]) => k).join(",") || `${stockParsed.length} strings`,
);
ok(
  "`scope` passes the sentence through byte-for-byte (no transform on prose)",
  stockParsed.every(([, s, p]) => p.prose === s.trim() && p.clauses.length === 0),
);

console.log("\n══ 3 · THE LABELS ARE DERIVED, NEVER EMPTY ════════════════════════════════════════════");
ok(
  "every parse carries a non-empty label",
  [...phsParsed, ...stockParsed].every(([, , p]) => p.label.trim().length > 0),
);
ok(
  "exactly two labels across the whole corpus",
  new Set([...phsParsed, ...stockParsed].map(([, , p]) => p.label)).size === 2,
  [...new Set([...phsParsed, ...stockParsed].map(([, , p]) => p.label))].map((l) => `"${l}"`).join(" · "),
);

console.log("\n══ 4 · NEGATIVE CONTROLS ══════════════════════════════════════════════════════════════");
const abbrev = boundaryParts(`${NE} it trades in the U.S. Treasury market. That is the whole claim.`);
ok(
  "an initial (\"U.S. Treasury\") does not split the clause",
  abbrev.clauses[0] === "it trades in the U.S. Treasury market",
  `clause="${abbrev.clauses[0]}"`,
);
const eg = boundaryParts(`${NE} anything else, e.g. a forecast. The rest is prose.`);
ok(
  '"e.g." does not split the clause',
  eg.clauses[0] === "anything else, e.g. a forecast",
  `clause="${eg.clauses[0]}"`,
);
const degenerate = boundaryParts(`${NE}`);
ok("a lone marker degrades to prose rather than an empty list", degenerate.shape === "scope");
ok("an empty string renders nothing", boundaryParts("").prose === "" && boundaryParts("").clauses.length === 0);

console.log("\n══ 5 · WORKED SAMPLE — what a reader now gets ═════════════════════════════════════════");
for (const key of ["PC1", "PC8", "PV6", "PA1"]) {
  const c = FINDING_COPY[key];
  if (!c) continue;
  const p = boundaryParts(c.doesntMean);
  console.log(`\n  ${key}  BEFORE  ${c.doesntMean}`);
  console.log(`  ${" ".repeat(key.length)}  AFTER   ${p.label} — ${p.clauses.join(" · ")}`);
  if (p.prose) console.log(`  ${" ".repeat(key.length)}          ${p.prose}`);
}
const sample = boundaryParts(FAMILY_DOESNT_MEAN.A);
console.log(`\n  family A  BEFORE  ${FAMILY_DOESNT_MEAN.A}`);
console.log(`            AFTER   ${sample.label} — ${sample.prose}`);

console.log(
  failures === 0
    ? "\n✅ BOUNDARY RENDER GATE PASSES — both registers parse, nothing is lost, the glyph never ships\n"
    : `\n❌ ${failures} FAILURE(S)\n`,
);
process.exit(failures === 0 ? 0 : 1);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHAT GOES UNPROVED BETWEEN RUNS, STATED PLAINLY
//
// This gate now runs on `npm run verify:cross-repo` (pre-push / a CI job that checks out both repos)
// instead of on every deploy. Between those runs, NOTHING enforces:
//
//   · that a NEW or EDITED portfolio boundary string still parses. Add a 42nd PHS string in a shape
//     the transform does not split, and the reader gets the raw "≠" back — the exact defect
//     boundary.ts exists to remove. The backend build will not notice.
//   · that an edit to boundary.ts stays LOSSLESS. A dropped clause renders as a shorter, still
//     plausible sentence; no test in the frontend repo covers it today either.
//   · that a stock string has not drifted into the portfolio register (or the reverse), which would
//     put the wrong LABEL on the line — confidently wrong, and worse than the raw glyph.
//
// WHERE IT SHOULD END UP — a SPLIT, so each half runs where its inputs live and neither half reaches:
//
//   BACKEND half (belongs in verify:copy, needs no frontend): assert the CORPUS still satisfies the
//     contract the transform is written against — every PHS string starts with the marker and every
//     marker-delimited clause is non-blank; no stock/family/lens string contains the marker at all.
//     That is a property of backend bytes, checkable in a backend-only checkout, and it is the half
//     that actually changes often (copy edits land here).
//
//   FRONTEND half (belongs in the frontend's own build): assert the TRANSFORM is total and lossless
//     over a generated fixture of those strings — the same trick gen-frontend-fallback.ts already
//     plays for the fallback copy, so the fixture cannot drift silently and the frontend needs no
//     backend checkout to run its own gate.
//
// Until that split exists, this whole file is the join and it runs pre-push, not on deploy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
