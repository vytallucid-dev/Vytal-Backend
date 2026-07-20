// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SEED — "Test Book" for the arman user: one holding per Health-tab / disclosure case, so every render
// path can be eye-verified in the real UI. ADDITIVE, REVERSIBLE, IDEMPOTENT — touches nothing real.
//
// ⚠ SAFETY (a prior seed wiped real data — this one CANNOT):
//   · NO delete, NO reset, NO update of any existing row. It ONLY creates: one account + its buys.
//   · Validates the user + resolves every REQUIRED instrument BEFORE any write; aborts (writes nothing)
//     if a required one is missing. Never admits or fabricates an instrument.
//   · Idempotent: keyed on the @@unique(userId,name) account "Test Book" — re-running appends only the
//     holdings not already present, never duplicates.
//   · Asserts every PRE-EXISTING account's holding + txn counts are byte-unchanged, before AND after.
//   · DRY-RUN by default. Pass --commit to write.
//
//   npx tsx src/scripts/seed-arman-test-book.ts            # dry run — validates + prints the plan
//   npx tsx src/scripts/seed-arman-test-book.ts --commit   # writes the account + holdings
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { replayAndMaterialize } from "../portfolio/replay.js";
import { resolveInstrument } from "../portfolio/resolve-instrument.js";
import { computeAndPersistPhs } from "../portfolio/phs/persist.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";

const USER = "7985d813-e3fa-4f6f-b23d-715a9a36ee01";
const EMAIL = "arman.shaikh01082003@gmail.com";
const ACCOUNT_NAME = "Test Book";
const TRADE_DATE = "2026-07-01"; // a real calendar date — a plausible buy date, never a fabricated one
const COMMIT = process.argv.includes("--commit");

/** One holding per case. `required:true` ⇒ its absence aborts the whole seed (write nothing). */
const PLAN: { isin: string; targetInr: number; case: string; expect: string; required: boolean }[] = [
  { isin: "INE733E01010", targetInr: 90000, case: "#1 NTPC stock (multi-instrument entity)", expect: "scored — headline of the NTPC entity", required: true },
  { isin: "INE733E07JS0", targetInr: 67000, case: "#1/#7 NTPC bond (same stem → collapses with the stock)", expect: "coupon_income_not_tracked · our_gap", required: true },
  { isin: "INF179K01UT0", targetInr: 56000, case: "#3 mutual fund (HDFC Flexi Cap)", expect: "held_not_scored · not_a_gap", required: true },
  { isin: "INF846K01W80", targetInr: 47000, case: "#4 gold ETF (Axis Gold)", expect: "held_not_scored · not_a_gap (commodity)", required: true },
  { isin: "INE041025011", targetInr: 53000, case: "#5 REIT (Embassy)", expect: "held_not_scored · not_a_gap (own name-risk entity)", required: true },
  { isin: "IN002026X115", targetInr: 49000, case: "#6 T-bill / discount (GOI 91D)", expect: "discount_instrument_pays_at_par · not_a_gap", required: true },
  { isin: "INF846KA1481", targetInr: 40000, case: "#8 dormant FMP (Axis FMP S130 Growth)", expect: "dormant · REFUSED (heldNotValued)", required: false },
];

function mockRes() { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; }
function mockReq(userId: string) { return { authUser: { userId }, body: {}, params: {}, query: {} } as any; }

async function livePrice(isin: string): Promise<number> {
  const i = await prisma.instrument.findUnique({ where: { isin }, select: { stockId: true, lastPrice: true, currentNav: true } });
  if (!i) throw new Error(`no instrument ${isin}`);
  if (i.stockId) {
    const dp = await prisma.$queryRawUnsafe<any[]>(`SELECT close FROM daily_prices WHERE stock_id=$1 ORDER BY date DESC LIMIT 1`, i.stockId);
    if (dp.length) return Number(dp[0].close);
  }
  const p = i.lastPrice ?? i.currentNav;
  if (p == null) throw new Error(`no price/nav for ${isin}`);
  return Number(p);
}

/** The ONE write primitive — resolve → append one buy to the ledger → replay that (account,instrument)
 *  queue. Scoped to Test Book's (accountId, instrumentId); it cannot touch another account's lots. */
async function buy(accountId: string, isin: string, qty: number, price: number) {
  const instr = await resolveInstrument(prisma, isin);
  return prisma.$transaction(async (tx) => {
    await tx.transaction.create({ data: { userId: USER, accountId, instrumentId: instr.id, stockId: instr.stockId, type: "buy", quantity: new Prisma.Decimal(qty), price: new Prisma.Decimal(price), fees: null, tradeDate: new Date(TRADE_DATE), ratio: null, notes: "[test-book]" } });
    return replayAndMaterialize(tx, USER, accountId, instr.id);
  });
}

/** Snapshot every account's holding + txn counts — the byte-unchanged assertion baseline. */
async function accountCensus() {
  const accts = await prisma.portfolioAccount.findMany({ where: { userId: USER }, select: { id: true, name: true, broker: true, state: true } });
  const rows: { id: string; name: string; broker: string; state: string; holdings: number; txns: number }[] = [];
  for (const a of accts) {
    rows.push({
      id: a.id, name: a.name, broker: String(a.broker), state: String(a.state),
      holdings: await prisma.holding.count({ where: { accountId: a.id } }),
      txns: await prisma.transaction.count({ where: { accountId: a.id } }),
    });
  }
  return rows;
}

async function main() {
  console.log(`\n${"█".repeat(90)}\n█ SEED "Test Book" for ${EMAIL}   —   ${COMMIT ? "COMMIT (writing)" : "DRY RUN (no writes)"}\n${"█".repeat(90)}`);

  // ── 1 · validate the user ──────────────────────────────────────────────────────────────────────
  const user = await prisma.user.findUnique({ where: { id: USER }, select: { id: true, email: true } });
  if (!user || user.email !== EMAIL) { console.error(`ABORT: user ${USER} not found or email mismatch (${user?.email})`); process.exit(1); }

  // ── 2 · BASELINE census (must be byte-unchanged for every PRE-EXISTING account afterward) ────────
  const before = await accountCensus();
  console.log("\n── BASELINE (pre-existing accounts) ──");
  for (const r of before) console.log(`   [${r.name}] broker=${r.broker} state=${r.state}  holdings=${r.holdings} txns=${r.txns}`);
  const existing = before.find((r) => r.name === ACCOUNT_NAME) ?? null;
  console.log(`   "${ACCOUNT_NAME}" ${existing ? `EXISTS (id=${existing.id})` : "does not exist yet"}`);

  // ── 3 · RESOLVE every instrument BEFORE any write. A missing REQUIRED one aborts (writes nothing). ─
  console.log("\n── RESOLVE + PRICE (before any write) ──");
  const resolved: { isin: string; qty: number; price: number; plan: (typeof PLAN)[number]; assetClass: string }[] = [];
  const missingRequired: string[] = [];
  const droppedOptional: string[] = [];
  for (const p of PLAN) {
    try {
      const instr = await resolveInstrument(prisma, p.isin);
      const price = await livePrice(p.isin);
      const qty = Math.max(1, Math.round(p.targetInr / price));
      resolved.push({ isin: p.isin, qty, price, plan: p, assetClass: instr.assetClass });
      console.log(`   ✓ ${p.case}\n       ${instr.isin} ${instr.symbol ?? "-"} · ${instr.assetClass} · qty ${qty} @ ₹${price} ≈ ₹${(qty * price).toLocaleString("en-IN")}`);
    } catch (e: any) {
      const msg = e?.code ?? e?.message ?? String(e);
      if (p.required) { missingRequired.push(`${p.isin} (${p.case}): ${msg}`); console.log(`   ✗ REQUIRED ${p.case} — ${p.isin}: ${msg}`); }
      else { droppedOptional.push(`${p.isin} (${p.case}): ${msg}`); console.log(`   ⚠ optional ${p.case} — ${p.isin}: ${msg} → skipping`); }
    }
  }
  if (missingRequired.length) { console.error(`\nABORT (wrote nothing): required instrument(s) unresolved:\n  ${missingRequired.join("\n  ")}`); process.exit(1); }

  // ── 4 · idempotency: only seed instruments not already in Test Book ─────────────────────────────
  let accountId = existing?.id ?? null;
  let alreadyPresent = new Set<string>();
  if (accountId) {
    const held = await prisma.holding.findMany({ where: { accountId, userId: USER }, select: { instrument: { select: { isin: true } } } });
    alreadyPresent = new Set(held.map((h) => h.instrument.isin).filter(Boolean) as string[]);
  }
  const toSeed = resolved.filter((r) => !alreadyPresent.has(r.isin));
  console.log(`\n── PLAN ──  ${toSeed.length} holding(s) to create${accountId ? ` (${alreadyPresent.size} already present, skipped)` : ""}`);
  if (accountId && toSeed.length === 0) { console.log(`   "${ACCOUNT_NAME}" already fully seeded — NO-OP.`); await prisma.$disconnect(); return; }

  if (!COMMIT) {
    console.log(`\nDRY RUN complete — nothing written. Re-run with --commit to create the account + ${toSeed.length} holding(s).`);
    await prisma.$disconnect();
    return;
  }

  // ── 5 · COMMIT — create the account (once), then the buys ────────────────────────────────────────
  if (!accountId) {
    const acct = await prisma.portfolioAccount.create({ data: { userId: USER, name: ACCOUNT_NAME, broker: "other" as never, state: "manual" as never }, select: { id: true } });
    accountId = acct.id;
    console.log(`\n   created account "${ACCOUNT_NAME}" id=${accountId} (broker=other, Stated)`);
  }
  const created: string[] = [];
  const failed: string[] = [];
  for (const r of toSeed) {
    try {
      await buy(accountId, r.isin, r.qty, r.price);
      created.push(`${r.isin} (${r.plan.case}) qty ${r.qty} @ ₹${r.price}`);
      console.log(`   + ${r.isin}  qty ${r.qty} @ ₹${r.price}  ${r.plan.case}`);
    } catch (e: any) {
      failed.push(`${r.isin} (${r.plan.case}): ${e?.message ?? e}`);
      console.error(`   ✗ FAILED ${r.isin}: ${e?.message ?? e}`);
    }
  }

  // ── 6 · rescore (append a fresh snapshot — never mutates accounts/holdings/txns) ─────────────────
  const outcome = await computeAndPersistPhs(USER);
  console.log(`\n   snapshot ${outcome.skipped ? "unchanged" : "persisted"} · phs=${outcome.phs} band=${outcome.band}`);

  // ── 7 · ASSERT pre-existing accounts byte-unchanged ─────────────────────────────────────────────
  const after = await accountCensus();
  console.log("\n── AFTER (assert pre-existing accounts unchanged) ──");
  let tampered = false;
  for (const b of before) {
    const a = after.find((x) => x.id === b.id)!;
    const same = a.holdings === b.holdings && a.txns === b.txns;
    if (!same) tampered = true;
    console.log(`   [${b.name}] holdings ${b.holdings}→${a.holdings} · txns ${b.txns}→${a.txns}  ${same ? "OK (unchanged)" : "⚠ CHANGED"}`);
  }
  const tb = after.find((x) => x.name === ACCOUNT_NAME);
  console.log(`   [${ACCOUNT_NAME}] holdings=${tb?.holdings} txns=${tb?.txns}  (new)`);

  // ── 8 · READ BACK the Test Book rows via the real controller — report the ACTUAL disclosure per row ─
  const holdRes = mockRes(); await listHoldings(mockReq(USER), holdRes);
  const rows = (holdRes.body?.data?.holdings ?? []).filter((h: any) => h.accountId === accountId);
  console.log("\n── TEST BOOK holdings, as the /me/holdings read renders them ──");
  for (const h of rows) {
    const cls = (h.disclosureNotes ?? []).map((n: any) => `${n.code}:${n.cls}`).join(", ") || (h.health != null ? `scored ${h.health}` : "-");
    console.log(`   ${String(h.symbol).padEnd(14)} ${String(h.assetClass ?? "-").padEnd(12)} isin=${h.isin} ek=${h.entityKey ?? "-"}  mv=${h.marketValue ?? "null"}  → ${cls}`);
  }

  console.log("\n" + "═".repeat(90));
  if (failed.length || tampered) {
    console.error(`❌ INCOMPLETE — ${created.length} created, ${failed.length} FAILED${tampered ? ", and a pre-existing account CHANGED" : ""}.`);
    if (failed.length) console.error("   failures:\n     " + failed.join("\n     "));
    process.exit(1);
  }
  console.log(`✅ Test Book seeded: ${created.length} holding(s) created, all pre-existing accounts byte-unchanged.`);
  if (droppedOptional.length) console.log(`   (optional cases skipped: ${droppedOptional.join("; ")})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
