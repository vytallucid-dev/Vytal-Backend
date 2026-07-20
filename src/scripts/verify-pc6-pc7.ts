// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PC6 / PC7 — THE SAME-HOUSE FINDINGS ARE REACHABLE, PROVEN BY FIXTURE (not by assumption).
//
// The first real multi-asset book (2 HDFC funds, 18%) could not fire these — 18% < 40% (C5 clean). The
// ruling: LEAVE the 40 threshold; PC6/PC7 are FAR on the live cohort, not dead. "Six guards this build read
// as coverage and couldn't fire — don't add two more by assumption." So: a synthetic book that DOES reach
// them. maxHousePct is the top fund house's share of the WHOLE book (patterns.ts:469). PC6: >40 (≤80).
// PC7: >80, and it SUPPRESSES PC6 (§11.1 headline-wins). Pure — no DB.
//
//   npx tsx src/scripts/verify-pc6-pc7.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { firePortfolioFindings } from "../portfolio/phs/patterns.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };

const S = (sym: string, isin: string, mv: number, sector: string | null, health: number | null = 70): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "large", sector, health, findings: [], isin, assetClass: "stock" });
const F = (sym: string, isin: string, mv: number, fundHouse: string | null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "mutual_fund", fundHouse });

function run(book: PhsHolding[]) {
  const r = computePhs(book);
  const f = firePortfolioFindings(book, r, { fieldWeakSymbols: new Set() });
  const pc6 = f.find((x) => x.id === "PC6") as any;
  const pc7 = f.find((x) => x.id === "PC7") as any;
  const maxHouse = (pc6?.bind?.maxHousePct ?? pc7?.bind?.maxHousePct ?? null);
  return { ids: f.map((x) => x.id), pc6, pc7, maxHouse };
}

// ── FIXTURE A — one house at 45% of the book → PC6 fires, PC7 does NOT ──
const A = run([
  F("HFUND1", "INF00HDFC0A1", 150_000, "HDFC Mutual Fund"),
  F("HFUND2", "INF00HDFC0B2", 150_000, "HDFC Mutual Fund"),
  F("HFUND3", "INF00HDFC0C3", 150_000, "HDFC Mutual Fund"),
  S("ICICIBANK", "INE090A01021", 300_000, "banks", 70),
  S("TCS", "INE467B01029", 250_000, "it_technology", 72),
]); // total 1,000,000 · HDFC = 450k = 45%
console.log("\n── FIXTURE A: one house 45% of book ──");
ok("★★ PC6 FIRES at house 45% (>40, ≤80) — the same-house guard is REACHABLE", !!A.pc6, `maxHousePct=${A.maxHouse?.toFixed?.(2) ?? A.maxHouse} · constituents=${A.pc6?.bind?.constituents?.length}`);
ok("★ PC7 does NOT fire at 45% (needs >80)", !A.pc7);
ok("★ PC6 binds the house + its funds", A.pc6?.bind?.fundHouse === "HDFC Mutual Fund" && A.pc6?.bind?.constituents?.length === 3, `house=${A.pc6?.bind?.fundHouse} funds=${A.pc6?.bind?.constituents?.length}`);

// ── FIXTURE B — one house at 85% of the book → PC7 fires, PC6 SUPPRESSED ──
const B = run([
  F("HFUND1", "INF00HDFC0A1", 300_000, "HDFC Mutual Fund"),
  F("HFUND2", "INF00HDFC0B2", 300_000, "HDFC Mutual Fund"),
  F("HFUND3", "INF00HDFC0C3", 250_000, "HDFC Mutual Fund"),
  S("ICICIBANK", "INE090A01021", 150_000, "banks", 70),
]); // total 1,000,000 · HDFC = 850k = 85%
console.log("\n── FIXTURE B: one house 85% of book ──");
ok("★★ PC7 FIRES at house 85% (>80) — the single-house guard is REACHABLE", !!B.pc7, `maxHousePct=${B.maxHouse?.toFixed?.(2) ?? B.maxHouse}`);
ok("★★ PC6 is SUPPRESSED when PC7 fires (§11.1 headline-wins — never both)", !B.pc6);
ok("★ PC7 tone is Concern (louder than PC6's Caution)", B.pc7?.tone === "Concern", `tone=${B.pc7?.tone}`);

// ── NEGATIVE CONTROL — one house at EXACTLY 40% → NEITHER fires (the boundary is `>`, not `≥`) ──
const N = run([
  F("HFUND1", "INF00HDFC0A1", 200_000, "HDFC Mutual Fund"),
  F("HFUND2", "INF00HDFC0B2", 200_000, "HDFC Mutual Fund"),
  S("ICICIBANK", "INE090A01021", 600_000, "banks", 70),
]); // total 1,000,000 · HDFC = 400k = 40%
console.log("\n── NEGATIVE CONTROL: one house exactly 40% ──");
ok("★★ NEITHER PC6 nor PC7 fires at exactly 40% (the guard is a real threshold, not always-on)", !N.pc6 && !N.pc7, `maxHouse≈40% · pc6=${!!N.pc6} pc7=${!!N.pc7}`);

console.log("\n" + (fail === 0 ? "  ✅ PC6/PC7 — REACHABLE AND BOUNDED (all pass)" : `  ❌ ${fail} FAILURE(S)`));
process.exitCode = fail ? 1 : 0;
