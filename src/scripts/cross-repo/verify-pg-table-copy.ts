// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// verify-pg-table-copy.ts — THE COPY SCANS, EXTENDED OVER THE PEER-GROUP TABLE ANNOTATIONS.
//
// ★★ CROSS-REPO. THIS GATE NEEDS BOTH CHECKOUTS, SO IT IS NOT — AND MUST NEVER BE — IN `build`. ★★
//
// It lives in src/scripts/cross-repo/ for exactly that reason; verify-build-gate-hygiene.ts FAILS THE
// BUILD if anything in this directory is ever wired into the build chain. See verify-boundary-render.ts
// for the incident that rule exists for.
//
// ── WHY IT EXISTS ──────────────────────────────────────────────────────────────────────────────────
// Two new reader-facing surfaces were authored IN THE FRONTEND: the snapshot-period note ("Every
// reading below is FY27Q1, scored 7 August 2026", "A reading on an older period has not taken in the
// latest results") and the exposure legend ("you hold", "on your watchlist"). They are captions over
// data the frontend already holds, which is the existing pattern on this page — `pondCharacterRead`
// and the raw floor's own italic notes are authored there too.
//
// But every OTHER sentence on this page goes through the shared copy scans, and a sentence that
// escapes them because of which repo it happens to live in is a sentence nobody is checking. So the
// scans reach across: the SAME `scanForwardLanguage` (R2/R3) and the SAME MOVEMENT_PROMISE /
// LAG_NUMBER / INSTRUCTION lists the two results-season gates run, imported, not re-typed.
//
// ── WHAT IT SCANS, AND WHAT THAT CANNOT PROVE ──────────────────────────────────────────────────────
// A SOURCE scan over the JSX text nodes and prose string literals of the two files. It cannot execute
// the components, so it sees the copy in pieces rather than as the assembled sentence — a banned
// phrase split across a `{variable}` boundary would slip through. What it DOES catch is the
// regression that actually happens: someone editing this copy in place and reaching for "worth
// watching", "expect", or a lag number. The negative controls below prove the scans are live.
//
//   npx tsx src/scripts/cross-repo/verify-pg-table-copy.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanForwardLanguage } from "../../scoring/findings/trajectory/regime-tier.js";
import { scanCopyConstraints } from "../lib/results-season-scans.js";

const FRONTEND_DIR = process.env.VYTAL_FRONTEND_DIR ?? resolve(process.cwd(), "../Vytal-Frontend");
const FILES = [
  "components/peer-group/snapshot-period.tsx",
  "components/peer-group/exposure.tsx",
  // The banner's own frontend-authored strings — the "+N more" chip and its tooltip. The SENTENCE it
  // renders is server-composed and already gated twice; these are the controls around it.
  "components/peer-group/results-season-banner.tsx",
  // The shared capsule, extracted from the banner. Its accessible labels and tooltip lines are
  // reader-facing text and now serve four call sites, so they are scanned where they live.
  "components/peer-group/capsule.tsx",
  // The three-lens separation section. Same split as the banner: the pole sentences, the empty state
  // and the boundary are SERVER-composed and gated by verify-lens-separation.ts; what is authored
  // here is the section's standing intro, the "+N more metrics" chip and the capsules' labels.
  "components/peer-group/health/separation-section.tsx",
];

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

for (const f of FILES) {
  const p = resolve(FRONTEND_DIR, f);
  if (!existsSync(p)) {
    console.error(`❌ frontend component not found at ${p}`);
    console.error(`   Set VYTAL_FRONTEND_DIR to the checkout path, or place the repos side by side.`);
    console.error(`   This is a CROSS-REPO gate (npm run verify:cross-repo) and needs both checkouts.`);
    console.error(`   If you are seeing this inside a deploy, something wired it into \`build\`.`);
    process.exit(1);
  }
}

/**
 * The reader-facing fragments of one .tsx file.
 *
 * ⚠ COMMENTS ARE STRIPPED FIRST, and that is load-bearing rather than tidy. These files carry long
 *   explanatory headers that quote the very phrasings the scans ban ("worth watching" appears in the
 *   note explaining why valence is avoided). Scanning them would fail the gate on its own rationale.
 *
 * What survives: JSX TEXT NODES (`>…<`), prose string literals, and TEMPLATE LITERALS with their
 * interpolations blanked. A literal is "prose" if it has a space and no character that marks it as
 * machinery — Tailwind classes, CSS values, paths and keys all carry one of `- : / . _ # < > =`.
 *
 * ⚠ TEMPLATE LITERALS ARE NOT OPTIONAL, and leaving them out was a real hole: the tooltip sentences
 *   the exposure marks now carry ("You hold PETRONET", "SYMBOL is on your watchlist") are composed
 *   with backticks, so a quoted-literal-only scan reported "clean" over a file whose newest reader-
 *   facing copy it had never read.
 */
function fragments(src: string): string[] {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

  const out: string[] = [];
  const push = (t: string) => {
    const s = t.replace(/\s+/g, " ").trim();
    if (s && /[a-z]{3}/.test(s)) out.push(s);
  };

  // JSX text nodes — the visible prose between tags. `{`/`}` excluded so an interpolation boundary
  // ends a fragment rather than swallowing the expression source into the scan.
  for (const m of stripped.matchAll(/>([^<>{}]+)</g)) push(m[1]);

  // Prose string literals — the words that ride in props (`noun="value"`, the EXPOSURE_WORDS map).
  for (const m of stripped.matchAll(/(['"])((?:(?!\1)[^\\\r\n]|\\.)*)\1/g)) {
    const t = m[2].trim();
    if (!t || !/\s/.test(t)) continue;
    if (/[-:/._#<>=]/.test(t)) continue; // a class list, a CSS value, a path, a token
    push(t);
  }

  // Template literals, with every `${…}` blanked to a placeholder so the surrounding words are read
  // as the sentence a reader sees. Applied repeatedly for one level of nested braces.
  for (const m of stripped.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    let t = m[1];
    for (let i = 0; i < 3; i++) t = t.replace(/\$\{[^{}]*\}/g, " SYMBOL ");
    if (t.includes("${")) continue; // deeper nesting than this scan can flatten honestly
    t = t.trim();
    if (!t || !/\s/.test(t)) continue;
    if (/[:/._#<>=]/.test(t)) continue; // a CSS value, a path, a class list
    push(t);
  }
  return out;
}

async function main() {
  rule("THE SHARED COPY SCANS OVER THE PEER-GROUP TABLE ANNOTATIONS");

  let total = 0;
  for (const f of FILES) {
    const frags = fragments(readFileSync(resolve(FRONTEND_DIR, f), "utf8"));
    total += frags.length;
    console.log(`\n  ── ${f} — ${frags.length} reader-facing fragments ──`);

    const forward: string[] = [];
    const constraints: string[] = [];
    for (const t of frags) {
      for (const v of scanForwardLanguage(t)) forward.push(`${v.rule} "${v.matched}" in «${t}»`);
      for (const v of scanCopyConstraints(t)) constraints.push(`${v.scan} "${v.matched}" in «${t}»`);
    }
    ok(`${f} — scanForwardLanguage (R2/R3)`, forward.length === 0, forward.slice(0, 3).join(" · ") || "clean");
    ok(
      `${f} — movement-promise / lag-number / instruction`,
      constraints.length === 0,
      constraints.slice(0, 3).join(" · ") || "clean",
    );
  }
  ok(`${total} fragments extracted across ${FILES.length} files`, total > 0, "an empty corpus proves nothing");

  rule("NEGATIVE CONTROLS — the scans are live, and the extractor sees JSX text");
  for (const planted of [
    "A row on an older period is worth watching.",
    "You should check the members on an older reading.",
    "Expect this reading to move once the results land.",
    "The older reading catches up within three days.",
  ]) {
    const caught = scanForwardLanguage(planted).length > 0 || scanCopyConstraints(planted).length > 0;
    ok(`planted: "${planted}"`, caught, caught ? "caught" : "NOT CAUGHT");
  }
  // …and the extractor itself: a planted JSX text node must be found and scanned.
  const probe = fragments(`<p>A row on an older period is worth watching.</p>`);
  ok(
    "the extractor finds a JSX text node",
    probe.length === 1 && scanCopyConstraints(probe[0]).length > 0,
    probe.join(" | ") || "found nothing",
  );
  // …and must NOT scan a comment, or this gate fails on its own rationale.
  ok(
    "the extractor SKIPS comments (they quote the banned phrasings on purpose)",
    fragments(`// never say worth watching here\n<p>Fine copy.</p>`).every((t) => !/worth watching/.test(t)),
  );
  // …and must not mistake a class list for prose.
  ok(
    "the extractor SKIPS class lists",
    fragments(`<p className="mt-3 text-ink3 leading-relaxed">Fine copy.</p>`).join("|") === "Fine copy.",
    fragments(`<p className="mt-3 text-ink3 leading-relaxed">Fine copy.</p>`).join("|"),
  );
  // ★ AND IT MUST READ TEMPLATE LITERALS — the hole this gate had until the tooltip copy landed in
  //   backticks. A planted phrase inside an interpolated string has to be caught.
  {
    const probe = fragments("const s = `${sym} is worth watching`;");
    ok(
      "the extractor reads TEMPLATE literals (with `${…}` blanked)",
      probe.length === 1 && scanCopyConstraints(probe[0]).length > 0,
      probe.join(" | ") || "found nothing",
    );
  }
  ok(
    "…and the real tooltip sentence survives extraction",
    fragments("const s = `You hold ${symbol}, and it is on your watchlist`;").length === 1,
  );

  console.log("\n" + "─".repeat(100));
  if (failures > 0) {
    console.error(`FAILED — ${failures} assertion${failures === 1 ? "" : "s"}.`);
    process.exit(1);
  }
  console.log("PASSED — the table annotations pass the same copy scans as every sentence beside them.");
}

main().catch((e) => {
  console.error("verify-pg-table-copy crashed:", e);
  process.exit(1);
});
