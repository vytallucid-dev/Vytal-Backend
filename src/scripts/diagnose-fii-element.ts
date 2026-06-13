// Read-only. Decisive element-level diagnosis:
// does InstitutionsForeignI carry a percentage fact in failing files,
// or is the value only on per-investor typed-member contexts?
//
// Run: npx tsx src/scripts/diagnose-fii-element.ts

import { fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";
import { prisma } from "../db/prisma.js";
import { XMLParser } from "fast-xml-parser";

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

// ── Fetch one null-fii row's xbrlUrl for a given symbol ──────────────────────
async function getUrl(symbol: string, nullFii: boolean): Promise<string | null> {
  const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } });
  if (!stock) return null;
  const rows = await prisma.$queryRawUnsafe<Array<{ xbrl_url: string }>>(
    `SELECT xbrl_url FROM shareholding_patterns
     WHERE stock_id = $1 AND xbrl_url IS NOT NULL
       AND fii_pct IS ${nullFii ? "NULL" : "NOT NULL"}
       AND source_date < '2025-06-01'
     ORDER BY as_on_date DESC LIMIT 1`,
    stock.id,
  );
  return rows[0]?.xbrl_url ?? null;
}

// ── Parse XML → flat fact list: [{element, contextRef, value}] ───────────────
type Fact = { element: string; contextRef: string; value: unknown };

function extractFacts(xml: string): Fact[] {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  let xbrl: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.toLowerCase().includes("xbrl")) { xbrl = (v as unknown[])[0] as Record<string, unknown>; break; }
  }

  const facts: Fact[] = [];
  for (const [rawKey, val] of Object.entries(xbrl)) {
    if (rawKey.startsWith("@_") || rawKey.startsWith("xbrli:") || rawKey.startsWith("link:")) continue;
    const localName = stripNs(rawKey);
    for (const entry of val as unknown[]) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const contextRef = String(obj["@_contextRef"] ?? "");
      if (!contextRef) continue;
      const value = obj["#text"] ?? null;
      facts.push({ element: localName, contextRef, value });
    }
  }
  return facts;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPercentage(elementName: string): boolean {
  const n = elementName.toLowerCase();
  return n.includes("percent") || n.includes("percentage") || n.includes("ratio");
}

function isShareCount(elementName: string): boolean {
  const n = elementName.toLowerCase();
  return (n.includes("number") || n.includes("noof") || n.includes("count") || n.includes("shares")) &&
    !n.includes("percent");
}

function dumpContext(facts: Fact[], contextRef: string, label: string) {
  const matching = facts.filter(f => f.contextRef === contextRef);
  console.log(`\n  Context "${contextRef}" in ${label} (${matching.length} facts):`);
  if (matching.length === 0) {
    console.log("    (no facts found under this context)");
    return;
  }
  for (const f of matching) {
    const tag = isPercentage(f.element) ? "[PCT]" :
                isShareCount(f.element) ? "[CNT]" : "[   ]";
    console.log(`    ${tag} ${f.element} = ${f.value}`);
  }
}

function dumpContextPattern(facts: Fact[], pattern: string, label: string, maxContexts = 3) {
  const ctxIds = [...new Set(
    facts.filter(f => f.contextRef.includes(pattern)).map(f => f.contextRef)
  )].sort().slice(0, maxContexts);

  console.log(`\n  Contexts matching "*${pattern}*" in ${label} (showing first ${maxContexts} of unique):`);
  if (ctxIds.length === 0) { console.log("    (none found)"); return; }

  for (const ctx of ctxIds) {
    const pctFacts = facts.filter(f => f.contextRef === ctx && isPercentage(f.element));
    const cntFacts = facts.filter(f => f.contextRef === ctx && isShareCount(f.element));
    console.log(`\n    Context "${ctx}":`);
    for (const f of pctFacts) console.log(`      [PCT] ${f.element} = ${f.value}`);
    for (const f of cntFacts.slice(0, 2)) console.log(`      [CNT] ${f.element} = ${f.value}`);
    if (pctFacts.length === 0 && cntFacts.length === 0) {
      const other = facts.filter(f => f.contextRef === ctx).slice(0, 3);
      other.forEach(f => console.log(`      [   ] ${f.element} = ${f.value}`));
    }
  }
}

// ── Sum typed-member percentages for a category ───────────────────────────────
function sumTypedMemberPct(facts: Fact[], ctxPattern: string): { sum: number; count: number } {
  // Typed-member aggregate contexts end in "I" (not "D" which are duration periods)
  const pctFacts = facts.filter(f =>
    f.contextRef.includes(ctxPattern) &&
    f.contextRef.endsWith("I") &&
    isPercentage(f.element) &&
    f.value != null,
  );
  const sum = pctFacts.reduce((s, f) => s + parseFloat(String(f.value)), 0);
  return { sum, count: pctFacts.length };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(72));
  console.log("FII/DII ELEMENT-LEVEL DIAGNOSIS — CANBK (failing) vs KAYNES (reference)");
  console.log("=".repeat(72));

  const canbkUrl = await getUrl("CANBK", true);
  const kaynesUrl = await getUrl("KAYNES", false);

  if (!canbkUrl) { console.error("No null-fii 2022-vintage row with URL for CANBK"); process.exit(1); }
  if (!kaynesUrl) { console.error("No non-null-fii 2022-vintage row with URL for KAYNES"); process.exit(1); }

  console.log(`\nCANBK  url: ${canbkUrl}`);
  console.log(`KAYNES url: ${kaynesUrl}`);

  console.log("\nFetching CANBK…");
  const canbkXml = await fetchXbrlXml(canbkUrl);
  console.log("Fetching KAYNES…");
  await new Promise(r => setTimeout(r, 600));
  const kaynesXml = await fetchXbrlXml(kaynesUrl);

  const canbkFacts  = extractFacts(canbkXml);
  const kaynesFacts = extractFacts(kaynesXml);
  console.log(`\nCANBK  total facts: ${canbkFacts.length}`);
  console.log(`KAYNES total facts: ${kaynesFacts.length}`);

  // ── 1. Dump every fact under InstitutionsForeignI and InstitutionsDomesticI ──

  console.log("\n" + "=".repeat(72));
  console.log("1. FACTS UNDER AGGREGATE CONTEXT IDs");
  console.log("=".repeat(72));

  dumpContext(canbkFacts,  "InstitutionsForeignI",  "CANBK");
  dumpContext(kaynesFacts, "InstitutionsForeignI",  "KAYNES");
  dumpContext(canbkFacts,  "InstitutionsDomesticI", "CANBK");
  dumpContext(kaynesFacts, "InstitutionsDomesticI", "KAYNES");

  // Also check the promoter + public contexts as sanity: parser succeeds on those
  console.log("\n  [sanity] ShareholdingOfPromoterAndPromoterGroupI in CANBK:");
  dumpContext(canbkFacts, "ShareholdingOfPromoterAndPromoterGroupI", "CANBK");
  console.log("\n  [sanity] PublicShareholdingI in CANBK:");
  dumpContext(canbkFacts, "PublicShareholdingI", "CANBK");

  // ── 2. Typed-member breakdown under InstitutionsForeignPortfolioInvestorOne ──

  console.log("\n" + "=".repeat(72));
  console.log("2. PER-INVESTOR TYPED-MEMBER CONTEXTS (first 3)");
  console.log("=".repeat(72));

  dumpContextPattern(canbkFacts,  "InstitutionsForeignPortfolioInvestorOne", "CANBK");
  dumpContextPattern(kaynesFacts, "InstitutionsForeignPortfolioInvestorOne", "KAYNES");

  // ── 3. What element name does KAYNES's working lookup resolve? ────────────

  console.log("\n" + "=".repeat(72));
  console.log("3. WORKING ELEMENT IN KAYNES (the fact byCtxV actually reads)");
  console.log("=".repeat(72));

  const PCT_KEYWORDS = ["shareholding", "percentage", "total", "shares"];
  const kaynesWorking = kaynesFacts.filter(f =>
    f.contextRef === "InstitutionsForeignI" &&
    PCT_KEYWORDS.every(kw => f.element.toLowerCase().includes(kw))
  );
  console.log(`\n  Facts in KAYNES where contextRef="InstitutionsForeignI" AND element matches all PCT keywords:`);
  if (kaynesWorking.length === 0) {
    console.log("  NONE — this is unexpected (KAYNES should succeed)");
  } else {
    kaynesWorking.forEach(f => console.log(`    [HIT] ${f.element} = ${f.value}`));
  }

  const canbkWorking = canbkFacts.filter(f =>
    f.contextRef === "InstitutionsForeignI" &&
    PCT_KEYWORDS.every(kw => f.element.toLowerCase().includes(kw))
  );
  console.log(`\n  Same query on CANBK (should be empty if that's the bug):`);
  if (canbkWorking.length === 0) {
    console.log("  NONE — confirms PCT keywords don't match any fact under InstitutionsForeignI");
  } else {
    canbkWorking.forEach(f => console.log(`    [HIT] ${f.element} = ${f.value}`));
  }

  // ── 4. Branch (b) test: sum typed-member percentages ─────────────────────

  console.log("\n" + "=".repeat(72));
  console.log("4. BRANCH (b) TEST — sum typed-member percentages");
  console.log("=".repeat(72));

  // Get publicPct from CANBK for sanity check
  const canbkPublicPctFact = canbkFacts.find(f =>
    f.contextRef === "PublicShareholdingI" &&
    PCT_KEYWORDS.every(kw => f.element.toLowerCase().includes(kw))
  );
  const canbkPublicPct = canbkPublicPctFact ? parseFloat(String(canbkPublicPctFact.value)) : null;

  // Sum all percentage facts on InstitutionsForeignPortfolioInvestorOneXXXI contexts
  const fpiSum = sumTypedMemberPct(canbkFacts, "InstitutionsForeignPortfolioInvestorOne");
  // Also try ForeignPortfolioInvestorI as a higher-level aggregate
  const fpiAggFact = canbkFacts.find(f =>
    f.contextRef === "ForeignPortfolioInvestorI" && isPercentage(f.element)
  );

  console.log(`\n  CANBK publicPct (from PublicShareholdingI): ${canbkPublicPct ?? "not found"}`);
  console.log(`\n  Sum of InstitutionsForeignPortfolioInvestorOneXXXI pct facts: ${fpiSum.sum.toFixed(4)}% (${fpiSum.count} typed-member contexts)`);
  if (canbkPublicPct !== null) {
    const sane = fpiSum.sum > 0 && fpiSum.sum <= canbkPublicPct;
    console.log(`  Plausible FII total (≤ public, > 0)? ${sane ? "YES" : "NO"}`);
  }
  if (fpiAggFact) {
    console.log(`\n  ForeignPortfolioInvestorI aggregate: ${fpiAggFact.element} = ${fpiAggFact.value}`);
  } else {
    console.log(`\n  ForeignPortfolioInvestorI: no percentage fact found`);
  }

  // Also check: is there ANY percentage fact on InstitutionsForeignI in CANBK?
  const canbkFiiAnyPct = canbkFacts.filter(f =>
    f.contextRef === "InstitutionsForeignI" && isPercentage(f.element)
  );
  const canbkFiiAnyCount = canbkFacts.filter(f =>
    f.contextRef === "InstitutionsForeignI" && isShareCount(f.element)
  );
  console.log(`\n  Any percentage fact on InstitutionsForeignI in CANBK: ${canbkFiiAnyPct.length > 0 ? canbkFiiAnyPct.map(f => `${f.element}=${f.value}`).join(", ") : "NONE"}`);
  console.log(`  Any share count fact on InstitutionsForeignI in CANBK: ${canbkFiiAnyCount.length > 0 ? canbkFiiAnyCount.map(f => `${f.element}=${f.value}`).join(", ") : "NONE"}`);

  // ── 5. VERDICT ─────────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(72));
  console.log("VERDICT");
  console.log("=".repeat(72));

  const kaynesHasPctOnAggregate = kaynesWorking.length > 0;
  const canbkHasPctOnAggregate  = canbkWorking.length > 0;
  const canbkHasAnyPctOnAggregate = canbkFiiAnyPct.length > 0;

  if (kaynesHasPctOnAggregate && !canbkHasPctOnAggregate) {
    if (canbkHasAnyPctOnAggregate) {
      // Fact exists but element name differs
      const altName = canbkFiiAnyPct[0].element;
      console.log(`\nBranch (a) — RENAMED ELEMENT.`);
      console.log(`  KAYNES: ${kaynesWorking[0].element} = ${kaynesWorking[0].value}`);
      console.log(`  CANBK:  ${altName} = ${canbkFiiAnyPct[0].value}`);
      console.log(`  The percentage fact EXISTS on InstitutionsForeignI in CANBK but under`);
      console.log(`  element "${altName}" which does not match all PCT keywords.`);
      console.log(`  Fix: add the missing keyword(s) to the PCT array, or add a second byCtxV`);
      console.log(`  call with element keywords matching "${altName}".`);
    } else {
      // No pct fact at all on the aggregate context
      console.log(`\nBranch (b) — VALUE ABSENT ON AGGREGATE CONTEXT.`);
      console.log(`  KAYNES: "${kaynesWorking[0].element}" = ${kaynesWorking[0].value} on InstitutionsForeignI`);
      console.log(`  CANBK:  NO percentage fact exists under InstitutionsForeignI at all.`);
      console.log(`  The FII percentage is only present on per-investor typed-member contexts.`);
      if (fpiSum.count > 0) {
        const sane = fpiSum.sum > 0 && (canbkPublicPct == null || fpiSum.sum <= canbkPublicPct);
        console.log(`  Typed-member sum: ${fpiSum.sum.toFixed(4)}% from ${fpiSum.count} FPI-Cat-1 contexts.`);
        console.log(`  Sanity: ${sane ? "PASS (plausible FII total)" : "FAIL (check sum logic)"}`);
        console.log(`  Fix: sum the per-investor pct facts from all DetailsOf...InstitutionsForeignPortfolioInvestorOneXXXI contexts.`);
      }
    }
  } else if (!kaynesHasPctOnAggregate) {
    console.log(`\nUNEXPECTED: KAYNES also has no PCT match on InstitutionsForeignI — re-check.`);
    console.log(`KAYNES all facts under InstitutionsForeignI:`);
    kaynesFacts.filter(f => f.contextRef === "InstitutionsForeignI").forEach(f =>
      console.log(`  ${f.element} = ${f.value}`)
    );
  } else {
    console.log(`\nBoth have pct on InstitutionsForeignI — something else is wrong.`);
  }

  console.log("\n" + "=".repeat(72));
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
