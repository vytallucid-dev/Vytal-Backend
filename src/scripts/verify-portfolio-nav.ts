// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO NAV CORRECTNESS HARNESS.
// Part 1 — PURE engine (computeNavSeries): first-buy start, price tracking, sells,
//   full exit → 0, carry-forward across price gaps, never-priced honesty, split qty.
// Part 2 — DB END-TO-END: seed a throwaway user, buy a REAL stock that has DailyPrice
//   history (via the real addTransaction path), compute NAV over the live closes, then
//   sell it all and confirm the tail goes to 0. Read-only compute (deterministic).
//   npx tsx src/scripts/verify-portfolio-nav.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { computeNavSeries, type NavLedgerTxn, type NavPricePoint } from "../portfolio/nav/engine.js";
import { computePortfolioNav } from "../portfolio/nav/assemble.js";
import { addTransaction } from "../controllers/me/transactions-controller.js";

let failures = 0;
function assert(name: string, cond: boolean, detail: string) {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
}
const near = (a: number | undefined, b: number) => a != null && Math.abs(a - b) < 1e-6;

// builders
const buy = (symbol: string, quantity: number, tradeDate: string): NavLedgerTxn => ({ symbol, type: "buy", quantity, ratio: null, tradeDate });
const sell = (symbol: string, quantity: number, tradeDate: string): NavLedgerTxn => ({ symbol, type: "sell", quantity, ratio: null, tradeDate });
const split = (symbol: string, ratio: string, tradeDate: string): NavLedgerTxn => ({ symbol, type: "split", quantity: null, ratio, tradeDate });
const pm = (obj: Record<string, [string, number][]>) => {
  const m = new Map<string, NavPricePoint[]>();
  for (const [sym, pts] of Object.entries(obj)) m.set(sym, pts.map(([date, close]) => ({ date, close })));
  return m;
};
const valAt = (series: { date: string; value: number }[], date: string) => series.find((p) => p.date === date)?.value;

async function seedUser(): Promise<{ authId: string; userId: string }> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `nav-${authId}@test.local`);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error("signup trigger did not create public.users");
  return { authId, userId: u.id };
}
const cleanupUser = (authId: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);

function mockRes() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
const mockReq = (userId: string, body: any) => ({ authUser: { userId }, body, params: {}, query: {} }) as any;
const post = async (userId: string, body: any) => { const r = mockRes(); await addTransaction(mockReq(userId, body), r); return r; };

async function main() {
  console.log("═══ PART 1 — PURE NAV ENGINE ═══");

  // Case A — first buy starts the series; value tracks the close.
  const A = computeNavSeries([buy("A", 10, "2024-01-01")], pm({ A: [["2024-01-01", 100], ["2024-01-02", 110], ["2024-01-03", 105]] }));
  console.log("\nCase A — buy 10 A, close 100→110→105:");
  assert("starts at first buy", A.firstDate === "2024-01-01", `firstDate=${A.firstDate}`);
  assert("3 trading-day points", A.points === 3, `points=${A.points}`);
  assert("value tracks close (1000/1100/1050)", near(valAt(A.series, "2024-01-01"), 1000) && near(valAt(A.series, "2024-01-02"), 1100) && near(valAt(A.series, "2024-01-03"), 1050), JSON.stringify(A.series.map((p) => p.value)));

  // Case B — a sell lowers held qty from its date.
  const B = computeNavSeries([buy("A", 10, "2024-01-01"), sell("A", 4, "2024-01-02")], pm({ A: [["2024-01-01", 100], ["2024-01-02", 100], ["2024-01-03", 100]] }));
  console.log("\nCase B — buy 10 then sell 4 on 01-02:");
  assert("pre-sell 10×100=1000", near(valAt(B.series, "2024-01-01"), 1000), `${valAt(B.series, "2024-01-01")}`);
  assert("from sell date 6×100=600", near(valAt(B.series, "2024-01-02"), 600) && near(valAt(B.series, "2024-01-03"), 600), `${valAt(B.series, "2024-01-02")}/${valAt(B.series, "2024-01-03")}`);

  // Case C — full exit → stops contributing (value 0 from the exit day).
  const C = computeNavSeries([buy("A", 10, "2024-01-01"), sell("A", 10, "2024-01-03")], pm({ A: [["2024-01-01", 100], ["2024-01-02", 100], ["2024-01-03", 100], ["2024-01-04", 100]] }));
  console.log("\nCase C — full exit on 01-03:");
  assert("held before exit >0", near(valAt(C.series, "2024-01-02"), 1000), `${valAt(C.series, "2024-01-02")}`);
  assert("exit day + after == 0", near(valAt(C.series, "2024-01-03"), 0) && near(valAt(C.series, "2024-01-04"), 0), `${valAt(C.series, "2024-01-03")}/${valAt(C.series, "2024-01-04")}`);

  // Case D — carry-forward: B missing 01-02's close uses its last known close (not 0).
  const D = computeNavSeries(
    [buy("A", 10, "2024-01-01"), buy("B", 5, "2024-01-01")],
    pm({ A: [["2024-01-01", 100], ["2024-01-02", 100], ["2024-01-03", 100]], B: [["2024-01-01", 50], ["2024-01-03", 60]] }),
  );
  console.log("\nCase D — B has no 01-02 close (gap):");
  // 01-02: A 10×100=1000 + B carries forward 50 → 5×50=250 = 1250 (NOT 1000 with B dropped to 0)
  assert("gap day carries forward (1250, not 1000)", near(valAt(D.series, "2024-01-02"), 1250), `${valAt(D.series, "2024-01-02")}`);
  assert("next real close applies (01-03=1300)", near(valAt(D.series, "2024-01-03"), 1300), `${valAt(D.series, "2024-01-03")}`);

  // Case E — a held symbol that never has a close contributes nothing (honest), not faked.
  const E = computeNavSeries([buy("A", 10, "2024-01-01"), buy("C", 5, "2024-01-01")], pm({ A: [["2024-01-01", 100]] }));
  console.log("\nCase E — C held but never priced:");
  assert("C reported as no-price", E.symbolsNoPrice.includes("C"), `symbolsNoPrice=${JSON.stringify(E.symbolsNoPrice)}`);
  assert("value = A only (1000)", near(valAt(E.series, "2024-01-01"), 1000), `${valAt(E.series, "2024-01-01")}`);

  // Case F — split scales held qty (same "a:b" convention as the FIFO engine).
  const F = computeNavSeries([buy("A", 10, "2024-01-01"), split("A", "1:1", "2024-01-02")], pm({ A: [["2024-01-01", 100], ["2024-01-02", 100]] }));
  console.log("\nCase F — split 1:1 (qty ×2) on 01-02:");
  assert("post-split qty doubles (2000)", near(valAt(F.series, "2024-01-02"), 2000), `${valAt(F.series, "2024-01-02")}`);

  // Case G — young book: no value before the first buy; series starts at first buy.
  const G = computeNavSeries([buy("A", 10, "2024-01-05")], pm({ A: [["2024-01-01", 100], ["2024-01-02", 100], ["2024-01-05", 100], ["2024-01-06", 100]] }));
  console.log("\nCase G — first buy 01-05, prices exist earlier:");
  assert("no pre-history (starts 01-05)", G.firstDate === "2024-01-05" && G.series[0]?.date === "2024-01-05", `firstDate=${G.firstDate} first=${G.series[0]?.date}`);
  assert("earlier dates absent", valAt(G.series, "2024-01-01") === undefined, "01-01 not emitted");

  // ═══ PART 2 — DB END-TO-END on live DailyPrice history ═══
  console.log("\n═══ PART 2 — DB END-TO-END (real stock w/ DailyPrice) ═══");
  const anyPrice = await prisma.dailyPrice.findFirst({ orderBy: { date: "desc" }, select: { stockId: true } });
  if (!anyPrice) { console.log("  ⚠ no DailyPrice rows — skipping DB E2E"); return finish(); }
  const stock = await prisma.stock.findUnique({ where: { id: anyPrice.stockId }, select: { symbol: true } });
  const dates = await prisma.dailyPrice.findMany({ where: { stockId: anyPrice.stockId }, orderBy: { date: "asc" }, select: { date: true } });
  if (!stock || dates.length < 12) { console.log(`  ⚠ ${stock?.symbol ?? "stock"} has only ${dates.length} daily prices — skipping DB E2E`); return finish(); }

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const buyIdx = Math.max(0, dates.length - 60);
  const sellIdx = dates.length - 5;
  const buyDate = iso(dates[buyIdx].date);
  const midDate = iso(dates[Math.min(dates.length - 20, buyIdx + 10)].date);
  const sellDate = iso(dates[sellIdx].date);
  const lastDate = iso(dates[dates.length - 1].date);
  console.log(`  Using ${stock.symbol}: buy ${buyDate} · last close ${lastDate} (${dates.length - buyIdx} trading days)`);

  const u = await seedUser();
  try {
    const bought = await post(u.userId, { symbol: stock.symbol, type: "buy", quantity: 100, price: 100, tradeDate: buyDate });
    assert("buy accepted", bought.statusCode === 201, `status=${bought.statusCode}`);

    const nav1 = await computePortfolioNav(u.userId);
    console.log(`  NAV after buy — ${nav1.points} points, ${nav1.firstDate} → ${nav1.lastDate}`);
    assert("series non-empty", nav1.points > 0, `points=${nav1.points}`);
    assert("starts at first buy (trading day)", nav1.firstDate === buyDate, `firstDate=${nav1.firstDate} buyDate=${buyDate}`);
    assert("ends at last close", nav1.lastDate === lastDate, `lastDate=${nav1.lastDate} exp=${lastDate}`);
    assert("first held day value > 0", (nav1.series[0]?.value ?? 0) > 0, `${nav1.series[0]?.value}`);
    assert("mid-series value > 0 (tracks price)", (valAt(nav1.series, midDate) ?? 0) > 0, `${midDate}=${valAt(nav1.series, midDate)}`);

    // deterministic + read-only: a second compute is byte-identical.
    const nav1b = await computePortfolioNav(u.userId);
    assert("recompute deterministic (read-only)", JSON.stringify(nav1.series) === JSON.stringify(nav1b.series), `pts ${nav1.points} vs ${nav1b.points}`);

    // full exit → the tail goes to 0 from the sell date.
    const sold = await post(u.userId, { symbol: stock.symbol, type: "sell", quantity: 100, price: 100, tradeDate: sellDate });
    assert("full sell accepted", sold.statusCode === 201, `status=${sold.statusCode}`);
    const nav2 = await computePortfolioNav(u.userId);
    assert("still held before exit (>0)", (valAt(nav2.series, midDate) ?? 0) > 0, `${midDate}=${valAt(nav2.series, midDate)}`);
    assert("last point == 0 after full exit", near(nav2.series[nav2.series.length - 1]?.value, 0), `last=${nav2.series[nav2.series.length - 1]?.value}`);
  } finally {
    await cleanupUser(u.authId);
    console.log("\n[cleanup] test user + portfolio rows deleted (cascade); no DailyPrice rows touched");
  }
  finish();
}

function finish() {
  console.log(`\n═══ ${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
  return prisma.$disconnect().then(() => process.exit(failures === 0 ? 0 : 1));
}
main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
