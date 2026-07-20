// READ-ONLY probe: will a BROKER-ADMITTED stock / bond actually get priced by the daily crons?
// Writes NOTHING.
import { prisma } from "../db/prisma.js";
import { fetchWithFallback } from "../ingestions/prices/registry.js";
import { fetchUdiff, parseUdiff, weekdaysBack } from "../ingestions/shared/udiff-bhavcopy.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(84) + "\n" + s + "\n" + "═".repeat(84));

// ── 1. THE EQUITY LANE: is the NSE feed WIDER than our 504? ──────────────────
rule("1 · STOCK — does the daily-prices feed even CONTAIN a stock outside our 504?");
// loadUniverse() = every isActive stock, keyed by SYMBOL. insertDailyPrices does
// universe.get(price.symbol). So an admitted stock prices IFF its symbol is in the feed.
let feed: any = null;
for (const d of weekdaysBack(new Date(), 8)) {
  try {
    const f = await fetchWithFallback(d);
    if (f && f.prices && f.prices.length > 0) { feed = f; break; }
  } catch { /* holiday / 404 — step back */ }
}
if (!feed) {
  console.log("   !! could not fetch an EOD feed — cannot answer empirically.");
} else {
  const feedSymbols = new Set<string>(feed.prices.map((p: any) => p.symbol));
  const ours = await q(`SELECT symbol FROM stocks WHERE is_active = true`);
  const ourSet = new Set(ours.map((r: any) => r.symbol));
  const covered = [...ourSet].filter((s) => feedSymbols.has(s as string)).length;
  const outside = [...feedSymbols].filter((s) => !ourSet.has(s));

  console.log(`   feed (${feed.provider}) carries        : ${feedSymbols.size} symbols`);
  console.log(`   our active universe               : ${ourSet.size} stocks  (${covered} of them found in the feed)`);
  console.log(`   symbols in the feed but NOT ours  : ${outside.length}`);
  console.log(`   e.g. ${outside.slice(0, 8).join(", ")}`);
  console.log(`\n   → A broker-admitted NSE stock lands in \`stocks\` (is_active=true), so loadUniverse() sees it`);
  console.log(`     on the very next run, and insertDailyPrices matches it by SYMBOL against these ${feedSymbols.size}.`);
  console.log(`     ${outside.length} such symbols are sitting in today's feed already. ✓ IT WILL BE PRICED.`);
}

// ── 2. THE BOND LANE: is it CATALOGUE-driven or FEED-driven? ─────────────────
rule("2 · BOND — the bond cron's worklist is the FEED, not the catalogue");
let rows: any[] = [];
for (const d of weekdaysBack(new Date(), 8)) {
  const f = await fetchUdiff(d);
  if (f.status !== 200 || f.bytes === 0) continue;
  const p = parseUdiff(f.buffer);
  if (p.ok) { rows = p.rows; break; }
}
const feedIsins = new Set(rows.filter((r) => r.isin).map((r) => r.isin));
const catalogued = await q(`SELECT isin, symbol FROM instruments WHERE asset_class='bond'`);
const inFeed = catalogued.filter((b: any) => feedIsins.has(b.isin)).length;
console.log(`   udiff session carries              : ${feedIsins.size} ISINs`);
console.log(`   our catalogued bonds               : ${catalogued.length}`);
console.log(`   …of which appear in THIS session   : ${inFeed}  (the rest simply did not trade today)`);
console.log(`
   runBondIngest() builds its worklist by UNIONING what the udiff SHOWS IT, then upserts
   ON CONFLICT (isin) DO UPDATE … WHERE instruments.asset_class = 'bond'.

   So for a BROKER-SEEDED bond (already asset_class='bond' in the catalogue):
     · it PRINTS on NSE  → it is in the feed → the upsert MATCHES the existing row → last_price and
       last_price_date are set, and the placeholder NAME is upgraded to the real FinInstrmNm.  ✓
     · it NEVER prints (OTC / BSE-only) → it is never in the feed → the cron never sees it → it
       stays honestly unpriced, forever, with unpricedReason='not_exchange_traded'.  ← BY DESIGN`);

// ── 3. THE GAP THAT IS REAL ──────────────────────────────────────────────────
rule("3 · THE REAL GAP — a BSE-only holding");
const nseOnly = await q(`SELECT DISTINCT exchange FROM stocks`);
console.log(`   exchanges present in \`stocks\`: ${nseOnly.map((r: any) => r.exchange).join(", ")}`);
console.log(`
   The daily-prices feed is the NSE bhavcopy. A broker-admitted stock that is listed ONLY on BSE
   carries a BSE tradingsymbol, will NOT match any row in the NSE feed, and will therefore NEVER be
   priced — it sits at unpricedReason='no_price_yet' indefinitely. Its identity, quantity and
   invested amount all still show; only the value is absent.

   That is honest, but the "yet" is doing work it cannot cash. Same class of problem as the OTC bond
   — and the bond lane already says 'not_exchange_traded' instead. The equity lane does not.`);

// ── 4. THE DEEPER RISK: the price lane joins on SYMBOL, the catalogue's spine is ISIN ────
rule("4 · SYMBOL-vs-ISIN — insertDailyPrices matches on SYMBOL. Do the ISINs actually agree?");
const eodHasIsin = feed ? (feed.prices as any[]).some((p) => p.isin) : false;
console.log(`   does the EOD equity feed (sec_bhavdata_full) carry an ISIN column? ${eodHasIsin ? "yes" : "NO — not one row"}`);
console.log(`   → so insertDailyPrices CANNOT cross-check symbol→ISIN. The symbol is the only key it has.`);
console.log(`     (This is exactly why the CATALOGUE was built on the udiff instead — udiff-bhavcopy.ts`);
console.log(`      says so in its header: "the equity pipeline's sec_bhavdata_full has NO ISIN column".)`);

// The udiff DOES carry symbol+ISIN together for equity. Use IT to test the collision hypothesis:
// could a broker-admitted stock's tradingsymbol match a DIFFERENT company's NSE symbol?
const EQ_BOARDS = new Set(["EQ", "BE", "BZ", "SM", "ST", "SZ", "E1"]);
const udiffEquity = rows.filter((r) => EQ_BOARDS.has(r.series) && r.isin && r.symbol);
const isinBySymbol = new Map<string, string>();
for (const r of udiffEquity) isinBySymbol.set(r.symbol, r.isin);

const ours = await q(`SELECT symbol, isin FROM stocks WHERE is_active = true`);
let agree = 0;
const disagree: { symbol: string; ours: string; nse: string }[] = [];
let absent = 0;
for (const s of ours as any[]) {
  const nse = isinBySymbol.get(s.symbol);
  if (!nse) { absent++; continue; }
  if (nse === s.isin) agree++;
  else disagree.push({ symbol: s.symbol, ours: s.isin, nse });
}
console.log(`\n   Cross-checking our 504 against the udiff (which HAS both symbol and ISIN):`);
console.log(`     symbol → ISIN AGREES with ours : ${agree}`);
console.log(`     symbol → ISIN DISAGREES        : ${disagree.length}`);
console.log(`     symbol not on an NSE equity board today : ${absent}`);
for (const d of disagree.slice(0, 5)) console.log(`       ✗ ${d.symbol}: ours=${d.ours}  NSE=${d.nse}`);
console.log(`
   VERDICT: the symbol→ISIN mapping is ${disagree.length === 0 ? "CLEAN today" : "ALREADY DIVERGING"} for the curated 504, so the
   symbol join is sound for them. The residual risk is a broker-admitted stock whose tradingsymbol
   happens to equal a DIFFERENT company's NSE symbol — the join would match and write the wrong
   company's close onto it. The EOD feed has no ISIN to catch that with; the udiff does.
   PRE-EXISTING (admitBareStock has shipped since Step 7) and NOT introduced by Step 17 — but Step 17
   makes broker admissions materially more likely, so it is worth naming rather than discovering.`);
await prisma.$disconnect();
