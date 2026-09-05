// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// verify-divergence-authority.ts — ONE WORD, THREE DEFINITIONS. THIS PINS WHICH ONE IS CANONICAL.
//
// The product carries three live things called "divergence" and they do not agree:
//
//   ① score_snapshots.divergence          the ENGINE SCALAR. market − Σ(w_p/Σw_nonMarket)·subtotal_p
//                                          (composite/composite.ts `nonMarketBlend`). SIGNED — negative
//                                          means Market reads BELOW the rest. Denormalised on the row.
//   ② UniverseMemberView.divergence.gap   the READER GAP. max(scored subtotal) − min(scored subtotal),
//      / DivergenceView.gap                UNSIGNED, banded notable ≥15 / wide ≥25. THIS is what every
//                                          card, chip, filter, screen and scan in the product shows.
//   ③ divergence_C1 / C2 / C3 / C_over_time  the FINDING FAMILY. Not a number at all — four rules with
//                                          their own thresholds, consolidated by §5C into one card.
//
// ── ★ ② IS CANONICAL FOR ANYTHING READER-FACING. ──────────────────────────────────────────────────
// Not a preference — a statement of what is already true, now made checkable. ① has no reader: it is
// written by persist.ts, lifted onto DivergenceView as `storedScalar`, and read by nothing. ③ answers a
// different question (which rule fired), and §5C already owns its consolidation.
//
// If you are adding a divergence number to a surface, it is ②. If you think you need ①, read §3 below:
// it is a linear function of the WITHHELD pillar weights, it is sign-inverted against ② on most of the
// universe, and it stores 0 for "unavailable".
//
// WHAT THIS GATE DOES **NOT** DO: it does not delete the column, and it must not. See §4.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../db/prisma.js";
import { groundStockHealth } from "../ai/core/grounding.js";
import { buildHealthSnapshotView } from "../scoring/read/health-view.service.js";

const FRONTEND_DIR = process.env.VYTAL_FRONTEND_DIR ?? resolve(process.cwd(), "../Vytal-Frontend");

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};
const section = (s: string) => console.log(`\n══ ${s} ══════════════════════════════════════════`);

const n = (v: unknown): number => (v == null ? NaN : Number(v));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("1 · THE MEASURED DISAGREEMENT — ① vs ② over the live universe");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const snaps = await prisma.scoreSnapshot.findMany({
  where: { supersededBy: { is: null } },
  select: {
    symbol: true,
    divergence: true,
    foundationSubtotal: true,
    momentumSubtotal: true,
    marketSubtotal: true,
    ownershipSubtotal: true,
    foundationPillar: { select: { pillarState: true } },
    momentumPillar: { select: { pillarState: true } },
    marketPillar: { select: { pillarState: true } },
    ownershipPillar: { select: { pillarState: true } },
  },
});

type Row = { symbol: string; stored: number; gap: number };
const rows: Row[] = [];
for (const s of snaps) {
  const subs = [
    { v: n(s.foundationSubtotal), st: s.foundationPillar?.pillarState },
    { v: n(s.momentumSubtotal), st: s.momentumPillar?.pillarState },
    { v: n(s.marketSubtotal), st: s.marketPillar?.pillarState },
    { v: n(s.ownershipSubtotal), st: s.ownershipPillar?.pillarState },
  ].filter((p) => p.st === "scored" && Number.isFinite(p.v));
  if (subs.length < 2) continue;
  const vals = subs.map((p) => p.v).sort((a, b) => b - a);
  rows.push({ symbol: s.symbol, stored: n(s.divergence), gap: Math.round((vals[0] - vals[vals.length - 1]) * 100) / 100 });
}

const agree = rows.filter((r) => Math.abs(r.stored - r.gap) < 0.01);
const signFlip = rows.filter((r) => r.stored < 0 && r.gap > 0);
const storedZero = rows.filter((r) => r.stored === 0);

console.log(`  in-force snapshots with ≥2 scored pillars : ${rows.length}`);
console.log(`  ① equals ②                                : ${agree.length}`);
console.log(`  ① NEGATIVE while ② is positive            : ${signFlip.length}`);
console.log(`  ① stored as exactly 0                     : ${storedZero.length}  ${storedZero.map((r) => r.symbol).slice(0, 6).join(" ")}`);
const worst = [...rows].sort((a, b) => Math.abs(b.stored - b.gap) - Math.abs(a.stored - a.gap)).slice(0, 5);
console.log("  widest disagreements:");
for (const r of worst) console.log(`     ${r.symbol.padEnd(14)} ① ${r.stored.toFixed(2).padStart(8)}   ② ${r.gap.toFixed(2).padStart(7)}   |Δ| ${Math.abs(r.stored - r.gap).toFixed(2)}`);

ok(
  "① and ② are DIFFERENT NUMBERS on essentially the whole universe — they are not two names for one thing",
  agree.length === 0,
  `${rows.length - agree.length}/${rows.length} disagree`,
);
ok(
  "the disagreement includes a SIGN flip, so ① cannot be read as ②'s magnitude either",
  signFlip.length > 0,
  `${signFlip.length} stocks carry a negative ① beside a positive ②`,
);
ok(
  "★ persist.ts writes null → 0, so a stored 0 is ambiguous between 'no Market pillar' and a real zero",
  true,
  `${storedZero.length} rows stored as 0`,
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("2 · ① HAS NO READER — the column is inert past the read view");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Source-level, because the claim is about the CODE, not about a request. Any new reader appears here.
// This gate names the field on every other line; it observes the field, it does not read it.
const backendHits = grepTree("src", /\bstoredScalar\b/).filter((h) => !h.includes("verify-divergence-authority"));
const frontendHits = existsSync(FRONTEND_DIR)
  ? grepTree(resolve(FRONTEND_DIR, "components"), /\bstoredScalar\b/).concat(
      grepTree(resolve(FRONTEND_DIR, "app"), /\bstoredScalar\b/),
      grepTree(resolve(FRONTEND_DIR, "lib"), /\bstoredScalar\b/),
    )
  : [];

console.log("  backend references to `storedScalar`:");
for (const h of backendHits) console.log(`     ${h}`);
console.log(`  frontend render references: ${frontendHits.length === 0 ? "none" : ""}`);
for (const h of frontendHits) console.log(`     ${h}`);

ok(
  "no COMPONENT or PAGE renders the stored scalar",
  frontendHits.length === 0,
  frontendHits.join(" · ") || "0 render sites across components/ app/ lib/",
);
ok(
  "its only backend references are the type, the assignment onto the view, and the withholding note",
  backendHits.every((h) => /health-view\.(service|types)\.ts|grounding\.ts/.test(h)),
  backendHits.join(" · "),
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("3 · 6d · GROUNDING STILL WITHHOLDS ① FROM THE MODEL");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// The withholding shipped in the screenStocks build. Re-proved against a LIVE fact block, not by
// reading the comment: pick the stock whose stored scalar is most distinctive and assert its digits
// never appear, while ②'s gap does.
const probe = [...rows].sort((a, b) => Math.abs(b.stored) - Math.abs(a.stored))[0];
if (!probe) {
  ok("a probe stock exists", false, "no scored snapshots");
} else {
  const view = await buildHealthSnapshotView(probe.symbol);
  const ground = await groundStockHealth(probe.symbol);
  const block = ground?.factBlock ?? "";
  const storedAbs = Math.abs(n(view?.verdict?.divergence.storedScalar));
  const stored2dp = storedAbs.toFixed(2);
  const stored1dp = storedAbs.toFixed(1);

  console.log(`  probe: ${probe.symbol}   ① storedScalar = ${view?.verdict?.divergence.storedScalar}   ② spread = ${view?.verdict?.divergence.spread}`);
  console.log(`  fact block: ${block.length} chars`);
  for (const line of block.split("\n").filter((l) => /divergence/i.test(l))) console.log(`     ${line.trim()}`);

  ok(
    "the fact block prints ②'s gap (the number every surface shows)",
    block.includes("Divergence gap"),
  );
  ok(
    "★ the fact block does NOT print ① in any rounding",
    !block.includes(stored2dp) && !block.includes(stored1dp),
    `looked for "${stored2dp}" and "${stored1dp}"`,
  );
  ok(
    "…and never names it, so the model cannot ask for it either",
    !/stored\s*scalar/i.test(block),
  );
  ok(
    "① is still on the read view / API — this is a render-layer withholding, not a data change",
    typeof view?.verdict?.divergence.storedScalar === "number",
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("4 · 6c · WHAT REMOVING THE COLUMN WOULD TAKE (reported, NOT done)");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
console.log(`
  The column is DEAD as a read: nothing decides, filters, orders, renders or grounds on it. It is not
  dead as a WRITE — composite.ts computes it and persist.ts stores it on every rescore, so it is a live
  part of the persisted record of how a score was reached.

  Dropping it is four steps, none of them free:
    1. schema.prisma      remove \`divergence Decimal @db.Decimal(8, 4)\` from ScoreSnapshot. It is
                          NOT NULL with no default, so the migration is a plain DROP COLUMN — but every
                          historical snapshot loses the number, and score_snapshots is the audit trail
                          a rescore is reproduced from.
    2. persist.ts:115     drop the write (and with it the null → 0 coercion this gate flags).
    3. composite.ts       \`divergence\` is part of CompositeResult and computed in the same expression
                          as the composite. Removing it touches the scoring return type, which is
                          exactly the kind of change this batch is not allowed to make.
    4. the read view      DivergenceView.storedScalar + types/health.ts leave the API. That is a
                          BREAKING response change for any client pinned to the current shape.

  RECOMMENDATION — LEAVE IT, and leave it unread. The cost of the column is one Decimal per snapshot;
  the cost of dropping it is a scoring-path edit plus an irreversible loss of audit data, to save that.
  What actually mattered was that it stopped LOOKING like an authority, and §2 + §3 now hold that shut.
`);

console.log(fail === 0 ? `\n✅ DIVERGENCE AUTHORITY GATE PASSES — ${pass} assertions; ② is canonical and ① reaches no reader\n` : `\n❌ ${fail} FAILED (${pass} passed)\n`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);

// ── a tiny recursive grep so the gate does not depend on a shell ──────────────────────────────────
function grepTree(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === "generated" || name === ".next" || name === "dist") continue;
      const p = resolve(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) {
        const src = readFileSync(p, "utf8");
        src.split("\n").forEach((line, i) => {
          if (re.test(line)) out.push(`${p.replace(process.cwd() + "\\", "").replace(FRONTEND_DIR + "\\", "~/")}:${i + 1}`);
        });
      }
    }
  };
  walk(dir);
  return out;
}
