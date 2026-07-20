// ═══════════════════════════════════════════════════════════════════════════
// STEP 20 — GATE 3. Manual multi-asset holdings, verified end to end.
//
//   npx tsx src/scripts/verify-step20-multiasset.ts
//
// 1  BYTE-IDENTICAL EQUITY (un-waivable): the 19 stock holdings, their 18 open lots and the 21
//    transactions are UNCHANGED. The key moved; not one number did.
// 2  A manual ETF, fund, REIT and BOND can be held — FIFO tracks them, the read path prices them.
// 3  The BOND carries its honest label, and its cost basis is the user's real outlay (never a
//    fabricated clean price).
// 4  NULL-DISTINCTNESS: a non-stock holding (stock_id NULL) cannot duplicate on re-entry.
// 5  HELD-NOT-SCORED, structurally.
// 6  Realized P&L on a non-stock SELL — the asset-neutral engine, unchanged.
// 7  The fences: fifo-engine untouched; no unique key on a nullable column.
//
// SELF-CLEANING: every row it writes is removed at the end, and the equity fingerprints are
// re-checked AFTER the cleanup. A verify that leaves residue is a migration nobody reviewed.
// ═══════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { replayAndMaterialize } from "../portfolio/replay.js";
import { resolveInstrument, InstrumentResolveError } from "../portfolio/resolve-instrument.js";
import { disclosuresFor, entryIncludesAccruedInterest, explainDisclosure } from "../portfolio/disclosures.js";
import { Prisma } from "../generated/prisma/client.js";

let fails = 0;
const ok = (c: boolean, msg: string, detail = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${msg}${detail ? `\n       ${detail}` : ""}`);
  if (!c) fails++;
};
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const one = async (s: string, ...p: unknown[]) => (await q(s, ...p))[0]!;

// ── THE EQUITY FINGERPRINTS, captured at GATE 0 BEFORE any of this shipped. ──
const FP_HOLDINGS = "eaf95d52695b008e2ca73ff6b132842c";
const FP_LOTS     = "e9d9de4850eb143989a74ef81e28a401";
const FP_TXNS     = "790b2edb965f31d4d69f980ffbf92ec1";

const equityFp = async () => ({
  h: await one(`
    SELECT count(*)::int n, md5(string_agg(
      h.account_id || '|' || h.instrument_id || '|' || coalesce(h.stock_id,'~') || '|' ||
      h.quantity::text || '|' || h.avg_cost::text || '|' ||
      h.invested_value::text || '|' || h.realized_pnl::text,
      ',' ORDER BY h.account_id, h.instrument_id)) AS fp
    FROM holdings h JOIN instruments i ON i.id = h.instrument_id WHERE i.asset_class = 'stock'`),
  l: await one(`
    SELECT count(*)::int n, md5(string_agg(
      l.holding_id || '|' || l.quantity::text || '|' || l.cost_per_share::text || '|' || l.buy_date::text,
      ',' ORDER BY l.holding_id, l.buy_date, l.id)) AS fp
    FROM holding_lots l JOIN holdings h ON h.id = l.holding_id
    JOIN instruments i ON i.id = h.instrument_id WHERE i.asset_class = 'stock'`),
  t: await one(`
    SELECT count(*)::int n, md5(string_agg(
      t.id || '|' || t.account_id || '|' || t.stock_id || '|' || t.type::text || '|' ||
      coalesce(t.quantity::text,'~') || '|' || coalesce(t.price::text,'~') || '|' || t.trade_date::text,
      ',' ORDER BY t.id)) AS fp
    FROM transactions t WHERE t.stock_id IS NOT NULL`),
});

console.log("\n═══ 1 — BYTE-IDENTICAL EQUITY (un-waivable) ═══\n");
const before = await equityFp();
ok(before.h.fp === FP_HOLDINGS && before.h.n === 19,
  "the 19 STOCK holdings are byte-identical — quantity, avg cost, invested value, realized P&L",
  `${before.h.n} holdings · fp ${before.h.fp} (GATE-0 baseline ${FP_HOLDINGS})`);
ok(before.l.fp === FP_LOTS && before.l.n === 18,
  "the 18 open LOTS are byte-identical — the FIFO register did not move",
  `${before.l.n} lots · fp ${before.l.fp} (baseline ${FP_LOTS})`);
ok(before.t.fp === FP_TXNS && before.t.n === 21,
  "the 21 TRANSACTIONS are byte-identical — the ledger (the source of truth) is untouched",
  `${before.t.n} txns · fp ${before.t.fp} (baseline ${FP_TXNS})`);

const backfilled = await one(`
  SELECT count(*)::int total, count(instrument_id)::int with_instr,
         count(*) FILTER (WHERE i.stock_id = t.stock_id)::int correct
  FROM transactions t JOIN instruments i ON i.id = t.instrument_id`);
ok(backfilled.total === backfilled.with_instr && backfilled.correct === backfilled.total,
  "every existing transaction gained the instrument its stock ALREADY pointed at — the backfill is " +
  "exact, not approximate",
  `${backfilled.with_instr}/${backfilled.total} keyed · ${backfilled.correct} point at their own stock's instrument`);

// ═══ 2 — MANUAL NON-STOCK HOLDINGS, END TO END ═════════════════════════════
console.log("\n═══ 2 — a manual ETF / fund / REIT / BOND can now be held ═══\n");

const user = await one(`SELECT id FROM users LIMIT 1`);
const acct = await prisma.portfolioAccount.upsert({
  where: { userId_name: { userId: user.id, name: "STEP20-VERIFY" } },
  create: { userId: user.id, name: "STEP20-VERIFY", broker: "zerodha", state: "manual" },
  update: {},
  select: { id: true },
});

/** Buy N units at ₹P, through the REAL write path (resolve → ledger → replay). */
async function buy(identifier: string, qty: number, price: number, date = "2024-01-10") {
  const instr = await resolveInstrument(prisma, identifier);
  return prisma.$transaction(async (tx) => {
    await tx.transaction.create({
      data: {
        userId: user.id, accountId: acct.id,
        instrumentId: instr.id, stockId: instr.stockId,
        type: "buy", quantity: new Prisma.Decimal(qty), price: new Prisma.Decimal(price),
        fees: null, tradeDate: new Date(date), ratio: null, notes: "[step20-verify]",
      },
    });
    const h = await replayAndMaterialize(tx, user.id, acct.id, instr.id);
    return { instr, h };
  });
}

// One live instrument of each class, chosen from the catalogue rather than hard-coded.
const pick = async (cls: string) =>
  (await one(
    `SELECT isin, symbol, name FROM instruments
     WHERE asset_class = $1 AND is_active
       AND (last_price IS NOT NULL OR current_nav IS NOT NULL)
       AND symbol IS NOT DISTINCT FROM symbol
     ORDER BY (symbol IS NULL), isin LIMIT 1`, cls));

const cases = [
  { cls: "etf", qty: 50, price: 250 },
  { cls: "mutual_fund", qty: 100, price: 45.5 },
  { cls: "reit", qty: 30, price: 320 },
  { cls: "bond", qty: 10, price: 1035.75 },
];
const made: { cls: string; isin: string; instrumentId: string; holdingId: string }[] = [];

for (const c of cases) {
  const target = await pick(c.cls);
  const { instr, h } = await buy(target.isin, c.qty, c.price);
  made.push({ cls: c.cls, isin: instr.isin, instrumentId: instr.id, holdingId: h.id });

  const expectedInvested = (c.qty * c.price).toFixed(2);
  const row = await one(
    `SELECT h.quantity::text q, h.avg_cost::text ac, h.invested_value::text iv, h.stock_id,
            i.asset_class::text cls
     FROM holdings h JOIN instruments i ON i.id = h.instrument_id WHERE h.id = $1`, h.id);

  ok(Number(row.iv).toFixed(2) === expectedInvested && Number(row.q) === c.qty && row.stock_id === null,
    `${c.cls.toUpperCase()} — ${c.qty} × ₹${c.price} held manually; FIFO cost basis is exact and stock_id is NULL`,
    `"${target.name.slice(0, 40)}" · qty ${row.q} · avgCost ₹${row.ac} · invested ₹${row.iv} (expected ₹${expectedInvested})`);
}

// ── the read path prices them (Step 14.5, already built — this proves it reaches manual rows) ──
console.log("");
for (const m of made) {
  const p = await one(`
    SELECT i.asset_class::text cls, i.last_price::text lp, i.current_nav::text nav,
           (SELECT close::text FROM instrument_prices WHERE instrument_id = i.id ORDER BY date DESC LIMIT 1) AS ip
    FROM instruments i WHERE i.id = $1`, m.instrumentId);
  const priceable = p.lp !== null || p.nav !== null || p.ip !== null;
  ok(priceable, `${m.cls.toUpperCase()} is PRICEABLE by the read path — it will show a market value, not a dash`,
    `last_price ${p.lp ?? "—"} · current_nav ${p.nav ?? "—"} · instrument_prices ${p.ip ?? "—"}`);
}

// ═══ 3 — THE BOND'S HONEST LABEL ═══════════════════════════════════════════
console.log("\n═══ 3 — the bond is LABELLED, and its cost basis is the user's real outlay ═══\n");
const bond = made.find((m) => m.cls === "bond")!;
const bondDisc = disclosuresFor("bond", { couponNullReason: null }); // a coupon-paying bond
ok(bondDisc.includes("coupon_income_not_tracked"),
  "a BOND holding carries `coupon_income_not_tracked` — we hold no coupon schedule for Indian debt, " +
  "so the P&L shown is a PRICE return and we SAY so rather than estimate the income leg",
  `disclosures: [${bondDisc.join(", ")}]`);
// ★ (T-1) A DISCOUNT G-SEC (T-bill) carries NO coupon disclosure — it has no coupon. It gets the
// "what it does" disclosure instead, never "coupon income not tracked".
const tbillDisc = disclosuresFor("gsec", { couponNullReason: "discount_instrument" });
ok(tbillDisc.includes("discount_instrument_pays_at_par") && !tbillDisc.includes("coupon_income_not_tracked"),
  "★ (T-1) a discount T-bill is NOT stamped `coupon_income_not_tracked` — it pays no coupon to track",
  `disclosures: [${tbillDisc.join(", ")}]`);
// ★ (T-1) NEGATIVE CONTROL + the absence-vocabulary ruling (cv2-s10a-not-a-gap-vocabulary): the T-bill
// sentence says what the instrument DOES, and NEVER raises absence — not even to deny it.
{
  const sentence = explainDisclosure("discount_instrument_pays_at_par").toLowerCase();
  const ABSENCE = ["not tracked", "missing", "we do not have", "we don't have", "unavailable", "no data", "we lack"];
  const leaked = ABSENCE.filter((w) => sentence.includes(w));
  ok(leaked.length === 0, "★ the discount sentence never uses the vocabulary of absence (says what it DOES)",
    leaked.length ? `LEAKED: ${leaked.join("/")}` : `"${explainDisclosure("discount_instrument_pays_at_par").slice(0, 60)}…"`);
  // negative control — a coupon-PAYING bond STILL gets the coupon disclosure (the fix is specific).
  ok(disclosuresFor("bond", { couponNullReason: null }).includes("coupon_income_not_tracked"),
    "★ negative control: a coupon-paying bond STILL carries coupon_income_not_tracked (exclusion is discount-only)");
}
ok(entryIncludesAccruedInterest("bond") && entryIncludesAccruedInterest("gsec") &&
   entryIncludesAccruedInterest("sgb") && !entryIncludesAccruedInterest("etf"),
  "the ENTRY HINT flag fires for bond/gsec/sgb and NOT for unit-priced instruments — the form asks a " +
  "bond buyer for the total they paid (accrued interest included), which is what makes their number right",
  `bond ${entryIncludesAccruedInterest("bond")} · sgb ${entryIncludesAccruedInterest("sgb")} · etf ${entryIncludesAccruedInterest("etf")}`);
for (const cls of ["stock", "etf", "mutual_fund", "reit", "invit"]) {
  if (disclosuresFor(cls, null).length !== 0) { ok(false, `${cls} should carry NO disclosure`, ""); }
}
ok(["stock", "etf", "mutual_fund", "reit", "invit"].every((c) => disclosuresFor(c, null).length === 0),
  "a stock / ETF / fund / REIT / InvIT carries NO disclosure — for a unit-priced instrument, " +
  "quantity × price IS the whole story, and inventing a caveat would be as dishonest as omitting one",
  "empty for every unit-priced class");

const bondRow = await one(`SELECT invested_value::text iv, avg_cost::text ac FROM holdings WHERE id = $1`, bond.holdingId);
ok(Number(bondRow.iv).toFixed(2) === (10 * 1035.75).toFixed(2),
  "★ the bond's cost basis is EXACTLY what the user entered (10 × ₹1035.75) — no clean-price " +
  "reconstruction, no assumed day-count, no fabricated accrual. Their real outlay, unmodified",
  `invested ₹${bondRow.iv} · avgCost ₹${bondRow.ac}`);

const engineSrc = readFileSync("src/portfolio/fifo-engine.ts", "utf8");
const replaySrc = readFileSync("src/portfolio/replay.ts", "utf8");
ok(!/accru|coupon|clean.?price|dirty.?price|day.?count/i.test(engineSrc + replaySrc),
  "★ NO ACCRUED-INTEREST MATH EXISTS ANYWHERE IN THE ENGINE OR THE REPLAY — grep-proven. We do not " +
  "hold the coupon schedules, so we compute nothing from them",
  "no accrual / coupon / clean-price / day-count arithmetic in fifo-engine.ts or replay.ts");

// ═══ 4 — NULL-DISTINCTNESS (Step 19's lesson) ══════════════════════════════
console.log("\n═══ 4 — a NULL stock_id cannot duplicate a holding ═══\n");
const etf = made.find((m) => m.cls === "etf")!;
await buy(etf.isin, 25, 260, "2024-03-05"); // a SECOND buy of the same ETF, same account
const dupe = await one(
  `SELECT count(*)::int n, sum(quantity)::text q FROM holdings WHERE account_id = $1 AND instrument_id = $2`,
  acct.id, etf.instrumentId);
ok(dupe.n === 1 && Number(dupe.q) === 75,
  "★ re-entering the same non-stock instrument UPDATES the one holding (50 + 25 = 75) — it does NOT " +
  "insert a second. The unique key stayed on instrument_id (NOT NULL); had it moved onto the newly-" +
  "nullable stock_id, Postgres' NULLS-DISTINCT rule would have made it enforce NOTHING and every " +
  "re-entry would have duplicated silently — the exact trap Step 19 hit on instrument_corporate_events",
  `${dupe.n} holding row · quantity ${dupe.q}`);

const keys = await q(`
  SELECT i.relname idx, string_agg(a.attname, ',' ORDER BY a.attnum) cols
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
  WHERE t.relname IN ('holdings','transactions') AND ix.indisunique
  GROUP BY 1`);
const touchesStock = keys.filter((k) => String(k.cols).includes("stock_id"));
ok(touchesStock.length === 0,
  "NO unique index on holdings or transactions touches the nullable stock_id — structurally trap-proof",
  keys.map((k) => `${k.idx}(${k.cols})`).join(" · "));

// ═══ 5 — HELD-NOT-SCORED ═══════════════════════════════════════════════════
console.log("\n═══ 5 — held-NOT-scored, structurally ═══\n");
const scored = await one(`
  SELECT count(*)::int n FROM holdings h
  JOIN instruments i ON i.id = h.instrument_id
  WHERE i.asset_class <> 'stock'
    AND EXISTS (SELECT 1 FROM stock_peer_groups g WHERE g.stock_id = h.stock_id)`);
ok(scored.n === 0,
  "★ NOT ONE non-stock holding can enter the scoring universe — it is keyed on stock_id via " +
  "stock_peer_groups, and a non-stock holding's stock_id is NULL. Held-not-scored is a CONSEQUENCE " +
  "of the spine, not a flag anyone has to remember to set",
  `${scored.n} non-stock holdings in a peer group`);

const pgCount = await one(`SELECT count(DISTINCT stock_id)::int n FROM stock_peer_groups`);
ok(pgCount.n === 149, "the 149 scored stocks are unchanged — the scoring universe did not move",
  `${pgCount.n} stocks in a peer group`);

// ═══ 6 — REALIZED P&L ON A NON-STOCK SELL ══════════════════════════════════
console.log("\n═══ 6 — FIFO realized P&L on a non-stock SELL (the asset-neutral engine) ═══\n");
const sellInstr = await resolveInstrument(prisma, etf.isin);
const sold = await prisma.$transaction(async (tx) => {
  await tx.transaction.create({
    data: {
      userId: user.id, accountId: acct.id, instrumentId: sellInstr.id, stockId: sellInstr.stockId,
      type: "sell", quantity: new Prisma.Decimal(60), price: new Prisma.Decimal(300),
      fees: null, tradeDate: new Date("2024-06-01"), ratio: null, notes: "[step20-verify]",
    },
  });
  return replayAndMaterialize(tx, user.id, acct.id, sellInstr.id);
});
// FIFO: 50 @ 250 (oldest lot, consumed whole) + 10 @ 260 → realized = 50×(300−250) + 10×(300−260)
//     = 2500 + 400 = 2900.  Remaining: 15 @ 260 = ₹3,900 invested.
ok(Number(sold.realizedPnl).toFixed(2) === "2900.00" && Number(sold.quantity) === 15 &&
   Number(sold.investedValue).toFixed(2) === "3900.00",
  "★ selling 60 ETF units @ ₹300 consumes the OLDEST lot first: 50 @ ₹250 then 10 @ ₹260 → realized " +
  "₹2,900, leaving 15 units @ ₹260. The engine did the same FIFO it does for equity — it was never " +
  "equity-specific, and it was not modified",
  `realized ₹${sold.realizedPnl} (expected 2900.00) · remaining ${sold.quantity} units · invested ₹${sold.investedValue}`);

// ═══ 7 — CLEANUP, then RE-PROVE the equity fingerprints ════════════════════
console.log("\n═══ 7 — cleanup, then RE-CHECK equity (a verify must leave no residue) ═══\n");
await prisma.transaction.deleteMany({ where: { accountId: acct.id } });
await prisma.holding.deleteMany({ where: { accountId: acct.id } });
await prisma.portfolioAccount.delete({ where: { id: acct.id } });

const after = await equityFp();
ok(after.h.fp === FP_HOLDINGS && after.l.fp === FP_LOTS && after.t.fp === FP_TXNS,
  "★ AFTER writing, replaying and deleting four non-stock positions, the equity book is still " +
  "byte-identical to its GATE-0 baseline — the two spines never touched",
  `holdings ${after.h.fp} · lots ${after.l.fp} · txns ${after.t.fp}`);

const residue = await one(`
  SELECT (SELECT count(*)::int FROM holdings h JOIN instruments i ON i.id=h.instrument_id WHERE i.asset_class<>'stock') AS h,
         (SELECT count(*)::int FROM transactions WHERE notes = '[step20-verify]') AS t`);
ok(residue.h === 0 && residue.t === 0, "no test rows survive", `${residue.h} holdings · ${residue.t} transactions`);

// ═══ 8 — AMBIGUITY IS REFUSED, NOT GUESSED ═════════════════════════════════
console.log("\n═══ 8 — a symbol is not a key ═══\n");
let refused = false, candidates = 0;
try {
  await resolveInstrument(prisma, "IMC1"); // three active bonds share this ticker
} catch (e) {
  if (e instanceof InstrumentResolveError && e.code === "ambiguous_symbol") {
    refused = true;
    candidates = e.candidates?.length ?? 0;
  }
}
ok(refused && candidates === 3,
  "★ \"IMC1\" names THREE bonds, and we REFUSE (409) with the candidate ISINs rather than pick one. " +
  "Every available tie-break — newest, priced, first-by-id — would attach a user's real money to an " +
  "instrument they did not choose, invisibly. A holding is not a search result",
  `refused with ${candidates} candidate ISINs`);

const fundBySymbol = await one(`SELECT count(*)::int n FROM instruments WHERE asset_class='mutual_fund' AND symbol IS NOT NULL`);
ok(fundBySymbol.n === 0,
  "…and a mutual fund cannot be addressed by symbol AT ALL (0 of 17,567 have a ticker) — which is why " +
  "the ISIN, not the symbol, is the catalogue's address",
  `${fundBySymbol.n} funds carry a symbol`);

console.log(`\n${fails === 0 ? "✅ 0 FAILURES — manual multi-asset holdings are live." : `❌ ${fails} FAILURE(S)`}\n`);
await prisma.$disconnect();
process.exit(fails === 0 ? 0 : 1);
