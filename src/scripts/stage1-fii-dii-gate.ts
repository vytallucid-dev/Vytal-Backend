// ═══════════════════════════════════════════════════════════════
// STAGE 1 GATE — proves the third-vintage parser change is (a) INERT on the two
// existing vintages and (b) CORRECT on the new one. Read-only: fetches stored
// xbrl_url values and re-parses. Writes NOTHING.
//
//   npx tsx src/scripts/stage1-fii-dii-gate.ts
//
// THREE CHECKS
//  A · NO-DRIFT  — rows that ALREADY have fii/dii (2025 + 2022 vintages) must
//                  re-parse identical. Any drift means the new candidates leaked
//                  into a vintage they must never touch.
//  B · DERIVED   — rows that are currently NULL (2020 vintage) must now resolve,
//                  with legacyInstitutionsDerived=true.
//  C · INDEPENDENT CROSS-CHECK — the derived DII is recomputed here from the RAW
//                  XML domestic sub-lines by a regex that shares no code with the
//                  parser. Tautology-free: if the subtraction is wrong, this
//                  disagrees. It also asserts fii came from the Institutions FPI
//                  line and NOT the promoter-side trap line of the same file.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";
import { parseXbrlShareholding } from "../ingestions/shareholdings/xbrl-parser.js";
import { PARTITION_MIN } from "../ingestions/shareholdings/shareholding-guards.js";

const EPS = 5e-5; // Decimal(8,4) round-trip tolerance
// Sub-line-sum vs derived-DII tolerance, in percentage points. This is a SOURCE
// ROUNDING budget, not a fudge factor: the 2020 vintage publishes 9 Institutions
// sub-lines each rounded to 2dp, plus the InstitutionsI total rounded separately,
// so the two can legitimately disagree by up to 10 x 0.005 = 0.05pp. Real example:
// SUMICHEM 2022-03-31 files sub-lines summing to 8.03 against a stated total of
// 8.05. The parser subtracts from the TOTAL (not the sub-lines) precisely so that
// fii + dii == InstitutionsI holds exactly and the "others = public - fii - dii"
// residual stays honest; this check confirms the two agree to within the filing
// own precision, and nothing tighter is meaningful.
const XCHECK_PP = 0.05;
const PER_VINTAGE = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  symbol: string;
  q: string;
  fii: number | null;
  dii: number | null;
  banks: number | null;
  url: string;
};

/** contextRef to percentage, straight off the XML. Deliberately NOT the parser code path. */
function rawPct(xml: string): Map<string, number> {
  const m = new Map<string, number>();
  const re =
    /<([A-Za-z0-9_:-]*ShareholdingAsAPercentageOfTotalNumberOfShares)\s+[^>]*contextRef="([^"]+)"[^>]*>([^<]*)</g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(xml)) !== null) {
    const v = parseFloat(x[3]);
    if (!isNaN(v)) m.set(x[2], v);
  }
  return m;
}

function taxonomy(xml: string): string {
  return (
    xml.match(/xmlns:in-[a-zA-Z0-9_-]+="[^"]*\/shp\/(\d{4}-\d{2}-\d{2})\//)?.[1] ?? "unknown"
  );
}

const near = (a: number | null, b: number | null, eps: number): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) <= eps;

async function pick(sql: string): Promise<Row[]> {
  const r = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
  return r.map((x) => ({
    symbol: String(x.symbol),
    q: String(x.q),
    url: String(x.xbrl_url),
    fii: x.fii_pct === null ? null : Number(x.fii_pct),
    dii: x.dii_pct === null ? null : Number(x.dii_pct),
    banks: x.banks_fis_pct === null ? null : Number(x.banks_fis_pct),
  }));
}

let failures = 0;
let maxDelta = 0;
const fvciSeen: string[] = [];
const fail = (m: string): void => {
  failures++;
  console.log(`     FAIL ${m}`);
};

async function checkNoDrift(label: string, rows: Row[]): Promise<void> {
  console.log(`\n-- A · NO-DRIFT · ${label} (${rows.length} rows) --`);
  for (const r of rows) {
    const xml = await fetchXbrlXml(r.url);
    const p = parseXbrlShareholding(xml);
    const tax = taxonomy(xml);
    const ok =
      near(p.fiiPct, r.fii, EPS) &&
      near(p.diiPct, r.dii, EPS) &&
      near(p.banksFisPct, r.banks, EPS) &&
      !p.legacyInstitutionsDerived;
    console.log(
      `  ${ok ? "OK  " : "BAD "} ${r.symbol.padEnd(11)} ${r.q}  tax=${tax}  ` +
        `fii ${r.fii} -> ${p.fiiPct}  dii ${r.dii} -> ${p.diiPct}  ` +
        `banksFis ${r.banks} -> ${p.banksFisPct}  derived=${p.legacyInstitutionsDerived}`,
    );
    if (!near(p.fiiPct, r.fii, EPS)) fail(`${r.symbol} ${r.q}: fii drifted ${r.fii} -> ${p.fiiPct}`);
    if (!near(p.diiPct, r.dii, EPS)) fail(`${r.symbol} ${r.q}: dii drifted ${r.dii} -> ${p.diiPct}`);
    if (!near(p.banksFisPct, r.banks, EPS))
      fail(`${r.symbol} ${r.q}: banksFis drifted ${r.banks} -> ${p.banksFisPct}`);
    if (p.legacyInstitutionsDerived)
      fail(`${r.symbol} ${r.q}: derivation FIRED on a direct-context vintage (${tax})`);
    await sleep(800);
  }
}

/** The 2020-vintage Institutions block, minus its two foreign lines. */
const DOMESTIC_SUBLINES = [
  "MutualFundsOrUtiI",
  "VentureCapitalFundsI",
  "AlternativeInvestmentFundsI",
  "FinancialInstitutionOrBanksI",
  "InsuranceCompaniesI",
  "ProvidentFundsOrPensionFundsI",
  "OtherInstitutionsI",
];

async function checkDerived(rows: Row[]): Promise<void> {
  console.log(`\n-- B+C · DERIVED + INDEPENDENT CROSS-CHECK (${rows.length} rows) --`);
  for (const r of rows) {
    const xml = await fetchXbrlXml(r.url);
    const p = parseXbrlShareholding(xml);
    const tax = taxonomy(xml);
    const raw = rawPct(xml);

    // C — rebuild DII from the raw sub-lines, independently of the parser.
    const subSum = DOMESTIC_SUBLINES.reduce((s, c) => s + (raw.get(c) ?? 0), 0);
    const instTotal = raw.get("InstitutionsI") ?? null;
    const fpi = raw.get("InstitutionsForeignPortfolioInvestorI") ?? null;
    const fvci = raw.get("ForeignVentureCapitalInvestorsI") ?? 0;
    const trapLine = raw.get("ForeignPortfolioInvestorI"); // promoter-side, must NOT be used

    const okNonNull = p.fiiPct !== null && p.diiPct !== null;
    const okDerived = p.legacyInstitutionsDerived === true;
    const okXcheck = p.diiPct !== null && Math.abs(p.diiPct - subSum) <= XCHECK_PP;
    const okTrap = fpi === null || p.fiiPct === null || Math.abs(p.fiiPct - (fpi + fvci)) <= EPS;
    const okPartition = p.promoterPct + p.publicPct >= PARTITION_MIN;
    // Institutions are a SUBSET of public shareholding. A wrong-context read
    // (e.g. picking up a promoter-table line) typically breaks this bound.
    const okBound =
      p.fiiPct === null || p.diiPct === null || p.fiiPct + p.diiPct <= p.publicPct + XCHECK_PP;
    const ok = okNonNull && okDerived && okXcheck && okTrap && okPartition && okBound;
    if (p.diiPct !== null) maxDelta = Math.max(maxDelta, Math.abs(p.diiPct - subSum));
    if (fvci > 0) fvciSeen.push(`${r.symbol} ${r.q} fvci=${fvci}`);

    const delta = p.diiPct === null ? "n/a" : Math.abs(p.diiPct - subSum).toFixed(4);
    console.log(
      `  ${ok ? "OK  " : "BAD "} ${r.symbol.padEnd(11)} ${r.q}  tax=${tax}\n` +
        `        fii=${p.fiiPct} (fpi ${fpi} + fvci ${fvci}) · dii=${p.diiPct} · InstitutionsI=${instTotal}\n` +
        `        xcheck sum-of-domestic-sublines=${subSum.toFixed(4)}  delta=${delta}pp` +
        `  · promoter-side trap line=${trapLine ?? "absent"}`,
    );
    if (!okNonNull) fail(`${r.symbol} ${r.q}: still NULL after the change`);
    if (!okDerived)
      fail(`${r.symbol} ${r.q}: legacyInstitutionsDerived=false — resolved by an unexpected path`);
    if (!okXcheck)
      fail(`${r.symbol} ${r.q}: dii ${p.diiPct} vs sum-sublines ${subSum.toFixed(4)} — subtraction disagrees`);
    if (!okTrap)
      fail(`${r.symbol} ${r.q}: fii ${p.fiiPct} != fpi+fvci ${fpi}+${fvci} — WRONG CONTEXT (trap line?)`);
    if (!okPartition)
      fail(`${r.symbol} ${r.q}: partition broken promoter+public=${p.promoterPct + p.publicPct}`);
    if (!okBound)
      fail(`${r.symbol} ${r.q}: fii+dii ${(p.fiiPct ?? 0) + (p.diiPct ?? 0)} exceeds public ${p.publicPct}`);
    await sleep(800);
  }
}

async function main(): Promise<void> {
  console.log("\n=== STAGE 1 GATE — third-vintage FII/DII (READ-ONLY) ===");

  const v2025 = await pick(
    `SELECT symbol, as_on_date::text q, fii_pct, dii_pct, banks_fis_pct, xbrl_url
     FROM shareholding_patterns
     WHERE fii_pct IS NOT NULL AND as_on_date >= '2025-06-30' AND xbrl_url IS NOT NULL
     ORDER BY as_on_date DESC, symbol LIMIT ${PER_VINTAGE}`,
  );
  const v2022 = await pick(
    `SELECT symbol, as_on_date::text q, fii_pct, dii_pct, banks_fis_pct, xbrl_url
     FROM shareholding_patterns
     WHERE fii_pct IS NOT NULL AND as_on_date BETWEEN '2022-09-30' AND '2023-12-31' AND xbrl_url IS NOT NULL
     ORDER BY as_on_date, symbol LIMIT ${PER_VINTAGE}`,
  );
  const v2020 = await pick(
    `SELECT symbol, as_on_date::text q, fii_pct, dii_pct, banks_fis_pct, xbrl_url
     FROM shareholding_patterns
     WHERE fii_pct IS NULL
       AND as_on_date IN ('2021-09-30','2021-12-31','2022-03-31','2022-06-30')
       AND xbrl_url IS NOT NULL
     ORDER BY random() LIMIT ${PER_VINTAGE * 2}`,
  );

  await checkNoDrift("2025 taxonomy", v2025);
  await checkNoDrift("2022 taxonomy", v2022);
  await checkDerived(v2020);

  console.log("\n-- observed --");
  console.log(
    `  worst sub-line-sum vs derived-DII delta: ${maxDelta.toFixed(4)}pp (budget ${XCHECK_PP}pp)`,
  );
  if (fvciSeen.length) {
    console.log("  NON-ZERO FVCI (would have been misfiled as DOMESTIC without trap 2):");
    for (const f of fvciSeen) console.log(`    ${f}`);
  } else {
    console.log("  no non-zero FVCI in this sample");
  }
  console.log(
    `\n=== ${failures === 0 ? "GATE PASSED — safe to backfill" : `GATE FAILED — ${failures} failure(s), DO NOT BACKFILL`} ===\n`,
  );
  await prisma.$disconnect();
  if (failures) process.exit(1);
}

main().catch(async (e) => {
  console.error("ERR", e);
  await prisma.$disconnect();
  process.exit(1);
});
