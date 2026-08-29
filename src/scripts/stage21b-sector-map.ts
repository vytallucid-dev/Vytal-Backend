// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 21b — SECTOR, FROM industryType FIRST AND YAHOO'S INDUSTRY SECOND.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage21b-sector-map.ts            # dry
//   npx tsx src/scripts/stage21b-sector-map.ts --commit
//
// ── THE ORDER IS THE POINT ───────────────────────────────────────────────────────────────────────
// (1) `industryType` WINS WHERE IT SPEAKS. It was derived from the XBRL taxonomy the company itself
//     filed under — a bank files banking XBRL, and nothing about that is a matter of opinion. Yahoo's
//     "Financial Services" collapses our banks / nbfc / capital_markets / insurance into one bucket,
//     so deferring to it there would discard better evidence for worse.
// (2) YAHOO'S `industry` (the fine one), never its `sector` (the coarse one). "Financial Services"
//     cannot choose between four of our buckets; "Banks—Regional" can.
// (3) ANYTHING NOT IN THE MAP STAYS NULL AND IS REPORTED. Conglomerates, shell companies and the
//     genuinely odd get no sector rather than a plausible one. A wrong sector is worse than a
//     missing one: it is invisible, it aggregates, and every rollup repeats it as fact. This is the
//     same gate seed-nifty500-pass1.ts applied to its own ambiguous NSE labels.
//
// ⚠ NULL-ONLY. A stock that already has a sector keeps it — the 503 originals were classified by
//   hand and that beats a third-party label.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";

const COMMIT = process.argv.includes("--commit");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

/** industryType → our sector. Authoritative: it came from the filing's own taxonomy. */
const BY_INDUSTRY_TYPE: Record<string, string> = {
  banking: "banks",
  nbfc: "nbfc",
  life_insurance: "insurance",
  general_insurance: "insurance",
};

/** ⚠ DASH FORMS DIFFER AND IT COST 191 STOCKS. Yahoo returns "Drug Manufacturers - Specialty &
 *  Generic" (hyphen, spaces) while this map was written with an em-dash. Every multi-word industry
 *  silently missed, and the miss looked exactly like "Yahoo has no label for this" — a gated NULL,
 *  not an error. So both sides are normalised: dashes unified, whitespace collapsed, lower-cased. */
const normIndustry = (s: string): string =>
  s.replace(/[‐-―−]/g, "-").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/** Yahoo `industry` → our sector. Only pairs that land on exactly ONE of ours appear here. */
const BY_YAHOO_INDUSTRY: Record<string, string> = {
  // technology
  "Information Technology Services": "it_technology", "Software—Application": "it_technology",
  "Software—Infrastructure": "it_technology", "Semiconductors": "it_technology",
  "Semiconductor Equipment & Materials": "it_technology", "Computer Hardware": "it_technology",
  "Electronic Components": "it_technology", "Scientific & Technical Instruments": "it_technology",
  "Solar": "it_technology",
  // internet
  "Internet Content & Information": "new_economy_internet", "Internet Retail": "new_economy_internet",
  // autos
  "Auto Parts": "automobile", "Auto Manufacturers": "automobile", "Auto & Truck Dealerships": "automobile",
  "Recreational Vehicles": "automobile",
  // financials (industryType usually wins first; these catch the rest)
  "Banks—Regional": "banks", "Banks—Diversified": "banks",
  "Capital Markets": "capital_markets", "Financial Data & Stock Exchanges": "capital_markets",
  "Asset Management": "capital_markets", "Shell Companies": "capital_markets",
  "Credit Services": "nbfc", "Mortgage Finance": "nbfc", "Financial Conglomerates": "nbfc",
  "Insurance—Life": "insurance", "Insurance—Property & Casualty": "insurance",
  "Insurance—Diversified": "insurance", "Insurance Brokers": "insurance",
  "Insurance—Reinsurance": "insurance", "Insurance—Specialty": "insurance",
  // healthcare
  "Drug Manufacturers—General": "pharma_healthcare", "Drug Manufacturers—Specialty & Generic": "pharma_healthcare",
  "Biotechnology": "pharma_healthcare", "Medical Devices": "pharma_healthcare",
  "Medical Instruments & Supplies": "pharma_healthcare", "Diagnostics & Research": "pharma_healthcare",
  "Medical Care Facilities": "pharma_healthcare", "Healthcare Plans": "pharma_healthcare",
  "Pharmaceutical Retailers": "pharma_healthcare", "Medical Distribution": "pharma_healthcare",
  "Health Information Services": "pharma_healthcare",
  // materials / chemicals
  "Specialty Chemicals": "chemicals_agrochemicals", "Chemicals": "chemicals_agrochemicals",
  "Agricultural Inputs": "chemicals_agrochemicals",
  // metals & mining
  "Steel": "metals_mining", "Other Industrial Metals & Mining": "metals_mining", "Aluminum": "metals_mining",
  "Copper": "metals_mining", "Gold": "metals_mining", "Silver": "metals_mining",
  "Coking Coal": "metals_mining", "Thermal Coal": "metals_mining", "Other Precious Metals & Mining": "metals_mining",
  // construction
  "Building Materials": "cement_construction", "Engineering & Construction": "cement_construction",
  "Building Products & Equipment": "cement_construction",
  // energy
  "Oil & Gas Integrated": "oil_gas_energy", "Oil & Gas E&P": "oil_gas_energy",
  "Oil & Gas Refining & Marketing": "oil_gas_energy", "Oil & Gas Midstream": "oil_gas_energy",
  "Oil & Gas Equipment & Services": "oil_gas_energy", "Uranium": "oil_gas_energy",
  // utilities
  "Utilities—Regulated Electric": "power", "Utilities—Independent Power Producers": "power",
  "Utilities—Renewable": "power", "Utilities—Diversified": "power", "Utilities—Regulated Gas": "power",
  "Utilities—Regulated Water": "power",
  // real estate
  "Real Estate—Development": "real_estate", "Real Estate Services": "real_estate",
  "Real Estate—Diversified": "real_estate",
  // telecom
  "Telecom Services": "telecom", "Communication Equipment": "telecom",
  // travel / hospitality
  "Airlines": "hospitality_travel", "Restaurants": "hospitality_travel", "Lodging": "hospitality_travel",
  "Resorts & Casinos": "hospitality_travel", "Travel Services": "hospitality_travel",
  "Gambling": "hospitality_travel",
  // logistics
  "Integrated Freight & Logistics": "logistics_infrastructure", "Trucking": "logistics_infrastructure",
  "Railroads": "logistics_infrastructure", "Marine Shipping": "logistics_infrastructure",
  "Airports & Air Services": "logistics_infrastructure",
  // capital goods
  "Specialty Industrial Machinery": "capital_goods_engineering", "Electrical Equipment & Parts": "capital_goods_engineering",
  "Farm & Heavy Construction Machinery": "capital_goods_engineering", "Aerospace & Defense": "capital_goods_engineering",
  "Tools & Accessories": "capital_goods_engineering", "Metal Fabrication": "capital_goods_engineering",
  "Pollution & Treatment Controls": "capital_goods_engineering", "Industrial Distribution": "capital_goods_engineering",
  "Business Equipment & Supplies": "capital_goods_engineering",
  // fmcg
  "Packaged Foods": "fmcg_consumer", "Beverages—Non-Alcoholic": "fmcg_consumer",
  "Beverages—Wineries & Distilleries": "fmcg_consumer", "Beverages—Brewers": "fmcg_consumer",
  "Household & Personal Products": "fmcg_consumer", "Tobacco": "fmcg_consumer",
  "Confectioners": "fmcg_consumer", "Farm Products": "fmcg_consumer", "Grocery Stores": "fmcg_consumer",
  // consumer discretionary / retail
  "Apparel Retail": "consumer_discretionary_retail", "Specialty Retail": "consumer_discretionary_retail",
  "Department Stores": "consumer_discretionary_retail", "Footwear & Accessories": "consumer_discretionary_retail",
  "Apparel Manufacturing": "consumer_discretionary_retail", "Luxury Goods": "consumer_discretionary_retail",
  "Home Improvement Retail": "consumer_discretionary_retail", "Textile Manufacturing": "consumer_discretionary_retail",
  "Furnishings, Fixtures & Appliances": "consumer_discretionary_retail", "Leisure": "consumer_discretionary_retail",
  "Packaging & Containers": "consumer_discretionary_retail", "Discount Stores": "consumer_discretionary_retail",
  "Personal Services": "consumer_discretionary_retail", "Consumer Electronics": "consumer_discretionary_retail",
  // added after the first dry run showed them unmapped and unambiguous
  "Infrastructure Operations": "logistics_infrastructure",
  "Electronics & Computer Distribution": "it_technology",
};

/** The same map, keyed on the normalised form — built once, used for every lookup. */
const YAHOO_NORM: Record<string, string> = Object.fromEntries(
  Object.entries(BY_YAHOO_INDUSTRY).map(([k, v]) => [normIndustry(k), v]));

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 21b — sector mapping  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  const led: Record<string, { sector?: string; industry?: string }> = {};
  for (const f of fs.readdirSync(".").filter((x) => /^_s21-ledger.*\.json$/.test(x)))
    Object.assign(led, JSON.parse(fs.readFileSync(f, "utf8")));

  const sectors = new Map((await raw<{ id: string; name: string }>(`SELECT id, name FROM sectors`)).map((s) => [s.name, s.id]));
  const need = await raw<{ symbol: string; it: string }>(
    `SELECT symbol, "industryType"::text it FROM stocks WHERE is_active AND sector_id IS NULL`);

  const plan: Array<{ symbol: string; sector: string; via: string }> = [];
  const unmapped = new Map<string, number>();
  for (const s of need) {
    const byType = BY_INDUSTRY_TYPE[s.it];
    if (byType) { plan.push({ symbol: s.symbol, sector: byType, via: `industryType=${s.it}` }); continue; }
    const ind = led[s.symbol]?.industry;
    const byInd = ind ? YAHOO_NORM[normIndustry(ind)] : undefined;
    if (byInd) { plan.push({ symbol: s.symbol, sector: byInd, via: `yahoo="${ind}"` }); continue; }
    unmapped.set(ind ?? "(no yahoo industry)", (unmapped.get(ind ?? "(no yahoo industry)") ?? 0) + 1);
  }

  const bySector: Record<string, number> = {};
  for (const p of plan) bySector[p.sector] = (bySector[p.sector] ?? 0) + 1;
  console.log(`\n  stocks with no sector   ${need.length}`);
  console.log(`  mappable                ${plan.length}   (via industryType ${plan.filter((p) => p.via.startsWith("industryType")).length} · via Yahoo ${plan.filter((p) => p.via.startsWith("yahoo")).length})`);
  console.log(`  LEFT NULL (gated)       ${need.length - plan.length}\n`);
  console.log(`  ${Object.entries(bySector).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`\n  top unmapped Yahoo industries — extend the map if any of these deserve a bucket:`);
  for (const [k, v] of [...unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18))
    console.log(`     ${String(v).padStart(4)}  ${k}`);

  if (!COMMIT) { console.log(`\n  dry — re-run with --commit.\n`); await prisma.$disconnect(); return; }

  let n = 0;
  const byName: Record<string, string[]> = {};
  for (const p of plan) (byName[p.sector] ??= []).push(p.symbol);
  for (const [name, syms] of Object.entries(byName)) {
    const id = sectors.get(name);
    if (!id) { console.log(`  ⚠ no sector row named "${name}" — ${syms.length} stock(s) skipped`); continue; }
    for (let i = 0; i < syms.length; i += 500)
      n += await prisma.$executeRawUnsafe(
        `UPDATE stocks SET sector_id = $1, updated_at = now() WHERE symbol = ANY($2::text[]) AND sector_id IS NULL`,
        id, syms.slice(i, i + 500));
  }
  console.log(`\n  sector set on ${n} stock(s)`);
  console.log(`  still NULL: ${(await raw<{ n: number }>(`SELECT count(*)::int n FROM stocks WHERE is_active AND sector_id IS NULL`))[0].n}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
