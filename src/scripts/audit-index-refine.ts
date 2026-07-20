// INDEX-PRICES AUDIT, part 3 — REFINE the prune list. READ-ONLY.
//
// Part 2's matcher was a heuristic and it has BOTH failure modes. This pass finds them, because
// handing over a prune list built on a broken matcher would be worse than not auditing at all.
//
//   FALSE POSITIVES — generic words matched a fund's PLAN name, not an index:
//     "Nifty Retail"  ← "Aditya Birla Sun Life Liquid Fund -Retail - IDCW"     (retail PLAN)
//     "Nifty NBFC"    ← "Axis CRISIL-IBX AAA Bond NBFC - Jun 2027 Index Fund"  (a bond fund)
//     "Nifty Rural"   ← "Sundaram Consumption Fund (Formerly … Rural …)"       (a rename)
//     "Nifty Hospitals" ← "Groww BSE Hospitals ETF FOF"                        (BSE, not Nifty)
//
//   FALSE NEGATIVES — the matcher never even tested some, or was too strict:
//     "Nifty 200"     → core "200" was 3 chars, and a `core.length < 4` guard SKIPPED it.
//     "Nifty BHARAT Bond Index - April 2030" → funds say "BHARAT Bond FOF - April 2030",
//                       which does not contain the literal "bharat bond index april 2030".
//
// npx tsx src/scripts/audit-index-refine.ts
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n${"═".repeat(78)}\n${s}\n${"═".repeat(78)}`);

const funds = await prisma.$queryRawUnsafe<any[]>(`
  SELECT DISTINCT ON (amfi_scheme_code) amfi_scheme_code code, scheme_name, is_active
  FROM instruments WHERE asset_class='mutual_fund' AND amfi_scheme_code IS NOT NULL`);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const fundNames = funds.map((f) => ({ n: norm(String(f.scheme_name ?? "")), active: f.is_active }));

/** A TOKEN-SET match: every distinguishing token of the index must appear in the fund name.
 *  Order-independent, so "BHARAT Bond FOF - April 2030" matches "BHARAT Bond Index - April 2030"
 *  once the filler word "index" is dropped. */
const FILLER = new Set(["nifty", "index", "the", "of", "and", "&"]);
function tokensOf(idx: string): string[] {
  return norm(idx).split(" ").filter((t) => t && !FILLER.has(t));
}
function tracked(idxName: string): { funds: number; active: number; sample: string | null } {
  const toks = tokensOf(idxName);
  if (toks.length === 0) return { funds: 0, active: 0, sample: null };
  let n = 0, a = 0, sample: string | null = null;
  for (const f of fundNames) {
    if (toks.every((t) => f.n.includes(t))) {
      n++;
      if (f.active) a++;
      if (!sample) sample = f.n;
    }
  }
  return { funds: n, active: a, sample };
}

// The 60 "genuinely unused" from part 2 — retest each with the token-set matcher.
const CLEAN60 = [
  "Nifty 200","NIFTY Alpha Quality Low-Volatility 30","NIFTY Alpha Quality Value Low-Volatility 30",
  "Nifty Financial Services 25/50","Nifty Growth Sectors 15","Nifty High Beta 50","NIFTY Midcap 100",
  "Nifty Midcap Liquid 15","NIFTY Midcap150 Quality 50","NIFTY Quality Low-Volatility 30",
  "Nifty Services Sector","Nifty Shariah 25","NIFTY Smallcap 100","NIFTY SME EMERGE","NIFTY100 Alpha 30",
  "NIFTY100 Enhanced ESG","Nifty100 Liquid 15","Nifty50 PR 1x Inverse","Nifty50 PR 2x Leverage",
  "Nifty50 Shariah","Nifty50 TR 1x Inverse","Nifty50 TR 2x Leverage","Nifty 50 Futures TR Index",
  "Nifty50 USD","Nifty Midcap Select","Nifty50 Dividend Points","Nifty Mobility",
  "Nifty MidSmall IT & Telecom","Nifty REITs & InvITs","Nifty Core Housing","Nifty Aditya Birla Group",
  "Nifty Mahindra Group","Nifty Tata Group","Nifty Tata Group 25% Cap","Nifty Smallcap250 Momentum Quality 100",
  "Nifty India Corporate Group Index - Aditya Birla Group","Nifty India Corporate Group Index - Mahindra Group",
  "Nifty India Corporate Group Index - Tata Group","Nifty India Corporate Group Index - Tata Group 25% Cap",
  "Nifty500 LargeMidSmall Equal-Cap Weighted","Nifty IPO","Nifty India Select 5 Corporate Groups (MAATR)",
  "Nifty BHARAT Bond Index - April 2030","Nifty BHARAT Bond Index - April 2031",
  "Nifty BHARAT Bond Index - April 2032","Nifty BHARAT Bond Index - April 2033",
  "Nifty500 Multifactor MQVLv 50","Nifty Waves","Nifty500 Healthcare","Nifty India FPI 150",
  "Nifty Conglomerate 50","Nifty Smallcap 500","Nifty REITs & Realty","Nifty BHARAT Bond Index - April 2025",
  "Nifty India Internet & E-Commerce","Nifty Commercial & Transport Services","Nifty Construction",
  "Nifty Housing Finance","Nifty Small Finance Banks & Microfinance Institutions","Nifty Sugar & Ethanol",
];

// The part-2 "tracked" entries I suspect are FALSE POSITIVES (generic word matched a plan name).
const SUSPECT_FP = ["Nifty Retail", "Nifty NBFC", "Nifty Rural", "Nifty Hospitals", "Nifty Housing"];

const sizes = await prisma.$queryRawUnsafe<any[]>(
  `SELECT index_name, count(*) pts FROM index_prices GROUP BY 1`);
const ptsOf = new Map(sizes.map((s) => [s.index_name as string, Number(s.pts)]));
const BPR = 459;

hdr("A. FALSE NEGATIVES — 'unused' indices that a token-set match DOES find funds for");
const rescued: string[] = [];
const stillClean: string[] = [];
for (const idx of CLEAN60) {
  const t = tracked(idx);
  if (t.funds > 0) {
    rescued.push(idx);
    console.log(`  ${String(t.funds).padStart(3)} funds (${String(t.active).padStart(3)} active)  ${idx}`);
    console.log(`        e.g. ${t.sample?.slice(0, 62)}`);
  } else {
    stillClean.push(idx);
  }
}
if (!rescued.length) console.log(`  none — the part-2 list survives the stricter test.`);

hdr("B. FALSE POSITIVES — part-2 'tracked' entries that matched a PLAN name, not an index");
for (const idx of SUSPECT_FP) {
  const t = tracked(idx);
  console.log(`  ${idx.padEnd(20)} token-set match → ${t.funds} fund(s)  ${t.funds === 0 ? "⇒ part-2 was a FALSE POSITIVE; it is genuinely untracked" : `e.g. ${t.sample?.slice(0, 46)}`}`);
}

hdr("C. ⚠️  THE LIMIT OF THIS AUDIT — WE HAVE NO ETFs");
console.log(`  Step 9 EXCLUDED ETFs from the catalogue (MF-only; ETF identity is a FUTURE step).`);
console.log(`  So I can test whether a MUTUAL FUND tracks an index — but NOT whether an ETF does.`);
console.log(`  Many NSE indices exist precisely BECAUSE an ETF tracks them (leveraged/inverse aside).`);
console.log(`  ⇒ An index tracked ONLY by an ETF looks "unused" today and would be pruned WRONGLY,`);
console.log(`    then have to be re-backfilled when the ETF step lands. This is the single biggest`);
console.log(`    reason to prune CONSERVATIVELY, or to defer the prune until ETF identity exists.`);

hdr("D. THE REFINED PRUNE LIST — after both corrections");
const finalPrune = stillClean.filter((x) => true);
const rows = finalPrune.reduce((s, x) => s + (ptsOf.get(x) ?? 0), 0);
const bytes = rows * BPR;
console.log(`  ${finalPrune.length} indices · ${rows.toLocaleString()} rows · ${(bytes / 1e6).toFixed(1)} MB\n`);
for (const x of finalPrune.sort((a, b) => (ptsOf.get(b) ?? 0) - (ptsOf.get(a) ?? 0))) {
  const p = ptsOf.get(x) ?? 0;
  console.log(`  ${String(p).padStart(5)}p  ${((p * BPR) / 1e6).toFixed(2).padStart(5)} MB  ${x}`);
}

hdr("E. THE HONEST RECLAIM");
const total = await prisma.$queryRawUnsafe<any[]>(
  `SELECT count(*) rows, pg_total_relation_size('index_prices') b FROM index_prices`);
console.log(`  index_prices today            : ${Number(total[0].rows).toLocaleString()} rows · ${(Number(total[0].b) / 1e6).toFixed(1)} MB`);
console.log(`  my earlier naive claim        : "~44 MB reclaimable"        ← WRONG`);
console.log(`  code-usage-only prune         : 104 indices / ~36 MB        ← would delete 44 fund benchmarks`);
console.log(`  after the MF-tracking test    : 60 indices / ~21 MB`);
console.log(`  after fixing the matcher      : ${finalPrune.length} indices / ~${(bytes / 1e6).toFixed(0)} MB   ← the honest number`);
console.log(`\n  DB 440 MB → ~${(440 - bytes / 1e6).toFixed(0)} MB after prune + VACUUM FULL.`);
console.log(`  ⇒ RECLAIM ≈ ${(bytes / 1e6).toFixed(0)} MB (${((bytes / Number(total[0].b)) * 100).toFixed(0)}% of index_prices, ${((bytes / 1e6 / 440) * 100).toFixed(1)}% of the DB).`);

await prisma.$disconnect();
