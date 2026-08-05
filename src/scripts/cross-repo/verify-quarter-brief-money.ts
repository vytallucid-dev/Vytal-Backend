// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — QUARTER IN BRIEF MONEY RENDERING vs THE RESULTS CARD.
//
// ★★ CROSS-REPO. NEEDS BOTH CHECKOUTS, SO IT IS NOT — AND MUST NEVER BE — IN `build`. ★★
// It lives here for the same reason verify-boundary-render.ts does: a Railway deploy checks out the
// backend alone, so on the deploy box the frontend path does not exist and the gate would fail for a
// reason that has nothing to do with what it guards. `npm run verify:cross-repo` is its home.
//
// WHAT IT GUARDS
// Quarter in Brief prints money INSIDE PROSE that sits directly beside the Results card printing the
// SAME figure. The card's rule lives in the frontend (`fmtMarketCap`); the prose's rule lives in the
// backend (`money`). Two repos cannot share a function without a shared package, and adding one is a
// new dependency — so this is one RULE with two implementations, and this gate is the only thing
// holding the second to the first.
//
// The failure it exists to catch is silent and ugly: someone changes the card to two decimals, and
// from that day every brief says "₹15,548 crore" beside a card saying "₹15,547.66 Cr". Both are
// defensible; together they tell a reader who cannot read a statement that one of them is lying.
//
// WHAT IT CANNOT PROVE
// It reads the frontend as TEXT (fmtMarketCap sits in a .tsx that imports React, so it cannot be
// imported into a node script the way boundary.ts can). It therefore proves the RULE CONSTANTS still
// agree, not that the two functions are observationally identical. If the frontend rewrites
// fmtMarketCap in a form this parser does not recognise, the gate fails loudly rather than passing
// quietly — which is the correct direction to fail in.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { money, MONEY_RULE } from "../../insight/quarter-brief/format.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(HERE, "..", "..", "..");
const FRONTEND_SHARED = resolve(
  BACKEND_ROOT, "..", "Vytal-Frontend", "components", "stock-detail", "overview", "shared.tsx",
);

let failures = 0;
const fail = (m: string) => { failures++; console.error(`  ✗ ${m}`); };
const pass = (m: string) => console.log(`  ✓ ${m}`);

function frontendRule(): string {
  let src: string;
  try {
    src = readFileSync(FRONTEND_SHARED, "utf8");
  } catch {
    console.error(`  ✗ cannot read the frontend at ${FRONTEND_SHARED}`);
    console.error("    This gate needs BOTH checkouts side by side. It is not a build gate.");
    process.exit(1);
  }
  const m = /export function fmtMarketCap[\s\S]*?\n}/.exec(src);
  if (!m) {
    fail("fmtMarketCap not found in the frontend — it moved or was rewritten; re-point this gate.");
    return "";
  }
  return m[0];
}

console.log("═".repeat(96));
console.log("QUARTER IN BRIEF — MONEY RENDERING vs THE RESULTS CARD");
console.log("═".repeat(96));
console.log(`\nfrontend: ${FRONTEND_SHARED}`);

const rule = frontendRule();

// ── 1 · the rule constants still agree ──────────────────────────────────────────────────────────────
console.log("\n1 · RULE CONSTANTS");
if (!rule.includes("100_000")) {
  fail(`frontend no longer switches to lakh-crore at 100_000 (backend MONEY_RULE says ${MONEY_RULE.lakhCroreThresholdCr})`);
} else pass(`lakh-crore threshold agrees (${MONEY_RULE.lakhCroreThresholdCr} Cr)`);

if (!rule.includes(`"${MONEY_RULE.locale}"`)) {
  fail(`frontend no longer formats with locale ${MONEY_RULE.locale}`);
} else pass(`locale agrees (${MONEY_RULE.locale})`);

if (!/maximumFractionDigits:\s*0/.test(rule)) {
  fail("frontend no longer rounds to whole crore (maximumFractionDigits: 0)");
} else pass("whole-crore rounding agrees (maximumFractionDigits: 0)");

// ── 2 · the backend renders the corpus the way the card would ───────────────────────────────────────
// Expected strings are computed with the CARD's own expression, then checked against `money`, so this
// compares behaviour rather than restating the backend's logic back at itself.
console.log("\n2 · CORPUS (backend `money` vs the card's arithmetic)");
const cardWouldRender = (cr: number): string =>
  cr >= 100_000
    ? `₹${(cr / 100_000).toFixed(2)} lakh crore`
    : `₹${cr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} crore`;

const CORPUS = [15547.66, 33533.95, 297.97, 717.83, 5040.55, 1, 999, 1000, 99999, 100000, 250000.5];
for (const cr of CORPUS) {
  const got = money(cr);
  const want = cardWouldRender(cr);
  if (got !== want) fail(`money(${cr}) = "${got}" but the card would render "${want}"`);
}
if (failures === 0) pass(`${CORPUS.length} values render identically to the card`);

// Sub-crore is the ONE deliberate divergence: the card would print "₹0 crore" for a real figure.
const subCrore = money(0.4);
if (subCrore !== "₹40 lakh") fail(`sub-crore should render as lakh, got "${subCrore}"`);
else pass(`sub-crore renders as "${subCrore}" (deliberate divergence — the card would say "₹0 crore")`);

console.log("\n" + "─".repeat(96));
if (failures > 0) {
  console.error(`FAILED — ${failures} assertion${failures === 1 ? "" : "s"}. The prose and the card would disagree.`);
  process.exit(1);
}
console.log("PASSED — one money rule, two implementations, still in step.");
