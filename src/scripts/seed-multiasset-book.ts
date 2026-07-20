// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GATE 1 — THE FIRST REAL MULTI-ASSET BOOK. Seeds a 6th, cleanly-separable test user with a hand-picked
// 13-holding book, then READS BACK exactly what the engine produces (no expectation asserted — the output
// IS the deliverable). Re-runnable: deletes the prior test user (by fixed email → cascade) and reseeds.
//
// Writes are scoped to the new user only; the 5 live users are never touched. Uses the DIRECT buy() path
// (resolve → ledger → replay), NOT addTransaction, to avoid enqueuing history-backfill background jobs
// (cv2-scheduler-hazard: keep the environment still). Reads via the real controllers over a mock req/res.
//
//   npx tsx src/scripts/seed-multiasset-book.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { replayAndMaterialize } from "../portfolio/replay.js";
import { resolveInstrument } from "../portfolio/resolve-instrument.js";
import { computeAndPersistPhs } from "../portfolio/phs/persist.js";
import { getPortfolioSnapshot } from "../controllers/me/portfolio-snapshot-controller.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";

const EMAIL = "__multiasset_book@test.invalid";
const TOTAL = 1_500_000; // ₹15L notional — qty sized off the live unit price so weight ≈ target
const TRADE_DATE = "2026-05-01";

// The approved book (GATE 0). weight = target share; sector/why for the report.
const BOOK: { isin: string; w: number; label: string }[] = [
  { isin: "INE733E01010", w: 0.11, label: "NTPC Ltd — stock — power" },
  { isin: "INE733E07JS0", w: 0.08, label: "NTPC TFB 7.28% 2030 — bond — power(inherit) [stem pair]" },
  { isin: "INE090A01021", w: 0.09, label: "ICICI Bank — stock — banks" },
  { isin: "INE467B01029", w: 0.09, label: "TCS — stock — it" },
  { isin: "INE030A01027", w: 0.08, label: "Hindustan Unilever — stock — fmcg" },
  { isin: "INE027E07998", w: 0.06, label: "SERENCD 8.98% — bond — NON-RESOLVING (own entity)" },
  { isin: "INF179K01UT0", w: 0.09, label: "HDFC Flexi Cap — fund — HDFC house" },
  { isin: "INF179K01YV8", w: 0.09, label: "HDFC Large Cap — fund — HDFC house" },
  { isin: "INF200K01QX4", w: 0.08, label: "SBI Large Cap — fund — SBI house" },
  { isin: "IN0020240183", w: 0.06, label: "GOI 6.75% 2029 — gsec — COUPON (PD3 fires)" },
  { isin: "IN002026X115", w: 0.05, label: "GOI T-Bill 91D 17/09/26 — gsec — DISCOUNT (PD3 silent)" },
  { isin: "INF846K01W80", w: 0.06, label: "Axis Gold ETF — etf — commodity" },
  { isin: "INE041025011", w: 0.06, label: "Embassy REIT — reit — name-risk" },
];

function mockRes() { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; }
function mockReq(userId: string, opts: { body?: any; params?: any; query?: any } = {}) { return { authUser: { userId }, body: opts.body ?? {}, params: opts.params ?? {}, query: opts.query ?? {} } as any; }

async function livePrice(isin: string): Promise<number> {
  const i = await prisma.instrument.findUnique({ where: { isin }, select: { stockId: true, lastPrice: true, currentNav: true } });
  if (!i) throw new Error(`no instrument ${isin}`);
  if (i.stockId) {
    const dp = await prisma.$queryRawUnsafe<any[]>(`SELECT close FROM daily_prices WHERE stock_id=$1 ORDER BY date DESC LIMIT 1`, i.stockId);
    if (!dp.length) throw new Error(`no daily price ${isin}`);
    return Number(dp[0].close);
  }
  const p = i.lastPrice ?? i.currentNav;
  if (p == null) throw new Error(`no price ${isin}`);
  return Number(p);
}

async function buy(userId: string, accountId: string, isin: string, qty: number, price: number) {
  const instr = await resolveInstrument(prisma, isin);
  return prisma.$transaction(async (tx) => {
    await tx.transaction.create({ data: { userId, accountId, instrumentId: instr.id, stockId: instr.stockId, type: "buy", quantity: new Prisma.Decimal(qty), price: new Prisma.Decimal(price), fees: null, tradeDate: new Date(TRADE_DATE), ratio: null, notes: "[multiasset-book]" } });
    return replayAndMaterialize(tx, userId, accountId, instr.id);
  });
}

/** JSON with long strings truncated so the shape is legible in one run. */
function show(label: string, obj: unknown) {
  const seen = new WeakSet();
  const s = JSON.stringify(obj, (_k, v) => {
    if (typeof v === "string" && v.length > 180) return v.slice(0, 180) + "…";
    if (typeof v === "object" && v !== null) { if (seen.has(v)) return "[circular]"; seen.add(v); }
    return v;
  }, 2);
  console.log(`\n${"█".repeat(100)}\n█ ${label}\n${"█".repeat(100)}\n${s}`);
}

async function main() {
  // ── 0 · re-runnable: delete the prior test user (cascades everything) ──
  const prior = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true, authUserId: true } });
  if (prior?.authUserId) {
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, prior.authUserId);
    console.log(`deleted prior test user ${prior.id} (cascade)`);
  }

  // ── 1 · create the 6th user via a real auth.users insert (trigger mints public.users) ──
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, EMAIL);
  const user = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!user) throw new Error("handle_new_user did not mint public.users — aborting");
  const USER = user.id;
  const acct = await prisma.portfolioAccount.create({ data: { userId: USER, name: "Multi-Asset Book", broker: "zerodha" as never, state: "manual" as never }, select: { id: true } });
  console.log(`6th user ${USER} · account ${acct.id} (auth ${authId})`);

  // ── 2 · seed the 13 holdings, sizing qty off the live unit price ──
  console.log("\n── SEEDING ──");
  for (const h of BOOK) {
    const px = await livePrice(h.isin);
    const qty = Math.max(1, Math.round((h.w * TOTAL) / px));
    await buy(USER, acct.id, h.isin, qty, px);
    console.log(`  ${h.isin}  qty=${String(qty).padStart(6)} @ ₹${String(px).padEnd(10)} ≈ ₹${Math.round(qty * px).toLocaleString("en-IN").padStart(9)}  ${h.label}`);
  }

  // ── 3 · persist the snapshot ──
  const outcome = await computeAndPersistPhs(USER);
  console.log(`\nsnapshot ${outcome.skipped ? "unchanged" : "persisted"} · phs=${outcome.phs} band=${outcome.band}`);

  // ── 4 · READ BACK via the real controllers (full production read) ──
  const snapRes = mockRes(); await getPortfolioSnapshot(mockReq(USER), snapRes);
  const holdRes = mockRes(); await listHoldings(mockReq(USER), holdRes);
  console.log(`\nsnapshot read: HTTP ${snapRes.statusCode} · holdings read: HTTP ${holdRes.statusCode}`);
  show("PORTFOLIO SNAPSHOT (story · findings · construction · health · coverage)", snapRes.body);
  show("HOLDINGS (weights · disclosures · coverage line)", holdRes.body);

  console.log(`\n✅ GATE 1 seeded + read. Test user: ${USER}  (email ${EMAIL})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
