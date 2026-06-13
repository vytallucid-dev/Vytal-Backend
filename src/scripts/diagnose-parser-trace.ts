// Directly run the production parseXbrlShareholding on CANBK and KAYNES,
// then monkey-patch the internals to trace what byCtxV sees.
// Run: npx tsx src/scripts/diagnose-parser-trace.ts

import { fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";
import { prisma } from "../db/prisma.js";
import { XMLParser } from "fast-xml-parser";

const CANBK_URL  = "https://nsearchives.nseindia.com/corporate/xbrl/SHP_196330_1408582_04042025055150_WEB.xml";
const KAYNES_URL = "https://nsearchives.nseindia.com/corporate/xbrl/SHP_197978_1418373_18042025012821_WEB.xml";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
  textNodeName: "#text",
  isArray: () => true,
});

function stripNs(name: string): string {
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

function safeNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

type Fact = { contextRef: string; value: number | null };

function buildFactMap(xbrl: Record<string, unknown>): Record<string, Fact[]> {
  const factMap: Record<string, Fact[]> = {};
  for (const [rawKey, val] of Object.entries(xbrl)) {
    if (rawKey.startsWith("@_") || rawKey.startsWith("xbrli:") || rawKey.startsWith("link:")) continue;
    const key = stripNs(rawKey).toLowerCase();
    const entries = val as unknown[];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const contextRef = String(obj["@_contextRef"] ?? "");
      if (!contextRef) continue;
      const rawVal = obj["#text"] ?? null;
      if (!factMap[key]) factMap[key] = [];
      factMap[key].push({ contextRef, value: safeNum(rawVal) });
    }
  }
  return factMap;
}

const PCT = ["shareholding", "percentage", "total", "shares"];

function diagnose(label: string, xml: string) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`PARSER TRACE: ${label}`);
  console.log("=".repeat(72));

  const parsed = xmlParser.parse(xml) as Record<string, unknown>;

  // Find xbrl root
  let xbrl: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.toLowerCase().includes("xbrl")) { xbrl = (v as unknown[])[0] as Record<string, unknown>; break; }
  }

  // 1. How many top-level keys in the parsed xbrl object?
  const keys = Object.keys(xbrl);
  console.log(`\nxbrl root: ${keys.length} keys`);

  // 2. Find all keys that contain "shareholdingas" (the PCT element family)
  const pctKeys = keys.filter(k => stripNs(k).toLowerCase().includes("shareholdingas"));
  console.log(`\nKeys matching 'shareholdingas' (PCT element group):`);
  if (pctKeys.length === 0) {
    console.log("  (none found — element does not appear as a top-level key!)");
  } else {
    for (const pk of pctKeys) {
      const entries = (xbrl[pk] as unknown[]) ?? [];
      const ctxRefs = entries
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .map(e => String((e as Record<string, unknown>)["@_contextRef"] ?? ""));
      console.log(`  "${pk}" → ${entries.length} occurrences`);
      // Show the ForeignI and DomesticI occurrences
      const fiiFacts = ctxRefs.filter(c => c.includes("InstitutionsForeignI"));
      const diiFacts = ctxRefs.filter(c => c.includes("InstitutionsDomesticI"));
      if (fiiFacts.length > 0) console.log(`    contextRef="InstitutionsForeignI" occurrences: ${fiiFacts.length} → ${fiiFacts.join(", ")}`);
      if (diiFacts.length > 0) console.log(`    contextRef="InstitutionsDomesticI" occurrences: ${diiFacts.length} → ${diiFacts.join(", ")}`);
    }
  }

  // 3. Build factMap and check what byCtx finds for InstitutionsForeignI
  const factMap = buildFactMap(xbrl);
  const fmKeys = Object.keys(factMap);
  const fmPctKeys = fmKeys.filter(k => PCT.every(kw => k.includes(kw.toLowerCase())));

  console.log(`\nfactMap keys matching ALL PCT keywords (${PCT.join(", ")}):`);
  if (fmPctKeys.length === 0) {
    console.log("  (none) — byCtx will always return null for FII/DII/promoter/public!");
    console.log("\n  All factMap keys containing 'shareholding':");
    fmKeys.filter(k => k.includes("shareholding")).slice(0, 20).forEach(k =>
      console.log(`    "${k}" (${factMap[k].length} facts)`)
    );
  } else {
    for (const k of fmPctKeys) {
      const fiiFact = factMap[k].find(f => f.contextRef === "InstitutionsForeignI");
      const diiFact = factMap[k].find(f => f.contextRef === "InstitutionsDomesticI");
      const promFact = factMap[k].find(f => f.contextRef.includes("PromoterAndPromoterGroupI"));
      console.log(`  factMap["${k}"] — ${factMap[k].length} facts`);
      if (fiiFact) console.log(`    InstitutionsForeignI  → value=${fiiFact.value}`);
      if (diiFact) console.log(`    InstitutionsDomesticI → value=${diiFact.value}`);
      if (promFact) console.log(`    PromoterAndPromoterGroupI → value=${promFact.value}`);
    }
  }

  // 4. Direct byCtx simulation for fii/dii
  console.log(`\nSimulated byCtx("InstitutionsForeignI", PCT keywords):`);
  let fiiHit: number | null = null;
  for (const [key, facts] of Object.entries(factMap)) {
    if (!PCT.every(kw => key.includes(kw.toLowerCase()))) continue;
    const fact = facts.find(f => f.contextRef === "InstitutionsForeignI");
    if (fact) { fiiHit = fact.value; console.log(`  HIT: key="${key}" value=${fact.value}`); }
  }
  if (fiiHit === null) console.log("  MISS — returns null");

  // 5. If miss, why? Dump every factMap key that contains "foreign"
  if (fiiHit === null) {
    console.log(`\n  factMap keys containing "foreign":`);
    fmKeys.filter(k => k.includes("foreign")).slice(0, 10).forEach(k => {
      const ctxs = factMap[k].map(f => f.contextRef).filter(c => c.includes("Foreign")).slice(0, 3);
      console.log(`    "${k}" — ${factMap[k].length} facts, sample ctxs: ${ctxs.join(", ")}`);
    });
  }
}

async function main() {
  console.log("Fetching CANBK...");
  const cxml = await fetchXbrlXml(CANBK_URL);
  console.log("Fetching KAYNES...");
  await new Promise(r => setTimeout(r, 600));
  const kxml = await fetchXbrlXml(KAYNES_URL);

  diagnose("KAYNES (reference — should find FII)", kxml);
  diagnose("CANBK (failing — FII should be null)", cxml);

  await prisma.$disconnect();
}
main().catch(console.error);
