// ─────────────────────────────────────────────────────────────────────────────
// Pure unit harness for the dual-vintage + scale-normalised XBRL parser.
// Run: npx tsx src/scripts/test-xbrl-dual-vintage.ts
//
// Fixtures are assembled from REAL captured structure (element names, namespaces,
// context IDs, members and values) of three filings observed in production:
//   • 2025-10-31 taxonomy (LICI 2026-06-01) — percentages stored as FRACTIONS
//   • 2025-05-31 taxonomy (BAJFINANCE 2025-06-30) — percentages stored as PERCENT
//   • 2022-09-30 taxonomy (KAYNES 2025-06-24) — PERCENT, "I"-suffix context IDs
//
// Asserts:
//   2025-10-31 → fii/dii/retail are now NON-NULL and normalised to PERCENT
//                (e.g. fii 0.0032 → 0.32); promoter+public ≈ 100; fii/dii ≤ public.
//   2025-05-31 → percent-native path UNCHANGED (fii stays 21.71).
//   2022-09-30 → fii/dii/retail now NON-NULL (the parser gap is closed),
//                percent, sane; counts populate via the "I"-suffix fallback.
// ─────────────────────────────────────────────────────────────────────────────

import { parseXbrlShareholding } from "../ingestions/shareholdings/xbrl-parser.js";

// ── Minimal-but-faithful XBRL builder ─────────────────────────────────────────
// Mirrors the real flat structure: each category is an <xbrli:context> with an
// explicitMember, plus a ShareholdingAsAPercentageOfTotalNumberOfShares fact and
// (optionally) a NumberOfFullyPaidUpEquityShares fact carrying the same contextRef.

interface Cat {
  id: string; // context id (vintage-specific: _ContextI vs I)
  member: string; // explicitMember local name
  pct?: number; // ShareholdingAsAPercentageOfTotalNumberOfShares value
  shares?: number; // NumberOfFullyPaidUpEquityShares value
}

function buildXbrl(shpNs: string, scheme: string, scrip: string, date: string, cats: Cat[]): string {
  const ctx = (c: Cat) =>
    `<xbrli:context id="${c.id}">` +
    `<xbrli:entity><xbrli:identifier scheme="${scheme}">${scrip}</xbrli:identifier></xbrli:entity>` +
    `<xbrli:period><xbrli:instant>${date}</xbrli:instant></xbrli:period>` +
    `<xbrli:scenario><xbrldi:explicitMember dimension="in-bse-shp:CategoryOfShareholdersAxis">in-bse-shp:${c.member}</xbrldi:explicitMember></xbrli:scenario>` +
    `</xbrli:context>`;
  const pctFact = (c: Cat) =>
    c.pct === undefined
      ? ""
      : `<in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="${c.id}" unitRef="pure" decimals="INF">${c.pct}</in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares>`;
  const shareFact = (c: Cat) =>
    c.shares === undefined
      ? ""
      : `<in-bse-shp:NumberOfFullyPaidUpEquityShares contextRef="${c.id}" unitRef="shares" decimals="INF">${c.shares}</in-bse-shp:NumberOfFullyPaidUpEquityShares>`;

  return (
    `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" ` +
    `xmlns:in-bse-shp="${shpNs}" ` +
    `xmlns:xbrldi="http://xbrl.org/2006/xbrldi">` +
    cats.map(ctx).join("") +
    cats.map(pctFact).join("") +
    cats.map(shareFact).join("") +
    `</xbrli:xbrl>`
  );
}

// ── Fixtures (values captured from the real filings) ──────────────────────────

// A) 2025-10-31 — FRACTIONS, _ContextI ids (LICI 2026-06-01)
const XBRL_2025_10 = buildXbrl(
  "http://www.bseindia.com/xbrl/shp/2025-10-31/in-bse-shp",
  "http://www.bseindia.com/in-bse-shp/ScripCode",
  "543526",
  "2026-06-01",
  [
    { id: "ShareholdingPattern_ContextI", member: "ShareholdingPatternMember", shares: 12649995402 },
    { id: "ShareholdingOfPromoterAndPromoterGroup_ContextI", member: "ShareholdingOfPromoterAndPromoterGroupMember", pct: 0.965, shares: 12207245562 },
    { id: "PublicShareholding_ContextI", member: "PublicShareholdingMember", pct: 0.035 },
    { id: "InstitutionsForeign_ContextI", member: "InstitutionsForeignMember", pct: 0.0032 },
    { id: "InstitutionsDomestic_ContextI", member: "InstitutionsDomesticMember", pct: 0.0108 },
    { id: "MutualFundsOrUTI_ContextI", member: "MutualFundsOrUTIMember", pct: 0.0094 },
    { id: "InsuranceCompanies_ContextI", member: "InsuranceCompaniesMember", pct: 0.0004 },
    { id: "Banks_ContextI", member: "BanksMember", pct: 0.0005 },
    { id: "NonInstitutions_ContextI", member: "NonInstitutionsMember", pct: 0.0209 },
  ],
);

// B) 2025-05-31 — PERCENT, _ContextI ids (BAJFINANCE 2025-06-30)
const XBRL_2025_05 = buildXbrl(
  "http://www.bseindia.com/xbrl/shp/2025-05-31/in-bse-shp",
  "http://www.bseindia.com/in-bse-shp/ScripCode",
  "500034",
  "2025-06-30",
  [
    { id: "ShareholdingPattern_ContextI", member: "ShareholdingPatternMember", shares: 6214286520 },
    { id: "ShareholdingOfPromoterAndPromoterGroup_ContextI", member: "ShareholdingOfPromoterAndPromoterGroupMember", pct: 54.73, shares: 3401225450 },
    { id: "PublicShareholding_ContextI", member: "PublicShareholdingMember", pct: 45.24 },
    { id: "InstitutionsForeign_ContextI", member: "InstitutionsForeignMember", pct: 21.71 },
    { id: "InstitutionsDomestic_ContextI", member: "InstitutionsDomesticMember", pct: 14.59 },
  ],
);

// C) 2022-09-30 — PERCENT, "I"-suffix ids (KAYNES 2025-06-24).
//    Includes real distractor contexts to prove EXACT-match correctness:
//    OtherInstitutionsForeignI (0) must NOT be picked for fii, and
//    IndianFinancialInstitutionsOrBanksI (1.5) must NOT be picked for banks.
const XBRL_2022_09 = buildXbrl(
  "http://www.bseindia.com/xbrl/shp/2022-09-30/in-bse-shp",
  "http://www.nseindia.com/NSESymbol",
  "KAYNES",
  "2025-06-24",
  [
    { id: "ShareholdingPatternI", member: "ShareholdingPatternMember", shares: 66957093 },
    { id: "ShareholdingOfPromoterAndPromoterGroupI", member: "ShareholdingOfPromoterAndPromoterGroupMember", pct: 53.52, shares: 35838533 },
    { id: "PublicShareholdingI", member: "PublicShareholdingMember", pct: 46.48 },
    { id: "InstitutionsForeignI", member: "InstitutionsForeignMember", pct: 10.67 },
    { id: "OtherInstitutionsForeignI", member: "OtherInstitutionsForeignMember", pct: 0 }, // distractor
    { id: "InstitutionsDomesticI", member: "InstitutionsDomesticMember", pct: 21.93 },
    { id: "MutualFundsOrUtiI", member: "MutualFundsOrUtiMember", pct: 18.2 },
    { id: "InsuranceCompaniesI", member: "InsuranceCompaniesMember", pct: 2.19 },
    { id: "BanksI", member: "BanksMember", pct: 0 },
    { id: "IndianFinancialInstitutionsOrBanksI", member: "IndianFinancialInstitutionsOrBanksMember", pct: 1.5 }, // distractor
    { id: "NonInstitutionsI", member: "NonInstitutionsMember", pct: 13.87 },
  ],
);

// ── Tiny assert harness ───────────────────────────────────────────────────────

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  const ok = cond;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const approx = (a: number | null, b: number, tol = 0.011) =>
  a != null && Math.abs(a - b) <= tol;

// ── Run ───────────────────────────────────────────────────────────────────────

console.log("=".repeat(72));
console.log("DUAL-VINTAGE XBRL PARSER — unit harness");
console.log("=".repeat(72));

// A) 2025-10-31 (fraction → normalised to percent)
console.log("\n[A] 2025-10-31  (fractions → percent)  — LICI structure");
const a = parseXbrlShareholding(XBRL_2025_10);
console.log(`    parsed: promoter=${a.promoterPct} public=${a.publicPct} fii=${a.fiiPct} dii=${a.diiPct} retail=${a.retailPct} mf=${a.mutualFundPct} ins=${a.insurancePct} banksFis=${a.banksFisPct} total=${a.totalShares} promSh=${a.promoterShares}`);
check("fii NON-NULL and normalised to percent (0.0032 → 0.32)", approx(a.fiiPct, 0.32), `got ${a.fiiPct}`);
check("dii normalised to percent (0.0108 → 1.08)", approx(a.diiPct, 1.08), `got ${a.diiPct}`);
check("mutualFund normalised (0.0094 → 0.94)", approx(a.mutualFundPct, 0.94), `got ${a.mutualFundPct}`);
check("retail NON-NULL & = public-fii-dii (≈2.10)", approx(a.retailPct, 2.1), `got ${a.retailPct}`);
check("promoter+public ≈ 100", approx(a.promoterPct + a.publicPct, 100, 0.05), `got ${a.promoterPct + a.publicPct}`);
check("fii ≤ public", a.fiiPct != null && a.fiiPct <= a.publicPct);
check("dii ≤ public", a.diiPct != null && a.diiPct <= a.publicPct);
check("share counts populate", a.totalShares === 12649995402 && a.promoterShares === 12207245562);
check("normalisation actually happened (fii NOT left as 0.0032)", !approx(a.fiiPct, 0.0032));

// B) 2025-05-31 (percent-native → unchanged)
console.log("\n[B] 2025-05-31  (percent-native, unchanged)  — BAJFINANCE structure");
const b = parseXbrlShareholding(XBRL_2025_05);
console.log(`    parsed: promoter=${b.promoterPct} public=${b.publicPct} fii=${b.fiiPct} dii=${b.diiPct} retail=${b.retailPct} total=${b.totalShares} promSh=${b.promoterShares}`);
check("fii unchanged (stays 21.71 — no false rescale)", approx(b.fiiPct, 21.71), `got ${b.fiiPct}`);
check("dii unchanged (14.59)", approx(b.diiPct, 14.59), `got ${b.diiPct}`);
check("promoter unchanged (54.73)", approx(b.promoterPct, 54.73), `got ${b.promoterPct}`);
check("promoter+public ≈ 100", approx(b.promoterPct + b.publicPct, 100, 0.05), `got ${b.promoterPct + b.publicPct}`);
check("fii ≤ public", b.fiiPct != null && b.fiiPct <= b.publicPct);
check("share counts populate", b.totalShares === 6214286520 && b.promoterShares === 3401225450);

// C) 2022-09-30 (I-suffix fallback → gap closed)
console.log("\n[C] 2022-09-30  (I-suffix fallback, gap closed)  — KAYNES structure");
const c = parseXbrlShareholding(XBRL_2022_09);
console.log(`    parsed: promoter=${c.promoterPct} public=${c.publicPct} fii=${c.fiiPct} dii=${c.diiPct} retail=${c.retailPct} mf=${c.mutualFundPct} ins=${c.insurancePct} banksFis=${c.banksFisPct} total=${c.totalShares} promSh=${c.promoterShares}`);
check("fii NON-NULL via InstitutionsForeignI (10.67)", approx(c.fiiPct, 10.67), `got ${c.fiiPct}`);
check("fii EXACT-matched (not OtherInstitutionsForeignI=0)", c.fiiPct !== 0);
check("dii NON-NULL (21.93)", approx(c.diiPct, 21.93), `got ${c.diiPct}`);
check("mutualFund via MutualFundsOrUtiI casing (18.2)", approx(c.mutualFundPct, 18.2), `got ${c.mutualFundPct}`);
check("insurance via InsuranceCompaniesI (2.19)", approx(c.insurancePct, 2.19), `got ${c.insurancePct}`);
check("banksFis = BanksI(0), NOT IndianFinancialInstitutionsOrBanksI(1.5)", c.banksFisPct === 0, `got ${c.banksFisPct}`);
check("retail NON-NULL & = public-fii-dii (≈13.88)", approx(c.retailPct, 13.88), `got ${c.retailPct}`);
check("promoter+public = 100", approx(c.promoterPct + c.publicPct, 100, 0.05), `got ${c.promoterPct + c.publicPct}`);
check("fii ≤ public", c.fiiPct != null && c.fiiPct <= c.publicPct);
check("dii ≤ public", c.diiPct != null && c.diiPct <= c.publicPct);
check("share counts populate via I-suffix (66957093 / 35838533)", c.totalShares === 66957093 && c.promoterShares === 35838533);

console.log("\n" + "=".repeat(72));
console.log(failures === 0 ? "ALL CHECKS PASSED ✓" : `${failures} CHECK(S) FAILED ✗`);
console.log("=".repeat(72));
process.exit(failures === 0 ? 0 : 1);
