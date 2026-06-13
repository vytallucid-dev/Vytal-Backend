import { fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";
import { parseXbrlShareholding } from "../ingestions/shareholdings/xbrl-parser.js";

const URL = "https://nsearchives.nseindia.com/corporate/xbrl/SHP_1645570_02042026071027_WEB.xml";

async function main() {
  console.log("Fetching 2026-03-31 CANBK filing...");
  const xml = await fetchXbrlXml(URL);

  // Check namespaces and element prefix
  const nsMatches = xml.match(/xmlns:[a-zA-Z0-9_-]+=["'][^"']+["']/g) ?? [];
  console.log("\nNamespaces:");
  nsMatches.forEach(m => console.log(" ", m));

  // What is the raw PCT element tag?
  const tagRe = /<([a-zA-Z0-9_:-]+ShareholdingAsAPercentageOfTotalNumberOfShares)[^>]*contextRef="ShareholdingOfPromoterAndPromoterGroup[^"]*"/;
  const tagMatch = xml.match(tagRe);
  console.log("\nRaw promoter pct tag:", tagMatch?.[1] ?? "not found");

  const result = parseXbrlShareholding(xml);
  console.log("\nParser output:");
  console.log("  promoterPct=", result.promoterPct);
  console.log("  publicPct=", result.publicPct);
  console.log("  scaleSum=", result.promoterPct + result.publicPct, "(if <1.5 → fraction file)");
  console.log("  fiiPct=", result.fiiPct);
  console.log("  diiPct=", result.diiPct);
  console.log("  totalShares=", result.totalShares);
}
main().catch(console.error);
