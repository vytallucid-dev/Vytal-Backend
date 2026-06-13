// Read-only. Fetches XBRL files for 5 failing stocks + KAYNES reference,
// fingerprints context-ID conventions, and identifies why fii/dii resolves
// on KAYNES but not on the others.
//
// Run: npx tsx src/scripts/diagnose-fii-dii-fail.ts

import { prisma } from "../db/prisma.js";
import { fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";

// ── The 5 confirmed-failing stocks + KAYNES as known-good reference ──────────
const FAILING = ["FIVESTAR", "CANBK", "BHEL", "TATASTEEL", "PFC"];
const REFERENCE = "KAYNES";

// ── Keywords used by VINTAGE_CTX for context lookup (from xbrl-parser.ts) ───
const PARSER_FII_CANDS = ["InstitutionsForeign_ContextI", "InstitutionsForeignI"];
const PARSER_DII_CANDS = ["InstitutionsDomestic_ContextI", "InstitutionsDomesticI"];

// ── Interesting keyword substrings for context-ID scanning ───────────────────
const SCAN_KEYWORDS = [
  "Foreign", "Domestic", "Institution", "MutualFund", "Insurance",
  "Bank", "Public", "Promoter", "Government", "President",
  "Portfolio", "Fii", "Dii", "Fpi", "Nri",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractNamespace(xml: string): string {
  // Look for in-bse-shp or in-nse-shp xmlns declaration
  const m = xml.match(/xmlns:in-[a-zA-Z0-9_-]+=["']([^"']+)["']/);
  return m ? m[1] : "(namespace not found)";
}

function extractTaxonomyDate(ns: string): string {
  const m = ns.match(/\/shp\/(\d{4}-\d{2}-\d{2})\//);
  return m ? m[1] : "unknown";
}

/** Extract all <xbrli:context id="..."> IDs from raw XML */
function extractContextIds(xml: string): string[] {
  const ids: string[] = [];
  const re = /<xbrli:context[^>]+\bid=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) ids.push(m[1]);
  return ids;
}

/** From context IDs, find those matching any scan keyword (case-insensitive) */
function interestingContextIds(ids: string[]): string[] {
  const kws = SCAN_KEYWORDS.map((k) => k.toLowerCase());
  return ids.filter((id) =>
    kws.some((kw) => id.toLowerCase().includes(kw)),
  );
}

/** Detect naming convention from context IDs */
function detectConvention(ids: string[]): string {
  const hasUnderscoreContext = ids.some((id) => id.includes("_ContextI"));
  const hasBareI = ids.some(
    (id) => /[A-Za-z]I$/.test(id) && !id.includes("_ContextI"),
  );
  if (hasUnderscoreContext && !hasBareI) return "_ContextI";
  if (!hasUnderscoreContext && hasBareI) return "bare-I";
  if (hasUnderscoreContext && hasBareI) return "mixed";
  return "other";
}

/** Pull a raw XBRL snippet: all lines containing a keyword (up to maxLines) */
function rawSnippet(xml: string, keyword: string, maxLines = 8): string {
  const lines = xml.split(/\r?\n/).filter((l) =>
    l.toLowerCase().includes(keyword.toLowerCase()),
  );
  return lines.slice(0, maxLines).map((l) => l.trim()).join("\n");
}

/** Check which of the parser's expected context IDs actually appear in the file */
function parserCoverageCheck(
  ids: Set<string>,
  fiiCands: string[],
  diiCands: string[],
): { fiiFound: string | null; diiFound: string | null } {
  const fiiFound = fiiCands.find((c) => ids.has(c)) ?? null;
  const diiFound = diiCands.find((c) => ids.has(c)) ?? null;
  return { fiiFound, diiFound };
}

/** Look for element tags (not context IDs) that carry FII/DII values */
function extractFiiDiiElements(xml: string): string[] {
  const tags = new Set<string>();
  // Match <ns:ElementName ... > or </ns:ElementName> with relevant keywords
  const re = /<([a-zA-Z0-9_-]+:[a-zA-Z0-9_]+)[^>]*>/g;
  let m: RegExpExecArray | null;
  const kwds = ["foreign", "domestic", "institution", "fii", "fpi", "portfolio"];
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1].toLowerCase();
    if (kwds.some((kw) => tag.includes(kw))) tags.add(m[1]);
  }
  return [...tags].slice(0, 20);
}

// ── DB lookup ────────────────────────────────────────────────────────────────

async function pickRow(
  symbol: string,
  requireNullFii: boolean,
): Promise<{ asOnDate: Date; xbrlUrl: string; sourceDate: Date } | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true },
  });
  if (!stock) return null;

  type Row = { as_on_date: Date; xbrl_url: string; source_date: Date };
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT as_on_date, xbrl_url, source_date
     FROM shareholding_patterns
     WHERE stock_id = $1
       AND xbrl_url IS NOT NULL
       ${requireNullFii ? "AND fii_pct IS NULL" : "AND fii_pct IS NOT NULL"}
     ORDER BY as_on_date DESC
     LIMIT 1`,
    stock.id,
  );
  if (rows.length === 0) return null;
  return {
    asOnDate: rows[0].as_on_date,
    xbrlUrl: rows[0].xbrl_url,
    sourceDate: rows[0].source_date,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(72));
  console.log("FII/DII NULL DIAGNOSIS — failing stocks vs KAYNES reference");
  console.log("=".repeat(72));

  // Step 1: pick one null-fii row per failing stock + one working KAYNES row
  type Target = {
    symbol: string;
    role: "failing" | "reference";
    asOnDate: string;
    sourceDate: string;
    xbrlUrl: string;
  };

  const targets: Target[] = [];

  // KAYNES reference: pick a 2022-vintage row (sourceDate < 2025-06)
  const kaynRef = await prisma.$queryRawUnsafe<
    Array<{ as_on_date: Date; xbrl_url: string; source_date: Date }>
  >(
    `SELECT as_on_date, xbrl_url, source_date
     FROM shareholding_patterns
     WHERE symbol = 'KAYNES'
       AND xbrl_url IS NOT NULL
       AND fii_pct IS NOT NULL
       AND source_date < '2025-06-01'
     ORDER BY as_on_date DESC
     LIMIT 1`,
  );
  if (kaynRef.length > 0) {
    targets.push({
      symbol: "KAYNES",
      role: "reference",
      asOnDate: kaynRef[0].as_on_date.toISOString().slice(0, 10),
      sourceDate: kaynRef[0].source_date.toISOString().slice(0, 10),
      xbrlUrl: kaynRef[0].xbrl_url,
    });
  } else {
    console.warn("  WARNING: no KAYNES 2022-vintage row found — skipping reference");
  }

  for (const sym of FAILING) {
    const row = await pickRow(sym, true);
    if (!row) {
      console.warn(`  WARNING: no null-fii row with xbrlUrl for ${sym}`);
      continue;
    }
    targets.push({
      symbol: sym,
      role: "failing",
      asOnDate: row.asOnDate.toISOString().slice(0, 10),
      sourceDate: row.sourceDate.toISOString().slice(0, 10),
      xbrlUrl: row.xbrlUrl,
    });
  }

  console.log(`\nTargets selected (${targets.length}):`);
  targets.forEach((t) =>
    console.log(
      `  [${t.role.padEnd(9)}] ${t.symbol.padEnd(12)} asOnDate=${t.asOnDate}` +
      `  sourceDate=${t.sourceDate}\n    url=${t.xbrlUrl}`,
    ),
  );

  // Step 2: fetch and fingerprint
  console.log("\n" + "=".repeat(72));
  console.log("FETCHING FILES…");
  console.log("=".repeat(72));

  type FileResult = Target & {
    namespace: string;
    taxonomyDate: string;
    convention: string;
    allContextIds: string[];
    interestingIds: string[];
    fiiCandFound: string | null;
    diiCandFound: string | null;
    fiiDiiElements: string[];
    hasGovernment: boolean;
    xml: string;
    fetchError?: string;
  };

  const results: FileResult[] = [];

  for (const t of targets) {
    process.stdout.write(`  Fetching ${t.symbol}… `);
    try {
      const xml = await fetchXbrlXml(t.xbrlUrl);
      process.stdout.write(`${Math.round(xml.length / 1024)}KB\n`);

      const ns = extractNamespace(xml);
      const taxonomyDate = extractTaxonomyDate(ns);
      const allContextIds = extractContextIds(xml);
      const interestingIds = interestingContextIds(allContextIds);
      const convention = detectConvention(allContextIds);
      const idSet = new Set(allContextIds);
      const { fiiFound, diiFound } = parserCoverageCheck(
        idSet, PARSER_FII_CANDS, PARSER_DII_CANDS,
      );
      const fiiDiiElements = extractFiiDiiElements(xml);
      const hasGovernment = allContextIds.some((id) =>
        id.toLowerCase().includes("government") ||
        id.toLowerCase().includes("president"),
      );

      results.push({
        ...t, namespace: ns, taxonomyDate, convention,
        allContextIds, interestingIds,
        fiiCandFound: fiiFound, diiCandFound: diiFound,
        fiiDiiElements, hasGovernment, xml,
      });
    } catch (e) {
      process.stdout.write(`ERROR\n`);
      results.push({ ...t, namespace: "", taxonomyDate: "", convention: "",
        allContextIds: [], interestingIds: [], fiiCandFound: null,
        diiCandFound: null, fiiDiiElements: [], hasGovernment: false,
        xml: "", fetchError: (e as Error).message });
    }
    // small delay between fetches
    await new Promise((r) => setTimeout(r, 600));
  }

  // Step 3: Per-file fingerprint table
  console.log("\n" + "=".repeat(72));
  console.log("PER-FILE FINGERPRINT");
  console.log("=".repeat(72));

  for (const r of results) {
    if (r.fetchError) {
      console.log(`\n[${r.role}] ${r.symbol}  FETCH FAILED: ${r.fetchError}`);
      continue;
    }
    console.log(`\n${"─".repeat(72)}`);
    console.log(`[${r.role}] ${r.symbol}  asOnDate=${r.asOnDate}  sourceDate=${r.sourceDate}`);
    console.log(`  Taxonomy namespace : ${r.namespace}`);
    console.log(`  Taxonomy date      : ${r.taxonomyDate}`);
    console.log(`  Context convention : ${r.convention}`);
    console.log(`  Total context IDs  : ${r.allContextIds.length}`);
    console.log(`  Has govt/President : ${r.hasGovernment}`);
    console.log(`  Parser fii cand hit: ${r.fiiCandFound ?? "NONE — parser cannot resolve fii"}`);
    console.log(`  Parser dii cand hit: ${r.diiCandFound ?? "NONE — parser cannot resolve dii"}`);
    console.log(`\n  Interesting context IDs (${r.interestingIds.length}):`);
    r.interestingIds.forEach((id) => console.log(`    ${id}`));
    if (r.fiiDiiElements.length > 0) {
      console.log(`\n  FII/DII-related element tags in file:`);
      r.fiiDiiElements.forEach((el) => console.log(`    ${el}`));
    }
  }

  // Step 4: Discriminator — compare the 5 failing files to each other
  console.log("\n" + "=".repeat(72));
  console.log("DISCRIMINATOR — failing files vs reference");
  console.log("=".repeat(72));

  const failing = results.filter((r) => r.role === "failing" && !r.fetchError);
  const reference = results.find((r) => r.role === "reference" && !r.fetchError);

  if (reference) {
    console.log(`\nReference (KAYNES) taxonomy date  : ${reference.taxonomyDate}`);
    console.log(`Reference context convention      : ${reference.convention}`);
    const refFiiCtx = reference.interestingIds.filter((id) =>
      id.toLowerCase().includes("foreign"),
    );
    console.log(`Reference FII-relevant context IDs: ${refFiiCtx.join(", ")}`);
  }

  // Group failing by taxonomy date
  const byTaxDate: Record<string, string[]> = {};
  for (const r of failing) {
    if (!byTaxDate[r.taxonomyDate]) byTaxDate[r.taxonomyDate] = [];
    byTaxDate[r.taxonomyDate].push(r.symbol);
  }
  console.log(`\nFailing stocks by taxonomy date:`);
  for (const [date, syms] of Object.entries(byTaxDate)) {
    console.log(`  ${date} : ${syms.join(", ")}`);
  }

  // Group by convention
  const byConvention: Record<string, string[]> = {};
  for (const r of failing) {
    if (!byConvention[r.convention]) byConvention[r.convention] = [];
    byConvention[r.convention].push(r.symbol);
  }
  console.log(`\nFailing stocks by context-ID convention:`);
  for (const [conv, syms] of Object.entries(byConvention)) {
    console.log(`  "${conv}" : ${syms.join(", ")}`);
  }

  // Find union of all interesting context IDs across failing files
  const allFailingInteresting = new Set(failing.flatMap((r) => r.interestingIds));
  const refInteresting = new Set(reference?.interestingIds ?? []);
  const onlyInFailing = [...allFailingInteresting].filter((id) => !refInteresting.has(id));
  const onlyInReference = [...refInteresting].filter((id) => !allFailingInteresting.has(id));
  const inBoth = [...allFailingInteresting].filter((id) => refInteresting.has(id));

  console.log(`\nContext IDs only in failing files (${onlyInFailing.length}):`);
  onlyInFailing.forEach((id) => {
    const seenIn = failing.filter((r) => r.interestingIds.includes(id)).map((r) => r.symbol);
    console.log(`  ${id}  [in: ${seenIn.join(", ")}]`);
  });
  console.log(`\nContext IDs only in KAYNES reference (${onlyInReference.length}):`);
  onlyInReference.forEach((id) => console.log(`  ${id}`));
  console.log(`\nContext IDs in BOTH failing and reference (${inBoth.length}):`);
  inBoth.forEach((id) => console.log(`  ${id}`));

  // Step 4b: for ONE failing file, what does byCtxV try vs what's present?
  console.log("\n" + "=".repeat(72));
  console.log("PARSER LOOKUP TRACE — one failing file (first available)");
  console.log("=".repeat(72));

  const firstFail = failing[0];
  if (firstFail) {
    console.log(`\nFile: ${firstFail.symbol}  taxonomyDate=${firstFail.taxonomyDate}`);
    console.log(`\nbyCtxV for fii tries (in order):`);
    for (const cand of PARSER_FII_CANDS) {
      const present = firstFail.allContextIds.includes(cand);
      console.log(`  "${cand}"  → ${present ? "FOUND" : "NOT PRESENT"}`);
    }
    console.log(`\nbyCtxV for dii tries (in order):`);
    for (const cand of PARSER_DII_CANDS) {
      const present = firstFail.allContextIds.includes(cand);
      console.log(`  "${cand}"  → ${present ? "FOUND" : "NOT PRESENT"}`);
    }

    // What context IDs does this file actually have for FII/DII?
    const actualFiis = firstFail.allContextIds.filter((id) =>
      id.toLowerCase().includes("foreign") ||
      id.toLowerCase().includes("fii") ||
      id.toLowerCase().includes("fpi"),
    );
    const actualDiis = firstFail.allContextIds.filter((id) =>
      id.toLowerCase().includes("domestic") ||
      id.toLowerCase().includes("dii"),
    );
    console.log(`\nActual FII-related context IDs in ${firstFail.symbol}:`);
    actualFiis.length > 0
      ? actualFiis.forEach((id) => console.log(`  "${id}"`))
      : console.log("  (none found)");
    console.log(`\nActual DII-related context IDs in ${firstFail.symbol}:`);
    actualDiis.length > 0
      ? actualDiis.forEach((id) => console.log(`  "${id}"`))
      : console.log("  (none found)");
  }

  // Step 5: Side-by-side raw XBRL excerpts
  console.log("\n" + "=".repeat(72));
  console.log("RAW XBRL EXCERPT — FII block comparison");
  console.log("=".repeat(72));

  if (reference && !reference.fetchError) {
    console.log(`\n── KAYNES (reference, 2022-vintage) ──`);
    const kaynesSnippet = rawSnippet(reference.xml, "Foreign", 12);
    console.log(kaynesSnippet || "(no lines containing 'Foreign')");
  }

  for (const r of failing.slice(0, 2)) {
    console.log(`\n── ${r.symbol} (failing) ──`);
    const snip = rawSnippet(r.xml, "Foreign", 12);
    console.log(snip || "(no lines containing 'Foreign')");
    // Also try Institution
    const instSnip = rawSnippet(r.xml, "Institution", 12);
    if (instSnip && instSnip !== snip) {
      console.log("  [Institution keyword:]");
      console.log(instSnip);
    }
  }

  // Step 6: Summary + recommendation
  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY & RECOMMENDATION");
  console.log("=".repeat(72));

  const failTaxDates = [...new Set(failing.map((r) => r.taxonomyDate))];
  const refTaxDate = reference?.taxonomyDate ?? "unknown";
  const failConventions = [...new Set(failing.map((r) => r.convention))];

  console.log(`\nThe 5 failing files use taxonomy: ${failTaxDates.join(", ")}`);
  console.log(`KAYNES uses taxonomy             : ${refTaxDate}`);
  console.log(`Failing files context convention : ${failConventions.join(", ")}`);
  console.log(`KAYNES context convention        : ${reference?.convention ?? "unknown"}`);
  console.log(
    `VINTAGE_CTX covers "${refTaxDate}" (_ContextI) and "2022-09-30" (bare-I).`,
  );

  const allParserMiss = failing.every(
    (r) => r.fiiCandFound === null && r.diiCandFound === null,
  );
  const someParserHit = failing.some(
    (r) => r.fiiCandFound !== null || r.diiCandFound !== null,
  );

  if (allParserMiss) {
    console.log("\n→ Parser misses ALL 5 failing files — their context IDs are not in VINTAGE_CTX.");
    console.log("  The failing files likely use a NEW naming convention not yet covered.");
  } else if (someParserHit) {
    console.log("\n→ Parser hits SOME failing files but not all — multiple missing variants.");
  }

  // Collect unique context IDs from failing files that look like FII/DII
  // and aren't in the parser's candidate list
  const parserAllCands = new Set([...PARSER_FII_CANDS, ...PARSER_DII_CANDS]);
  const missingFiiIds = [...new Set(
    failing.flatMap((r) => r.allContextIds.filter((id) =>
      (id.toLowerCase().includes("foreign") ||
       id.toLowerCase().includes("domestic") ||
       id.toLowerCase().includes("institution")) &&
      !parserAllCands.has(id),
    )),
  )];
  if (missingFiiIds.length > 0) {
    console.log(`\nContext IDs in failing files that look like FII/DII`);
    console.log(`but are NOT in VINTAGE_CTX (candidates to add):`);
    for (const id of missingFiiIds) {
      const seenIn = failing.filter((r) => r.allContextIds.includes(id)).map((r) => r.symbol);
      console.log(`  "${id}"  [${seenIn.join(", ")}]`);
    }
  } else {
    console.log(`\nNo obvious FII/DII-named context IDs found outside VINTAGE_CTX.`);
    console.log(`The data may be stored under non-standard element names or absent entirely.`);
  }

  console.log("\n" + "=".repeat(72));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
