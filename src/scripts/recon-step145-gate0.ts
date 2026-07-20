// ═══════════════════════════════════════════════════════════════
// STEP 14.5 — GATE 0 RECON (READ-ONLY). Which price source does each non-stock class actually have?
//
// The build wants to price a held ETF/REIT/InvIT. Before writing a line of the read, establish —
// by measurement, not assumption — WHAT PRICE EACH CLASS ACTUALLY HAS TODAY:
//   · REIT/InvIT → instruments.last_price (Step 14's snapshot, fed from instrument_prices)?
//   · ETF        → instruments.current_nav (Step 13's AMFI NAV)?  …or is it in instrument_prices too?
//   · MF         → instruments.current_nav (Step 9)?
// And: is anything actually HELD that is non-stock today (i.e. does this gap bite anyone yet)?
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(80) + "\n" + s + "\n" + "═".repeat(80));

rule("1 · PRICE-SOURCE COVERAGE per asset class — what is actually populated?");
console.log(
  J(
    await q(`
    SELECT asset_class::text AS ac,
           count(*)::int                                             AS rows,
           count(stock_id)::int                                      AS with_stock_id,
           count(last_price)::int                                    AS with_last_price,
           count(current_nav)::int                                   AS with_current_nav,
           count(*) FILTER (WHERE id IN (SELECT DISTINCT instrument_id FROM instrument_prices))::int AS in_instrument_prices
      FROM instruments
     GROUP BY 1 ORDER BY 1`),
  ),
);
console.log(`
   READ THIS AS:
     · with_stock_id        → the stock path (stock_prices). Unchanged by 14.5.
     · with_last_price      → Step 14's exchange-price snapshot.
     · with_current_nav     → the AMFI NAV (Step 9 / Step 13).
     · in_instrument_prices → has a row in the instrument_id-keyed price history.`);

rule("2 · Is instrument_prices REIT/InvIT-only? (i.e. are ETFs in there too?)");
console.log(
  J(
    await q(`SELECT i.asset_class::text ac, count(DISTINCT ip.instrument_id)::int instruments, count(*)::int price_rows
               FROM instrument_prices ip JOIN instruments i ON i.id = ip.instrument_id
              GROUP BY 1 ORDER BY 1`),
  ),
);

rule("3 · ETF — does it have a MARKET price anywhere, or only a NAV?");
console.log(
  J(
    await q(`SELECT count(*)::int etfs,
                    count(current_nav)::int with_nav,
                    count(last_price)::int  with_market_price,
                    min(nav_date)::text     oldest_nav_date,
                    max(nav_date)::text     newest_nav_date,
                    count(*) FILTER (WHERE is_active)::int active
               FROM instruments WHERE asset_class = 'etf'`),
  ),
);
console.log("   NAV STALENESS — how many ETFs carry a NAV older than the newest in the file?");
console.log(
  J(
    await q(`SELECT count(*) FILTER (WHERE nav_date = (SELECT max(nav_date) FROM instruments WHERE asset_class='etf'))::int fresh,
                    count(*) FILTER (WHERE nav_date < (SELECT max(nav_date) FROM instruments WHERE asset_class='etf'))::int stale
               FROM instruments WHERE asset_class = 'etf'`),
  ),
);

rule("4 · MF — NAV coverage + the known staleness population (Step 9 measured 44.8% stale)");
console.log(
  J(
    await q(`SELECT count(*)::int mfs,
                    count(current_nav)::int with_nav,
                    count(*) FILTER (WHERE current_nav IS NULL)::int null_nav,
                    count(*) FILTER (WHERE is_active)::int active,
                    count(*) FILTER (WHERE NOT is_active)::int dormant
               FROM instruments WHERE asset_class = 'mutual_fund'`),
  ),
);

rule("5 · REIT/InvIT — last_price coverage + staleness (Step 14)");
console.log(
  J(
    await q(`SELECT count(*)::int trusts,
                    count(last_price)::int with_price,
                    min(last_price_date)::text oldest,
                    max(last_price_date)::text newest
               FROM instruments WHERE asset_class IN ('reit','invit')`),
  ),
);

rule("6 · IS ANYTHING NON-STOCK ACTUALLY HELD TODAY? (does the gap bite anyone yet?)");
console.log("── broker_holdings joined to the catalogue ──");
console.log(
  J(
    await q(`SELECT COALESCE(i.asset_class::text,'(no instrument)') AS ac,
                    count(*)::int rows,
                    count(bh.stock_id)::int with_stock_id
               FROM broker_holdings bh
               LEFT JOIN instruments i ON i.id = bh.instrument_id
              GROUP BY 1 ORDER BY 1`),
  ),
);
console.log("\n── manual holdings (holdings.stock_id is NOT NULL → can only ever be stocks) ──");
console.log(
  J(
    await q(`SELECT i.asset_class::text ac, count(*)::int rows
               FROM holdings h JOIN instruments i ON i.id = h.instrument_id
              GROUP BY 1 ORDER BY 1`),
  ),
);

rule("7 · THE STOCK PATH — the byte-identical baseline the change must not move");
console.log("Every currently-held STOCK position's price (the exact rows holdings-controller reads):");
console.log(
  J(
    await q(`SELECT count(DISTINCT sp.stock_id)::int priced_stocks,
                    md5(string_agg(sp.stock_id || '|' || sp.price::text || '|' ||
                                   coalesce(sp.prev_close::text,'~') || '|' ||
                                   coalesce(sp.day_change_pct::text,'~'), ',' ORDER BY sp.stock_id)) AS fp
               FROM stock_prices sp
              WHERE sp.stock_id IN (SELECT stock_id FROM holdings WHERE stock_id IS NOT NULL
                                    UNION SELECT stock_id FROM broker_holdings WHERE stock_id IS NOT NULL)`),
  ),
);

rule("8 · The stale comments the prompt flags");
console.log("   src/brokers/lifecycle.ts:126-127  and  src/brokers/universe-admit.ts:149");
console.log("   both claim a resolved ETF is 'Held and valued, never scored' — today it is held-not-VALUED.");
console.log("   After 14.5 that claim becomes TRUE. (Checked in the build, not here.)");

await prisma.$disconnect();
console.log("\n═══ GATE 0 COMPLETE — nothing was written. ═══");
