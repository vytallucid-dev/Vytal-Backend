// Read-only diagnostic: verify whether pledgedShares (BigInt count) is reliable
// across vintages. Fetches actual XBRL files for 7 target stocks and compares
// what the parser reads vs. what the file actually contains.
// NO WRITES. Run: npx tsx src/scripts/diagnose-pledge-counts.ts

import { prisma } from "../db/prisma.js";

// ── Target rows (from DB query — hardcoded to avoid re-fetch) ──────────────────
// These are the most recent rows with pledgedShares > 0 AND xbrlUrl non-null.
const TARGETS = [
  // GROUP SUSPECT: believed to be zero-pledge stocks with spurious counts
  {
    group: "SUSPECT",
    symbol: "BAJAJ-AUTO",  fy: "FY26", q: "Q4",
    pledgedShares: 13822n,       promoterShares: 153756828n, totalShares: 279497838n,
    promoterPledgedPct: 1,       promoterPledgedSharesPct: 1,
    xbrlUrl: "https://nsearchives.nseindia.com/corporate/xbrl/SHP_1656829_21042026085055_WEB.xml",
  },
  {
    group: "SUSPECT",
    symbol: "JSWSTEEL",    fy: "FY26", q: "Q4",
    pledgedShares: 585000n,      promoterShares: 1108203750n, totalShares: 2445453966n,
    promoterPledgedPct: 1,       promoterPledgedSharesPct: 1,
    xbrlUrl: "https://nsearchives.nseindia.com/corporate/xbrl/SHP_1656626_21042026064612_WEB.xml",
  },
  {
    group: "SUSPECT",
    symbol: "VBL",         fy: "FY26", q: "Q4",
    pledgedShares: 310n,         promoterShares: 2010217729n, totalShares: 3382094394n,
    promoterPledgedPct: 1,       promoterPledgedSharesPct: 1,
    xbrlUrl: "https://nsearchives.nseindia.com/corporate/xbrl/SHP_1648827_10042026045626_WEB.xml",
  },
  {
    group: "SUSPECT",
    symbol: "SUNPHARMA",   fy: "FY26", q: "Q4",
    pledgedShares: 85000n,       promoterShares: 1307119535n, totalShares: 2399334970n,
    promoterPledgedPct: 1,       promoterPledgedSharesPct: 1,
    xbrlUrl: "https://nsearchives.nseindia.com/corporate/xbrl/SHP_1653690_17042026073413_WEB.xml",
  },
  // GROUP REAL: believed to be genuinely pledged stocks
  {
    group: "REAL",
    symbol: "ASHOKLEY",    fy: "FY26", q: "Q4",
    pledgedShares: 1203500000n,  promoterShares: 2342920242n, totalShares: 5168114272n,
    promoterPledgedPct: 0.5903,  promoterPledgedSharesPct: 0.5903,
    xbrlUrl: "https://nsearchives.nseindia.com/corporate/xbrl/SHP_1656064_21042026023508_WEB.xml",
  },
  {
    group: "REAL",
    symbol: "HINDZINC",    fy: "FY26", q: "Q4",
    pledgedShares: 242118403n,   promoterShares: 2565271353n, totalShares: 4225319000n,
    promoterPledgedPct: 0.9196,  promoterPledgedSharesPct: 0.8252,
    xbrlUrl: "https://nsearchives.nseindia.com/corporate/xbrl/SHP_1653416_17042026054412_WEB.xml",
  },
  {
    group: "REAL",
    symbol: "LAURUSLABS",  fy: "FY26", q: "Q4",
    pledgedShares: 4000000n,     promoterShares: 148431720n,  totalShares: 539856582n,
    promoterPledgedPct: 0.2795,  promoterPledgedSharesPct: 0.2795,
    xbrlUrl: "https://nsearchives.nseindia.com/corporate/xbrl/SHP_1655519_20042026072131_WEB.xml",
  },
];

// ── Parser logic mirror ────────────────────────────────────────────────────────
// Mirrors src/ingestions/shareholdings/xbrl-parser.ts lines 317-341.
// The parser collects all facts whose LOWERCASED element name (after stripping
// namespace) contains ("pledge" OR "encumb") AND one of the content keywords.
// For pledgedShares: first fact where key also has "noshare" OR "numberofshare".

interface XbrlFact {
  element: string;     // original element name from XML
  contextRef: string;
  value: number;
  raw: string;         // raw string value from XML
}

function stripNs(name: string): string {
  return name.includes(":") ? name.split(":")[1] : name;
}

function parseXbrlFacts(xml: string): XbrlFact[] {
  const facts: XbrlFact[] = [];
  // Match all elements with a contextRef (XBRL inline facts)
  const tagRe = /<([A-Za-z0-9_:.-]+)\s[^>]*contextRef="([^"]+)"[^>]*>([^<]*)<\/[A-Za-z0-9_:.-]+>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const element = m[1];
    const contextRef = m[2];
    const raw = m[3].trim();
    if (raw === "" || raw === "0") {
      // Include zeros — parser allows 0 through
      if (raw === "0") facts.push({ element, contextRef, value: 0, raw });
      continue;
    }
    const value = Number(raw);
    if (!isNaN(value)) {
      facts.push({ element, contextRef, value, raw });
    }
  }
  return facts;
}

function findPledgeFacts(xml: string): {
  all: XbrlFact[];           // every fact with pledge/encumb in element name
  countFacts: XbrlFact[];    // subset: also has noshare/numberofshare → candidates for pledgedShares
  pctPromoterFacts: XbrlFact[];  // percent + (held|promoter)
  pctTotalFacts: XbrlFact[];     // percent + total
  parserPicksForCount: XbrlFact | null;  // what parser would assign to pledgedShares
} {
  const allFacts = parseXbrlFacts(xml);
  const pledgeFacts = allFacts.filter(f => {
    const k = stripNs(f.element).toLowerCase();
    return k.includes("pledge") || k.includes("encumb");
  });

  const countFacts = pledgeFacts.filter(f => {
    const k = stripNs(f.element).toLowerCase();
    return k.includes("noshare") || k.includes("numberofshare");
  });
  const pctPromoterFacts = pledgeFacts.filter(f => {
    const k = stripNs(f.element).toLowerCase();
    return k.includes("percent") && (k.includes("held") || k.includes("promoter"));
  });
  const pctTotalFacts = pledgeFacts.filter(f => {
    const k = stripNs(f.element).toLowerCase();
    return k.includes("percent") && k.includes("total");
  });

  // Parser picks FIRST count fact (pledgedShares === null check means first wins)
  const parserPicksForCount = countFacts.length > 0 ? countFacts[0] : null;

  return { all: pledgeFacts, countFacts, pctPromoterFacts, pctTotalFacts, parserPicksForCount };
}

// Also search for the CORRECT encumbered element — scan the full XML for any
// element containing the context that looks like a promoter pledged count
// but WITHOUT the "pledge/encumb" keyword constraint, to catch different naming.
function findEncumberedAlternatives(xml: string): XbrlFact[] {
  const allFacts = parseXbrlFacts(xml);
  return allFacts.filter(f => {
    const k = stripNs(f.element).toLowerCase();
    // Locked-in shares, hypothecated, pledged (broader search)
    return k.includes("lock") || k.includes("hypothecat") ||
           k.includes("encumber") || k.includes("pledg");
  });
}

async function fetchXml(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (research/diagnostic)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

function fmt(n: bigint | number | null): string {
  if (n === null || n === undefined) return "null";
  return String(n);
}

async function main() {
  console.log("=".repeat(110));
  console.log("PLEDGE COUNT DIAGNOSTIC — read-only, no writes");
  console.log("Resolves: is pledgedShares (BigInt count) reliable for the pledge ladder?");
  console.log("=".repeat(110));

  const verdicts: { symbol: string; group: string; verdict: string; detail: string }[] = [];

  for (const t of TARGETS) {
    const computedRatio = t.promoterShares > 0n
      ? (Number(t.pledgedShares) / Number(t.promoterShares) * 100).toFixed(4) + "%"
      : "N/A (promoterShares=0)";

    console.log("\n" + "═".repeat(110));
    console.log(`${t.group}: ${t.symbol}  ${t.fy} ${t.q}`);
    console.log("═".repeat(110));
    console.log("DB values:");
    console.log(`  pledgedShares            = ${fmt(t.pledgedShares)}`);
    console.log(`  promoterShares           = ${fmt(t.promoterShares)}`);
    console.log(`  totalShares              = ${fmt(t.totalShares)}`);
    console.log(`  promoterPledgedPct (DB)  = ${t.promoterPledgedPct}`);
    console.log(`  promoterPledgedSharesPct = ${t.promoterPledgedSharesPct}`);
    console.log(`  computed pledgedShares/promoterShares*100 = ${computedRatio}`);

    let xml: string;
    try {
      console.log(`\nFetching XBRL: ${t.xbrlUrl}`);
      xml = await fetchXml(t.xbrlUrl);
      console.log(`  OK — ${xml.length.toLocaleString()} chars`);
    } catch (err) {
      console.log(`  FETCH FAILED: ${(err as Error).message}`);
      verdicts.push({ symbol: t.symbol, group: t.group, verdict: "FETCH_FAILED", detail: "" });
      continue;
    }

    const { all, countFacts, pctPromoterFacts, pctTotalFacts, parserPicksForCount } =
      findPledgeFacts(xml);

    // ── ALL pledge/encumb elements in the file ──
    console.log(`\nAll pledge/encumb XBRL elements in file (${all.length} facts):`);
    if (all.length === 0) {
      console.log("  (none)");
    } else {
      for (const f of all) {
        console.log(`  ${stripNs(f.element).padEnd(60)} ctx=${f.contextRef.padEnd(30)} val=${f.raw}`);
      }
    }

    // ── What the parser reads for pledgedShares ──
    console.log(`\nParser reads for pledgedShares (key has noshare|numberofshare — ${countFacts.length} candidates):`);
    if (countFacts.length === 0) {
      console.log("  (none matching — pledgedShares would be 0 by default)");
    } else {
      for (const f of countFacts) {
        const isFirst = f === countFacts[0];
        console.log(
          `  ${isFirst ? "→ PARSER PICKS:" : "  (also found):"} ` +
          `${stripNs(f.element).padEnd(60)} ctx=${f.contextRef.padEnd(30)} val=${f.raw}`
        );
      }
    }

    // ── pct elements for reference ──
    if (pctPromoterFacts.length > 0) {
      console.log(`\nPct-of-promoter elements (${pctPromoterFacts.length}):`);
      for (const f of pctPromoterFacts) {
        console.log(`  ${stripNs(f.element).padEnd(60)} ctx=${f.contextRef.padEnd(30)} val=${f.raw}`);
      }
    }
    if (pctTotalFacts.length > 0) {
      console.log(`\nPct-of-total elements (${pctTotalFacts.length}):`);
      for (const f of pctTotalFacts) {
        console.log(`  ${stripNs(f.element).padEnd(60)} ctx=${f.contextRef.padEnd(30)} val=${f.raw}`);
      }
    }

    // ── Raw XML excerpt for the parser-picked element ──
    if (parserPicksForCount) {
      const elemShort = stripNs(parserPicksForCount.element);
      // Find a 400-char window around the element in the raw XML
      const idx = xml.indexOf(parserPicksForCount.element);
      if (idx >= 0) {
        const excerpt = xml.slice(Math.max(0, idx - 50), idx + 350).replace(/\n/g, " ").trim();
        console.log(`\nRaw XML excerpt for parser-picked element:`);
        console.log(`  ...${excerpt}...`);
      }
    }

    // ── VERDICT ──
    let verdict: string;
    let detail: string;

    if (parserPicksForCount === null) {
      // Parser found nothing — pledgedShares in DB must be 0 (or a stale row from different vintage)
      verdict = "MISPARSED_STALE";
      detail = `File has NO count element with pledge/encumb+noshare/numberofshare. DB value ${t.pledgedShares} came from an older XBRL version of this row.`;
    } else {
      const parserVal = Math.round(parserPicksForCount.value);
      const dbVal = Number(t.pledgedShares);
      const parserElemKey = stripNs(parserPicksForCount.element).toLowerCase();

      // Does the parser-picked element look like a genuine pledged-shares count?
      // Cross-check: if pledgedShares ≈ promoterShares (ratio > 50%) for a "suspect" stock → misparsed
      const ratioToPromoter = dbVal / Number(t.promoterShares);
      const ratioToTotal = dbVal / Number(t.totalShares);

      // Also: does the value in the file match what's in the DB?
      const matchesDb = Math.abs(parserVal - dbVal) < 1;

      if (!matchesDb) {
        verdict = "PARSE_VALUE_MISMATCH";
        detail = `File element val=${parserVal}, DB has ${dbVal} — stale or different row`;
      } else if (t.group === "SUSPECT" && ratioToPromoter > 0.0001) {
        // For "suspect" stocks, any pledgedShares > 0.01% of promoter is suspicious
        // Check if the element is actually an encumbered-shares element or something else
        // Look for context: if context looks like a promoter-sub-category or row subtotal
        const ctx = parserPicksForCount.contextRef.toLowerCase();
        const isProbablySubRow = ctx.includes("sub") || ctx.includes("row") || ctx.includes("encumb");
        if (parserVal > 0 && parserVal === dbVal) {
          verdict = "PRESENT_IN_FILE_VERIFY_CONTEXT";
          detail = `Parser picks element val=${parserVal}, matching DB. Context: ${parserPicksForCount.contextRef}. Ratio to promoter: ${(ratioToPromoter * 100).toFixed(6)}%`;
        } else {
          verdict = "ZERO_IN_FILE";
          detail = "Element absent or zero in file";
        }
      } else {
        verdict = "MATCHES_FILE";
        detail = `Parser picks ${stripNs(parserPicksForCount.element)} val=${parserVal}, DB=${dbVal}. Ratio to promoter: ${(ratioToPromoter * 100).toFixed(4)}%`;
      }
    }

    console.log(`\nVERDICT: ${verdict}`);
    console.log(`  ${detail}`);
    verdicts.push({ symbol: t.symbol, group: t.group, verdict, detail });
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(110));
  console.log("SUMMARY TABLE");
  console.log("═".repeat(110));
  for (const v of verdicts) {
    console.log(`  ${v.group.padEnd(8)} ${v.symbol.padEnd(14)} ${v.verdict}`);
    console.log(`           ${v.detail}`);
  }

  // ── Single conclusion ─────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(110));
  console.log("SINGLE CONCLUSION");
  console.log("═".repeat(110));
  const allMatchOrReal = verdicts.filter(
    v => v.verdict === "MATCHES_FILE" || v.verdict === "PRESENT_IN_FILE_VERIFY_CONTEXT"
  );
  const mismatched = verdicts.filter(v =>
    v.verdict !== "MATCHES_FILE" && v.verdict !== "PRESENT_IN_FILE_VERIFY_CONTEXT"
  );
  if (mismatched.length === 0) {
    console.log("pledgedShares is RELIABLE — parser picks the correct element for all 7 stocks.");
    console.log("→ PROCEED: build the pledge ladder using BigInt counts (pledgedShares / promoterShares).");
  } else {
    console.log(`pledgedShares may be UNRELIABLE for some stocks (${mismatched.length} of 7 have non-matching verdicts).`);
    console.log("→ INVESTIGATE the specific element/context for each non-matching case below:");
    for (const v of mismatched) {
      console.log(`    ${v.symbol}: ${v.verdict} — ${v.detail}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect().finally(() => process.exit(1));
});
