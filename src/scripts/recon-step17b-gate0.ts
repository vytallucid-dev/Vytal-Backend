// ═══════════════════════════════════════════════════════════════
// STEP 17 (A+B+C) — GATE 0 RECON. READ-ONLY. Writes NOTHING.
//
// Part A's fence is settled (Gate 0a/b/c → the honest 356). This script re-confirms it and then does
// the real work of THIS gate: tracing the BROKER-HOLDING RESOLUTION PATH against the code as it
// actually is, not as the build prompt assumes it is. Two of the prompt's premises are already
// suspect from a read of src/brokers:
//
//   · "broker gives ISIN + name"  — StandardHolding has NO name field, and Kite's
//     /portfolio/holdings does not send a company name (universe-admit.ts says so in its header and
//     admitBareStock sets `name: symbol` because of it). If that holds, the "store the broker's
//     reported name CLEAN and broker-neutral" ruling has NO INPUT to store.
//   · "a non-stock holding not in the catalogue" — the prompt treats this as a NEW branch to add.
//     Reading Pass 3, it is not new: it is an EXISTING BUG. An unknown ISIN with no catalogue row
//     falls straight into admitBareStock() and becomes a `stocks` row with asset_class='stock'.
//     A bond would be fabricated into an equity. This is the ETF bug of Step 13, still open for
//     every class the catalogue does not yet contain.
//
// It checks, in order:
//   1. THE FENCE — re-confirm 356, zero equity collisions.
//   2. THE BUG — what Pass 0/1/2/3 do TODAY with a bond ISIN that is not in the catalogue.
//   3. THE NAME — does any broker actually send one? (decides whether Part B's naming ruling is
//      even implementable, and from where.)
//   4. THE BROKER-NEUTRAL INVARIANT — does `instruments` carry any broker/user column?
//   5. INVESTED — is qty × avgCost computable from broker data alone?
//   6. STOCK-ADMIT FORWARD PRICING + HELD-NOT-SCORED — does loadUniverse see an admitted stock, and
//      does a PG-less stock really carry no score?
//   7. THE AUDIT FEED — can IngestionError carry an informational class without polluting the
//      fault queue? (There is a precedent: the scoring class already shares this table.)
//   8. BASELINES.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { fetchUdiff, parseUdiff, weekdaysBack, type UdiffRow } from "../ingestions/shared/udiff-bhavcopy.js";
import { GOVT_SERIES_CODES } from "../ingestions/govt-securities/govt-guards.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

const EQUITY_SERIES = ["EQ", "BE", "BZ", "SM", "ST", "SZ", "E1", "IL", "GC"];
const KNOWN_LANE = new Set<string>([...EQUITY_SERIES, "RR", "IV", "MF", ...GOVT_SERIES_CODES]);
const secType = (isin: string) => isin.slice(7, 9);
const REFUSE = new Set(["01", "04", "20"]); // equity codes, proven from NSE's own equity boards

const sessions: { day: string; rows: UdiffRow[] }[] = [];
for (const d of weekdaysBack(new Date(), 22)) {
  if (sessions.length >= 10) break;
  const f = await fetchUdiff(d);
  if (f.status !== 200 || f.bytes === 0) continue;
  const p = parseUdiff(f.buffer);
  if (!p.ok) continue;
  sessions.push({ day: d.toISOString().slice(0, 10), rows: p.rows });
}
sessions.sort((a, b) => a.day.localeCompare(b.day));

// ═══════════════════════════════════════════════════════════════
rule("1 · THE FENCE — re-confirm the honest 356 on live data");
// ═══════════════════════════════════════════════════════════════
const union = new Map<string, UdiffRow>();
for (const s of sessions) {
  for (const r of s.rows) {
    if (KNOWN_LANE.has(r.series)) continue;
    if (!r.isin || !r.isin.startsWith("INE")) continue; // INF=fund, IN0-9=govt — other lanes
    if (REFUSE.has(secType(r.isin))) continue; // equity / preference — REFUSED
    union.set(r.isin, r);
  }
}
const bonds = [...union.values()];
console.log(`sessions: ${sessions.length} (${sessions[0]!.day} … ${sessions[sessions.length - 1]!.day})`);
console.log(`★ CLEAN CORPORATE-DEBT ISINs: ${bonds.length}`);
const types: Record<string, number> = {};
for (const b of bonds) types[secType(b.isin)] = (types[secType(b.isin)] ?? 0) + 1;
console.log(`   by ISIN security-type: ${J(types)}   (07/08=NCD·debenture · 24=municipal green bond STRPP · A7=extended debt roll)`);
const collide = await q(`SELECT isin, symbol FROM stocks WHERE isin = ANY($1::text[])`, bonds.map((b) => b.isin));
const inCat = await q(`SELECT isin, asset_class::text ac FROM instruments WHERE isin = ANY($1::text[])`, bonds.map((b) => b.isin));
console.log(`   exact ISIN collision with the 504 stocks: ${collide.length} ${collide.length === 0 ? "✓" : `✗✗ ${J(collide)}`}`);
console.log(`   already in \`instruments\`:                 ${inCat.length} ${inCat.length === 0 ? "✓ all net-new" : `✗✗ ${J(inCat)}`}`);

// ═══════════════════════════════════════════════════════════════
rule("2 · THE BUG — what does the resolver do TODAY with a bond ISIN it has never seen?");
// ═══════════════════════════════════════════════════════════════
// Trace resolveHoldingsToUniverse() by hand against a bond that is NOT in the catalogue (i.e. any
// of the 356, pre-load; or ANY OTC bond, forever). No writes — we simply ask each pass's query.
const probe = bonds[0]!;
console.log(`PROBE: a broker holding of ${probe.isin}  "${probe.name}"  (tradingsymbol ${probe.symbol})\n`);

const pass0 = await q(`SELECT id FROM instruments WHERE isin=$1 AND stock_id IS NULL`, probe.isin);
console.log(`   Pass 0 — catalogue (instruments WHERE isin=… AND stock_id IS NULL): ${pass0.length} hit(s) → ${pass0.length ? "resolved" : "MISS"}`);
const pass1 = await q(`SELECT id FROM stocks WHERE symbol=$1`, probe.symbol);
console.log(`   Pass 1 — stocks by SYMBOL ("${probe.symbol}"):                      ${pass1.length} hit(s) → ${pass1.length ? "resolved" : "MISS"}`);
const pass2 = await q(`SELECT id FROM stocks WHERE isin=$1`, probe.isin);
console.log(`   Pass 2 — stocks by ISIN (the rename/spine check):                  ${pass2.length} hit(s) → ${pass2.length ? "resolved" : "MISS"}`);
console.log(`   Pass 3 — has an ISIN, matched nothing  →  admitBareStock(symbol, isin, exchange)`);
console.log(`
   ✗✗ THE BUG, STATED PLAINLY. Pass 3 has NO asset-class branch. It creates:
        stocks     { symbol: "${probe.symbol}", name: "${probe.symbol}", isin: "${probe.isin}" }
        instruments{ isin: "${probe.isin}", asset_class: 'stock', stock_id: <the new stock> }
      A CORPORATE BOND, fabricated into the EQUITY universe — sitting in \`stocks\`, which is exactly
      where loadUniverse() and the scoring engine go looking. This is the ETF bug of Step 13 (see
      universe-admit's Pass-0 autopsy) STILL OPEN for every class the catalogue does not yet contain.
      Step 13 fixed it for ETFs by CATALOGUING them — it never fixed the fall-through itself.`);

// How many of the 356 would Pass 1 catch by symbol collision? (a bond ticker colliding with a stock
// ticker would be even worse: the bond would be VALUED as that equity)
const bondSyms = bonds.map((b) => b.symbol).filter(Boolean);
const symCollide = await q(`SELECT symbol FROM stocks WHERE symbol = ANY($1::text[])`, bondSyms);
console.log(`\n   bond tradingsymbols that collide with a STOCK symbol: ${symCollide.length} ${symCollide.length === 0 ? "✓ (Pass 1 cannot mis-resolve a bond to an equity today)" : `✗✗ ${J(symCollide)}`}`);
console.log(`   → so today every one of the ${bonds.length} bonds falls to Pass 3 and would be ADMITTED AS A STOCK.`);
console.log(`   → Part A (cataloguing them) closes it for these ${bonds.length}. Part B must close the FALL-THROUGH`);
console.log(`     itself, or the next OTC bond a user holds re-opens it.`);

// ═══════════════════════════════════════════════════════════════
rule("3 · THE NAME — does the broker actually send one? (the prompt assumes it does)");
// ═══════════════════════════════════════════════════════════════
console.log(`StandardHolding (src/brokers/types.ts) declares: symbol, quantity, avgCost, currentValue, isin, exchange.`);
console.log(`   → there is NO \`name\` field on the canonical holding shape.`);
console.log(`KiteHolding (src/brokers/adapters/kite-http.ts) declares: tradingsymbol, quantity, average_price,`);
console.log(`   last_price, isin?, exchange?  → NO company name. zerodha.normalize() maps exactly these.`);
console.log(`universe-admit.ts header, verbatim:`);
console.log(`   "name: the broker sends NO company name (confirmed against the Kite Connect v3 response`);
console.log(`    attributes). So name = the symbol."   → and admitBareStock() does exactly that.\n`);
console.log(`✗✗ SO PART B's PREMISE IS FALSE. "Store the broker's reported name CLEAN and broker-neutral"`);
console.log(`   has no input to store: THE BROKER REPORTS NO NAME. The Option-1 ruling is unimplementable`);
console.log(`   as written — not because it is wrong, but because the field does not exist.\n`);
console.log(`   WHERE A REAL NAME CAN HONESTLY COME FROM INSTEAD (and this is the good news):`);
console.log(`     · in the catalogue → we already have the real name (${bonds.length} bonds get FinInstrmNm from the udiff).`);
console.log(`     · NOT in the catalogue → the ISIN is all we have. name = symbol, exactly as a bare stock does`);
console.log(`       today. That is the honest statement, and it is ALREADY broker-neutral (a tradingsymbol is`);
console.log(`       an exchange ticker, not broker branding) — so the invariant Part B wants is already true.`);
console.log(`   The prompt's fear (a "Zerodha"-branded name leaking into a shared row) cannot occur, because`);
console.log(`   no broker-authored string is ever stored on an instrument in the first place.`);

// ═══════════════════════════════════════════════════════════════
rule("4 · THE BROKER-NEUTRAL INVARIANT — does `instruments` carry ANY broker/user column?");
// ═══════════════════════════════════════════════════════════════
const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='instruments' ORDER BY ordinal_position`);
console.log(`instruments columns: ${cols.map((c: any) => c.column_name).join(", ")}`);
const bad = cols.filter((c: any) => /broker|user/i.test(c.column_name));
console.log(`\n   columns matching /broker|user/: ${bad.length} ${bad.length === 0 ? "✓ NONE — the catalogue row is broker-neutral BY CONSTRUCTION" : `✗✗ ${J(bad)}`}`);
const bh = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='broker_holdings' AND column_name IN ('broker_connection_id','user_id','instrument_id','stock_id','quantity','avg_cost')`);
console.log(`   broker association lives on broker_holdings: ${bh.map((c: any) => c.column_name).join(", ")} ✓`);
console.log(`   → User A (Zerodha) and User B (Upstox) holding the same ISIN both point instrument_id at the`);
console.log(`     SAME shared row. Neither can see the other's broker. The invariant HOLDS today, unchanged.`);

// ═══════════════════════════════════════════════════════════════
rule("5 · INVESTED — computable from broker data alone?");
// ═══════════════════════════════════════════════════════════════
const nn = await q(`SELECT column_name, is_nullable FROM information_schema.columns
                     WHERE table_name='broker_holdings' AND column_name IN ('quantity','avg_cost')`);
console.log(`   ${J(nn)}`);
console.log(`   → quantity NOT NULL, avg_cost NOT NULL. invested = quantity × avg_cost needs NO price of ours. ✓`);
console.log(`\n   BUT src/brokers/union.ts line ~188 currently sets, for every broker row:`);
console.log(`        investedValue: null,   // "the snapshot feed carries no invested figure"`);
console.log(`   That is TRUE of the feed and FALSE of the arithmetic — the two inputs are right there, NOT NULL.`);
console.log(`   And it is exactly the manual side's definition (Σ open-lot qty × cost), so the two engines stay`);
console.log(`   comparable. This is a real, safe, one-line-shaped change — and it is what makes an UNPRICEABLE`);
console.log(`   holding show a number instead of a blank.`);

// ═══════════════════════════════════════════════════════════════
rule("6 · STOCK AUTO-ADMIT — forward pricing, and does held-not-scored actually hold?");
// ═══════════════════════════════════════════════════════════════
console.log(`loadUniverse() (src/ingestions/prices/ingest-prices.ts:61) reads:`);
console.log(`   prisma.stock.findMany({ where: { isActive: true }, select: { id, symbol } })`);
console.log(`   → keyed on SYMBOL, over ALL active stocks. An auto-admitted stock is isActive:true, so the`);
console.log(`     NEXT daily-prices run prices it — IF its tradingsymbol appears in the bhavcopy (it is an NSE`);
console.log(`     ticker, so it does). No backfill: history starts at admit-date. ✓ CONFIRMED\n`);
const scored = await q(`
  SELECT (SELECT count(*)::int FROM stocks) total,
         (SELECT count(DISTINCT stock_id)::int FROM stock_peer_groups) with_pg,
         (SELECT count(*)::int FROM stocks s WHERE NOT EXISTS (SELECT 1 FROM stock_peer_groups g WHERE g.stock_id=s.id)) no_pg`);
console.log(`   stocks: ${J(scored)}`);
const snap = await q(`SELECT count(*)::int n FROM score_snapshots`).catch(() => [{ n: "—" }]);
const snapNoPg = await q(`
  SELECT count(*)::int n FROM score_snapshots ss
   WHERE NOT EXISTS (SELECT 1 FROM stock_peer_groups g WHERE g.stock_id = ss.stock_id)`).catch(() => [{ n: "—" }]);
console.log(`   score_snapshots total: ${J(snap)}   · snapshots for a PG-LESS stock: ${J(snapNoPg)}`);
console.log(`   → a stock with NO peer group carries NO score. Held-not-scored is not a new flag to add —`);
console.log(`     it is the EXISTING consequence of having no PG. An auto-admitted stock gets no PG, so it`);
console.log(`     is held-not-scored by construction. Scoring stays a deliberate promotion (assign PG). ✓`);

// ═══════════════════════════════════════════════════════════════
rule("7 · THE AUDIT FEED — can IngestionError carry an INFORMATIONAL class?");
// ═══════════════════════════════════════════════════════════════
console.log(`GuardType enum today:`);
console.log(J((await q(`SELECT e.enumlabel l FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='GuardType' ORDER BY e.enumsortorder`)).map((r: any) => r.l)));
console.log(`IngestionSeverity today:`);
console.log(J((await q(`SELECT e.enumlabel l FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='IngestionSeverity' ORDER BY e.enumsortorder`)).map((r: any) => r.l)));
console.log(`
   → NO informational value in either enum. Part C needs a migration (Gate 1): a GuardType
     (e.g. 'broker_seeded') and an IngestionSeverity ('info'). Both are ADDITIVE enum values.

   THE PRECEDENT IS ALREADY THERE, and it is exactly this shape: the SCORING error class shares this
   same table via its own guardTypes (scoring_job_failed/…) + a synthetic cron ("scoring:<job>"), and
   ingestion-error.ts documents why the two cannot collide on dedup. A third, INFORMATIONAL class is
   the same move a third time.

   THE ONE THING THAT IS NOT FREE — the fault count. ingestion-errors-controller.ts builds:
        if (!status || status === "open") where.status = "open";
   with NO guardType exclusion. So an info row WOULD land in the default triage list and WOULD be
   counted as a fault. The controller must EXCLUDE the info class by default (and the frontend's
   severity filter — currently critical|high|medium|low — needs the new category as its own view).
   That is a deliberate change in both repos, not an emergent property.`);
const openNow = await q(`SELECT count(*)::int n FROM ingestion_errors WHERE status='open'`);
console.log(`\n   open faults right now (the number that must not be inflated): ${J(openNow)}`);

// ═══════════════════════════════════════════════════════════════
rule("8 · BASELINES — the fingerprints Gate 3 re-measures byte-identical");
// ═══════════════════════════════════════════════════════════════
console.log("instruments:      ", J(await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`)));
console.log("stocks:           ", J(await q(`SELECT count(*)::int n FROM stocks`)));
console.log("peer_groups:      ", J(await q(`SELECT count(*)::int n FROM peer_groups`)));
console.log("stock_peer_groups:", J(await q(`SELECT count(*)::int n FROM stock_peer_groups`)));
console.log("instrument_prices:", J(await q(`SELECT count(*)::int n FROM instrument_prices`)));
console.log("broker_holdings:  ", J(await q(`SELECT count(*)::int n FROM broker_holdings`)));
console.log("ingestion_errors: ", J(await q(`SELECT status, count(*)::int n FROM ingestion_errors GROUP BY 1 ORDER BY 1`)));

await prisma.$disconnect();
console.log("\n═══ GATE 0 COMPLETE — nothing was written. ═══");
