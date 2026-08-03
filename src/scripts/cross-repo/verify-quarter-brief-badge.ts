// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — THE QUARTER IN BRIEF BADGE, AS THE FRONTEND RENDERS IT.
//
// ★★ CROSS-REPO. NEEDS BOTH CHECKOUTS, SO IT IS NOT — AND MUST NEVER BE — IN `build`. ★★
// Same reason as verify-quarter-brief-money.ts: a Railway deploy checks out the backend alone, so on
// the deploy box the frontend path does not exist and the gate would fail for a reason that has
// nothing to do with what it guards. `npm run verify:cross-repo` is its home.
//
// ── WHAT IT GUARDS ─────────────────────────────────────────────────────────────────────────────────
// The verdict is COMPUTED here and RENDERED there, and three things had to be copied across the repo
// boundary to render it. Two repos cannot share a constant without a shared package, and adding one
// is a new dependency — so these are single decisions with two copies, and this gate is the only
// thing holding the second to the first.
//
//   1 · VERDICT_DOESNT_MEAN — the limit of what the badge claims. It ships WITH the badge on both
//       surfaces. If the backend sharpens the wording and the frontend keeps the old sentence, the
//       product is making a claim it has already decided not to make.
//   2 · The key → glyph map. The glyph carries DIRECTION so colour does not have to (BADGE_TREATMENT
//       `colourEncodesMeaning: false`). A frontend map that drifts renders a down-arrow beside
//       "Grew" — the badge then contradicts its own label, in the one component a reader trusts most.
//   3 · HEALTH_HEADING_MARKER — the substring the pinned `scoredAsOf` date attaches to. If the
//       backend renames that heading, the date silently detaches and the brief's health figure sits
//       undated beside a live Health tab showing a different number. That is the exact confusion the
//       pinning exists to prevent, and its failure mode is invisible.
//
// ── AND ONE LAYOUT RULE, BECAUSE ITS FAILURE INVERTS MEANING ───────────────────────────────────────
//   4 · The verdict label must never be truncated. "Grew, margins thinner" clipped to "Grew,
//       margins…" reads as its own opposite. This is the one CSS rule worth a gate: it is a single
//       class, it is the obvious thing to reach for on a narrow card, and nothing else would catch it.
//
// ── WHAT IT CANNOT PROVE ───────────────────────────────────────────────────────────────────────────
// It reads the frontend as TEXT — .tsx files import React and cannot be imported into a node script.
// So it proves the CONSTANTS still agree, not that the component renders them. Layout, contrast and
// whether the prose reads like something Vytal should put its name on are for a human at the page;
// no harness proves those, which is why the operator opens it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERDICT_KEYS, VERDICTS, VERDICT_DOESNT_MEAN } from "../../insight/quarter-brief/verdict.js";
import { ALLOWED_HEADINGS } from "../../insight/quarter-brief/prompt.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(HERE, "..", "..", "..");
const FE = (...p: string[]) => resolve(BACKEND_ROOT, "..", "Vytal-Frontend", ...p);

const SHARED = FE("components", "results", "shared.tsx");
const SNAPSHOT = FE("components", "results", "SnapshotTab.tsx");
const FEED = FE("app", "(main)", "results", "page.tsx");

let failures = 0;
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`  ✗ cannot read the frontend at ${path}`);
    console.error("    This gate needs BOTH checkouts side by side. It is not a build gate.");
    process.exit(1);
  }
}

const shared = read(SHARED);
const snapshot = read(SNAPSHOT);
const feed = read(FEED);

console.log("═".repeat(96));
console.log("GATE — QUARTER IN BRIEF BADGE (backend verdict.ts ↔ frontend results/shared.tsx)");
console.log("═".repeat(96));

// ── 1 · the caveat, verbatim ────────────────────────────────────────────────────────────────────────
console.log("\n1 · VERDICT_DOESNT_MEAN");
if (!shared.includes(VERDICT_DOESNT_MEAN)) {
  fail("the frontend's VERDICT_DOESNT_MEAN is not the backend's, verbatim.");
  console.error(`    backend: ${VERDICT_DOESNT_MEAN}`);
  const m = /VERDICT_DOESNT_MEAN\s*=\s*\n?\s*"([^"]*)"/.exec(shared);
  console.error(`    frontend: ${m ? m[1] : "(not found — it moved or was renamed)"}`);
} else {
  pass("caveat copy agrees, verbatim");
}

// It must SHIP WITH THE BADGE on BOTH surfaces — the detail card and the feed card. A caveat present
// in the shared module but rendered on neither is the same as not having one.
console.log("\n2 · THE CAVEAT SHIPS WITH THE BADGE (both surfaces)");
if (!/VerdictCaveat\s*\/?>/.test(snapshot)) {
  fail("SnapshotTab no longer renders VerdictCaveat beside the verdict badge.");
} else pass("detail card renders the caveat with the badge");

if (!feed.includes("VERDICT_DOESNT_MEAN")) {
  fail("the results feed card no longer renders VERDICT_DOESNT_MEAN with its verdict.");
} else pass("feed card renders the caveat with the verdict");

// ── 3 · the key → glyph map ─────────────────────────────────────────────────────────────────────────
console.log("\n3 · KEY → GLYPH");
const mapBlock = /const VERDICT_GLYPH[^{]*\{([\s\S]*?)\n\};/.exec(shared);
if (!mapBlock) {
  fail("VERDICT_GLYPH not found in the frontend — it moved or was rewritten; re-point this gate.");
} else {
  const feMap = new Map<string, string>();
  for (const m of mapBlock[1].matchAll(/(\w+)\s*:\s*"(\w+)"/g)) feMap.set(m[1], m[2]);

  // ⚠ Scoped to THIS section. The first version tested the global `failures`, so a failure anywhere
  // earlier suppressed this pass line — and worse, a failure HERE still printed "✓ all 9 keys map"
  // beside its own "✗". A gate that reports a pass next to its own failure is unreadable at exactly
  // the moment someone is reading it.
  const before = failures;
  for (const key of VERDICT_KEYS) {
    const want = VERDICTS[key].glyph;
    const got = feMap.get(key);
    if (got === undefined) fail(`frontend has no glyph for verdict "${key}" — it would fall back to a wrong one`);
    else if (got !== want) fail(`glyph for "${key}": backend says "${want}", frontend says "${got}"`);
    feMap.delete(key);
  }
  for (const stray of feMap.keys()) fail(`frontend maps a glyph for "${stray}", which is not a backend verdict key`);
  if (failures === before) pass(`all ${VERDICT_KEYS.length} verdict keys map to the backend's glyph`);
}

// ── 4 · the health heading the pinned date attaches to ──────────────────────────────────────────────
console.log("\n4 · HEALTH_HEADING_MARKER → the pinned scoredAsOf date");
const markerMatch = /HEALTH_HEADING_MARKER\s*=\s*"([^"]*)"/.exec(shared);
if (!markerMatch) {
  fail("HEALTH_HEADING_MARKER not found in the frontend — the pinned date has nothing to attach to.");
} else {
  const marker = markerMatch[1].toLowerCase();
  const hits = ALLOWED_HEADINGS.filter((h) => h.toLowerCase().includes(marker));
  if (hits.length === 0) {
    fail(`frontend anchors the pinned date on "${marker}", which matches NO allowed heading — the date would never render.`);
    console.error(`    allowed headings: ${ALLOWED_HEADINGS.join(" | ")}`);
  } else if (hits.length > 1) {
    fail(`frontend anchor "${marker}" matches ${hits.length} headings (${hits.join(" | ")}) — the date would attach to more than one.`);
  } else {
    pass(`anchor "${marker}" matches exactly one heading: "${hits[0]}"`);
  }
}

// ── 5 · the label must never be truncated ───────────────────────────────────────────────────────────
console.log("\n5 · THE VERDICT LABEL WRAPS, NEVER TRUNCATES");
const badge = /export function VerdictBadge[\s\S]*?\n}/.exec(shared);
if (!badge) {
  fail("VerdictBadge not found in the frontend — it moved or was rewritten; re-point this gate.");
} else if (/\btruncate\b|text-ellipsis|line-clamp-/.test(badge[0])) {
  fail('VerdictBadge clips its label. "Grew, margins thinner" truncated to "Grew, margins…" reads as its own opposite.');
} else {
  pass("VerdictBadge does not clip its label");
}

// ── 6 · the prose parser classifies real brief shapes correctly ─────────────────────────────────────
// The card renders headings, paragraphs and bullets by MATCHING TEXT, because the generator emits
// bare lines ("What happened"), not markdown. Two silent failures live here and neither is visible
// in a screenshot of a brief that happens to be fine:
//
//   · A HEADING THAT STOPS MATCHING renders as a paragraph — the section loses its heading and its
//     pinned date, and the brief reads as one undifferentiated block. "What it did to the Vytal
//     health score" is EIGHT words against a limit of eight. Renaming it to nine breaks the card,
//     in this repo, with nothing here failing. That is what this section is for.
//   · A SENTENCE THAT STARTS MATCHING renders as a heading — a line of prose is bolded mid-brief.
//
// Both regexes are lifted from the frontend source rather than restated, so this tests what ships.
console.log("\n6 · THE PROSE PARSER (frontend regexes vs real brief shapes)");
const headingSrc = /const HEADING_LINE\s*=\s*(\/.*\/)[a-z]*;/.exec(shared);
const bulletSrc = /const BULLET_LINE\s*=\s*(\/.*\/)[a-z]*;/.exec(shared);

if (!headingSrc || !bulletSrc) {
  fail("HEADING_LINE / BULLET_LINE not found in the frontend — the prose renderer was rewritten; re-point this gate.");
} else {
  const HEADING = new RegExp(headingSrc[1].slice(1, -1));
  const BULLET = new RegExp(bulletSrc[1].slice(1, -1));
  // The card's own classifier, in the same order it runs in.
  const classify = (l: string): "bullet" | "heading" | "para" => {
    if (BULLET.test(l)) return "bullet";
    const h = HEADING.exec(l);
    if (h && !/[.!?,;]$/.test(h[1]) && h[1].trim().split(/\s+/).length <= 8) return "heading";
    return "para";
  };

  const before6 = failures;
  for (const h of ALLOWED_HEADINGS) {
    const got = classify(h);
    if (got !== "heading") {
      fail(`the card would render the heading "${h}" as a ${got} — the section loses its heading${/health score/i.test(h) ? " AND its pinned score date" : ""}.`);
      if (h.split(/\s+/).length > 8) console.error(`    ${h.split(/\s+/).length} words; the card's limit is 8.`);
    }
  }
  if (failures === before6) pass(`all ${ALLOWED_HEADINGS.length} allowed headings classify as headings`);

  // Real lines lifted from stored briefs — every one MUST read as prose, not as a heading.
  const PROSE_CORPUS = [
    "- Revenue this quarter: ₹15,548 crore (previous quarter: ₹10,511 crore), up 48% against the previous quarter.",
    "Operating margin was 2.3% this quarter, from 3.1% 4 quarters back — falling.",
    "Profit lifted by non-operating income.",
    "Vytal health score as scored on 2026-08-03: 65.0 out of 100, band \"Steady\".",
    "- Foundation held at 52.8.",
    "For every ₹100 of premium, ₹103.43 went out in claims and costs — ₹3.43 more than came in.",
  ];
  const before6b = failures;
  for (const l of PROSE_CORPUS) {
    if (classify(l) === "heading") fail(`the card would render this line of prose as a HEADING: "${l.slice(0, 70)}…"`);
  }
  if (failures === before6b) pass(`${PROSE_CORPUS.length} real prose lines classify as prose, not headings`);
}

console.log("\n" + "─".repeat(96));
if (failures > 0) {
  console.error(`FAILED — ${failures} assertion${failures === 1 ? "" : "s"}. The computed verdict and the rendered badge would disagree.`);
  process.exit(1);
}
console.log("PASSED — one verdict, computed here and rendered there, still in step.");
