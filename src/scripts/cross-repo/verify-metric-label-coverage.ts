// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// verify-metric-label-coverage.ts — EVERY SCORING METRIC KEY HAS A DISPLAY NAME IN THE CATALOGUE.
//
// ★★ CROSS-REPO. THIS GATE NEEDS BOTH CHECKOUTS, SO IT IS NOT — AND MUST NEVER BE — IN `build`. ★★
// It lives in src/scripts/cross-repo/ for that reason; verify-build-gate-hygiene.ts fails the build if
// anything here is ever wired into the build chain.
//
// ── THE BUG THIS IS FOR ────────────────────────────────────────────────────────────────────────────
// The three-lens separation section HEADS EACH BLOCK WITH A METRIC NAME. The read layer serves the
// metric KEY (`CASA`, `F3`, `NPyoy`) — deliberately, because it has no label map and the frontend has
// carried one for every other metric surface since the explorer shipped. Which means the heading is
// only ever as good as that map's COVERAGE: `getMetricLabel` falls back to the code itself for an
// unknown key, so a metric the map has never heard of heads a block with `NPyoy` — and the day
// someone "fixes" that with a humaniser, `lens_lm7_CASA` renders as "Lens lm7 CASA". That exact
// rendering shipped once.
//
// A fallback is the right BEHAVIOUR (never fabricate a name), but it must never actually fire. So the
// engine's own canonical registry — CANONICAL_METRICS, the one the bars loader validates every
// peer-group's metric set against — is reconciled against the frontend's METRIC_MAP.
//
// ── WHY IT READS SOURCE RATHER THAN IMPORTING ─────────────────────────────────────────────────────
// The frontend module is TSX-adjacent app code with `@/` path aliases; importing it from here would
// drag the frontend's tsconfig resolution into a backend script. The map is a flat object literal of
// `KEY: { label: … }` entries, so the keys are extractable from bytes, and extracting exactly the
// keys is enough — this gate is about COVERAGE, not about which words the label uses. The two
// registries deliberately differ in register (the engine's "Debt/Equity" is a review printout; the
// frontend's "Debt / Equity" is display copy), and pinning them byte-equal would force one of them to
// speak in the other's voice.
//
//   npx tsx src/scripts/cross-repo/verify-metric-label-coverage.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CANONICAL_METRICS } from "../../scoring/bars-loader/label-map.js";

const FRONTEND_DIR = process.env.VYTAL_FRONTEND_DIR ?? resolve(process.cwd(), "../Vytal-Frontend");
const MAP_FILE = "lib/health/metric-labels.ts";

let failures = 0;
const ok = (name: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

const path = resolve(FRONTEND_DIR, MAP_FILE);
if (!existsSync(path)) {
  console.error(`❌ frontend metric catalogue not found at ${path}`);
  console.error(`   Set VYTAL_FRONTEND_DIR to the checkout path, or place the repos side by side.`);
  console.error(`   This is a CROSS-REPO gate (npm run verify:cross-repo) and needs both checkouts.`);
  process.exit(1);
}

const src = readFileSync(path, "utf8");

/** Every `KEY: { label: "…" }` entry inside METRIC_MAP. The market sub-component map below it is a
 *  different vocabulary (A1/B2/…) and is deliberately not part of this reconciliation. */
function metricMapKeys(text: string): Map<string, string> {
  const start = text.indexOf("const METRIC_MAP");
  const end = text.indexOf("const MARKET_SUB_MAP");
  const body = text.slice(start, end > start ? end : undefined);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*\{[^}]*label:\s*"([^"]+)"/gm)) {
    out.set(m[1], m[2]);
  }
  return out;
}

rule("EVERY ENGINE CANONICAL METRIC KEY RESOLVES TO A DISPLAY NAME");

const mapped = metricMapKeys(src);
ok(`extracted the frontend metric catalogue (${mapped.size} entries)`, mapped.size >= 20, `${MAP_FILE}`);

const canonical = CANONICAL_METRICS.map((m) => m.key);
ok(`the engine declares ${canonical.length} canonical foundation/momentum metrics`, canonical.length >= 20);

const missing = canonical.filter((k) => !mapped.has(k));
ok(
  "★ every canonical key has a catalogue label — no block heading can fall back to the raw key",
  missing.length === 0,
  missing.join(", ") || "complete",
);

// Reconciled the other way too: an entry for a key the engine does not score is dead copy, and dead
// copy is how a map stops being trustworthy. Same discipline as the catalogue gate's §4.
const orphans = [...mapped.keys()].filter((k) => !canonical.includes(k));
ok(
  "no catalogue entry names a metric the engine does not score",
  orphans.length === 0,
  orphans.join(", ") || "no orphans",
);

// ⚠ NEGATIVE CONTROL — the extraction must actually be reading labels, not returning an empty map
//   that trivially satisfies "no orphans".
ok(
  "NEGATIVE CONTROL — the extraction really read labels",
  (mapped.get("F3") ?? "").length > 3 && (mapped.get("CASA") ?? "").length > 3,
  `F3="${mapped.get("F3") ?? ""}" · CASA="${mapped.get("CASA") ?? ""}"`,
);
ok(
  "NEGATIVE CONTROL — a key the engine has never declared is NOT in the map",
  !mapped.has("lens_lm7_CASA"),
  "a composed lens key is not a metric key",
);

console.log("");
if (failures > 0) {
  console.error(`❌ verify-metric-label-coverage: ${failures} failure(s)`);
  process.exit(1);
}
console.log("✅ verify-metric-label-coverage: all checks passed");
