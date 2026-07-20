// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 0 — GATE 3 VERIFICATION (the population fix + the honest coverage line).
//
// Asserts the whole Stage-0 contract in one place:
//   1. UN-WAIVABLE — every live user's Health is byte-identical (recompute == persisted).
//   2. Ruling i  — Signals renormalizes over scored weight: a fund cannot lift a flagged stock's
//                  Signals (mixed book stays 44, not 58); a stocks-only book is identity.
//   3. Ruling 1  — heldNotScored enters totalValue + the weight vector; coverage becomes TRUE.
//   4. Ruling 2  — heldNotValued excluded from the denominator; unvaluedValue / unvaluedShare /
//                  constructionProvisional (fires strictly above 0.25) on the payload.
//   5. Ruling 3+4 — `invested` never in the weight vector; the `: 0` fallback is gone.
//
//   node_modules/.bin/tsx src/scripts/verify-cv2-stage0.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";
import { assemblePortfolio, listPortfolioDisclosure, constructionValuation } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { getPortfolioSnapshot } from "../controllers/me/portfolio-snapshot-controller.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(80) + "\n" + s + "\n" + "═".repeat(80));

const stock = (sym: string, mv: number, health: number | null, findings: any[] = []): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "large", sector: "IT", health, findings });
const fund = (sym: string, mv: number): PhsHolding => // exactly how a heldNotScored fund assembles
  ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [] });

/** Drive the REAL read controller with a minimal req/res — proves the wire payload, not a mock of it. */
function drive(userId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req: any = { authUser: { userId } };
    const res: any = { json: (b: any) => resolve(b), status: () => res };
    Promise.resolve(getPortfolioSnapshot(req, res)).catch(reject);
  });
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════════
  rule("1 · HEALTH UNMOVED — the un-waivable (§13). Live recompute == persisted, EVERY user.");
  // ═══════════════════════════════════════════════════════════════════════════════
  const users = await prisma.$queryRawUnsafe<{ user_id: string }[]>(`SELECT DISTINCT user_id FROM transactions`);
  for (const u of users) {
    const stored = await prisma.portfolioHealthSnapshot.findFirst({
      where: { userId: u.user_id }, orderBy: { createdAt: "desc" }, select: { phs: true },
    });
    const r = computePhs((await assemblePortfolio(u.user_id)).holdings);
    ok(`${u.user_id.slice(0, 8)} · Health byte-identical (recompute == persisted)`,
      r.health === (stored?.phs ?? null), `recompute ${r.health} vs persisted ${stored?.phs ?? "—"}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("2 · SIGNALS RENORMALIZES over scored weight (Ruling i) — the findings+funds collision.");
  // ═══════════════════════════════════════════════════════════════════════════════
  const c1 = computePhs([stock("FLAGGED", 100_000, 60, ["high"]), fund("NIFTYBEES", 900_000)]);
  ok("mixed book: a ₹9L fund does NOT lift the flagged stock — Health 44 (Signals 20), not 58",
    c1.health === 44 && c1.signals === 20, `health=${c1.health} signals=${c1.signals.toFixed(2)}`);
  // stocks-only (all scored → scoredValue==totalValue → wSig==w): identity with the pre-CV2 formula.
  const so = computePhs([stock("A", 100_000, 60, ["high"]), stock("B", 100_000, 80)]);
  ok("stocks-only book: renorm is identity — Signals 60 (= 100 − 80×0.5), byte-identical to pre-CV2",
    so.signals === 60, `signals=${so.signals}`);

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("3 · POPULATION (Ruling 1) — heldNotScored enters totalValue; the coverage line is TRUE.");
  // ═══════════════════════════════════════════════════════════════════════════════
  // The spec's motivating case, corrected: ₹10L scored stock + ₹90L fund.
  const mixed = computePhs([stock("ONESTOCK", 1_000_000, 70), fund("BIGFUND", 9_000_000)]);
  ok("₹10L-stock / ₹90L-fund: totalValue spans the WHOLE book (₹100L), scoredValue = ₹10L",
    mixed.totalValue === 10_000_000 && mixed.scoredValue === 1_000_000,
    `totalValue=₹${mixed.totalValue} scoredValue=₹${mixed.scoredValue}`);
  ok("…so coverage reads 10% of value (was 100% — the live defect this stage ends)",
    Math.round(mixed.coverage * 100) === 10, `coverage=${(mixed.coverage * 100).toFixed(1)}%`);
  ok("…and Health is UNTOUCHED (the fund contributes nothing — no findings, unscored)",
    mixed.health === 70, `health=${mixed.health} (== quality ${mixed.quality})`);

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("4 · Ruling 2 — heldNotValued EXCLUDED; unvaluedValue / unvaluedShare / provisional > 0.25.");
  // ═══════════════════════════════════════════════════════════════════════════════
  const hnv = (v: string) => ({ brokerCurrentValue: v } as any);
  const under = constructionValuation(1000, [hnv("100")]);           // 100/1100 = 9.09%
  ok("under threshold: unvaluedValue = ₹100.00, share ≈ 9.1%, provisional FALSE",
    under.unvaluedValue === "100.00" && Math.abs(under.unvaluedShare - 100 / 1100) < 1e-9 && under.constructionProvisional === false,
    `share=${(under.unvaluedShare * 100).toFixed(2)}%`);
  const at = constructionValuation(300, [hnv("100")]);               // 100/400 = 25% exactly (NOT > 0.25)
  ok("boundary: exactly 25% does NOT fire (strictly above 0.25)",
    at.constructionProvisional === false, `share=${(at.unvaluedShare * 100).toFixed(2)}%`);
  const over = constructionValuation(100, [hnv("100")]);             // 100/200 = 50%
  ok("over threshold: 50% fires constructionProvisional TRUE",
    over.constructionProvisional === true, `share=${(over.unvaluedShare * 100).toFixed(2)}%`);
  const none = constructionValuation(1000, []);
  ok("no unvalued capital: unvaluedValue = ₹0.00, share 0, provisional FALSE",
    none.unvaluedValue === "0.00" && none.unvaluedShare === 0 && none.constructionProvisional === false);

  // …and the fields are ON THE WIRE — drive the real controller for the user holding an unvalued row.
  let payloadChecked = false;
  for (const u of users) {
    const disc = await listPortfolioDisclosure(u.user_id);
    if (disc.heldNotValued.length === 0) continue;
    const body = await drive(u.user_id);
    const d = body?.data?.disclosure;
    ok(`payload (${u.user_id.slice(0, 8)}): controller emits unvaluedValue / unvaluedShare / constructionProvisional`,
      body?.success === true && typeof d?.unvaluedValue === "string" &&
        typeof d?.unvaluedShare === "number" && typeof d?.constructionProvisional === "boolean",
      `unvaluedValue=₹${d?.unvaluedValue} share=${(d?.unvaluedShare * 100).toFixed(2)}% provisional=${d?.constructionProvisional}`);
    payloadChecked = true;
    break;
  }
  ok("a live user with an unvalued position exists to prove the payload (else skipped honestly)", payloadChecked);

  // ═══════════════════════════════════════════════════════════════════════════════
  rule("5 · Ruling 3 + 4 — `invested` never in the weight vector; the `: 0` fallback is GONE.");
  // ═══════════════════════════════════════════════════════════════════════════════
  const engineSrc = readFileSync("src/portfolio/phs/engine.ts", "utf8");
  const assembleSrc = readFileSync("src/portfolio/phs/assemble.ts", "utf8");
  ok("engine.ts: the weight vector never reads `invested` / cost basis (Ruling 3 grep-guard)",
    !/\binvested\b/.test(engineSrc));
  ok("assemble.ts: marketValue is qty × price, never `invested`",
    !/\binvestedValue\b/.test(assembleSrc));
  ok("assemble.ts: the `: 0` marketValue fallback is REMOVED — a priceless stock now `continue`s",
    !/marketValue\s*=\s*price\s*\?[^;]*:\s*0/.test(assembleSrc) && assembleSrc.includes("if (!price) continue"));

  console.log(`\n${fail === 0 ? "✅ STAGE 0 VERIFIED — the population spans the real book, Health did not move" : `❌ ${fail} FAILURE(S)`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error("VERIFY ERROR:", e?.message ?? e); process.exitCode = 1; })
     .finally(() => prisma.$disconnect());
