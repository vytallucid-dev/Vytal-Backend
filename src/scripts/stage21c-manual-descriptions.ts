// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 21c — THE 13 DESCRIPTIONS YAHOO DOES NOT SERVE.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage21c-manual-descriptions.ts            # dry
//   npx tsx src/scripts/stage21c-manual-descriptions.ts --commit
//
// Stage 21 covered 2,277 of 2,290 from Yahoo's assetProfile. These 13 return an error consistently —
// retried, same result — so Yahoo genuinely holds no profile for them. At thirteen companies a
// per-company lookup is proportionate, where at 2,290 it would not have been.
//
// Sourced from screener.in company pages (2026-08-28) and checked against the company name and the
// industryType already derived from its filings. Each is the business description as published, not
// a paraphrase, and each carries its source URL so a later reader can re-check it rather than
// trusting this file.
//
// ⚠ NULL-ONLY, like every other description write. If Yahoo ever starts serving one of these, the
//   value already here wins — a hand-checked description outranks a third-party summary.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const COMMIT = process.argv.includes("--commit");
const SOURCE = "screener.in company page, retrieved 2026-08-28";

interface Row { symbol: string; description: string; url: string }

const ROWS: Row[] = [
  { symbol: "3PLAND", url: "https://www.screener.in/company/3PLAND/",
    description: "Incorporated in 1965, 3P Land Holdings Limited is classified as a Core Investment Company (CIC) under RBI regulations. Formerly known as Pudumjee Industries Limited, the company transitioned from manufacturing paper and hygiene products to focusing on real estate development and investment activities." },
  { symbol: "AUSTENG", url: "https://www.screener.in/company/AUSTENG/",
    description: "Incorporated in 1973, Austin Engineering Company Limited deals in bearings and their components, and also generates power from wind energy. The company manufactures and exports anti-friction bearings and related components for industrial applications under the AEC trademark." },
  { symbol: "DHATRE", url: "https://www.screener.in/company/DHATRE/",
    description: "Incorporated in 1996, Dhatre Udyog Limited is a manufacturer of a diverse range of iron and steel products. The company operates as a secondary steel producer, manufacturing TMT bars including rebars, MS grade angles, flats, squares, rounds, and wire rod coils of various sizes." },
  { symbol: "ELPROINTL", url: "https://www.screener.in/company/ELPROINTL/",
    description: "Elpro International Limited is engaged in manufacturing surge arresters, construction and development of real estate properties, equity investment in third parties, and windmill operations. The company was initially focused on power distribution equipment before transitioning to real estate development in the late 1990s." },
  { symbol: "HBESD", url: "https://www.screener.in/company/HBESD/",
    description: "Incorporated in 1994, HB Estate Developers Limited is engaged in the business of owning and managing hotels and real estate properties. Its key project includes the Taj City Centre in Gurugram." },
  // ⚠ Renamed. screener.in still carries the Akzo Nobel India description; the business (paints and
  //   coatings) is unchanged, but the name is not, so the former name is stated rather than implied.
  { symbol: "JSWDULUX", url: "https://www.screener.in/company/JSWDULUX/",
    description: "JSW Dulux Limited, formerly Akzo Nobel India Limited and incorporated in 1954, manufactures, trades in, and sells paints and related products. The company supplies protective coatings and colour solutions to both industrial and consumer markets." },
  { symbol: "KAMANWALA", url: "https://www.screener.in/company/KAMANWALA/",
    description: "Incorporated in 1984, Kamanwala Housing Construction Limited operates in the real estate development and construction business, specialising in the construction of residential and commercial buildings and related real estate development activities." },
  { symbol: "MAFATIND", url: "https://www.screener.in/company/MAFATIND/",
    description: "Founded in 1905 and headquartered in Mumbai, Mafatlal Industries Limited manufactures and trades in textiles in India. Its range spans men's and women's wear, denim, school, corporate, work, hospitality and medical uniforms, bed linen, towels and specialty fabrics, sold through both B2B and B2C channels." },
  { symbol: "NIMBSPROJ", url: "https://www.screener.in/company/NIMBSPROJ/",
    description: "Nimbus Projects Limited is a Delhi-NCR real estate developer focused on residential, commercial and mixed-use properties in Noida, Greater Noida and the Yamuna Expressway corridor. The company constructs residential flats through special purpose vehicles operating leasehold land parcels." },
  { symbol: "RAJPALAYAM", url: "https://www.screener.in/company/RAJPALAYAM/",
    description: "Incorporated in 1936, Rajapalayam Mills Limited manufactures cotton yarn and fabrics, and generates electricity from its windmills for captive requirements. The company specialises in finer-count yarn and value-added products such as mercerized, mélange, slub and gassed yarn, and was the first textile venture of the Ramco group." },
  { symbol: "SHRIKRISH", url: "https://www.screener.in/company/SHRIKRISH/",
    description: "Shri Krishna Devcon Limited is a real estate developer engaged in the identification and acquisition of land, planning, execution and marketing of projects, and the construction and development of townships, housing projects and commercial premises. It operates primarily in Indore, Madhya Pradesh." },
  { symbol: "TANAA", url: "https://www.screener.in/company/TANAA/",
    description: "Incorporated in 1994, Taneja Aerospace & Aviation Limited manufactures aerospace parts and components and provides aircraft maintenance, repair and overhaul (MRO) services. The company serves military and commercial aviation, offering aircraft modifications, avionics retrofitting and airfield maintenance." },
  { symbol: "VIJSOLX", url: "https://www.screener.in/company/VIJSOLX/",
    description: "Incorporated in 1987, Vijay Solvex Limited manufactures edible oil and vanaspati ghee, and also operates in ceramics and wind power generation. The company processes crude and refined edible oils, produces mustard oil derivatives, and manufactures specialty ceramic products and porcelain insulators." },
];

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 21c — hand-sourced descriptions  ${COMMIT ? "*** COMMIT ***" : "(dry)"}   ${ROWS.length} companies`);
  console.log("=".repeat(100));

  const live = await prisma.$queryRawUnsafe<Array<{ symbol: string; has: boolean }>>(
    `SELECT symbol, (description IS NOT NULL) AS has FROM stocks WHERE symbol = ANY($1::text[])`,
    ROWS.map((r) => r.symbol));
  const known = new Map(live.map((l) => [l.symbol, l.has]));

  const missing = ROWS.filter((r) => !known.has(r.symbol));
  const already = ROWS.filter((r) => known.get(r.symbol) === true);
  if (missing.length) console.log(`\n  ⚠ not in the universe, skipped: ${missing.map((m) => m.symbol).join(", ")}`);
  if (already.length) console.log(`  already had a description, left alone: ${already.map((m) => m.symbol).join(", ")}`);

  const todo = ROWS.filter((r) => known.get(r.symbol) === false);
  console.log(`\n  to write: ${todo.length}`);
  for (const t of todo) console.log(`     ${t.symbol.padEnd(12)} ${t.description.slice(0, 90)}…`);

  if (!COMMIT) { console.log(`\n  dry — re-run with --commit.\n`); await prisma.$disconnect(); return; }

  let n = 0;
  for (const t of todo) {
    n += await prisma.stock.updateMany({
      where: { symbol: t.symbol, description: null },
      data: { description: t.description },
    }).then((r) => r.count);
  }
  console.log(`\n  wrote ${n} description(s)   source: ${SOURCE}`);
  const left = (await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int n FROM stocks WHERE is_active AND description IS NULL`))[0].n;
  console.log(`  active stocks still without a description: ${left}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
