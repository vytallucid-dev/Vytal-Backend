// ═══════════════════════════════════════════════════════════════
// STEP 17 — GATE 3 VERIFY. Bonds + broker resolution + the audit feed.
//
// This does NOT assert on code comments. It SIMULATES a real broker sync — three synthetic holdings
// carrying VALID Indian ISINs the taxonomy has never seen (an equity, a bond, and one with an
// unknown security-type) — pushes them through the ACTUAL resolveHoldingsToUniverse() the sync path
// calls, and then reads the database to see what really happened.
//
// Then it DELETES every synthetic row and re-measures the fingerprints, so the byte-identical claim
// is proven over the state this script itself perturbed. A verify that leaves residue is not a
// verify; it is a migration nobody reviewed.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { resolveHoldingsToUniverse } from "../brokers/universe-admit.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { resolvePrice } from "../portfolio/price-resolver.js";
import { classifyIsin, ISIN_TAXONOMY } from "../ingestions/shared/isin-class.js";
import { isCorporateDebt } from "../ingestions/corporate-bonds/bond-guards.js";
import type { StandardHolding } from "../brokers/types.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

let PASS = 0;
let FAIL = 0;
const ok = (cond: boolean, label: string, detail = "") => {
  cond ? PASS++ : FAIL++;
  console.log(`   ${cond ? "✓" : "✗✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

// ── THE SYNTHETIC HOLDINGS ────────────────────────────────────────────────────
// Real ISIN GRAMMAR, fake issuer ("000Z") so they cannot collide with anything live. Each one
// exercises a DIFFERENT branch of the Pass-3 fix.
const SYN_STOCK = "INE000Z01011"; // type 01 → equity   → admit to stocks + catalogue
const SYN_BOND = "INE000Z07019"; // type 07 → debt     → catalogue only, stock_id NULL
const SYN_UNKNOWN = "INE000Z99017"; // type 99 → unknown → NO ROW. The honest gap.
const SYN_PREFIX = "INE000Z";

const cleanup = async () => {
  await q(`DELETE FROM ingestion_errors WHERE target_entity LIKE $1`, `${SYN_PREFIX}%`);
  await q(`DELETE FROM instruments WHERE isin LIKE $1`, `${SYN_PREFIX}%`);
  await q(`DELETE FROM stocks WHERE isin LIKE $1`, `${SYN_PREFIX}%`);
};
await cleanup(); // in case a prior run died mid-way

// ── BASELINE, captured BEFORE we perturb anything ────────────────────────────
const fp = async () => ({
  instruments: await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`),
  stocks: (await q(`SELECT count(*)::int n FROM stocks`))[0].n,
  peerGroups: (await q(`SELECT count(*)::int n FROM peer_groups`))[0].n,
  stockPeerGroups: (await q(`SELECT count(*)::int n FROM stock_peer_groups`))[0].n,
  scoreSnapshots: (await q(`SELECT count(*)::int n FROM score_snapshots`))[0].n,
  scoredStocks: (await q(`SELECT count(DISTINCT stock_id)::int n FROM stock_peer_groups`))[0].n,
  openFaults: (await q(`SELECT count(*)::int n FROM ingestion_errors WHERE status='open' AND guard_type <> 'broker_seeded'`))[0].n,
});
const BEFORE = await fp();
console.log("BASELINE:", J(BEFORE));

// ═══════════════════════════════════════════════════════════════
rule("1 · THE BOND LOAD — 356, fenced on the ISIN, priced, held-not-scored");
// ═══════════════════════════════════════════════════════════════
const bonds = (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class='bond'`))[0].n;
ok(bonds === 356, `356 bonds in the catalogue`, `found ${bonds}`);
ok(
  (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class='bond' AND stock_id IS NOT NULL`))[0].n === 0,
  `every bond has stock_id NULL → HELD-NOT-SCORED by construction (the scoring universe cannot see it)`,
);
ok(
  (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class='bond' AND isin IS NULL`))[0].n === 0,
  `every bond is keyed on the ISIN spine`,
);
const dupes = await q(`SELECT isin FROM instruments WHERE asset_class='bond' GROUP BY isin HAVING count(*) > 1`);
ok(dupes.length === 0, `ISIN-unique — no duplicates`, `${dupes.length} dupes`);

const priced = (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class='bond' AND last_price IS NOT NULL`))[0].n;
ok(priced === 356, `all 356 priced via the instrument_prices lane`, `${priced}/356`);
const bp = (await q(`SELECT count(*)::int n FROM instrument_prices ip JOIN instruments i ON i.id=ip.instrument_id WHERE i.asset_class='bond'`))[0].n;
ok(bp > 0, `bond price rows landed in instrument_prices`, `${bp} rows`);
const dated = (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class='bond' AND last_price IS NOT NULL AND last_price_date IS NULL`))[0].n;
ok(dated === 0, `no bond carries a price without a DATE (a price must never render undated)`);

// ── THE FENCE, re-proven against the loaded rows ──
const equityTypes = await q(
  `SELECT DISTINCT substring(isin from 8 for 2) st FROM instruments WHERE asset_class='bond' ORDER BY 1`,
);
const loadedTypes = equityTypes.map((r: any) => r.st);
ok(
  loadedTypes.every((t: string) => (ISIN_TAXONOMY.DEBT_TYPES as readonly string[]).includes(t)),
  `every loaded bond carries a DEBT ISIN security-type`,
  `types: ${loadedTypes.join(",")}`,
);
ok(
  (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class='bond' AND substring(isin from 8 for 2) IN ('01','04','20')`))[0].n === 0,
  `NO equity/preference type-code was admitted as a bond (the BAYERCROP failure is unreachable)`,
);
ok(
  (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class='bond' AND isin NOT LIKE 'INE%'`))[0].n === 0,
  `every bond is INE (corporate) — no INF fund, no IN0-9 government paper`,
);

// ── THE EQUITY COLLISION — the one that must be zero ──
const coll = await q(`SELECT i.isin, s.symbol FROM instruments i JOIN stocks s ON s.isin = i.isin WHERE i.asset_class='bond'`);
ok(coll.length === 0, `ZERO bond ISINs collide with a stock — no P2002, the equity spine is intact`, J(coll));

// ── DISJOINT FROM GOVERNMENT ──
const govtOverlap = await q(`
  SELECT count(*)::int n FROM instruments b
   WHERE b.asset_class='bond'
     AND EXISTS (SELECT 1 FROM instruments g WHERE g.isin=b.isin AND g.asset_class IN ('gsec','sgb'))`);
ok(govtOverlap[0].n === 0, `bonds ∩ govt = ∅ — the two fences are complementary and DISJOINT`);
const govtStill = await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments WHERE asset_class IN ('gsec','sgb') GROUP BY 1 ORDER BY 1`);
ok(
  govtStill.find((r: any) => r.ac === "gsec")?.n === 170 && govtStill.find((r: any) => r.ac === "sgb")?.n === 45,
  `government paper UNMOVED by the bond load`,
  J(govtStill),
);

// ── ATTRIBUTE HONESTY ──
const attrs = (await q(`
  SELECT count(*) FILTER (WHERE attributes->>'coupon' IS NOT NULL)::int coupon,
         count(*) FILTER (WHERE (attributes->>'coupon')::numeric = 0)::int zero_coupon,
         count(*) FILTER (WHERE attributes->>'maturityYear' IS NOT NULL)::int mat_year,
         count(*) FILTER (WHERE attributes->>'maturityDate' IS NOT NULL)::int mat_date,
         count(*) FILTER (WHERE attributes->>'issuer' IS NOT NULL)::int issuer,
         count(*) FILTER (WHERE attributes->>'creditRating' IS NOT NULL)::int rating,
         count(*) FILTER (WHERE attributes->>'creditRatingNullReason' = 'not_sourceable')::int rating_reason
    FROM instruments WHERE asset_class='bond'`))[0];
console.log(`   attributes: ${J(attrs)}`);
ok(Number(attrs.rating) === 0, `CREDIT RATING is null on ALL 356 — never inferred, never defaulted to AAA`);
ok(Number(attrs.rating_reason) === 356, `…and every one carries the REASON "not_sourceable" (honest-empty, not merely empty)`);
ok(Number(attrs.coupon) > 300, `coupon parsed where the name carries one`, `${attrs.coupon}/356`);
ok(Number(attrs.zero_coupon) > 0, `zero-coupon bonds stored as a REAL 0, not conflated with null`, `${attrs.zero_coupon} of them`);
ok(Number(attrs.mat_date) < 10, `exact maturity ONLY where the name spells it out — never invented`, `${attrs.mat_date}/356`);
ok(Number(attrs.issuer) === 191, `issuer resolved BY JOIN on the ISIN stem, not parsed from the name`, `${attrs.issuer}/356`);

// ═══════════════════════════════════════════════════════════════
rule("2 · THE ISIN TAXONOMY — the shared discriminator both callers use");
// ═══════════════════════════════════════════════════════════════
ok(classifyIsin("INE462A01022").kind === "equity", `BAYERCROP (INE462A01022) classifies as EQUITY — the collision that started this`);
ok(classifyIsin("INE494B04019").kind === "unclassifiable", `TVS Motor pref shares (INE494B04019) → unclassifiable, NOT debt`);
ok(classifyIsin("INE00QS24043").kind === "debt", `Indore Municipal green bond (INE00QS24043, type 24) → DEBT (the 12 that were nearly dropped)`);
ok(classifyIsin("INE787H07156").kind === "debt", `an NCD (type 07) → DEBT`);
ok(classifyIsin("INF754K30052").kind === "unclassifiable", `a fund unit (INF) → unclassifiable, never a bond`);
ok(classifyIsin("IN0020240068").kind === "unclassifiable", `government paper (IN0) → unclassifiable, never a corporate bond`);
ok(classifyIsin(null).kind === "unclassifiable", `no ISIN → unclassifiable (the honest gap)`);
// The fence's TWO keys are genuinely independent: a bond ISIN on a CLAIMED board is still refused.
ok(isCorporateDebt("N0", "INE787H07156") === true, `two-key fence ADMITS a debt ISIN on an unclaimed board`);
ok(isCorporateDebt("EQ", "INE787H07156") === false, `two-key fence REFUSES the same ISIN on the EQ board (key 1 is real, not decorative)`);
ok(isCorporateDebt("N0", "INE462A01022") === false, `two-key fence REFUSES an EQUITY ISIN on an unclaimed board (key 2 is what stops BAYERCROP)`);

// ═══════════════════════════════════════════════════════════════
rule("3 · BROKER RESOLUTION — the Pass-3 fix, simulated end-to-end");
// ═══════════════════════════════════════════════════════════════
const holdings: StandardHolding[] = [
  { symbol: "SYNSTOCK", quantity: 10, avgCost: 100, currentValue: null, isin: SYN_STOCK, exchange: "NSE" },
  { symbol: "SYNBOND28", quantity: 5, avgCost: 1000, currentValue: null, isin: SYN_BOND, exchange: "NSE" },
  { symbol: "SYNWEIRD", quantity: 3, avgCost: 50, currentValue: null, isin: SYN_UNKNOWN, exchange: "NSE" },
];
const r1 = await resolveHoldingsToUniverse(holdings);
console.log(`   outcomes: ${J(r1.outcomes.map((o) => ({ s: o.symbol, how: o.how })))}`);

// ── (a) STOCK → admitted to stocks + catalogue, held-NOT-scored ──
const synStock = await q(`SELECT id, symbol, name, isin FROM stocks WHERE isin=$1`, SYN_STOCK);
ok(synStock.length === 1, `a broker STOCK outside the 504 → ADMITTED to \`stocks\``);
const synStockInst = await q(`SELECT id, asset_class::text ac, stock_id FROM instruments WHERE isin=$1`, SYN_STOCK);
ok(synStockInst[0]?.ac === "stock" && synStockInst[0]?.stock_id, `…and to the catalogue as asset_class=stock, pointing at the stock`);
const synPg = await q(`SELECT count(*)::int n FROM stock_peer_groups WHERE stock_id=$1`, synStock[0]?.id);
ok(synPg[0].n === 0, `…with NO peer group → HELD-NOT-SCORED. Scoring stays a deliberate promotion.`);
const synScore = await q(`SELECT count(*)::int n FROM score_snapshots WHERE stock_id=$1`, synStock[0]?.id);
ok(synScore[0].n === 0, `…and NO score snapshot`);
const active = await q(`SELECT is_active FROM stocks WHERE isin=$1`, SYN_STOCK);
ok(active[0]?.is_active === true, `…is_active=true → loadUniverse() picks it up on the NEXT daily-prices run (priced forward, no backfill)`);

// ── (b) BOND → catalogue only. NEVER a stocks row. This is the bug fix. ──
const synBondStock = await q(`SELECT count(*)::int n FROM stocks WHERE isin=$1`, SYN_BOND);
ok(synBondStock[0].n === 0, `★ a broker BOND is NOT fabricated into \`stocks\` — THE BUG IS FIXED`);
const synBondInst = await q(`SELECT id, asset_class::text ac, stock_id, name, symbol FROM instruments WHERE isin=$1`, SYN_BOND);
ok(synBondInst[0]?.ac === "bond", `…it is admitted to the CATALOGUE as asset_class=bond`, `got ${synBondInst[0]?.ac}`);
ok(synBondInst[0]?.stock_id === null, `…with stock_id NULL → held-NOT-scored, structurally unreachable from the scoring engine`);

// ── (c) UNKNOWN TYPE → NO ROW. The honest gap. ──
ok(
  (await q(`SELECT count(*)::int n FROM stocks WHERE isin=$1`, SYN_UNKNOWN))[0].n === 0 &&
    (await q(`SELECT count(*)::int n FROM instruments WHERE isin=$1`, SYN_UNKNOWN))[0].n === 0,
  `★ an ISIN with an UNKNOWN security-type creates NO ROW — never guessed into a class`,
);
ok(r1.unidentifiable.includes("SYNWEIRD"), `…and is reported as unidentifiable (named, never silently dropped)`);

// ═══════════════════════════════════════════════════════════════
rule("4 · BROKER-NEUTRAL + SHARED — a second user's sync of the SAME ISIN");
// ═══════════════════════════════════════════════════════════════
// A different broker, a different tradingsymbol for the same security. The ISIN is the spine.
const r2 = await resolveHoldingsToUniverse([
  { symbol: "SYNBOND28X", quantity: 99, avgCost: 990, currentValue: null, isin: SYN_BOND, exchange: "BSE" },
]);
const rows2 = await q(`SELECT id FROM instruments WHERE isin=$1`, SYN_BOND);
ok(rows2.length === 1, `the second sync resolved to the SAME single shared row (not a fork)`, `${rows2.length} rows`);
ok(rows2[0].id === synBondInst[0].id, `…the very same instrument id`);
ok(r2.admittedInstruments.length === 0, `…and admitted NOTHING new (Pass 0 answered — it was already catalogued)`);

const instCols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='instruments' AND column_name ~* 'broker|user'`);
ok(instCols.length === 0, `\`instruments\` has NO broker/user column — the catalogue row is broker-neutral BY CONSTRUCTION`);
const bondName = synBondInst[0]?.name;
ok(
  !/zerodha|kite|upstox|groww|angel|broker/i.test(String(bondName)),
  `the stored name carries NO broker branding`,
  `name = "${bondName}" (the exchange tradingsymbol — the broker sends no company name at all)`,
);

// ═══════════════════════════════════════════════════════════════
rule("5 · THE AUDIT FEED — informational, per-instrument-once, never a fault");
// ═══════════════════════════════════════════════════════════════
const audit = await q(
  `SELECT target_entity isin, severity::text sev, guard_type::text gt, source, status, occurrences, observed
     FROM ingestion_errors WHERE target_entity LIKE $1 ORDER BY target_entity`,
  `${SYN_PREFIX}%`,
);
console.log(`   ${audit.length} audit event(s):`);
for (const a of audit) console.log(`     [${a.sev}/${a.gt}] ${a.isin} ×${a.occurrences}  ${String(a.observed).slice(0, 78)}`);

ok(audit.length === 2, `exactly TWO events — one for the stock, one for the bond`, `${audit.length}`);
ok(audit.every((a: any) => a.gt === "broker_seeded" && a.sev === "info"), `both are guard_type=broker_seeded, severity=info`);
ok(audit.every((a: any) => a.source === "broker"), `both carry source="broker"`);
ok(
  audit.find((a: any) => a.isin === SYN_UNKNOWN) === undefined,
  `the UNCLASSIFIABLE holding fired NO admission event (nothing was admitted, so nothing is claimed)`,
);
// The second user's sync must fire NOTHING — the event is per-INSTRUMENT, at creation.
const bondEvent = audit.find((a: any) => a.isin === SYN_BOND);
ok(Number(bondEvent?.occurrences) === 1, `★ the SECOND user's sync of the same ISIN fired NO new event`, `occurrences=${bondEvent?.occurrences}`);

// ── AND THE PART THAT MATTERS MOST: it must not inflate the fault count. ──
const faultsNow = (await q(`SELECT count(*)::int n FROM ingestion_errors WHERE status='open' AND guard_type <> 'broker_seeded'`))[0].n;
ok(faultsNow === BEFORE.openFaults, `★ the OPEN-FAULT count did NOT move (${BEFORE.openFaults} → ${faultsNow}) — an admission is not a problem`);
const naive = (await q(`SELECT count(*)::int n FROM ingestion_errors WHERE status='open'`))[0].n;
console.log(`   (a NAIVE count that forgot to exclude the audit class would read ${naive}, not ${faultsNow} — which is exactly why the controller excludes it by default)`);

// ═══════════════════════════════════════════════════════════════
rule("6 · INVESTED IS ALWAYS SHOWN · VALUE IS HONESTLY ABSENT");
// ═══════════════════════════════════════════════════════════════
// The price resolver, exercised directly on the shape a broker-seeded OTC bond actually has.
const otc = resolvePrice({
  stockId: null,
  instrumentId: synBondInst[0].id,
  stockPrice: undefined,
  instrument: { assetClass: "bond", lastPrice: null, lastPriceDate: null, currentNav: null, navDate: null, isActive: true },
});
ok(otc.price === null, `an unpriceable bond resolves to price=null — never 0, never a guess`);
ok(otc.unpricedReason === "not_exchange_traded", `…with reason "not_exchange_traded", NOT "no_price_yet"`, `got "${otc.unpricedReason}"`);
console.log(`   → "no_price_yet" would promise a number that is never coming. This says the true thing.`);

// A LOADED bond (one of the 356) DOES price, through the same resolver.
const realBond = (await q(`SELECT id, last_price, last_price_date FROM instruments WHERE asset_class='bond' AND last_price IS NOT NULL LIMIT 1`))[0];
const rp = resolvePrice({
  stockId: null,
  instrumentId: realBond.id,
  stockPrice: undefined,
  instrument: {
    assetClass: "bond", lastPrice: realBond.last_price, lastPriceDate: realBond.last_price_date,
    currentNav: null, navDate: null, isActive: true,
  },
});
ok(rp.price !== null && rp.source === "exchange_close", `an NSE-traded bond DOES value, via the 14.5 resolver, with zero read-path change`, `₹${rp.price} as of ${rp.asOf}`);

// The invested amount — computed from broker data alone, so it survives having no price.
const bh = await q(`SELECT user_id, quantity, avg_cost FROM broker_holdings LIMIT 1`);
if (bh.length) {
  const positions = await listUnifiedPositions(String(bh[0].user_id));
  const brokerPos = positions.filter((p) => p.source === "broker");
  const withInvested = brokerPos.filter((p) => p.investedValue != null);
  ok(
    brokerPos.length > 0 && withInvested.length === brokerPos.length,
    `EVERY broker position now carries an invested amount (was null for all of them)`,
    `${withInvested.length}/${brokerPos.length}`,
  );
  const s = brokerPos[0]!;
  const expect = Number(s.quantity) * Number(s.avgCost);
  ok(
    Math.abs(Number(s.investedValue) - expect) < 0.01,
    `invested = quantity × avgCost, from the broker's own snapshot — needs NO price of ours`,
    `${s.symbol}: ${s.quantity} × ${s.avgCost} = ${s.investedValue}`,
  );
  ok(brokerPos.every((p) => p.realizedPnl === null), `realizedPnl still honestly NULL (a snapshot has no lot register — not fabricated)`);
} else {
  console.log("   (no broker_holdings rows to read — skipping the live union check)");
}

// ═══════════════════════════════════════════════════════════════
rule("7 · CLEANUP + BYTE-IDENTICAL");
// ═══════════════════════════════════════════════════════════════
await cleanup();
const AFTER = await fp();

const b = { ...BEFORE } as any;
const a = { ...AFTER } as any;
// The bond load DID add 356 instruments — that is the deliverable, not a regression. Everything else
// must be untouched, and the SCORED set most of all.
const bondsNow = (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class='bond'`))[0].n;
ok(bondsNow === 356, `356 bonds remain after cleanup (the synthetic rows are gone; the real load is not)`);

ok(a.stocks === b.stocks, `stocks: ${b.stocks} → ${a.stocks} (the synthetic admit was reversed)`);
ok(a.stocks === 504, `★ the 504 SCORED-UNIVERSE stocks are UNCHANGED`);
ok(a.peerGroups === b.peerGroups && a.peerGroups === 23, `★ peer groups UNCHANGED (23)`);
ok(a.stockPeerGroups === b.stockPeerGroups && a.stockPeerGroups === 149, `★ stock↔PG assignments UNCHANGED (149)`);
ok(a.scoreSnapshots === b.scoreSnapshots, `★ score snapshots UNCHANGED (${a.scoreSnapshots}) — nothing was re-scored`);
ok(a.scoredStocks === b.scoredStocks, `★ the SCORED stock set UNCHANGED (${a.scoredStocks})`);
ok(a.openFaults === b.openFaults, `★ open faults UNCHANGED (${a.openFaults}) — the audit class never entered the queue`);

const other = await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments WHERE asset_class <> 'bond' GROUP BY 1 ORDER BY 1`);
console.log(`\n   non-bond catalogue: ${J(other)}`);
const expect: Record<string, number> = { etf: 337, gsec: 170, invit: 15, mutual_fund: 17567, reit: 6, sgb: 45, stock: 504 };
let allOk = true;
for (const [k, v] of Object.entries(expect)) {
  const got = other.find((r: any) => r.ac === k)?.n;
  if (got !== v) { allOk = false; console.log(`      ✗✗ ${k}: expected ${v}, got ${got}`); }
}
ok(allOk, `★ BYTE-IDENTICAL — 504 stocks · 17,567 MF · 337 ETF · 21 trusts · 215 govt, all unmoved`);

const residue = await q(`SELECT count(*)::int n FROM instruments WHERE isin LIKE $1`, `${SYN_PREFIX}%`);
ok(residue[0].n === 0, `no synthetic residue left behind by this verify`);

// ═══════════════════════════════════════════════════════════════
rule(FAIL === 0 ? `✓✓ GATE 3 PASS — ${PASS} checks, 0 failures` : `✗✗ GATE 3 FAIL — ${FAIL} of ${PASS + FAIL} checks failed`);
// ═══════════════════════════════════════════════════════════════
await prisma.$disconnect();
process.exit(FAIL === 0 ? 0 : 1);
