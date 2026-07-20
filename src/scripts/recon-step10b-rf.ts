// STEP 10+11 (Option B) GATE 0 — READ-ONLY. The risk-free rate we ALREADY have,
// and whether AMFI's category strings are a usable ranking bucket.
// npx tsx src/scripts/recon-step10b-rf.ts
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

// ── RISK-FREE: index_prices already carries G-Sec + overnight-rate indices ──
hdr("RISK-FREE — what the system ALREADY has (no new pipeline needed?)");
for (const name of [
  "Nifty 10 yr Benchmark G-Sec",
  "Nifty 10 yr Benchmark G-Sec (Clean Price)",
  "Nifty 1D Rate Index",
  "Nifty Composite G-sec Index",
]) {
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT count(*) n, min(date) mn, max(date) mx,
            (SELECT close FROM index_prices WHERE index_name=$1 ORDER BY date ASC  LIMIT 1) first_close,
            (SELECT close FROM index_prices WHERE index_name=$1 ORDER BY date DESC LIMIT 1) last_close
     FROM index_prices WHERE index_name=$1`, name);
  const x = r[0];
  if (!Number(x.n)) { console.log(`  ${name.padEnd(43)} — NOT PRESENT`); continue; }
  const yrs = (new Date(x.mx).getTime() - new Date(x.mn).getTime()) / (365.25 * 86400000);
  const cagr = Math.pow(Number(x.last_close) / Number(x.first_close), 1 / yrs) - 1;
  console.log(
    `  ${name.padEnd(43)} ${String(x.n).padStart(5)} pts  ${String(x.mn).slice(0, 10)} → ${String(x.mx).slice(0, 10)}  ` +
      `(${yrs.toFixed(1)} y)  implied annualised return = ${(cagr * 100).toFixed(2)}%`,
  );
}
console.log(`\n  ⇒ These are TOTAL-RETURN INDICES, not spot yields. That is actually BETTER for Sharpe:`);
console.log(`    the risk-free leg of Sharpe should be the RETURN EARNED risk-free over the SAME window,`);
console.log(`    which is exactly what the index's own return gives. No spot-yield pipeline needed.`);
console.log(`    "Nifty 1D Rate Index" (overnight/TREPS) is what Indian AMC factsheets conventionally use.`);

// Do we have 5 years of it? That is the binding constraint for a 5Y Sharpe.
const cov = await prisma.$queryRawUnsafe<any[]>(`
  SELECT index_name, min(date) mn, max(date) mx, count(*) n FROM index_prices
  WHERE index_name IN ('Nifty 1D Rate Index','Nifty 10 yr Benchmark G-Sec') GROUP BY 1`);
console.log(`\n  5-YEAR COVERAGE CHECK (a 5Y Sharpe needs a 5Y risk-free leg):`);
for (const c of cov) {
  const yrs = (new Date(c.mx).getTime() - new Date(c.mn).getTime()) / (365.25 * 86400000);
  console.log(`    ${String(c.index_name).padEnd(30)} ${yrs.toFixed(1)} y  ${yrs >= 5 ? "✅ covers 5Y" : "⚠️ SHORT — a 5Y Sharpe would be honest-empty"}`);
}

// ── CATEGORY FRAGMENTATION — legacy vs current AMFI section naming ──
hdr("CATEGORY — is AMFI's section header a CLEAN ranking bucket?");
const cats = await prisma.$queryRawUnsafe<any[]>(`
  SELECT category, count(DISTINCT amfi_scheme_code) codes
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL
  GROUP BY 1 ORDER BY 1`);
// AMFI ships BOTH a modern naming ("Debt Scheme - X") and a legacy one ("Income/Debt Oriented Schemes - X").
const legacy = cats.filter((c) => /Income\/Debt Oriented|Growth\/Equity Oriented|Hybrid Schemes/i.test(c.category));
const modern = cats.filter((c) => !/Income\/Debt Oriented|Growth\/Equity Oriented|Hybrid Schemes/i.test(c.category));
console.log(`  total category strings: ${cats.length}   modern-named: ${modern.length}   legacy-named: ${legacy.length}`);
console.log(`\n  LEGACY-named buckets (AMFI still ships these old section headers):`);
for (const c of legacy) console.log(`    ${String(c.codes).padStart(5)}  ${c.category}`);
console.log(`\n  ⇒ THE SAME economic category is split across TWO strings. e.g. Overnight Fund exists as`);
console.log(`    "Debt Scheme - Overnight Fund" (250) AND "Income/Debt Oriented Schemes - Overnight Fund" (4).`);
console.log(`    Ranking on the RAW string fragments the bucket and puts 4 funds in a category of their own.`);
console.log(`    Fix (no new data): NORMALISE the section header to a canonical category before ranking —`);
console.log(`    strip the "Open/Close Ended Schemes(...)" wrapper and the scheme-class prefix, keep the leaf.`);

// What the normalised leaf would look like.
const leaf = new Map<string, number>();
for (const c of cats) {
  const m = /\(([^)]*)\)/.exec(c.category);
  let l = m ? m[1]! : c.category;
  l = l.replace(/^(Debt Scheme|Equity Scheme|Hybrid Scheme|Other Scheme|Solution Oriented Scheme|Income\/Debt Oriented Schemes|Growth\/Equity Oriented Schemes|Hybrid Schemes|Solution Oriented Schemes)\s*-\s*/i, "").trim();
  leaf.set(l, (leaf.get(l) ?? 0) + Number(c.codes));
}
const sorted = [...leaf.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\n  NORMALISED leaf categories: ${leaf.size} (from ${cats.length} raw strings)`);
for (const [l, n] of sorted.slice(0, 12)) console.log(`    ${String(n).padStart(5)}  ${l}`);
const small = sorted.filter(([, n]) => n < 5);
console.log(`  leaves with <5 schemes after normalising: ${small.length}  ${small.map(([l]) => l).slice(0, 4).join(", ")}`);

// Open vs Close ended — should CLOSED-ended FMPs even be ranked?
const oc = await prisma.$queryRawUnsafe<any[]>(`
  SELECT CASE WHEN category ILIKE 'Close Ended%' THEN 'close-ended'
              WHEN category ILIKE 'Interval%'    THEN 'interval'
              ELSE 'open-ended' END AS kind,
         count(DISTINCT amfi_scheme_code) codes,
         count(DISTINCT amfi_scheme_code) FILTER (WHERE is_active) AS active
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
console.log(`\n  OPEN vs CLOSE ended:`);
for (const r of oc) console.log(`    ${String(r.kind).padEnd(12)} ${String(r.codes).padStart(5)} codes  (${r.active} active)`);
console.log(`  ⇒ close-ended FMPs are not purchasable and mostly dormant. Ranking them ALONGSIDE`);
console.log(`    open-ended funds pollutes the percentile. Recommend: rank within open-ended only;`);
console.log(`    close-ended funds still get their OWN analytics, just no category percentile.`);

await prisma.$disconnect();
