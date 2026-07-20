// ═══════════════════════════════════════════════════════════════════════
// STEP 15 — GATE 3 VERIFICATION. G-sec / T-bill / SDL / SGB identity (identity-only, priced).
//
//   npx tsx src/scripts/verify-step15-govt.ts
// ═══════════════════════════════════════════════════════════════════════
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import type { BrokerId } from "../brokers/types.js";
import { integrate } from "../brokers/lifecycle.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";
import { linkAccount, createAccount } from "../controllers/me/accounts-controller.js";
import { assemblePortfolio, listPortfolioDisclosure } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { parseGovtName } from "../ingestions/govt-securities/govt-guards.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(78) + "\n" + s + "\n" + "═".repeat(78));
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const call = async (fn: any, userId: string, o: any = {}) => { const r = mockRes(); await fn({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: o.query ?? {} } as any, r); return r; };
const holdings = async (u: string) => (await call(listHoldings, u, { query: {} })).body.data;

const created: string[] = [];
try {
  // ═══════════════════════════════════════════════════════════════
  rule("1 · BYTE-IDENTICAL — the un-waivable baseline");
  // ═══════════════════════════════════════════════════════════════
  const fpA = (await q(`SELECT count(*)::int n, md5(string_agg(id||'|'||symbol||'|'||isin||'|'||name, ',' ORDER BY id)) fp FROM stocks`))[0];
  ok("504 stocks unchanged", fpA.n === 504 && fpA.fp === "3add5d41096ac195f51cb15a2a383ab9", `${fpA.n} · ${fpA.fp}`);

  const fundFp = (cls: string) => `SELECT count(*)::int n, md5(string_agg(
      isin||'|'||coalesce(symbol,'~')||'|'||name||'|'||coalesce(amfi_scheme_code,'~')||'|'||
      coalesce(scheme_name,'~')||'|'||coalesce(fund_house,'~')||'|'||coalesce(category,'~')||'|'||
      coalesce(plan_type,'~')||'|'||coalesce(current_nav::text,'~')||'|'||
      coalesce(nav_date::text,'~')||'|'||is_active::text, ',' ORDER BY isin)) fp
    FROM instruments WHERE asset_class = '${cls}'`;
  const fpM = (await q(fundFp("mutual_fund")))[0];
  ok("17,567 MF rows unchanged", fpM.n === 17567 && fpM.fp === "651f6ba0132b4dc0657e611bb9559969", `${fpM.n} · ${fpM.fp}`);
  const fpE = (await q(fundFp("etf")))[0];
  ok("337 ETF rows unchanged", fpE.n === 337 && fpE.fp === "dae247ae2c8a1cb7617c783e30085d01", `${fpE.n} · ${fpE.fp}`);
  const trusts = (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('reit','invit')`))[0];
  ok("21 REIT/InvIT rows unchanged", trusts.n === 21, `${trusts.n}`);
  const anal = (await q(`SELECT count(*)::int n FROM mf_analytics`))[0];
  ok("14,041 mf_analytics rows unchanged", anal.n === 14041, `${anal.n}`);
  ok("daily_prices / stock_prices STILL have no instrument_id (equity spine untouched)",
    (await q(`SELECT count(*)::int n FROM information_schema.columns
               WHERE table_name IN ('daily_prices','stock_prices') AND column_name='instrument_id'`))[0].n === 0);

  // ═══════════════════════════════════════════════════════════════
  rule("2 · LOADED — the government universe");
  // ═══════════════════════════════════════════════════════════════
  const byClass = await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments
                            WHERE asset_class IN ('gsec','sgb') GROUP BY 1 ORDER BY 1`);
  console.log(`   ${J(byClass)}`);
  const nGsec = byClass.find((r) => r.ac === "gsec")?.n ?? 0;
  const nSgb = byClass.find((r) => r.ac === "sgb")?.n ?? 0;
  ok("gsec rows loaded", nGsec > 0, `${nGsec}`);
  ok("sgb rows loaded", nSgb > 0, `${nSgb}`);

  const bySeries = await q(`SELECT attributes->>'series' s, asset_class::text ac, count(*)::int n
                             FROM instruments WHERE asset_class IN ('gsec','sgb') GROUP BY 1,2 ORDER BY 1`);
  console.log(`   by source series: ${J(bySeries)}`);
  ok("GS / TB / SG all classed 'gsec'; GB classed 'sgb' (the ruling, enforced)",
    bySeries.every((r) => (["GS", "TB", "SG"].includes(r.s) ? r.ac === "gsec" : r.ac === "sgb")));

  ok("every government row has stock_id NULL (held-not-scored BY CONSTRUCTION)",
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb') AND stock_id IS NOT NULL`))[0].n === 0);
  ok("every government ISIN is in the NUMERIC namespace (IN + digit — never INE/INF)",
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb')
               AND isin !~ '^IN[0-9][0-9A-Z]{9}$'`))[0].n === 0);
  ok("ISIN unique across the WHOLE catalogue (the spine holds)",
    (await q(`SELECT count(*)::int n FROM (SELECT isin FROM instruments GROUP BY isin HAVING count(*)>1) x`))[0].n === 0);
  ok("no CORPORATE debt leaked in (only the 4 government series exist)",
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb')
               AND attributes->>'series' NOT IN ('GS','TB','GB','SG')`))[0].n === 0);

  // ═══════════════════════════════════════════════════════════════
  rule("3 · PRICED — they all trade, so they are all valued");
  // ═══════════════════════════════════════════════════════════════
  const priced = (await q(`SELECT count(*)::int total, count(last_price)::int with_price
                             FROM instruments WHERE asset_class IN ('gsec','sgb')`))[0];
  ok("EVERY government instrument carries a last_price", priced.with_price === priced.total, J(priced));
  ok("no price without the date it belongs to",
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb')
               AND ((last_price IS NULL) <> (last_price_date IS NULL))`))[0].n === 0);
  ok("the snapshot equals the newest instrument_prices row (no drift between the two stores)",
    (await q(`SELECT count(*)::int n FROM instruments i
               JOIN LATERAL (SELECT close, date FROM instrument_prices ip WHERE ip.instrument_id = i.id
                              ORDER BY date DESC LIMIT 1) p ON true
              WHERE i.asset_class IN ('gsec','sgb') AND (i.last_price <> p.close OR i.last_price_date <> p.date)`))[0].n === 0);
  const sample = await q(`SELECT symbol, asset_class::text ac, name, last_price, last_price_date
                            FROM instruments WHERE symbol IN ('SGBJUN28','664GS2027','725AP37') ORDER BY symbol`);
  for (const s of sample) console.log(`   ${String(s.symbol).padEnd(11)} ${s.ac.padEnd(5)} ₹${String(s.last_price).padStart(10)} @ ${s.last_price_date?.toISOString().slice(0, 10)}  ${s.name}`);

  // ═══════════════════════════════════════════════════════════════
  rule("4 · ATTRIBUTES — populated where sourceable, honest-null where NOT. Never fabricated.");
  // ═══════════════════════════════════════════════════════════════
  const attrs = (await q(`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE attributes->>'coupon' IS NOT NULL)::int with_coupon,
           count(*) FILTER (WHERE attributes->>'maturityYear' IS NOT NULL)::int with_year,
           count(*) FILTER (WHERE attributes->>'maturityDate' IS NOT NULL)::int with_exact_date,
           count(*) FILTER (WHERE attributes->>'yieldToMaturity' IS NOT NULL)::int with_yield
      FROM instruments WHERE asset_class IN ('gsec','sgb')`))[0];
  console.log(`   ${J(attrs)}`);
  ok("maturity YEAR on every instrument (it IS explicit in the name)", attrs.with_year === attrs.total);
  ok("EXACT maturity date ONLY on T-bills — never invented for GS/SDL/SGB",
    attrs.with_exact_date === (await q(`SELECT count(*)::int n FROM instruments WHERE attributes->>'series' = 'TB'`))[0].n,
    `${attrs.with_exact_date} exact dates = the T-bill count`);
  ok("NO GS / SDL / SGB carries a fabricated exact maturity date",
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb')
               AND attributes->>'series' <> 'TB' AND attributes->>'maturityDate' IS NOT NULL`))[0].n === 0);
  ok("every GS/SDL/SGB says WHY its exact date is null ('not_in_source')",
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb')
               AND attributes->>'series' <> 'TB' AND attributes->>'maturityDateNullReason' <> 'not_in_source'`))[0].n === 0);
  ok("EVERY T-bill has coupon NULL, reason 'discount_instrument' (a CORRECT null, not a gap)",
    (await q(`SELECT count(*)::int n FROM instruments WHERE attributes->>'series' = 'TB'
               AND (attributes->>'coupon' IS NOT NULL OR attributes->>'couponNullReason' <> 'discount_instrument')`))[0].n === 0);
  ok("every coupon-bearing instrument HAS a coupon (GS/SDL/SGB)",
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb')
               AND attributes->>'series' <> 'TB' AND attributes->>'coupon' IS NULL`))[0].n === 0);
  ok("YIELD is honestly NULL everywhere, with a reason (not sourceable, not computable)",
    attrs.with_yield === 0 &&
    (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb')
               AND attributes->>'yieldNullReason' <> 'not_sourceable'`))[0].n === 0);
  ok("SDLs carry their issuing STATE (the info the source gave us, kept)",
    (await q(`SELECT count(*)::int n FROM instruments WHERE attributes->>'govtType' = 'sdl'
               AND attributes->>'issuerState' IS NULL`))[0].n === 0);

  // The parser, proven on the real name shapes.
  const gs = parseGovtName("GS", "GOI LOAN   6.64% 2027");
  ok("parser: G-sec → coupon 6.64, year 2027, exact date NULL", gs.coupon === 6.64 && gs.maturityYear === 2027 && gs.maturityDate === null);
  const tb = parseGovtName("TB", "GOI TBILL 364D-08/07/27");
  ok("parser: T-bill → exact date 2027-07-08, tenor 364, coupon NULL(discount)",
    tb.maturityDate === "2027-07-08" && tb.tenorDays === 364 && tb.coupon === null && tb.couponNullReason === "discount_instrument");
  const gb = parseGovtName("GB", "2.5%GOLDBONDS2028SR-III");
  ok("parser: SGB → coupon 2.5, year 2028, tranche SR-III (the year is GLUED to the text)",
    gb.coupon === 2.5 && gb.maturityYear === 2028 && gb.tranche === "SR-III" && gb.maturityDate === null);
  const sg = parseGovtName("SG", "SDL AP 7.25% 2037");
  ok("parser: SDL → state AP, coupon 7.25, year 2037", sg.issuerState === "AP" && sg.coupon === 7.25 && sg.maturityYear === 2037);
  ok("parser NEVER guesses a month from an ambiguous SGB symbol (SGBJU29III: JUN or JUL?)",
    parseGovtName("GB", "2.5%GOLDBONDS2029SR-III").maturityDate === null);

  // ═══════════════════════════════════════════════════════════════
  rule("5 · OVERLAP");
  // ═══════════════════════════════════════════════════════════════
  ok("no government ISIN exists in `stocks` (it would be SCORED)",
    (await q(`SELECT count(*)::int n FROM stocks s JOIN instruments i ON i.isin = s.isin
               WHERE i.asset_class IN ('gsec','sgb')`))[0].n === 0);
  ok("the AMFI INF% trespass guard still returns 0 (government ISINs are numeric-namespace)",
    (await q(`SELECT count(*)::int n FROM instruments
               WHERE asset_class NOT IN ('mutual_fund'::"AssetClass",'etf'::"AssetClass") AND isin LIKE 'INF%'`))[0].n === 0);

  // ═══════════════════════════════════════════════════════════════
  rule("6 · HELD-NOT-SCORED + VALUED — a held SGB flows through, priced, unjudged");
  // ═══════════════════════════════════════════════════════════════
  const sgb = (await q(`SELECT id, symbol, name, last_price FROM instruments WHERE asset_class='sgb' AND last_price IS NOT NULL ORDER BY symbol LIMIT 1`))[0];
  const gsec = (await q(`SELECT id, symbol, name, last_price FROM instruments WHERE attributes->>'series'='GS' AND last_price IS NOT NULL ORDER BY symbol LIMIT 1`))[0];

  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `s15-${authId}@test.local`);
  created.push(authId);
  const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });

  const acct = (await call(createAccount, userId, { body: { name: "Demat", broker: "mock" as BrokerId } })).body.data.id;
  const conn = await integrate(userId, "mock" as BrokerId, { accepted: true, disclaimerVersion: "v1", params: { mockAccountRef: "S15" } } as any);
  await call(linkAccount, userId, { params: { id: acct }, body: { connectionId: conn.id } });
  const put = (symbol: string, instrumentId: string, qty: number) =>
    prisma.brokerHolding.create({ data: { userId, brokerConnectionId: conn.id, symbol, instrumentId, stockId: null, quantity: qty, avgCost: 100, syncedAt: new Date() } });
  await put(sgb.symbol, sgb.id, 5);
  await put(gsec.symbol, gsec.id, 100);

  const h = await holdings(userId);
  const rowOf = (s: string) => h.holdings.find((x: any) => x.symbol === s);
  const hs = rowOf(sgb.symbol);
  const hg = rowOf(gsec.symbol);

  ok("a held SGB shows a REAL marketValue (via instrument_prices → 14.5's resolver, NO read change)",
    hs.marketValue != null && hs.priceSource === "exchange_close" &&
      Math.abs(Number(hs.marketValue) - 5 * Number(sgb.last_price)) < 0.01,
    `${sgb.symbol}: 5 × ₹${sgb.last_price} = ₹${hs.marketValue} @ ${hs.priceAsOf}`);
  ok("a held G-sec shows a REAL marketValue",
    hg.marketValue != null && hg.priceSource === "exchange_close" &&
      Math.abs(Number(hg.marketValue) - 100 * Number(gsec.last_price)) < 0.01,
    `${gsec.symbol}: 100 × ₹${gsec.last_price} = ₹${hg.marketValue}`);
  ok("both are heldNotScored=true, heldNotValued=false (valued, never judged)",
    hs.heldNotScored === true && hs.heldNotValued === false && hg.heldNotScored === true && hg.heldNotValued === false);
  ok("neither carries a health score or a tier",
    hs.health === null && hg.health === null && hs.tier === "unknown" && hg.tier === "unknown");

  // (CV2 Stage 0 — Ruling 1) The gilts are priced capital, so they now ENTER the engine as UNSCORED
  // holdings (health=null) — no longer dropped. But nothing here is SCORED, so there is still NO
  // Health (evaluable=false, health=null): the book weighs in totalValue/Construction, never in the score.
  const engine = (await assemblePortfolio(userId)).holdings;
  const gr = computePhs(engine);
  ok("the engine now sees the 2 gilts as UNSCORED capital (health=null), never scored",
    engine.length === 2 && engine.every((h: any) => h.health === null && h.tier === "unknown"),
    `${engine.length} holdings, all unscored`);
  ok("still NO Health — nothing is scored (evaluable=false), yet totalValue reflects the gilts",
    gr.evaluable === false && gr.health === null && Math.abs(gr.totalValue - engine.reduce((s: number, h: any) => s + h.marketValue, 0)) < 0.01,
    `evaluable=${gr.evaluable} health=${gr.health} totalValue=₹${gr.totalValue.toFixed(2)}`);
  const disc = await listPortfolioDisclosure(userId);
  ok("disclosure: both are heldNotSCORED with a ₹ value (not 'could not price')",
    disc.heldNotScored.length === 2 && disc.heldNotValued.length === 0 &&
      disc.heldNotScored.every((x) => Number(x.marketValue) > 0),
    disc.heldNotScored.map((x) => `${x.symbol}=₹${x.marketValue}`).join(" · "));

  // ═══════════════════════════════════════════════════════════════
  rule("7 · ERROR FLOW");
  // ═══════════════════════════════════════════════════════════════
  const errs = await q(`SELECT guard_type::text gt, severity::text sev, target_entity, status::text st, observed
                          FROM ingestion_errors WHERE cron = 'govt_securities_daily' ORDER BY last_seen_at DESC`);
  console.log(`   ${errs.length} IngestionError row(s) from cron=govt_securities_daily`);
  for (const e of errs) console.log(`   · [${e.sev}/${e.gt}] ${e.target_entity ?? "—"} — ${String(e.observed).slice(0, 90)}`);
  ok("no CRITICAL fault open", errs.filter((e) => e.sev === "critical" && e.st === "open").length === 0);
} finally {
  for (const a of created) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
}

rule("SUMMARY");
console.log(`\n   ${fail === 0 ? "✅" : "❌"} ${fail} failure(s)\n`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
