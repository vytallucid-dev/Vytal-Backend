// Read-only diagnostic: structural difference between XBRL files that yield
// populated fiiPct/diiPct vs those that yield NULL.
//
// Run: npx tsx src/scripts/diagnose-fii-dii-xbrl.ts

import { prisma } from "../db/prisma.js";
import { fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";

// ── The exact context IDs the parser keys on for FII/DII ──────────────────────
const PARSER_FII_CTX   = "InstitutionsForeign_ContextI";
const PARSER_DII_CTX   = "InstitutionsDomestic_ContextI";
const PARSER_MF_CTX    = "MutualFundsOrUTI_ContextI";
const PARSER_INS_CTX   = "InsuranceCompanies_ContextI";
const PARSER_BANKS_CTX = "Banks_ContextI";
// The primary percentage element (namespace-stripped, lowercased)
const PARSER_PCT_KEYWORDS = ["shareholding", "percentage", "total", "shares"];

// ── Keyword scan for tag names in raw XML ─────────────────────────────────────
const TAG_KEYWORDS = [
  "Foreign", "FII", "FPI", "Institution", "MutualFund", "DII",
  "Public", "Promoter", "Domestic", "NonInstitution", "Retail",
  "Individual", "Portfolio",
];

// ── helpers ───────────────────────────────────────────────────────────────────

function extractNamespaces(xml: string): string[] {
  const re = /xmlns(?::[a-z0-9-]+)?="([^"]+)"/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[0]);
  return [...new Set(out)];
}

function extractContextIds(xml: string): string[] {
  const re = /<[^>]*:context[^>]*\s+id="([^"]+)"/gi;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) ids.push(m[1]);
  return ids;
}

function extractExplicitMembers(xml: string): string[] {
  const re = /<[^>]*:explicitMember[^>]*>([^<]+)<\/[^>]*:explicitMember>/gi;
  const members: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const val = m[1].trim();
    const stripped = val.split(":").pop() ?? val;
    members.push(stripped);
  }
  return [...new Set(members)];
}

function extractPresentTags(xml: string): string[] {
  // Extract distinct element names (strip ns prefix) that contain any keyword
  const re = /<([a-zA-Z0-9_:]+)\s[^>]*contextRef/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1];
    const stripped = raw.includes(":") ? raw.split(":").slice(1).join(":") : raw;
    seen.add(stripped);
  }
  return [...seen].filter((t) =>
    TAG_KEYWORDS.some((kw) => t.toLowerCase().includes(kw.toLowerCase()))
  );
}

function checkParserCtxPresent(xml: string, ctxId: string): boolean {
  return xml.includes(`"${ctxId}"`);
}

/** Pull a short block of raw XML around a context ID or tag name (first match). */
function excerpt(xml: string, needle: string, window = 300): string {
  const idx = xml.indexOf(needle);
  if (idx < 0) return `  [not found: "${needle}"]`;
  const start = Math.max(0, idx - 80);
  const end = Math.min(xml.length, idx + window);
  return xml.slice(start, end).replace(/\n\s*/g, " ").trim();
}

/** Extract institution-related context blocks (id + explicitMember) from raw XML. */
function extractInstitutionContextBlocks(xml: string): string[] {
  const re = /<[^>]*:context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/[^>]*:context>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = m[1];
    const body = m[2];
    // keep only institution/foreign/domestic/FII/DII-related contexts
    const relevant =
      /Institution|Foreign|Domestic|MutualFund|Insurance|Bank|NonInstitut|Retail|Individual|FII|DII|Portfolio/i.test(
        id + body
      );
    if (relevant) {
      const members =
        [...body.matchAll(/<[^>]*:explicitMember[^>]*>([^<]+)<\/[^>]*:explicitMember>/gi)]
          .map((x) => x[1].trim().split(":").pop())
          .join(", ");
      blocks.push(`  id="${id}"  members=[${members}]`);
    }
  }
  return blocks;
}

/** Check whether a pct-bearing element (any keyword match) uses a given contextRef */
function findPctTagsForCtx(xml: string, ctxId: string): string[] {
  const re = new RegExp(
    `<([a-zA-Z0-9_:]+)[^>]*contextRef="${ctxId}"[^>]*>[^<]*<`,
    "g"
  );
  const tags: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1];
    const stripped = raw.includes(":") ? raw.split(":").slice(1).join(":") : raw;
    if (
      PARSER_PCT_KEYWORDS.some((kw) =>
        stripped.toLowerCase().includes(kw.toLowerCase())
      )
    )
      tags.push(stripped);
  }
  return [...new Set(tags)];
}

// ── fingerprint one file ───────────────────────────────────────────────────────

interface Fingerprint {
  url: string;
  symbol: string;
  asOnDate: string;
  fiiPct: number | null;
  fetchError: string | null;
  namespaces: string[];
  contextIds: string[];
  explicitMembers: string[];
  presentKeywordTags: string[];
  parserCtxPresence: Record<string, boolean>;
  institutionContextBlocks: string[];
  // populated-file details
  fiiCtxPctTags: string[];
  diiCtxPctTags: string[];
  // null-file details: what DOES exist near "institution"-like contexts?
  altContextsNearInstitution: string[];
  rawXml?: string;
}

async function fingerprint(
  symbol: string,
  asOnDate: Date,
  fiiPct: number | null,
  url: string
): Promise<Fingerprint> {
  const base: Fingerprint = {
    url,
    symbol,
    asOnDate: asOnDate.toISOString().slice(0, 10),
    fiiPct,
    fetchError: null,
    namespaces: [],
    contextIds: [],
    explicitMembers: [],
    presentKeywordTags: [],
    parserCtxPresence: {},
    institutionContextBlocks: [],
    fiiCtxPctTags: [],
    diiCtxPctTags: [],
    altContextsNearInstitution: [],
  };

  let xml: string;
  try {
    xml = await fetchXbrlXml(url);
  } catch (e) {
    base.fetchError = String(e);
    return base;
  }

  base.rawXml = xml;
  base.namespaces = extractNamespaces(xml);
  base.contextIds = extractContextIds(xml);
  base.explicitMembers = extractExplicitMembers(xml);
  base.presentKeywordTags = extractPresentTags(xml);

  const ctxsToCheck = [
    PARSER_FII_CTX,
    PARSER_DII_CTX,
    PARSER_MF_CTX,
    PARSER_INS_CTX,
    PARSER_BANKS_CTX,
    "NonInstitutions_ContextI",
    "PublicShareholding_ContextI",
    "ShareholdingOfPromoterAndPromoterGroup_ContextI",
    "ShareholdingPattern_ContextI",
  ];
  for (const ctx of ctxsToCheck) {
    base.parserCtxPresence[ctx] = checkParserCtxPresent(xml, ctx);
  }

  base.institutionContextBlocks = extractInstitutionContextBlocks(xml);
  base.fiiCtxPctTags = findPctTagsForCtx(xml, PARSER_FII_CTX);
  base.diiCtxPctTags = findPctTagsForCtx(xml, PARSER_DII_CTX);

  // For null files: find any context whose ID contains institution-like words
  if (fiiPct === null) {
    base.altContextsNearInstitution = base.contextIds.filter((id) =>
      /Institution|Foreign|Domestic|MutualFund|Insurance|Bank|NonInstitut|FII|DII|Portfolio/i.test(id)
    );
  }

  return base;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(72));
  console.log("FII/DII XBRL STRUCTURE DIAGNOSTIC");
  console.log("=".repeat(72));

  // ── Pick 3 populated + 3 null rows, each with a non-null xbrlUrl ──────────

  const populated = await prisma.shareholdingPattern.findMany({
    where: { fiiPct: { not: null }, xbrlUrl: { not: null } },
    select: { symbol: true, asOnDate: true, fiiPct: true, xbrlUrl: true },
    orderBy: { asOnDate: "desc" },
    take: 3,
  });

  const nullRows = await prisma.shareholdingPattern.findMany({
    where: { fiiPct: null, xbrlUrl: { not: null } },
    select: { symbol: true, asOnDate: true, fiiPct: true, xbrlUrl: true },
    orderBy: { asOnDate: "desc" },
    take: 3,
  });

  console.log("\nSELECTED ROWS:");
  console.log("  POPULATED (fiiPct non-null):");
  for (const r of populated) {
    console.log(`    ${r.symbol.padEnd(12)} ${r.asOnDate.toISOString().slice(0, 10)}  fiiPct=${r.fiiPct}  ${r.xbrlUrl}`);
  }
  console.log("  NULL (fiiPct null):");
  for (const r of nullRows) {
    console.log(`    ${r.symbol.padEnd(12)} ${r.asOnDate.toISOString().slice(0, 10)}  fiiPct=null  ${r.xbrlUrl}`);
  }

  // ── Fetch & fingerprint ───────────────────────────────────────────────────

  console.log("\nFetching XBRL files (6 total)...");

  const allRows = [
    ...populated.map((r) => ({ ...r, group: "POPULATED" })),
    ...nullRows.map((r) => ({ ...r, group: "NULL" })),
  ];

  const prints: (Fingerprint & { group: string })[] = [];
  for (const r of allRows) {
    process.stdout.write(`  Fetching ${r.symbol} ${r.asOnDate.toISOString().slice(0, 10)}... `);
    const fp = await fingerprint(r.symbol, r.asOnDate, r.fiiPct !== null ? Number(r.fiiPct) : null, r.xbrlUrl!);
    prints.push({ ...fp, group: r.group });
    console.log(fp.fetchError ? `ERROR: ${fp.fetchError}` : "ok");
  }

  // ── Per-file structural report ────────────────────────────────────────────

  for (const fp of prints) {
    console.log("\n" + "─".repeat(72));
    console.log(`[${fp.group}]  ${fp.symbol}  ${fp.asOnDate}  fiiPct=${fp.fiiPct ?? "NULL"}`);
    console.log(`  URL: ${fp.url}`);

    if (fp.fetchError) {
      console.log(`  FETCH ERROR: ${fp.fetchError}`);
      continue;
    }

    // Namespace / taxonomy version
    const taxNs = fp.namespaces.filter(
      (n) => n.includes("in-bse") || n.includes("in-nse") || n.includes("in-capmkt") || n.includes("sebi")
    );
    console.log(`  Taxonomy namespaces: ${taxNs.length ? taxNs.join(", ") : "(none matched — all ns below)"}`);
    if (!taxNs.length) console.log(`    All ns: ${fp.namespaces.slice(0, 6).join(", ")}`);

    // Context count summary
    console.log(`  Total contexts: ${fp.contextIds.length}`);

    // Explicit members (shareholder categories defined)
    console.log(`  ExplicitMembers (${fp.explicitMembers.length}): ${fp.explicitMembers.slice(0, 20).join(", ")}`);

    // Keyword-bearing tags present
    console.log(`  Keyword tags in file: ${fp.presentKeywordTags.join(", ") || "(none)"}`);

    // Parser context presence
    console.log("  Parser context IDs — present in this file?");
    for (const [ctx, present] of Object.entries(fp.parserCtxPresence)) {
      const marker = present ? "✓" : "✗";
      console.log(`    ${marker} ${ctx}`);
    }

    // Institution context blocks
    if (fp.institutionContextBlocks.length) {
      console.log("  Institution-related context blocks:");
      for (const b of fp.institutionContextBlocks) console.log(b);
    } else {
      console.log("  Institution-related context blocks: (none found)");
    }

    // For populated: confirm the pct tags attached to FII/DII contexts
    if (fp.group === "POPULATED") {
      console.log(`  PCT element names on ${PARSER_FII_CTX}: ${fp.fiiCtxPctTags.join(", ") || "(none)"}`);
      console.log(`  PCT element names on ${PARSER_DII_CTX}: ${fp.diiCtxPctTags.join(", ") || "(none)"}`);
    }

    // For null: what context IDs exist that look institution-related?
    if (fp.group === "NULL") {
      console.log(
        `  Alt institution-like context IDs in file: ${
          fp.altContextsNearInstitution.length
            ? fp.altContextsNearInstitution.join(", ")
            : "(none)"
        }`
      );
    }
  }

  // ── Side-by-side raw excerpt ──────────────────────────────────────────────

  const popXml = prints.find((p) => p.group === "POPULATED" && !p.fetchError);
  const nullXml = prints.find((p) => p.group === "NULL" && !p.fetchError);

  console.log("\n" + "=".repeat(72));
  console.log("RAW XBRL EXCERPT — institution context block");
  console.log("=".repeat(72));

  if (popXml?.rawXml) {
    console.log(`\n── POPULATED (${popXml.symbol} ${popXml.asOnDate}) ──`);
    // Show context block for InstitutionsForeign_ContextI
    const foreignCtxExcerpt = excerpt(popXml.rawXml, PARSER_FII_CTX, 400);
    console.log("  Context block for FII ctx:");
    console.log("  " + foreignCtxExcerpt);

    // Show the pct element that resolves to FII
    const pctExcerpt = excerpt(popXml.rawXml, `contextRef="${PARSER_FII_CTX}"`, 200);
    console.log("  FII pct element:");
    console.log("  " + pctExcerpt);

    // DII context block
    const diiExcerpt = excerpt(popXml.rawXml, PARSER_DII_CTX, 400);
    console.log("  Context block for DII ctx:");
    console.log("  " + diiExcerpt);
  }

  if (nullXml?.rawXml) {
    console.log(`\n── NULL (${nullXml.symbol} ${nullXml.asOnDate}) ──`);

    // Show what context IDs look institution-related
    const altIds = nullXml.altContextsNearInstitution;
    if (altIds.length) {
      for (const id of altIds.slice(0, 5)) {
        const blk = excerpt(nullXml.rawXml, `id="${id}"`, 400);
        console.log(`  Context block for id="${id}":`);
        console.log("  " + blk);
      }
      // Also show any pct elements for the first alt context
      const firstAlt = altIds[0];
      const altPctTags = findPctTagsForCtx(nullXml.rawXml, firstAlt);
      console.log(`  PCT element names on "${firstAlt}": ${altPctTags.join(", ") || "(none)"}`);
      const altPctExcerpt = excerpt(nullXml.rawXml, `contextRef="${firstAlt}"`, 200);
      console.log(`  First pct element on "${firstAlt}":`);
      console.log("  " + altPctExcerpt);
    } else {
      // No institution-like context IDs at all — show all context IDs raw
      console.log("  No institution-like context IDs found. All context IDs in file:");
      for (const id of nullXml.contextIds) console.log(`    ${id}`);
      // Show sample of explicit members
      console.log("  ExplicitMembers raw:");
      for (const m of nullXml.explicitMembers) console.log(`    ${m}`);
    }

    // Also show a sample of ANY pct element to confirm filing has data
    const anyPct = excerpt(nullXml.rawXml, "ShareholdingAsAPercentage", 300);
    console.log("  Sample pct element (first match):");
    console.log("  " + anyPct);
  }

  // ── Summary verdict ────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(72));
  console.log("VERDICT");
  console.log("=".repeat(72));

  const popSample = prints.filter((p) => p.group === "POPULATED" && !p.fetchError);
  const nullSample = prints.filter((p) => p.group === "NULL" && !p.fetchError);

  if (!popSample.length || !nullSample.length) {
    console.log("Insufficient fetched files for comparison — check fetch errors above.");
    await prisma.$disconnect();
    return;
  }

  // Determine which parser contexts are consistently present/absent
  const ctxKeys = Object.keys(popSample[0].parserCtxPresence);
  console.log("\nParser context presence: POPULATED vs NULL");
  console.log(
    "  " + "context".padEnd(50) + "populated".padStart(10) + "  null".padStart(8)
  );
  for (const ctx of ctxKeys) {
    const popCount = popSample.filter((p) => p.parserCtxPresence[ctx]).length;
    const nullCount = nullSample.filter((p) => p.parserCtxPresence[ctx]).length;
    const marker = popCount > 0 && nullCount === 0 ? " ← DIFF" : "";
    console.log(
      "  " + ctx.padEnd(50) +
      `${popCount}/${popSample.length}`.padStart(10) +
      `${nullCount}/${nullSample.length}`.padStart(8) +
      marker
    );
  }

  const fiiMissing = nullSample.every((p) => !p.parserCtxPresence[PARSER_FII_CTX]);
  const diiMissing = nullSample.every((p) => !p.parserCtxPresence[PARSER_DII_CTX]);
  const fiiPresent = popSample.every((p) => p.parserCtxPresence[PARSER_FII_CTX]);

  const popTaxonomy = [...new Set(
    popSample.flatMap((p) =>
      p.namespaces.filter((n) =>
        n.includes("in-bse") || n.includes("in-nse") || n.includes("in-capmkt")
      )
    )
  )];
  const nullTaxonomy = [...new Set(
    nullSample.flatMap((p) =>
      p.namespaces.filter((n) =>
        n.includes("in-bse") || n.includes("in-nse") || n.includes("in-capmkt")
      )
    )
  )];

  const popMembers = [...new Set(popSample.flatMap((p) => p.explicitMembers))].sort();
  const nullMembers = [...new Set(nullSample.flatMap((p) => p.explicitMembers))].sort();
  const inNullNotPop = nullMembers.filter((m) => !popMembers.includes(m));
  const inPopNotNull = popMembers.filter((m) => !nullMembers.includes(m));

  console.log(`\nPopulated files taxonomy: ${popTaxonomy.join(", ") || "(not detected)"}`);
  console.log(`Null files taxonomy:      ${nullTaxonomy.join(", ") || "(not detected)"}`);

  console.log(`\nExplicitMembers in POPULATED only: ${inPopNotNull.join(", ") || "(none)"}`);
  console.log(`ExplicitMembers in NULL only:      ${inNullNotPop.join(", ") || "(none)"}`);

  console.log("\n── Conclusion ──");

  if (fiiPresent && fiiMissing && diiMissing) {
    console.log(
      `Populated files use context IDs "${PARSER_FII_CTX}" / "${PARSER_DII_CTX}" — the parser finds them.`
    );
    const altIds = nullSample.flatMap((p) => p.altContextsNearInstitution);
    if (altIds.length) {
      const uniqueAlt = [...new Set(altIds)];
      console.log(
        `Null files do NOT have those context IDs, but DO have institution-like contexts: ${uniqueAlt.join(", ")}`
      );
      console.log(
        `→ FIX: (i) Add fallback context names to the parser, OR (ii) handle a second document layout.`
      );
      console.log(
        `   Specifically: the null-file FII/DII data is present but under different context IDs.`
      );
    } else {
      console.log(
        "Null files have NO institution-like context IDs at all."
      );
      console.log(
        "→ DIAGNOSIS: The sub-breakdown (FII/DII/retail) is simply absent from these filings."
      );
      console.log(
        "   This is a SOURCE GAP — the issuer/NSE did not publish FII/DII breakdown in the XBRL for these quarters."
      );
      console.log(
        "   Fix (iii): not a parser issue; cannot reconstruct. Consider deriving from NSDL/CDSL data instead."
      );
    }
  } else {
    console.log(
      "Mixed presence — see per-file detail above and the context diff table for specifics."
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect().finally(() => process.exit(1));
});
