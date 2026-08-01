// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE BOUNDARY CORPUS GATE — the BACKEND HALF of the render check. Backend bytes only.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────────
// verify-boundary-render.ts proves the frontend's `boundaryParts` transform is total over this copy.
// It does that by IMPORTING the frontend module, so it needs both checkouts — and the two repos are
// separate on GitHub. It cannot be a backend build gate; it now lives in src/scripts/cross-repo/ and
// runs on `npm run verify:cross-repo`. That left the deploy build proving NOTHING about this copy,
// and the copy is the half that changes: a new portfolio finding lands here, not in the transform.
//
// So this gate takes the half that CAN be proved from backend bytes alone: that the corpus is still
// written in the register the transform is written for.
//
// ── WHAT IT PROVES, AND WHY EACH ONE IS THE PROPERTY THAT MATTERS ─────────────────────────────────
//
//   1. REGISTER SEPARATION — every portfolio string carries the marker; NO stock/family/lens string
//      does. This is the assertion with teeth. The transform derives its LABEL from shape alone:
//      marker ⇒ "Doesn't mean", no marker ⇒ "How to read it". A stock string that acquired a marker
//      would render under "Doesn't mean" — and for the stock register that label is ACTIVELY FALSE
//      ("Doesn't mean: a hard risk warning to investigate" — it IS one). Confidently wrong beats
//      loudly wrong, so this is worse than the raw glyph it replaced.
//
//   2. NO BLANK SEGMENT — the transform's ONLY lossy branch is `if (!s) return;`, which silently drops
//      an empty marker-delimited segment. A doubled marker, or one with nothing but a space after it,
//      loses a clause and renders as a shorter, still-plausible sentence that nobody reports. Proving
//      no segment is blank proves THAT BRANCH IS UNREACHABLE for this corpus — which is the backend
//      end of "parses losslessly", stated as a fact about the input rather than a re-run of the code.
//
//   3. NO LEAD PROSE — every portfolio string STARTS with the marker. The transform handles text
//      before the first marker by moving it to the END, after the clause list. No stored string does
//      that today, and one that did would render its opening words last, which reads as a copy bug.
//
//   4. CLEAN EDGES — no string relies on surrounding whitespace. The transform trims; the endpoint
//      serves the raw bytes. Assert them equal so the served string and the rendered string agree.
//
// ── ⚠ WHAT IT CANNOT PROVE — AND THE HALF THAT STILL HAS NO HOME ON DEPLOY ────────────────────────
// It does NOT run the transform. It cannot: the transform is a frontend file, and re-implementing it
// here to check it would create the second home this whole build exists to kill — a copy that drifts
// from the original in lockstep with its own assertions, going green the whole way (see the ★★ note
// in verify-catalogue.ts about six bars that were pinned wrong for exactly that reason).
//
// So these stay unproved until `verify:cross-repo` runs, or until the frontend carries its own gate:
//   · that the SENTENCE SPLIT still lands correctly on the final segment ("U.S. Treasury", "e.g.")
//   · that clauses + prose reassemble to the original — losslessness END TO END, not just the
//     absence of the drop condition
//   · that the glyph reaches no rendered field
//
//   npx tsx src/scripts/verify-boundary-corpus.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { FINDING_COPY } from "../portfolio/phs/copy.js";
import { STOCK_FINDINGS, FAMILY_DOESNT_MEAN, LENS_DOESNT_MEAN } from "../catalogue/stock-findings.js";

/** Built from its code point, never typed — the same discipline boundary.ts uses. */
const NE = String.fromCharCode(0x2260);

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

const portfolio = Object.entries(FINDING_COPY).map(([k, c]) => [k, c.doesntMean] as const);
const stock = [
  ...Object.entries(STOCK_FINDINGS).map(([k, e]) => [k, e.doesntMean] as const),
  ...Object.entries(FAMILY_DOESNT_MEAN).map(([f, s]) => [`family:${f}`, s] as const),
  ...Object.entries(LENS_DOESNT_MEAN).map(([f, s]) => [`lens:${f}`, s] as const),
];

rule("1 · ⚠ REGISTER SEPARATION — the label is derived from SHAPE, so shape is the contract");
console.log(`  portfolio register: ${portfolio.length} strings  ·  stock/family/lens register: ${stock.length} strings`);

const unmarked = portfolio.filter(([, s]) => !s.includes(NE));
ok(
  'every PORTFOLIO boundary carries the marker (without it the line renders as "How to read it")',
  unmarked.length === 0,
  unmarked.map(([k]) => k).join(",") || `${portfolio.length}/${portfolio.length}`,
);
const marked = stock.filter(([, s]) => s.includes(NE));
ok(
  'NO stock/family/lens boundary carries the marker (with it the line renders as "Doesn\'t mean" — false for this register)',
  marked.length === 0,
  marked.map(([k]) => k).join(",") || `${stock.length}/${stock.length} clean`,
);

rule("2 · ⚠ NO BLANK SEGMENT — the transform's only lossy branch, proved unreachable for this corpus");
//
// boundaryParts() splits on the marker and drops any segment that trims to "". That branch is the one
// way a clause disappears without a trace. It cannot fire on a corpus with no blank segment.
const blankSeg = portfolio.filter(([, s]) => s.split(NE).slice(1).some((seg) => seg.trim() === ""));
ok(
  "no portfolio string has an empty marker-delimited segment (no doubled or trailing marker)",
  blankSeg.length === 0,
  blankSeg.map(([k]) => k).join(",") ||
    `${portfolio.reduce((n, [, s]) => n + s.split(NE).length - 1, 0)} segments over ${portfolio.length} strings, none blank`,
);
// The same fact from the other side: markers in, clauses out, one for one.
const countMismatch = portfolio.filter(([, s]) => {
  const markers = s.split(NE).length - 1;
  const nonBlank = s.split(NE).slice(1).filter((seg) => seg.trim() !== "").length;
  return markers !== nonBlank;
});
ok(
  "marker count EQUALS non-blank segment count, string by string (nothing to drop)",
  countMismatch.length === 0,
  countMismatch.map(([k]) => k).join(",") || "one clause per marker",
);
// A clause that is only its own separator would strip to "" downstream — same disappearance, later.
const separatorOnly = portfolio.filter(([, s]) =>
  s.split(NE).slice(1).some((seg) => seg.trim().replace(/[,.;]$/, "").trim() === ""),
);
ok(
  "…and no segment is nothing but its trailing separator (which would strip to empty)",
  separatorOnly.length === 0,
  separatorOnly.map(([k]) => k).join(",") || "every segment carries words",
);

rule("3 · NO LEAD PROSE — the marker opens the line, so the opening words are not rendered last");
const withLead = portfolio.filter(([, s]) => s.trim().indexOf(NE) !== 0);
ok(
  "every portfolio boundary STARTS with the marker",
  withLead.length === 0,
  withLead.map(([k]) => `${k}: "${k[1] ?? ""}"`).join(" · ") ||
    withLead.map(([k]) => k).join(",") || `${portfolio.length}/${portfolio.length}`,
);

rule("4 · CLEAN EDGES — the served bytes and the rendered string are the same string");
const untrimmed = [...portfolio, ...stock].filter(([, s]) => s !== s.trim());
ok(
  "no boundary in either register relies on leading or trailing whitespace",
  untrimmed.length === 0,
  untrimmed.map(([k]) => k).join(",") || `${portfolio.length + stock.length} strings`,
);
const empty = [...portfolio, ...stock].filter(([, s]) => s.trim() === "");
ok(
  "no boundary is empty (an empty one renders as nothing at all, in either shape)",
  empty.length === 0,
  empty.map(([k]) => k).join(",") || "all non-empty",
);

rule("5 · NEGATIVE CONTROLS — every rule above, fired on the input it exists to reject");
const M = NE;
ok(
  "register separation CATCHES a stock string that acquired a marker",
  [`${M} a prediction the stock will fall`].some((s) => s.includes(M)),
  "caught",
);
ok(
  "the blank-segment rule CATCHES a doubled marker",
  `${M} it is a mistake, ${M}${M} trim it.`.split(M).slice(1).some((seg) => seg.trim() === ""),
  "caught",
);
ok(
  "the separator-only rule CATCHES a segment that is just a comma",
  `${M} it is a mistake, ${M} , ${M} trim it.`
    .split(M)
    .slice(1)
    .some((seg) => seg.trim().replace(/[,.;]$/, "").trim() === ""),
  "caught",
);
ok(
  "the lead-prose rule CATCHES words before the first marker",
  `Concentration is a fact. ${M} it is a mistake.`.trim().indexOf(M) !== 0,
  "caught",
);
ok(
  "…and none of them bites a real portfolio string (the rules discriminate)",
  (() => {
    const [, s] = portfolio[0]!;
    return (
      s.trim().indexOf(M) === 0 &&
      !s.split(M).slice(1).some((seg) => seg.trim() === "") &&
      s === s.trim()
    );
  })(),
  `sample: "${(portfolio[0]?.[1] ?? "").slice(0, 58)}…"`,
);

rule("6 · THE CORPUS, BY SEGMENT — what the transform is handed");
// Segments, not clauses: the final segment's split into clause + trailing prose is the transform's
// job and is deliberately not reproduced here. See the header for why this file does not re-implement it.
for (const [k, s] of portfolio.slice(0, 3)) {
  const segs = s.split(M).slice(1).map((x) => x.trim().replace(/[,.;]$/, "").trim());
  console.log(`  ${k.padEnd(5)} ${segs.length} segment(s) · ${segs.join(" · ").slice(0, 96)}`);
}
console.log(`  …${portfolio.length - 3} more portfolio strings`);
console.log(`  ${stock.length} stock/family/lens strings pass through as prose, unsplit`);

console.log(
  fail === 0
    ? "\n✅ BOUNDARY CORPUS GATE PASSES — both registers still in shape; the transform's lossy branch is unreachable\n"
    : `\n❌ ${fail} FAILURE(S)\n`,
);
process.exit(fail === 0 ? 0 : 1);
