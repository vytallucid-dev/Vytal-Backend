// ═══════════════════════════════════════════════════════════════
// S4.5 — faceValueShare: WHY THE FALLBACK DID NOT FIRE. READ-ONLY, in memory.
//   npx tsx src/scripts/_s45-facevalue.ts
//
// The annual parser does:
//     faceValueShare: extractNumber(xml,"FaceValueOfEquityShareCapital", BS)
//                  ?? extractNumber(xml,"FaceValueOfEquityShareCapital", PNL)
// with BS="OneI", PNL="FourD". R4c found the tag PRESENT under {OneD, FourD} on
// DRREDDY FY24 / HCLTECH FY24 and we still stored null. So the FourD fallback
// should have fired and did not. This opens the real documents and shows the raw
// element text, then runs the SHIPPED regex against it.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const TAG = "FaceValueOfEquityShareCapital";

/** the SHIPPED regex, verbatim from parser-legacy-common.ts extractNumber */
const shipped = (xml: string, tag: string, ctx: string) => {
  const re = new RegExp(
    `<in-bse-fin:${tag}\\b[^>]*?contextRef="${ctx}"[^>]*?>([\\-\\d.eE+]+)</in-bse-fin:${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
};
/** the same regex with whitespace tolerance around the value */
const tolerant = (xml: string, tag: string, ctx: string) => {
  const re = new RegExp(
    `<in-bse-fin:${tag}\\b[^>]*?contextRef="${ctx}"[^>]*?>\\s*([\\-\\d.eE+]+)\\s*</in-bse-fin:${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
};

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S4.5 — faceValueShare: the fallback, tested against real documents         ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const rows = await raw<any>(
    `SELECT st."symbol" sym, f."fiscal_year" fy, f."result_type" rt, f."xbrl_url" u,
            f."face_value_share"::float8 fvs, f."source" src
       FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
      WHERE f."face_value_share" IS NULL AND f."xbrl_url" IS NOT NULL
        AND f."filing_date" > TIMESTAMP '2022-11-25'
      ORDER BY st."symbol" LIMIT 6`);

  let fixedBy = 0, stillNull = 0;
  for (const r of rows) {
    let xml: string;
    try { xml = await fetchXbrlFile(r.u); } catch (e) { console.log(`  ${r.sym} ${r.fy}: unreachable`); continue; }
    console.log(`\n  ── ${r.sym} ${r.fy} ${r.rt}  (stored face_value_share = ${r.fvs === null ? "NULL" : r.fvs})`);

    // 1. DUMP the raw element text exactly as it appears
    const all = [...xml.matchAll(new RegExp(`<in-bse-fin:${TAG}\\b([^>]*)>([\\s\\S]*?)</in-bse-fin:${TAG}>`, "g"))];
    console.log(`     <${TAG}> occurrences: ${all.length}`);
    for (const m of all) {
      const ctx = /contextRef="([^"]+)"/.exec(m[1])?.[1] ?? "-";
      console.log(`        ctx=${ctx.padEnd(8)} raw text between tags = ${JSON.stringify(m[2])}`);
    }
    if (!all.length) { console.log(`     ⇒ GENUINELY ABSENT — nothing to read`); continue; }

    // 2. run the SHIPPED regex, both contexts
    const sBS = shipped(xml, TAG, "OneI"), sPNL = shipped(xml, TAG, "FourD");
    const tBS = tolerant(xml, TAG, "OneI"), tPNL = tolerant(xml, TAG, "FourD");
    console.log(`     SHIPPED  regex: OneI=${sBS ?? "null"}  FourD=${sPNL ?? "null"}   → stored ${(sBS ?? sPNL) ?? "NULL"}`);
    console.log(`     TOLERANT regex: OneI=${tBS ?? "null"}  FourD=${tPNL ?? "null"}   → would store ${(tBS ?? tPNL) ?? "NULL"}`);
    if ((sBS ?? sPNL) === null && (tBS ?? tPNL) !== null) { fixedBy++; console.log(`     ⇒ ⚠ THE WHITESPACE IS THE DEFECT — value present, shipped regex misses it`); }
    else if ((sBS ?? sPNL) === null) { stillNull++; console.log(`     ⇒ not whitespace — the tag is under a context neither attempt reads`); }
    await new Promise((z) => setTimeout(z, 350));
  }
  console.log(`\n  ── SUMMARY ──`);
  console.log(`  rows the whitespace-tolerant regex would populate : ${fixedBy}`);
  console.log(`  rows still null for another reason               : ${stillNull}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
