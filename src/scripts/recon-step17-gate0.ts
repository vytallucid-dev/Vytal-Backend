// ═══════════════════════════════════════════════════════════════
// STEP 17 — GATE 0 RECON (READ-ONLY). Corporate bonds / NCDs identity.
//
// THIS IS A STORAGE-SIZING RECON FIRST AND A SOURCING RECON SECOND. The load is the largest one
// left, and the DB is at ~359MB against a 500MB Supabase Free ceiling. So the PRIMARY deliverable
// is a number: THE COUNT × bytes-per-row = MB. That number, and nothing else, decides whether we
// load on Free or upgrade to Pro BEFORE loading. Nothing is written here.
//
//   A. THE COUNT — how many corporate-debt ISINs are in the udiff, unioned across sessions? Debt is
//      thin (Step 15 measured govt paper at 115/day → 197/union) so ONE day undercounts by design.
//   B. THE FENCE — the corporate-debt series are the INVERSE of the govt allow-list. Derive them
//      EMPIRICALLY as the complement of every known lane, so nothing is assumed and nothing is
//      missed. Prove the two allow-lists are disjoint.
//   C. THE STORAGE ESTIMATE — measured, not guessed. The existing `gsec` rows are the exact shape a
//      bond row will have (stock_id NULL, attributes JSONB, no MF payload), so pg_column_size() on
//      THEM is the honest bytes/row. Index overhead + price rows + the DAILY price accrual too —
//      instrument_prices grows every session forever, and at scale that dominates the identity load.
//   D. THE INE-COLLISION — corporate bonds are issued by COMPANIES, in the same INE namespace as
//      equity. This is the bond analogue of the ETF INF-collision scare. Does any bond ISIN exactly
//      collide with a stock's ISIN? (It must not — different instruments get different ISINs — but
//      the ETF scare is exactly why we check for real instead of reasoning about it.)
//   E. ATTRIBUTE HONESTY — issuer/coupon/maturity from the name? Rating from anywhere? A bond's
//      rating is its key signal; if it is not sourceable it goes NULL, never fabricated.
//   F. THE ENUM — 'bond' exists (Step 8). Verify → Gate 1 is likely a SKIP.
//   G. IS THE UDIFF THE WHOLE UNIVERSE? Corporate debt is heavily OTC / BSE-listed. The NSE CM
//      segment may carry a FRACTION of the holdable set. Say so honestly rather than pass an
//      NSE-traded count off as "the universe".
//   H. BASELINE fingerprints for Gate 3.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { fetchUdiff, parseUdiff, weekdaysBack, type UdiffRow } from "../ingestions/shared/udiff-bhavcopy.js";
import { GOVT_SERIES_CODES } from "../ingestions/govt-securities/govt-guards.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));
const MB = (b: number) => `${(b / 1_048_576).toFixed(1)}MB`;

// The lanes ALREADY LOADED. Everything in the file that is not one of these and not government is,
// by elimination, the corporate-debt zoo. Deriving the include-set as a COMPLEMENT means a series
// we have never seen before shows up in the recon instead of being silently skipped by a hardcoded
// list — the failure mode a "N*/Y*/Z*/P*" prefix guess would have.
const EQUITY_SERIES = ["EQ", "BE", "BZ", "SM", "ST", "SZ", "E1", "IL", "GC"]; // stocks + the SME/illiquid boards
const TRUST_SERIES = ["RR", "IV"]; // REIT / InvIT — Step 14
const FUND_SERIES = ["MF"]; // closed-end fund units
const GOVT = GOVT_SERIES_CODES as readonly string[]; // GS/TB/GB/SG — Step 15, imported NOT re-typed
const KNOWN = new Set<string>([...EQUITY_SERIES, ...TRUST_SERIES, ...FUND_SERIES, ...GOVT]);

const LOOKBACK = 10;
const MAX_WALK = 22;

// ── Fetch the look-back window ─────────────────────────────────────────────
const sessions: { day: string; rows: UdiffRow[] }[] = [];
for (const d of weekdaysBack(new Date(), MAX_WALK)) {
  if (sessions.length >= LOOKBACK) break;
  const f = await fetchUdiff(d);
  if (f.status !== 200 || f.bytes === 0) continue;
  const p = parseUdiff(f.buffer);
  if (!p.ok) continue;
  sessions.push({ day: d.toISOString().slice(0, 10), rows: p.rows });
}
if (sessions.length === 0) {
  console.log("!! no udiff fetched — cannot size. STOP.");
  await prisma.$disconnect();
  process.exit(1);
}
sessions.sort((a, b) => a.day.localeCompare(b.day));
console.log(`udiff sessions fetched: ${sessions.length} — ${sessions[0]!.day} … ${sessions[sessions.length - 1]!.day}`);
console.log(`rows per session: ${sessions.map((s) => `${s.day}:${s.rows.length}`).join("  ")}`);

// ═══════════════════════════════════════════════════════════════
rule("B · THE FENCE — derive the corporate-debt series as the COMPLEMENT of every known lane");
// ═══════════════════════════════════════════════════════════════
const histAll: Record<string, number> = {};
for (const r of sessions[sessions.length - 1]!.rows) histAll[r.series] = (histAll[r.series] ?? 0) + 1;
console.log("FULL SERIES HISTOGRAM (latest session):", J(histAll));

const debtSeries = [...new Set(sessions.flatMap((s) => s.rows.map((r) => r.series)))]
  .filter((s) => !KNOWN.has(s))
  .sort();
console.log(`\nKNOWN lanes fenced out: equity[${EQUITY_SERIES.join(",")}] trust[${TRUST_SERIES.join(",")}] fund[${FUND_SERIES.join(",")}] govt[${GOVT.join(",")}]`);
console.log(`\n→ THE CORPORATE-DEBT INCLUDE SET (${debtSeries.length} series): ${debtSeries.join(", ")}`);

// DISJOINTNESS — the two allow-lists must not intersect. Proven, not asserted.
const overlap = debtSeries.filter((s) => GOVT.includes(s));
console.log(`\nDISJOINTNESS vs the govt allow-list: ${overlap.length === 0 ? "✓ PROVEN — zero intersection" : `✗✗ OVERLAP: ${overlap.join(",")}`}`);

// ═══════════════════════════════════════════════════════════════
rule("A · THE COUNT — the number that decides everything");
// ═══════════════════════════════════════════════════════════════
const debtSet = new Set(debtSeries);
const perDay: Record<string, number> = {};
const union = new Map<string, { row: UdiffRow; day: string }>();
for (const s of sessions) {
  const mine = s.rows.filter((r) => debtSet.has(r.series));
  perDay[s.day] = mine.length;
  for (const r of mine) if (r.isin) union.set(r.isin, { row: r, day: s.day }); // most-recent wins
}
const noIsin = sessions.flatMap((s) => s.rows.filter((r) => debtSet.has(r.series) && !r.isin));

console.log(`corporate-debt ROWS per session: ${J(perDay)}`);
const days = Object.values(perDay);
console.log(`   single-session range: ${Math.min(...days)} … ${Math.max(...days)}  (median ${days.sort((a, b) => a - b)[Math.floor(days.length / 2)]})`);
console.log(`\n★ DISTINCT ISINs ACROSS THE ${sessions.length}-SESSION UNION: ${union.size}`);
console.log(`   rows with NO ISIN (→ honest gap, unloadable): ${noIsin.length}`);
console.log(`\n   UNION GROWTH (does the count still climb, i.e. is 10 sessions enough to SEE the universe?)`);
const growth = new Set<string>();
for (const s of sessions) {
  for (const r of s.rows) if (debtSet.has(r.series) && r.isin) growth.add(r.isin);
  console.log(`     after ${s.day}: ${growth.size} distinct`);
}

console.log(`\n── per-series breakdown of the union ──`);
const bySeries: Record<string, number> = {};
for (const { row } of union.values()) bySeries[row.series] = (bySeries[row.series] ?? 0) + 1;
for (const [s, n] of Object.entries(bySeries).sort((a, b) => b[1] - a[1])) {
  const ex = [...union.values()].find((u) => u.row.series === s)!.row;
  console.log(`   ${s.padEnd(4)} ${String(n).padStart(5)}  e.g. ${(ex.isin || "?").padEnd(14)} ${ex.name.slice(0, 52)}`);
}

// ═══════════════════════════════════════════════════════════════
rule("SOURCING · do these carry ISIN + close + name, and do they actually TRADE?");
// ═══════════════════════════════════════════════════════════════
const all = [...union.values()].map((u) => u.row);
const usable = all.filter((r) => r.usable);
const traded = all.filter((r) => r.volume > 0n);
console.log(`   ISIN present:     ${all.length}/${union.size} (the union is keyed on ISIN, so this is 100% by construction)`);
console.log(`   usable OHLC:      ${usable.length}/${all.length}  (${((usable.length / all.length) * 100).toFixed(1)}%) → these can be PRICED via the instrument_prices lane`);
console.log(`   traded (vol>0) on their latest session: ${traded.length}/${all.length} (${((traded.length / all.length) * 100).toFixed(1)}%)`);
console.log(`   unusable (→ identity-only, honest-NULL value): ${all.length - usable.length}`);
if (usable.length) {
  const cl = usable.map((r) => r.close).sort((a, b) => a - b);
  console.log(`   close range: ₹${cl[0]} … ₹${cl[cl.length - 1]}  (median ₹${cl[Math.floor(cl.length / 2)]})`);
  console.log(`   → a bond quotes near FACE (₹100 / ₹1000 / ₹100000). A median in that neighbourhood is the sanity check.`);
}

// ISIN prefix census — the INE-namespace question, measured.
const pfx: Record<string, number> = {};
for (const r of all) pfx[r.isin.slice(0, 3)] = (pfx[r.isin.slice(0, 3)] ?? 0) + 1;
console.log(`\n   ISIN PREFIX CENSUS: ${J(pfx)}`);
console.log(`   (INE = the EQUITY issuer namespace. Corporate bonds ARE issued by companies, so INE here is EXPECTED,`);
console.log(`    and it means the govt lane's /^IN[0-9].../ ISIN guard CANNOT be reused — see D.)`);

// ═══════════════════════════════════════════════════════════════
rule("D · THE INE-COLLISION — the bond analogue of the ETF INF-collision scare. Checked FOR REAL.");
// ═══════════════════════════════════════════════════════════════
const bondIsins = [...union.keys()];
const collideStock = await q(`SELECT isin, symbol, name FROM stocks WHERE isin = ANY($1::text[])`, bondIsins);
const collideInstr = await q(`SELECT isin, symbol, asset_class::text ac, name FROM instruments WHERE isin = ANY($1::text[])`, bondIsins);

console.log(`bond ISINs that EXACTLY collide with a row in \`stocks\`      : ${collideStock.length}`);
if (collideStock.length) console.log(`   ✗✗ ${J(collideStock)}`);
console.log(`bond ISINs already present in \`instruments\` (any class)     : ${collideInstr.length}`);
if (collideInstr.length) console.log(`   ${J(collideInstr.slice(0, 20))}`);

// The REAL question is not "same ISIN" (that would be a source bug) but "same ISSUER, different
// ISIN" — a company we score as a stock that ALSO has bonds. That is the CORRECT, expected case,
// and it must load as new rows without touching the stock. Measure how common it is.
const stockIsins = await q(`SELECT isin, symbol FROM stocks WHERE isin IS NOT NULL`);
// An Indian ISIN is IN + E/F/0.. + a 4-char company code + 5 more. The ISSUER is the first 6 chars
// (e.g. INE002A / INE002A01018 stock vs INE002A07xxx bond — SAME issuer stem, DIFFERENT security).
const stockStem = new Map<string, string>();
for (const s of stockIsins) stockStem.set(String(s.isin).slice(0, 7), String(s.symbol));
const sameIssuer = all.filter((r) => stockStem.has(r.isin.slice(0, 7)));
console.log(`\nbond ISINs whose ISSUER STEM (first 7 chars) matches a stock we score: ${sameIssuer.length}`);
for (const r of sameIssuer.slice(0, 12)) {
  console.log(`   ${r.isin}  ← issuer of stock ${stockStem.get(r.isin.slice(0, 7))!.padEnd(12)}  ${r.name.slice(0, 46)}`);
}
console.log(`
   READ THIS AS: same COMPANY, different SECURITY, different ISIN. This is the expected shape and the
   catalogue handles it natively — the bond is a NEW ISIN, so the dedup-on-ISIN guard sees no conflict,
   inserts a stock_id=NULL row (held-NOT-scored), and the company's equity row is untouched (still
   scored). A P2002 is only possible on an EXACT ISIN collision, which the line above measures.`);

// ═══════════════════════════════════════════════════════════════
rule("C · THE STORAGE ESTIMATE — the primary deliverable. MEASURED, not guessed.");
// ═══════════════════════════════════════════════════════════════
const dbNow = (await q(`SELECT pg_database_size(current_database()) b, pg_size_pretty(pg_database_size(current_database())) s`))[0];
console.log(`CURRENT DB: ${dbNow.s}  (${Number(dbNow.b).toLocaleString()} bytes)`);
const FREE_CEILING = 500 * 1_048_576;
const headroom = FREE_CEILING - Number(dbNow.b);
console.log(`SUPABASE FREE CEILING: 500MB → HEADROOM: ${MB(headroom)}\n`);

// The `gsec` rows are the EXACT shape a bond row will take: stock_id NULL, attributes JSONB
// populated, the whole MF payload NULL. So their real on-disk tuple size IS the bond bytes/row.
const shape = (await q(`
  SELECT asset_class::text ac, count(*)::int n,
         avg(pg_column_size(i.*))::numeric(10,1) avg_tuple,
         max(pg_column_size(i.*))::int max_tuple,
         avg(pg_column_size(attributes))::numeric(10,1) avg_attrs,
         avg(pg_column_size(name))::numeric(10,1) avg_name
    FROM instruments i GROUP BY 1 ORDER BY 1`));
console.log("MEASURED tuple size by asset_class (the gsec row is the bond row's twin):");
for (const r of shape) {
  console.log(`   ${String(r.ac).padEnd(12)} n=${String(r.n).padStart(6)}  avg_tuple=${String(r.avg_tuple).padStart(7)}B  max=${String(r.max_tuple).padStart(6)}B  attrs=${String(r.avg_attrs ?? "—").padStart(7)}B  name=${String(r.avg_name).padStart(6)}B`);
}
const gsecShape = shape.find((r) => r.ac === "gsec");
const instrSize = (await q(`
  SELECT pg_relation_size('instruments') heap, pg_indexes_size('instruments') idx,
         pg_total_relation_size('instruments') tot, (SELECT count(*)::int FROM instruments) n`))[0];
const idxPerRow = Number(instrSize.idx) / Number(instrSize.n);
const heapPerRow = Number(instrSize.heap) / Number(instrSize.n);
console.log(`\n\`instruments\` today: heap ${MB(Number(instrSize.heap))} + idx ${MB(Number(instrSize.idx))} = ${MB(Number(instrSize.tot))} over ${instrSize.n} rows`);
console.log(`   → REAL heap/row (incl. page overhead + fillfactor): ${heapPerRow.toFixed(0)}B    REAL index/row: ${idxPerRow.toFixed(0)}B`);

// A bond's attributes JSONB is RICHER than a gsec's (issuer + coupon + maturity + rating + series).
// Measure a REPRESENTATIVE one rather than reuse the gsec number.
const sampleAttrs = {
  series: "NF", debtType: "ncd", issuer: "TATA CAPITAL HOUSING FINANCE LIMITED",
  coupon: 8.65, couponNullReason: null, maturityYear: 2029, maturityDate: "2029-03-15",
  maturityDateNullReason: null, creditRating: null, creditRatingNullReason: "not_sourceable",
  faceValue: 1000, yieldToMaturity: null, yieldNullReason: "not_sourceable",
};
const attrSize = (await q(`SELECT pg_column_size($1::jsonb)::int b`, JSON.stringify(sampleAttrs)))[0];
const avgBondName = all.reduce((a, r) => a + r.name.length, 0) / all.length;
console.log(`\n   a REPRESENTATIVE bond attributes JSONB measures ${attrSize.b}B (vs gsec's ${gsecShape?.avg_attrs ?? "—"}B)`);
console.log(`   avg bond NAME length in the feed: ${avgBondName.toFixed(0)} chars (vs gsec's ${gsecShape?.avg_name ?? "—"}B)`);

const gsecTuple = Number(gsecShape?.avg_tuple ?? 300);
const bondTuple = gsecTuple - Number(gsecShape?.avg_attrs ?? 0) - Number(gsecShape?.avg_name ?? 0) + attrSize.b + avgBondName;
const bondRowCost = bondTuple * (heapPerRow / gsecTuple > 1 ? heapPerRow / gsecTuple : 1.25) + idxPerRow;
console.log(`\n   → PROJECTED bond identity row: ~${bondTuple.toFixed(0)}B tuple × page-overhead + ~${idxPerRow.toFixed(0)}B index ≈ ${bondRowCost.toFixed(0)}B/row all-in`);

// PRICE ROWS — and this is the one that actually scales. instrument_prices is APPEND-ONLY and grows
// EVERY SESSION, FOREVER. At scale it dwarfs the identity load within a year.
const ipSize = (await q(`
  SELECT pg_total_relation_size('instrument_prices') tot, (SELECT count(*)::int FROM instrument_prices) n`))[0];
const ipPerRow = Number(ipSize.n) > 0 ? Number(ipSize.tot) / Number(ipSize.n) : 130;
console.log(`\n\`instrument_prices\` today: ${MB(Number(ipSize.tot))} over ${ipSize.n} rows → ${ipPerRow.toFixed(0)}B/row all-in (heap+idx)`);

const N = union.size;
const pricedFrac = usable.length / all.length;
const idBytes = N * bondRowCost;
const backfillBytes = N * pricedFrac * LOOKBACK * ipPerRow; // the 10-session load
const yearBytes = N * pricedFrac * 250 * ipPerRow; // ONE YEAR of daily accrual

console.log(`
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ THE ESTIMATE — at the MEASURED count of ${String(N).padStart(5)} NSE-traded corporate-debt ISINs        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ identity rows (instruments)          ${String(N).padStart(6)} × ${bondRowCost.toFixed(0).padStart(4)}B = ${MB(idBytes).padStart(8)}                 │
│ price backfill (${LOOKBACK} sessions)          ${String(Math.round(N * pricedFrac * LOOKBACK)).padStart(6)} × ${ipPerRow.toFixed(0).padStart(4)}B = ${MB(backfillBytes).padStart(8)}                 │
│ ── LOAD TOTAL ────────────────────────────────────────────── ${MB(idBytes + backfillBytes).padStart(8)} ─────────────── │
│ ONE YEAR of daily price accrual      ${String(Math.round(N * pricedFrac * 250)).padStart(6)} × ${ipPerRow.toFixed(0).padStart(4)}B = ${MB(yearBytes).padStart(8)}                 │
└─────────────────────────────────────────────────────────────────────────────────────┘

   AGAINST: ${MB(headroom)} of headroom on Supabase Free.
   LOAD:      ${MB(idBytes + backfillBytes)}  → ${idBytes + backfillBytes < headroom ? "✓ FITS" : "✗ BREACHES"}
   LOAD + 1y: ${MB(idBytes + backfillBytes + yearBytes)}  → ${idBytes + backfillBytes + yearBytes < headroom ? "✓ FITS" : "✗ BREACHES"}`);

// The counterfactual the operator actually needs: what if the FULL universe (not just NSE-traded)
// is the target? Size it at several plausible universe sizes so the ruling is informed, not guessed.
console.log(`\n   COUNTERFACTUAL — if we chased the FULL (NSDL/OTC) universe instead of the NSE-traded set:`);
for (const n of [5_000, 10_000, 25_000, 50_000, 100_000]) {
  const idB = n * bondRowCost;
  console.log(`     ${String(n).padStart(7)} ISINs → identity ${MB(idB).padStart(8)}  ${idB < headroom ? "fits Free" : "BREACHES Free"}  (identity-only; OTC paper has no NSE close to store)`);
}

// ═══════════════════════════════════════════════════════════════
rule("E · ATTRIBUTE HONESTY — what is actually in the name, and what is a fabrication risk?");
// ═══════════════════════════════════════════════════════════════
console.log("Raw names, verbatim — the ONLY material the attributes can honestly be built from:\n");
for (const s of Object.keys(bySeries).sort()) {
  const ex = all.filter((r) => r.series === s).slice(0, 3);
  console.log(`── ${s} ──`);
  for (const r of ex) console.log(`   sym=${(r.symbol || "—").padEnd(14)} "${r.name}"`);
}
const withPct = all.filter((r) => /(\d+(\.\d+)?)\s*%/.test(r.name)).length;
const withFullDate = all.filter((r) => /\d{2}[-/]\d{2}[-/]\d{2,4}/.test(r.name)).length;
const withYear = all.filter((r) => /20\d{2}/.test(r.name)).length;
const withRating = all.filter((r) => /\b(AAA|AA\+?|AA-|A\+|BBB|CRISIL|ICRA|CARE|IND)\b/i.test(r.name)).length;
console.log(`\nPARSEABILITY across all ${all.length} names:`);
console.log(`   coupon  (a "%" in the name)      : ${withPct}/${all.length}  (${((withPct / all.length) * 100).toFixed(1)}%)`);
console.log(`   maturity FULL DATE (dd-mm-yy)    : ${withFullDate}/${all.length}  (${((withFullDate / all.length) * 100).toFixed(1)}%)`);
console.log(`   maturity YEAR only (20xx)        : ${withYear}/${all.length}  (${((withYear / all.length) * 100).toFixed(1)}%)`);
console.log(`   CREDIT RATING in the name        : ${withRating}/${all.length}  (${((withRating / all.length) * 100).toFixed(1)}%)`);
console.log(`
   THE RATING IS THE ONE THAT MATTERS. A bond's credit rating is its single most important signal —
   and the udiff has NO rating column. If it is not in the name either, it is NOT SOURCEABLE from
   this feed, and it goes honest-NULL with a reason. It is NOT inferred from the coupon, NOT
   inferred from the issuer, NOT defaulted to "AAA". A fabricated rating on a debt instrument is
   not a cosmetic error — it is the exact number a holder would act on.`);

// ═══════════════════════════════════════════════════════════════
rule("G · IS THE UDIFF THE WHOLE HOLDABLE UNIVERSE? (it is almost certainly NOT)");
// ═══════════════════════════════════════════════════════════════
console.log(`The udiff is the NSE CAPITAL-MARKET segment: what is LISTED AND TRADED ON NSE. Corporate debt
in India is overwhelmingly (a) privately placed, (b) BSE-listed, and (c) traded OTC on the RFQ/NDS-OM
platforms rather than on the NSE order book. So the ${union.size} ISINs above are a FLOOR on the
holdable universe, not the universe.

WHAT THAT MEANS FOR SCOPE — the honest options:
   · NSE-traded set (${union.size})  — everything here is sourceable AND priceable. Complete for what it covers.
   · Full NSDL universe (~tens of thousands) — would need a DIFFERENT source (NSDL/CDSL ISIN master,
     or the BSE debt bhavcopy). Most of it has NO NSE close → identity-only, honest-null value.
A user holding an OTC/BSE-only bond would NOT be found in the udiff → their holding stays unmapped
(honest gap), exactly as a no-ISIN row does today. That is the real cost of scoping to NSE.`);

// ═══════════════════════════════════════════════════════════════
rule("F · THE ENUM — does AssetClass already carry 'bond'?");
// ═══════════════════════════════════════════════════════════════
console.log(J(await q(`SELECT e.enumlabel label FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
                        WHERE t.typname='AssetClass' ORDER BY e.enumsortorder`)));

// ═══════════════════════════════════════════════════════════════
rule("H · BASELINE — the fingerprints Gate 3 re-measures byte-identical");
// ═══════════════════════════════════════════════════════════════
console.log("instruments by class:", J(await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`)));
console.log("stocks:              ", J(await q(`SELECT count(*)::int n FROM stocks`)));
console.log("instrument_prices:   ", J(await q(`SELECT count(*)::int n FROM instrument_prices`)));
console.log("mf families:         ", J(await q(`SELECT count(*)::int n FROM instruments WHERE asset_class='mutual_fund'`)));

await prisma.$disconnect();
console.log("\n═══ GATE 0 COMPLETE — nothing was written. The operator rules on STORAGE next. ═══");
