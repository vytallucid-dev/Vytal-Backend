import { fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";
import { prisma } from "../db/prisma.js";

const CANBK_URL = "https://nsearchives.nseindia.com/corporate/xbrl/SHP_196330_1408582_04042025055150_WEB.xml";
const KAYNES_URL = "https://nsearchives.nseindia.com/corporate/xbrl/SHP_197978_1418373_18042025012821_WEB.xml";

async function main() {
  console.log("Fetching CANBK...");
  const cxml = await fetchXbrlXml(CANBK_URL);
  await new Promise(r => setTimeout(r, 600));
  console.log("Fetching KAYNES...");
  const kxml = await fetchXbrlXml(KAYNES_URL);

  for (const [name, xml] of [["CANBK", cxml], ["KAYNES", kxml]] as [string, string][]) {
    console.log(`\n=== ${name}: lines with ShareholdingAsAPercentageOfTotalNumberOfShares + InstitutionsForeignI ===`);
    const lines = xml.split(/\n/);
    const hits = lines.filter(l =>
      l.includes("ShareholdingAsAPercentageOfTotalNumberOfShares") &&
      l.includes("InstitutionsForeignI")
    );
    if (hits.length === 0) {
      console.log("  (none on same line — file may be single-line)");
      // Try inline grep: split on > and look at each token
      const tokens = xml.split(/>/).filter(t =>
        t.includes("ShareholdingAsAPercentageOfTotalNumberOfShares") &&
        t.includes("InstitutionsForeignI")
      );
      tokens.slice(0, 3).forEach(t => console.log("  TOKEN:", t.trim().slice(0, 400)));
    } else {
      hits.slice(0, 3).forEach(l => console.log(" ", l.trim().slice(0, 400)));
    }

    // Show the namespace prefix used for the Shareholding element
    console.log(`\n${name}: namespace declarations:`);
    const nsMatches = xml.match(/xmlns:[a-zA-Z0-9_-]+=["'][^"']+["']/g) ?? [];
    nsMatches.forEach(m => console.log(" ", m));

    // Show raw prefix of ShareholdingAsAPct elements
    console.log(`\n${name}: unique prefixed tag names for ShareholdingAsAPct:`);
    const tagRe = /<([a-zA-Z0-9_:-]+ShareholdingAsAPercentageOfTotalNumberOfShares)[^>]*contextRef="InstitutionsForeignI"/g;
    const tags = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(xml)) !== null) tags.add(m[1]);
    tags.forEach(t => console.log(" ", t));
  }

  await prisma.$disconnect();
}
main().catch(console.error);
