// File: src/scripts/audit-parser-tags.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Args {
  xbrl: string;
  parser: string;
  taxonomyHint?: string;
}

function parseArgs(): Args {
  const out: Partial<Args> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === "xbrl") out.xbrl = m[2];
    if (m[1] === "parser") out.parser = m[2];
    if (m[1] === "taxonomy") out.taxonomyHint = m[2];
  }
  if (!out.xbrl || !out.parser) {
    console.error(
      "Usage: tsx audit-parser-tags.ts --xbrl=<path> --parser=<path> [--taxonomy=banking|nbfc|li|gi|indas]",
    );
    process.exit(1);
  }
  return out as Args;
}

/**
 * Extract every distinct tag emitted in the XBRL file under the in-capmkt
 * and in-capmkt-ent namespaces.
 */
function tagsInXbrl(xmlPath: string): Set<string> {
  const xml = readFileSync(xmlPath, "utf8");
  const tags = new Set<string>();
  const re = /<in-capmkt(?:-ent)?:([A-Za-z][A-Za-z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    tags.add(m[1]);
  }
  return tags;
}

/**
 * Extract every tag name the parser source file passes as the second argument
 * to extractNumber / extractString / extractDate.
 *
 * Matches patterns like:
 *   extractNumber(xml, "GrossPremiumIncome", PNL)
 *   extractDate(xml, "DateOfStartOfFinancialYear", "OneD")
 *   extractString(xml, "Symbol", PNL)
 */
function tagsInParser(parserPath: string): Set<string> {
  const src = readFileSync(parserPath, "utf8");
  const tags = new Set<string>();
  const re =
    /extract(?:Number|String|Date)\s*\(\s*xml\s*,\s*"([A-Za-z][A-Za-z0-9_]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    tags.add(m[1]);
  }
  return tags;
}

function diff() {
  const args = parseArgs();
  const xbrlPath = resolve(args.xbrl);
  const parserPath = resolve(args.parser);

  const inXbrl = tagsInXbrl(xbrlPath);
  const inParser = tagsInParser(parserPath);

  const onlyInXbrl = [...inXbrl].filter((t) => !inParser.has(t)).sort();
  const onlyInParser = [...inParser].filter((t) => !inXbrl.has(t)).sort();
  const inBoth = [...inXbrl].filter((t) => inParser.has(t)).sort();

  console.log(`\n══ Audit ══`);
  console.log(`  XBRL:   ${xbrlPath}`);
  console.log(`  Parser: ${parserPath}`);
  if (args.taxonomyHint) console.log(`  Taxonomy hint: ${args.taxonomyHint}`);
  console.log();
  console.log(`  Tags in XBRL only:    ${inXbrl.size}`);
  console.log(`  Tags in parser only:  ${inParser.size}`);
  console.log(`  Both:                 ${inBoth.length}`);

  console.log(`\n── Tags in XBRL but NOT in parser (${onlyInXbrl.length}) ──`);
  console.log(`(potential data loss; review for relevance)`);
  for (const t of onlyInXbrl) console.log(`  ${t}`);

  console.log(
    `\n── Tags parser looks for but NOT in XBRL (${onlyInParser.length}) ──`,
  );
  console.log(
    `(these will produce null fields. May be expected fallbacks, or tag-name bugs.)`,
  );
  for (const t of onlyInParser) console.log(`  ${t}`);

  console.log(`\n── Tags both have (working, ${inBoth.length}) ──`);
  for (const t of inBoth) console.log(`  ${t}`);
}

diff();
