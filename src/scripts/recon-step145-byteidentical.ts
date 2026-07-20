// STEP 14.5 — GATE 0c. The two questions that decide whether the read change is byte-identical
// for STOCK holdings today (read-only).
//
// Q1. `heldNotValued` is currently `p.stockId == null`. The HONEST meaning of the field (and what
//     PHS's partition already uses, phs/assemble.ts:128) is "we could not price it". Those differ
//     for exactly one shape: a stock ADMITTED from a broker feed that has no stock_prices row yet
//     — marketValue null, but heldNotValued FALSE. Does that shape exist in the live book? If it
//     does not, re-basing the flag on `marketValue == null` changes NOTHING today and aligns the
//     two surfaces that currently disagree.
//
// Q2. `dayChangePct` divides by `prevValue = totalMarketValue - dayChange.total`. That is only
//     coherent while every row with a marketValue ALSO has a dayChangeValue. An ETF valued at NAV
//     has NO previous NAV (there is no NAV-history table — compute-and-discard), so it will have a
//     value and no day-change, and the denominator would then include capital the numerator does
//     not. The fix is to build prevValue from the rows that HAVE a day-change. That is byte-
//     identical TODAY only if every held, priced stock has a non-null prev_close. Does it?
import { prisma } from "../db/prisma.js";

const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

console.log("── Q1 · every held stock_id, and whether it has a stock_prices row ──");
console.log(
  J(
    await q(`
    WITH held AS (
      SELECT stock_id FROM holdings WHERE stock_id IS NOT NULL
      UNION
      SELECT stock_id FROM broker_holdings WHERE stock_id IS NOT NULL
    )
    SELECT count(*)::int held_stocks,
           count(sp.stock_id)::int with_price_row,
           count(*) FILTER (WHERE sp.stock_id IS NULL)::int WITHOUT_price_row
      FROM held h LEFT JOIN stock_prices sp ON sp.stock_id = h.stock_id`),
  ),
);
console.log(
  "   → if WITHOUT_price_row = 0, then today marketValue is non-null for EVERY held stock,\n" +
    "     so `heldNotValued = (marketValue == null)` ≡ `(stockId == null)` on the live book. No change.",
);

console.log("\n── Q2 · does every held, priced stock carry a prev_close? ──");
console.log(
  J(
    await q(`
    WITH held AS (
      SELECT stock_id FROM holdings WHERE stock_id IS NOT NULL
      UNION
      SELECT stock_id FROM broker_holdings WHERE stock_id IS NOT NULL
    )
    SELECT count(*)::int priced,
           count(sp.prev_close)::int with_prev_close,
           count(*) FILTER (WHERE sp.prev_close IS NULL)::int null_prev_close,
           count(sp.day_change_pct)::int with_day_change_pct
      FROM held h JOIN stock_prices sp ON sp.stock_id = h.stock_id`),
  ),
);
console.log(
  "   → if null_prev_close = 0, every priced stock row has a day-change, so rebuilding prevValue\n" +
    "     from 'rows that have a day-change' yields the IDENTICAL denominator today.",
);

console.log("\n── The 3 broker rows with no instrument (they must STAY honest-null) ──");
console.log(
  J(await q(`SELECT symbol, stock_id, instrument_id FROM broker_holdings WHERE instrument_id IS NULL ORDER BY symbol`)),
);

console.log("\n── Do trusts have a prev_close available for a day-change? (instrument_prices) ──");
console.log(
  J(
    await q(`
    SELECT count(*)::int trusts,
           count(*) FILTER (WHERE p.prev_close IS NOT NULL)::int with_prev_close
      FROM instruments i
      JOIN LATERAL (SELECT close, prev_close, date FROM instrument_prices ip
                     WHERE ip.instrument_id = i.id ORDER BY date DESC LIMIT 1) p ON true
     WHERE i.asset_class IN ('reit','invit')`),
  ),
);

console.log("\n── Sanity: the snapshot (instruments.last_price) equals the newest history close ──");
console.log(
  J(
    await q(`
    SELECT count(*)::int trusts,
           count(*) FILTER (WHERE i.last_price = p.close AND i.last_price_date = p.date)::int agree
      FROM instruments i
      JOIN LATERAL (SELECT close, date FROM instrument_prices ip
                     WHERE ip.instrument_id = i.id ORDER BY date DESC LIMIT 1) p ON true
     WHERE i.asset_class IN ('reit','invit')`),
  ),
);

await prisma.$disconnect();
