// ═══════════════════════════════════════════════════════════════════════
// STEP 14.5 — GATE 3 VERIFICATION. Portfolio valuation reads non-stock instrument prices.
//
// Builds a genuinely MIXED book (stocks + ETF + REIT + fund + a dormant fund + an unmapped symbol),
// drives the REAL endpoint, and measures. Every non-stock assertion is paired with a STOCK
// assertion, because the un-waivable requirement is that stocks did not move.
//
//   npx tsx src/scripts/verify-step145-valuation.ts
// ═══════════════════════════════════════════════════════════════════════
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import type { BrokerId } from "../brokers/types.js";
import { integrate } from "../brokers/lifecycle.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";
import { linkAccount, createAccount } from "../controllers/me/accounts-controller.js";
import { addTransaction } from "../controllers/me/transactions-controller.js";
import { assemblePortfolio, listPortfolioDisclosure } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";

let fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(78) + "\n" + s + "\n" + "═".repeat(78));

const mockRes = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
};
const mockReq = (userId: string, o: any = {}) =>
  ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: o.query ?? {} }) as any;
const call = async (fn: any, userId: string, o: any = {}) => { const r = mockRes(); await fn(mockReq(userId, o), r); return r; };
const holdings = async (userId: string) => (await call(listHoldings, userId, { query: {} })).body.data;

const created: string[] = [];
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);

try {
  // ═══════════════════════════════════════════════════════════════
  rule("0 · PICK THE FIXTURES — real instruments, from the live catalogue");
  // ═══════════════════════════════════════════════════════════════
  const etfExch = (await q(`SELECT id, isin, symbol, name, last_price, last_price_date FROM instruments
                             WHERE asset_class='etf' AND last_price IS NOT NULL AND symbol IS NOT NULL
                             ORDER BY symbol LIMIT 1`))[0];
  const etfNav = (await q(`SELECT id, isin, symbol, name, current_nav, nav_date FROM instruments
                            WHERE asset_class='etf' AND last_price IS NULL AND is_active AND current_nav IS NOT NULL
                            LIMIT 1`))[0];
  const etfDead = (await q(`SELECT id, isin, symbol, name, current_nav, nav_date FROM instruments
                             WHERE asset_class='etf' AND NOT is_active AND current_nav IS NOT NULL
                             LIMIT 1`))[0];
  const reit = (await q(`SELECT id, isin, symbol, name, last_price, last_price_date FROM instruments
                          WHERE asset_class='reit' AND last_price IS NOT NULL ORDER BY symbol LIMIT 1`))[0];
  const mf = (await q(`SELECT id, isin, symbol, name, current_nav, nav_date FROM instruments
                        WHERE asset_class='mutual_fund' AND is_active AND current_nav IS NOT NULL LIMIT 1`))[0];

  console.log(`   ETF (exchange) : ${etfExch?.symbol}  ₹${etfExch?.last_price} @ ${etfExch?.last_price_date?.toISOString().slice(0, 10)}`);
  console.log(`   ETF (NAV only) : ${etfNav?.name?.slice(0, 44)}  NAV ₹${etfNav?.current_nav}`);
  console.log(`   ETF (DORMANT)  : ${etfDead?.name?.slice(0, 44)}  NAV ₹${etfDead?.current_nav} (is_active=false)`);
  console.log(`   REIT           : ${reit?.symbol}  ₹${reit?.last_price} @ ${reit?.last_price_date?.toISOString().slice(0, 10)}`);
  console.log(`   MF             : ${mf?.name?.slice(0, 44)}  NAV ₹${mf?.current_nav}`);
  ok("all five fixtures resolved", !!(etfExch && etfNav && etfDead && reit && mf));
  if (!etfExch || !etfNav || !etfDead || !reit || !mf) throw new Error("fixtures missing");

  // ═══════════════════════════════════════════════════════════════
  rule("1 · A PURE-STOCK BOOK — the baseline the change must not move");
  // ═══════════════════════════════════════════════════════════════
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `s145-${authId}@test.local`);
  created.push(authId);
  const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });

  const manualAcct = (await call(createAccount, userId, { body: { name: "Manual", broker: "zerodha" } })).body.data.id;
  await call(addTransaction, userId, { body: { symbol: "TCS", type: "buy", quantity: 10, price: 3000, tradeDate: "2024-01-01", accountId: manualAcct } });
  await call(addTransaction, userId, { body: { symbol: "INFY", type: "buy", quantity: 20, price: 500, tradeDate: "2024-01-02", accountId: manualAcct } });

  const before = await holdings(userId);
  const engineBefore = (await assemblePortfolio(userId)).holdings;

  const tcsBefore = before.holdings.find((h: any) => h.symbol === "TCS");
  const tcsPrice = Number((await prisma.stockPrice.findFirstOrThrow({ where: { stock: { symbol: "TCS" } }, select: { price: true } })).price);
  ok("a STOCK is priced from stock_prices, exactly as before",
    tcsBefore.priceSource === "stock_price" && Number(tcsBefore.currentPrice) === tcsPrice,
    `TCS currentPrice=${tcsBefore.currentPrice} (stock_prices=${tcsPrice}) source=${tcsBefore.priceSource}`);
  ok("a STOCK's marketValue = qty × stock_prices.price",
    Number(tcsBefore.marketValue) === 10 * tcsPrice, `${tcsBefore.marketValue} = 10 × ${tcsPrice}`);
  ok("a STOCK is NOT flagged heldNotValued / heldNotScored",
    tcsBefore.heldNotValued === false && tcsBefore.heldNotScored === false);

  // THE dayChangePct DENOMINATOR: on an all-stock book the new "sum over movers" formula must equal
  // the old `totalMarketValue - dayChange.total` exactly (every priced stock carries a prev_close).
  const mvAll = before.holdings.reduce((s: number, h: any) => s + (h.marketValue ?? 0), 0);
  const dcAll = before.holdings.reduce((s: number, h: any) => s + (h.dayChangeValue ?? 0), 0);
  const oldPrev = mvAll - dcAll;
  const oldPct = oldPrev > 0 ? ((dcAll / oldPrev) * 100).toFixed(4) : null;
  ok("dayChangePct on an all-stock book is BYTE-IDENTICAL to the old formula",
    before.totals.dayChangePct === oldPct, `new=${before.totals.dayChangePct} old=${oldPct}`);
  ok("no day-change partiality on an all-stock book", before.totals.partial.dayChange === false);

  // ═══════════════════════════════════════════════════════════════
  rule("2 · ADD THE NON-STOCK POSITIONS (broker-mirror — the only way to hold one today)");
  // ═══════════════════════════════════════════════════════════════
  const brokerAcct = (await call(createAccount, userId, { body: { name: "Demat", broker: "mock" as BrokerId } })).body.data.id;
  const conn = await integrate(userId, "mock" as BrokerId, {
    accepted: true, disclaimerVersion: "v1", params: { mockAccountRef: "DEMAT_145" },
  } as any);
  await call(linkAccount, userId, { params: { id: brokerAcct }, body: { connectionId: conn.id } });

  const put = (symbol: string, instrumentId: string | null, qty: number) =>
    prisma.brokerHolding.create({
      data: {
        userId, brokerConnectionId: conn.id, symbol, instrumentId, stockId: null,
        quantity: qty, avgCost: 100, syncedAt: new Date(),
      },
    });

  await put(etfExch.symbol, etfExch.id, 50); //  ETF, exchange close
  await put("ETFNAVONLY", etfNav.id, 7); //       ETF, NAV fallback (NSE does not list it)
  await put("ETFDORMANT", etfDead.id, 3); //      ETF, MATURED → must stay honest-null
  await put(reit.symbol, reit.id, 25); //         REIT, exchange close
  await put("SOMEFUND", mf.id, 12); //            mutual fund, NAV
  await put("NOSUCHTHING", null, 4); //           no instrument at all → honest-null

  const after = await holdings(userId);
  const row = (s: string) => after.holdings.find((h: any) => h.symbol === s);

  // ═══════════════════════════════════════════════════════════════
  rule("3 · BYTE-IDENTICAL — the stock rows did not move");
  // ═══════════════════════════════════════════════════════════════
  const tcsAfter = row("TCS");
  ok("TCS currentPrice / marketValue / dayChange UNCHANGED after non-stock rows joined the book",
    tcsAfter.currentPrice === tcsBefore.currentPrice &&
      tcsAfter.marketValue === tcsBefore.marketValue &&
      tcsAfter.dayChangeValue === tcsBefore.dayChangeValue &&
      tcsAfter.priceSource === "stock_price",
    `mv ${tcsBefore.marketValue} → ${tcsAfter.marketValue}`);
  const infyB = before.holdings.find((h: any) => h.symbol === "INFY");
  const infyA = row("INFY");
  ok("INFY unchanged too", infyA.marketValue === infyB.marketValue && infyA.currentPrice === infyB.currentPrice);

  // ═══════════════════════════════════════════════════════════════
  rule("4 · THE GAP IS CLOSED — non-stock holdings now carry a real value");
  // ═══════════════════════════════════════════════════════════════
  const e = row(etfExch.symbol);
  ok("ETF is VALUED at its EXCHANGE CLOSE (not its NAV)",
    e.marketValue != null && e.priceSource === "exchange_close" &&
      Math.abs(Number(e.marketValue) - 50 * Number(etfExch.last_price)) < 0.01,
    `${etfExch.symbol}: 50 × ₹${etfExch.last_price} = ₹${e.marketValue} (asOf ${e.priceAsOf})`);
  ok("ETF is heldNotValued=false, heldNotScored=TRUE (valued, never judged)",
    e.heldNotValued === false && e.heldNotScored === true);

  const r = row(reit.symbol);
  ok("REIT is VALUED at its exchange close",
    r.marketValue != null && r.priceSource === "exchange_close" &&
      Math.abs(Number(r.marketValue) - 25 * Number(reit.last_price)) < 0.01,
    `${reit.symbol}: 25 × ₹${reit.last_price} = ₹${r.marketValue} (asOf ${r.priceAsOf})`);
  ok("REIT is heldNotValued=false, heldNotScored=true", r.heldNotValued === false && r.heldNotScored === true);

  const en = row("ETFNAVONLY");
  ok("an ETF NSE does not list falls back to its AMFI NAV",
    en.marketValue != null && en.priceSource === "amfi_nav" &&
      Math.abs(Number(en.marketValue) - 7 * Number(etfNav.current_nav)) < 0.01,
    `7 × ₹${etfNav.current_nav} = ₹${en.marketValue}`);

  const f = row("SOMEFUND");
  ok("a mutual fund is VALUED at its NAV",
    f.marketValue != null && f.priceSource === "amfi_nav" &&
      Math.abs(Number(f.marketValue) - 12 * Number(mf.current_nav)) < 0.01,
    `12 × ₹${mf.current_nav} = ₹${f.marketValue}`);

  ok("every valued non-stock row carries the DATE its price belongs to",
    [e, r, en, f].every((h) => typeof h.priceAsOf === "string" && h.priceAsOf.length === 10));

  // ═══════════════════════════════════════════════════════════════
  rule("5 · HONEST-EMPTY PRESERVED — what we cannot price stays null, WITH a reason");
  // ═══════════════════════════════════════════════════════════════
  const d = row("ETFDORMANT");
  ok("a MATURED fund is NOT valued at its stale NAV — null, reason 'dormant'",
    d.marketValue === null && d.currentPrice === null && d.unpricedReason === "dormant" && d.heldNotValued === true,
    `${etfDead.name?.slice(0, 40)} (NAV ₹${etfDead.current_nav} from ${etfDead.nav_date?.toISOString().slice(0, 10)}) → marketValue=${d.marketValue}`);
  const n = row("NOSUCHTHING");
  ok("an unmapped broker symbol stays null, reason 'no_instrument'",
    n.marketValue === null && n.unpricedReason === "no_instrument" && n.heldNotValued === true);
  ok("NEITHER is coerced to 0", d.marketValue !== 0 && n.marketValue !== 0);

  // ═══════════════════════════════════════════════════════════════
  rule("6 · TOTALS — the mixed book adds up, and admits what it skipped");
  // ═══════════════════════════════════════════════════════════════
  const expected = after.holdings.reduce((s: number, h: any) => s + (h.marketValue ?? 0), 0);
  ok("totals.currentValue = Σ of every VALUED row (stocks + ETF + REIT + fund)",
    Math.abs(Number(after.totals.currentValue) - expected) < 0.01,
    `₹${after.totals.currentValue} over ${after.totals.pricedPositions} priced of ${after.totals.positions} positions`);
  ok("the 2 unpriceable rows are NOT counted as 0 (they are excluded, and disclosed)",
    after.totals.positions - after.totals.pricedPositions === 2);
  ok("day-change partiality is DISCLOSED (NAV-priced rows have no previous NAV)",
    after.totals.partial.dayChange === true);
  const moversMv = after.holdings.filter((h: any) => h.dayChangeValue != null)
    .reduce((s: number, h: any) => s + h.marketValue - h.dayChangeValue, 0);
  const dcTot = after.holdings.reduce((s: number, h: any) => s + (h.dayChangeValue ?? 0), 0);
  ok("dayChangePct is measured against exactly the capital that HAS a day-change",
    after.totals.dayChangePct === (moversMv > 0 ? ((dcTot / moversMv) * 100).toFixed(4) : null),
    `${after.totals.dayChangePct}%`);

  // ═══════════════════════════════════════════════════════════════
  rule("7 · HEALTH UNTOUCHED — the population grew, the Health number did not (CV2 Stage 0)");
  // ═══════════════════════════════════════════════════════════════
  // Step 14.5 froze a STRICTER contract here — the engine's input SET was byte-identical because
  // priced non-stocks were dropped from the score entirely. Construction v2 Stage 0 REVERSES that by
  // design: heldNotScored (a priced fund / ETF / REIT) is real capital, so it now ENTERS the engine
  // as UNSCORED weight (health=null). The un-waivable is no longer "input identical" — it is "HEALTH
  // identical": unscored capital contributes NOTHING to Quality (renormalized over scored) or to
  // Signals (also renormalized over scored, Ruling i), so the Health VALUE cannot move as the book grows.
  const engineAfter = (await assemblePortfolio(userId)).holdings;
  const hBefore = computePhs(engineBefore);
  const hAfter = computePhs(engineAfter);
  ok("HEALTH is byte-identical before and after the non-stock rows landed (the un-waivable)",
    hBefore.health === hAfter.health && hBefore.quality === hAfter.quality && hBefore.signals === hAfter.signals,
    `health ${hBefore.health}→${hAfter.health} · quality ${hBefore.quality}→${hAfter.quality} · signals ${hBefore.signals}→${hAfter.signals}`);
  const unscoredAfter = engineAfter.filter((h: any) => h.health === null);
  ok("the 4 PRICED non-stocks now ENTER the engine as unscored capital (health=null, tier unknown)",
    engineAfter.length === engineBefore.length + 4 && unscoredAfter.length === 4 &&
      unscoredAfter.every((h: any) => h.tier === "unknown" && h.sector === null),
    `${engineBefore.length} → ${engineAfter.length} holdings (${unscoredAfter.length} unscored)`);
  ok("the 2 genuinely unpriceable rows did NOT enter the score (still heldNotValued)",
    engineAfter.every((h: any) => h.symbol !== "ETFDORMANT" && h.symbol !== "NOSUCHTHING"));

  const disc = await listPortfolioDisclosure(userId);
  ok("totalValue GREW by exactly the heldNotScored value (the population fix — funds now weigh in)",
    Math.abs(hAfter.totalValue - hBefore.totalValue -
      disc.heldNotScored.reduce((s, h) => s + Number(h.marketValue), 0)) < 0.01,
    `Δ totalValue = ₹${(hAfter.totalValue - hBefore.totalValue).toFixed(2)}`);
  ok("disclosure: the priced-but-unscorable rows are heldNotSCORED (not 'could not price')",
    disc.heldNotScored.length === 4 &&
      disc.heldNotScored.every((h) => Number(h.marketValue) > 0),
    disc.heldNotScored.map((h) => `${h.symbol}=₹${h.marketValue}(${h.priceSource})`).join(" · "));
  ok("disclosure: only the genuinely unpriceable rows remain heldNotVALUED",
    disc.heldNotValued.length === 2 &&
      disc.heldNotValued.every((h) => ["ETFDORMANT", "NOSUCHTHING"].includes(h.symbol)),
    disc.heldNotValued.map((h) => h.symbol).join(", "));
  ok("disclosure: heldNotScoredValue is the ₹ outside the score",
    Math.abs(Number(disc.heldNotScoredValue) -
      disc.heldNotScored.reduce((s, h) => s + Number(h.marketValue), 0)) < 0.01,
    `₹${disc.heldNotScoredValue}`);
  ok("NO non-stock instrument acquired a stock row or a score",
    (await q(`SELECT count(*)::int n FROM instruments i JOIN stocks s ON s.isin = i.isin
               WHERE i.asset_class <> 'stock'`))[0].n === 0);

  // ═══════════════════════════════════════════════════════════════
  rule("8 · THE 3 FINGERPRINTS — un-waivable");
  // ═══════════════════════════════════════════════════════════════
  const fpA = (await q(`SELECT count(*)::int n, md5(string_agg(id||'|'||symbol||'|'||isin||'|'||name, ',' ORDER BY id)) fp FROM stocks`))[0];
  ok("504 stocks unchanged", fpA.n === 504 && fpA.fp === "3add5d41096ac195f51cb15a2a383ab9", `${fpA.n} · ${fpA.fp}`);

  const fundFp = (cls: string) => `SELECT count(*)::int n, md5(string_agg(
      isin||'|'||coalesce(symbol,'~')||'|'||name||'|'||coalesce(amfi_scheme_code,'~')||'|'||
      coalesce(scheme_name,'~')||'|'||coalesce(fund_house,'~')||'|'||coalesce(category,'~')||'|'||
      coalesce(plan_type,'~')||'|'||coalesce(current_nav::text,'~')||'|'||
      coalesce(nav_date::text,'~')||'|'||is_active::text, ',' ORDER BY isin)) fp
    FROM instruments WHERE asset_class = '${cls}'`;
  const fpB = (await q(fundFp("mutual_fund")))[0];
  ok("17,567 MF rows unchanged", fpB.n === 17567 && fpB.fp === "651f6ba0132b4dc0657e611bb9559969", `${fpB.n} · ${fpB.fp}`);
  const fpC = (await q(fundFp("etf")))[0];
  ok("337 ETF rows unchanged (last_price is NOT part of the identity fingerprint)",
    fpC.n === 337 && fpC.fp === "dae247ae2c8a1cb7617c783e30085d01", `${fpC.n} · ${fpC.fp}`);
  const fpD = (await q(`SELECT count(*)::int n FROM mf_analytics`))[0];
  ok("14,041 mf_analytics rows unchanged", fpD.n === 14041, `${fpD.n}`);

  ok("daily_prices / stock_prices STILL have no instrument_id (the equity spine is untouched)",
    (await q(`SELECT count(*)::int n FROM information_schema.columns
               WHERE table_name IN ('daily_prices','stock_prices') AND column_name='instrument_id'`))[0].n === 0);
} finally {
  for (const a of created) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
}

rule("SUMMARY");
console.log(`\n   ${fail === 0 ? "✅" : "❌"} ${fail} failure(s)\n`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
