// ─────────────────────────────────────────────────────────────────────────────
// PHS PERSISTENCE SMOKE — the A.12 compute+persist contract end-to-end on a seeded
// user with REAL holdings (live prices/tiers/sectors/scores). Proves: assemble →
// computePhs → write ONE snapshot; re-run identical inputs → fingerprint match → skip.
// Throwaway user, cleaned up (cascade).
//   npx tsx src/scripts/verify-phs-persist.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { computeAndPersistPhs } from "../portfolio/phs/persist.js";
// (§15, asserted in batch 3) The tier CUTS survive; `structureTierOf()` does not. Imported so the cuts
// are read from their declared home rather than restated here — the same rule `copyRegisterOf` follows.
import * as K from "../portfolio/phs/constants.js";

let failures = 0;
const ok = (n: string, c: boolean, d: string) => { console.log(`  ${c ? "✅" : "❌"} ${n} — ${d}`); if (!c) failures++; };

async function main() {
  // Pick scored + unscored live stocks (all carry price+tier+sector from prior passes).
  const scored = await prisma.stock.findMany({ where: { symbol: { in: ["RELIANCE", "TCS", "HDFCBANK"] }, scoreSnapshots: { some: {} } }, select: { id: true, symbol: true } });
  const unscored = await prisma.stock.findMany({ where: { symbol: { in: ["LENSKART", "SWIGGY"] } }, select: { id: true, symbol: true } });
  if (scored.length < 2) { console.log("  ⚠ need scored RELIANCE/TCS/HDFCBANK — skipping"); return finish(); }

  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `phs-${authId}@test.local`);
  const user = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  const userId = user!.id;

  try {
    // Holdings now belong to an account — give this test user its default "My Holdings".
    const account = await prisma.portfolioAccount.create({ data: { userId, name: "My Holdings", broker: "zerodha", state: "manual" }, select: { id: true } });
    // Real holdings (direct create — PHS reads holdings regardless of how they were built).
    // A holding is OF an instrument: resolve the stock's catalog pointer-row (1:1).
    const mk = async (stockId: string, qty: number) => {
      const instrument = await prisma.instrument.findUniqueOrThrow({ where: { stockId }, select: { id: true } });
      return prisma.holding.create({ data: {
        userId, accountId: account.id, instrumentId: instrument.id, stockId,
        quantity: new Prisma.Decimal(qty), avgCost: new Prisma.Decimal(100),
        investedValue: new Prisma.Decimal(qty * 100), realizedPnl: new Prisma.Decimal(0), lastComputedAt: new Date(),
      }});
    };
    for (const s of scored) await mk(s.id, 20);
    for (const s of unscored) await mk(s.id, 30);

    // First compute → writes a snapshot.
    const first = await computeAndPersistPhs(userId);
    ok("first compute writes a snapshot", !first.skipped && !!first.snapshotId, `skipped=${first.skipped} phs=${first.phs} band=${first.band}`);

    const snap = await prisma.portfolioHealthSnapshot.findUnique({ where: { id: first.snapshotId } });
    console.log(`     pillars: quality=${snap?.quality} structure=${snap?.structure} signals=${snap?.signals} · coverage=${snap?.coverage} · phs=${snap?.phs} ${snap?.band} · provisional=${snap?.provisional}`);
    console.log(`     value splits: total=${snap?.totalValue} scored=${snap?.scoredValue} recognized=${snap?.recognizedUnscoredValue} small=${snap?.smallUnscoredValue}`);
    ok("evaluable + phs present (has scored holdings)", snap?.evaluable === true && snap?.phs != null, `evaluable=${snap?.evaluable}`);
    ok("coverage = scored/total in (0,1)", Number(snap?.coverage) > 0 && Number(snap?.coverage) < 1, `c=${snap?.coverage}`);
    ok("structure ≤ 100 and signals ≤ 100 (penalty-only)", Number(snap?.structure) <= 100 && Number(snap?.signals) <= 100, `str=${snap?.structure} sig=${snap?.signals}`);
    ok("PHS ≤ Quality (penalty-only guarantee)", snap?.phs == null || snap?.quality == null || snap!.phs <= Math.ceil(Number(snap!.quality)), `phs=${snap?.phs} q=${snap?.quality}`);
    // (Stage 9 §15) structureLedger is NO LONGER WRITTEN — S1–S5 are deleted, so a NEW row carries NULL.
    // That is the honest value: "this row was never scored by S-rules." The COLUMN and its 31 historical
    // rows stay (nullable, never dropped — you cannot un-drop history), so a reader can still tell the two
    // eras apart. Asserted as NULL, not merely "not an array": a fabricated [] would claim the S-rules ran
    // and found nothing, which is a different (and false) statement from "they did not run."
    ok("structureLedger is NULL on a new row (S1–S5 gone; the column keeps its history)", snap?.structureLedger === null, `${JSON.stringify(snap?.structureLedger)}`);
    ok("signalsLedger is still an array (Signals is untouched by §15)", Array.isArray(snap?.signalsLedger), "json");
    // (Construction v2 Stage 5 — the CUTOVER) bumped 1.2 → 2.0: the displayed `structure` is now C1–C6
    // Net, so the fingerprint (which stamps this) MUST change to re-persist every book. See ruling ②.
    ok("constant_version stamped (2.0 — the cutover bump)", snap?.constantVersion === "portfolio-spec 2.0", `${snap?.constantVersion}`);
    // structure COLUMN is the C1–C6 Net now (not the S-composite) — a valid Construction number ≤ 100.
    ok("structure column = the C1–C6 Net (cutover), a valid Construction ≤ 100", Number(snap?.structure) >= 0 && Number(snap?.structure) <= 100, `net=${snap?.structure}`);
    // ── (Stage 9 §15 · corrected in Stage 10a batch 3) THE COPY INPUTS — AND WHAT IS NO LONGER ONE ────
    //
    // ⚠ THIS ASSERTION WAS STALE FOR A WHOLE STAGE, AND ITS NEIGHBOUR NINE LINES UP IS WHY THAT MATTERS.
    // It read `structure_tier persisted (valid label)` and expected one of Starter/Building/Established.
    // §15 DELETED `structureTierOf()` — new rows carry NULL — so it had been failing since §15 landed, and
    // it was still failing when batch 3 ran the suite.
    //
    // ★ §15 UPDATED `structureLedger` (line 59) AND MISSED THIS ONE. Same stage, same ruling, same file,
    // two lines apart: S1–S5 died, the ledger assertion was rewritten to assert NULL and explain why, and
    // the tier assertion — which died for the SAME reason in the SAME commit — was left asserting the old
    // world. A ruling applied by hand is applied unevenly; nothing connected the two, so nothing caught it.
    //
    // ── ★ THE RULING, ASSERTED RATHER THAN RESTATED ─────────────────────────────────────────────────
    //
    //     THE VOCABULARY LABELS THE INVESTOR, NOT THE BOOK.
    //
    // "Starter / Building / Established" is a REGISTER FOR A SENTENCE — never a badge, and never a field.
    // The engine stopped producing it; `patterns.ts` derives it from `holdingCount` at fire time
    // (`copyRegisterOf`) and spends it on a clause. So the honest shape of a new row is:
    //
    //   structure_tier  NULL     — retired from the payload. ★ The COLUMN survives and keeps its 31
    //                              historical rows (you cannot un-drop history), so a reader can still
    //                              tell the two eras apart. Asserted NULL, not merely "not a label": a
    //                              fabricated "Starter" would claim the engine tiered this book, which is
    //                              a different and false statement from "the engine no longer tiers."
    //                              (The same distinction line 59 makes about a fabricated [].)
    //   capital_tier    a label   — ALIVE. `capitalTierOf()` survives §15: it is a copy selector too, but
    //                              it labels the CAPITAL, not the investor, so the ruling never reached it.
    //   holdingCount    a number  — ALIVE, in constructionData. The input that REPLACED structure_tier.
    ok("★ structure_tier is NULL on a new row — §15 retired it from the payload (the column keeps its history)",
      snap?.structureTier === null, `${JSON.stringify(snap?.structureTier)}`);
    ok("capital_tier persisted (valid label) — a copy selector, and §15 never reached it",
      ["Modest", "Moderate", "Substantial"].includes(snap?.capitalTier ?? ""), `${snap?.capitalTier}`);

    // ★ AND THE REPLACEMENT IS PRESENT — otherwise "retired" would just mean "lost". The register has to
    // be derivable from the row, or §15 removed a field and took the sentence with it.
    const cdTier = (snap?.constructionData ?? null) as { holdingCount?: number } | null;
    ok("★ holdingCount persisted — the copy input that REPLACED structure_tier (copyRegisterOf reads it)",
      typeof cdTier?.holdingCount === "number", `holdingCount=${cdTier?.holdingCount}`);
    ok("★ …and it still selects a register off the DECLARED cuts (1–4 Starter · 5–7 Building · 8+ Established)",
      K.STRUCT_TIER_BUILDING_MIN === 5 && K.STRUCT_TIER_ESTABLISHED_MIN === 8,
      `building≥${K.STRUCT_TIER_BUILDING_MIN} established≥${K.STRUCT_TIER_ESTABLISHED_MIN} — the constants survive §15; only the function died`);

    // ★ NEVER A BADGE — the ruling's actual teeth, and the thing a NULL check alone does not prove. §15
    // did not merely relocate the tier; it forbade the payload from carrying one. A future writer putting
    // `structureTier` back on the row would satisfy every assertion above except this one.
    ok("★ the engine exports no structureTierOf — the register is DERIVED at fire time, never persisted",
      !("structureTierOf" in (K as unknown as Record<string, unknown>)),
      "the vocabulary labels the INVESTOR, not the book");
    // (Stage 7 §12) the dead v1.2 ceiling columns are DROPPED, not merely written null/false. Asserted on
    // the row's SHAPE: a column that no longer exists cannot be silently re-populated by a future writer.
    const snapKeys = snap as unknown as Record<string, unknown>;
    ok("dead v1.2 columns RETIRED from the row (phs_raw / ceiling_applied / ceiling_value dropped)",
      !("phsRaw" in snapKeys) && !("ceilingApplied" in snapKeys) && !("ceilingValue" in snapKeys),
      "ceiling retired in 1.2; columns dropped in Stage 7 (0 rows carried history)");
    // (1.2 Change 4/5) pillarProfile persisted (scored book).
    const pp = snap?.pillarProfile as { foundation: number } | null | undefined;
    ok("pillar_profile persisted (4 pillars, scored book)", !!pp && typeof pp.foundation === "number", `${JSON.stringify(pp)}`);
    console.log(`     pillarProfile=${JSON.stringify(snap?.pillarProfile)} · lensProfile=${JSON.stringify(snap?.lensProfile)}`);

    // Re-run identical inputs → fingerprint match → skip (no duplicate snapshot).
    const second = await computeAndPersistPhs(userId);
    ok("re-run skips (fingerprint idempotency)", second.skipped && second.snapshotId === first.snapshotId, `skipped=${second.skipped}`);
    const count = await prisma.portfolioHealthSnapshot.count({ where: { userId } });
    ok("exactly ONE snapshot row (append-only, no dup)", count === 1, `count=${count}`);
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);
    console.log("  [cleanup] test user + snapshot deleted (cascade)");
  }
  finish();
}
function finish() {
  console.log(`\n═══ ${failures === 0 ? "PERSIST SMOKE PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
  return prisma.$disconnect().then(() => process.exit(failures === 0 ? 0 : 1));
}
main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
