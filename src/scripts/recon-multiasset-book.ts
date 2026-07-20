// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RECON — THE FIRST REAL MULTI-ASSET BOOK (GATE 0, consolidated). READ-ONLY. Surfaces the live catalogue
// and PROVES each pick: stem-matched pair, non-resolving bond, distinct-sector scored stocks, same/other
// fund houses, coupon-vs-discount G-Secs, gold ETF, REIT — every one confirmed PRICED (an unpriced holding
// is weight-0). Picks nothing on its own; the chosen book is seeded by seed-multiasset-book.ts.
//
//   npx tsx src/scripts/recon-multiasset-book.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
const q = <T = any>(s: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(s, ...a);
const H = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));
const n = (x: any) => Number(x);

// The 13 chosen picks — printed with their live price at the end as the seed-readiness proof.
const BOOK = [
  "INE733E01010", "INE733E07JS0", "INE090A01021", "INE467B01029", "INE030A01027", "INE027E07998",
  "INF179K01UT0", "INF179K01YV8", "INF200K01QX4", "IN0020240183", "IN002026X115", "INF846K01W80", "INE041025011",
];

async function main() {
  // ── 0 · asset-class distribution ──
  H("0 · ASSET-CLASS DISTRIBUTION (is_active)");
  for (const r of await q(`SELECT asset_class, count(*) c FROM instruments WHERE is_active GROUP BY 1 ORDER BY 2 DESC`))
    console.log(`   ${String(r.asset_class).padEnd(14)} ${n(r.c)}`);

  // ── 1 · STEM-MATCH — a stock whose left(isin,7) is shared by a PRICED corporate bond (the pair) ──
  H("1 · STEM-MATCH PAIRS — stock + PRICED bond (left(isin,7) equal). NTPC=INE733E is the flagship.");
  for (const r of await q(`
    SELECT left(s.isin,7) stem, min(s.symbol) sym, count(*) bonds,
           count(*) FILTER (WHERE b.last_price IS NOT NULL) priced
    FROM instruments b JOIN instruments s ON s.asset_class='stock' AND s.is_active AND left(s.isin,7)=left(b.isin,7)
    WHERE b.asset_class='bond' AND b.is_active GROUP BY 1 ORDER BY count(*) DESC LIMIT 12`))
    console.log(`   ${r.stem}  ${String(r.sym).padEnd(11)} bonds=${String(r.bonds).padStart(3)} priced=${r.priced}`);
  console.log("   ── NTPC (INE733E) stock + its priced bonds:");
  for (const r of await q(`SELECT isin, last_price, name FROM instruments WHERE left(isin,7)='INE733E' AND asset_class IN ('stock','bond') ORDER BY asset_class DESC, isin`))
    console.log(`      ${r.isin}  px=${r.last_price ?? "(stock→stock_prices)"}  ${String(r.name).slice(0,40)}`);

  // ── 2 · NON-RESOLVING bonds — stem matches no stock; priced; its own standalone entity ──
  H("2 · NON-RESOLVING bonds (own entity, no penalty) WITH a price");
  const [nr] = await q(`SELECT count(*) c FROM instruments b WHERE b.asset_class='bond' AND b.is_active AND NOT EXISTS (SELECT 1 FROM instruments s WHERE s.asset_class='stock' AND left(s.isin,7)=left(b.isin,7))`);
  console.log(`   ${n(nr.c)} corporate bonds resolve to no catalogued stock. Priced samples:`);
  for (const r of await q(`SELECT isin, last_price, name FROM instruments b WHERE b.asset_class='bond' AND b.is_active AND b.last_price IS NOT NULL AND NOT EXISTS (SELECT 1 FROM instruments s WHERE s.asset_class='stock' AND left(s.isin,7)=left(b.isin,7)) ORDER BY isin LIMIT 6`))
    console.log(`      ${r.isin}  px=${r.last_price}  ${String(r.name).slice(0,50)}`);

  // ── 3 · distinct-sector stocks — SCORED (Health) + PRICED (weight) ──
  H("3 · distinct-sector stocks — SCORED + PRICED (recognizable large-caps)");
  for (const r of await q(`
    SELECT sec.name sector, i.symbol, i.isin
    FROM instruments i JOIN stocks s ON s.id=i.stock_id JOIN sectors sec ON sec.id=s.sector_id
    WHERE i.asset_class='stock' AND i.is_active AND sec.name IN ('banks','it_technology','fmcg_consumer')
      AND EXISTS(SELECT 1 FROM score_snapshots ss WHERE ss.stock_id=s.id)
      AND i.symbol IN ('ICICIBANK','HDFCBANK','TCS','INFY','HINDUNILVR','ITC')
    ORDER BY sec.name, i.symbol`))
    console.log(`   ${String(r.sector).padEnd(16)} ${String(r.symbol).padEnd(12)} ${r.isin}`);

  // ── 4 · fund houses — clean Growth-Direct equity funds (same house ×2 + another) ──
  H("4 · clean Growth-Direct equity funds (HDFC ×2 + SBI) — C5/PC6/PC7 subject");
  for (const r of await q(`SELECT isin, fund_house, current_nav, scheme_name FROM instruments WHERE isin IN ('INF179K01UT0','INF179K01YV8','INF200K01QX4') ORDER BY fund_house`))
    console.log(`   ${r.isin}  nav=${r.current_nav}  ${String(r.fund_house).padEnd(18)} ${String(r.scheme_name).slice(0,44)}`);

  // ── 5 · G-Sec coupon vs T-bill discount — the T-1 partition (PD3) ──
  H("5 · G-SEC couponNullReason split + the coupon/discount picks");
  for (const r of await q(`SELECT coalesce(attributes->>'couponNullReason','(coupon)') cnr, count(*) c FROM instruments WHERE asset_class='gsec' GROUP BY 1 ORDER BY 2 DESC`))
    console.log(`   ${String(r.cnr).padEnd(22)} ${n(r.c)}`);
  for (const r of await q(`SELECT isin, last_price, attributes->>'couponNullReason' cnr, name FROM instruments WHERE isin IN ('IN0020240183','IN002026X115')`))
    console.log(`   ${r.isin}  px=${r.last_price}  ${r.cnr === "discount_instrument" ? "T-BILL " : "COUPON "} ${String(r.name).slice(0,34)}`);

  // ── 6/7 · gold ETF + REIT ──
  H("6/7 · gold ETF (commodity) + REIT (name-risk)");
  for (const r of await q(`SELECT isin, asset_class, last_price, current_nav, fund_house, name FROM instruments WHERE isin IN ('INF846K01W80','INE041025011')`))
    console.log(`   ${String(r.asset_class).padEnd(5)} ${r.isin}  last_px=${r.last_price ?? "-"} nav=${r.current_nav ?? "-"} house=${r.fund_house ?? "-"}  ${String(r.name).slice(0,28)}`);

  // ── 8 · SEED-READINESS — every chosen pick resolves to a live price (else weight 0) ──
  H("8 · SEED-READINESS — every one of the 13 picks is PRICED");
  let unpriced = 0;
  for (const isin of BOOK) {
    const [i] = await q(`SELECT isin, asset_class, stock_id, last_price, current_nav, name FROM instruments WHERE isin=$1`, isin);
    let px: any = null;
    if (i.stock_id) { const [d] = await q(`SELECT close FROM daily_prices WHERE stock_id=$1 ORDER BY date DESC LIMIT 1`, i.stock_id); px = d?.close ?? null; }
    else px = i.last_price ?? i.current_nav ?? null;
    if (px == null) unpriced++;
    console.log(`   ${px == null ? "❌ UNPRICED" : "✅"}  ${isin}  ${String(i.asset_class).padEnd(12)} px=${px ?? "NULL"}  ${String(i.name).slice(0,34)}`);
  }
  console.log(`\n   ${unpriced === 0 ? "✅ all 13 priced — the book is seed-ready" : `❌ ${unpriced} unpriced`}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
