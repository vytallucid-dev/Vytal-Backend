// ═══════════════════════════════════════════════════════════════
// STAGE 7b GATE — the discovery rules, against REAL sample URLs. Offline, instant.
//
//   npx tsx src/scripts/stage7b-discovery-verify.ts
//
// Every classifier turns a URL into a PERIOD, and a period that is wrong by one
// year is invisible downstream: the PDF parses fine, the numbers are real, and the
// row lands on the wrong quarter. Nothing later in the lane can catch that — the
// fence checks we do not OVERWRITE, not that we filed correctly.
//
// So each site's fiscal-year convention is asserted here against a URL actually
// observed on that site, INCLUDING the Q4 roll (FY2026 Q1 ends 2025-06-30 but
// FY2026 Q4 ends 2026-03-31 — the calendar year advances only for Q4), and
// including the negative cases each `keep` filter exists to exclude.
// ═══════════════════════════════════════════════════════════════
import { wantedCode, selectUrls } from "./stage7b-worklist.js";
import { SITES, type SiteConfig } from "../ingestions/quaterly-results/irdai/irdai-discovery.js";

let fails = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  if (!ok) fails++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};
const site = (s: string): SiteConfig => SITES.find((x) => x.symbol === s)!;

function expect(sym: string, url: string, want: { periodEnd: string; grain: string; basis?: string } | null, label = ""): void {
  const cfg = site(sym);
  const keptOk = want === null ? true : cfg.keep(url);
  const got = cfg.keep(url) ? cfg.classify(url, label) : null;
  if (want === null) {
    check(`${sym}: rejects ${url.split("/").slice(-2).join("/").slice(0, 52)}`, got === null,
      got ? `but got ${got.periodEnd} ${got.grain}` : "");
    return;
  }
  const ok = keptOk && got !== null && got.periodEnd === want.periodEnd && got.grain === want.grain &&
    (want.basis === undefined || got.basis === want.basis);
  check(`${sym}: ${url.split("/").slice(-2).join("/").slice(0, 46)} -> ${want.periodEnd} ${want.grain}`, ok,
    got ? `got ${got.periodEnd} ${got.grain} ${got.basis}` : "classified as null");
}

console.log("\n=== STAGE 7b GATE — discovery classification (offline) ===\n");

console.log("-- ICICIPRULI: fy<label>/fy<label>q<n>/ --");
expect("ICICIPRULI", "https://www.iciciprulife.com/content/dam/icicipru/about-us/PublicDisclosures/fy2026/fy2026q1/Standalone_Q1_FY_26.pdf",
  { periodEnd: "2025-06-30", grain: "quarterly", basis: "standalone" });
expect("ICICIPRULI", "https://www.iciciprulife.com/content/dam/icicipru/about-us/PublicDisclosures/fy2026/fy2026q2/Consolidated_Q2_FY_26.pdf",
  { periodEnd: "2025-09-30", grain: "quarterly", basis: "consolidated" });
expect("ICICIPRULI", "https://www.iciciprulife.com/content/dam/icicipru/about-us/PublicDisclosures/FY2027/FY2027Q1/Standalone_Q1.pdf",
  { periodEnd: "2026-06-30", grain: "quarterly", basis: "standalone" });
// THE Q4 ROLL — the calendar year advances only here.
expect("ICICIPRULI", "https://www.iciciprulife.com/content/dam/icicipru/about-us/PublicDisclosures/fy2026/fy2026q4/Standalone_Q4.pdf",
  { periodEnd: "2026-03-31", grain: "quarterly" });
// "yearly" carries governance documents too — those must NOT become annual rows.
expect("ICICIPRULI", "https://www.iciciprulife.com/content/dam/icicipru/about-us/PublicDisclosures/fy2026/yearly/Discharge_of_stewardship_responsibility_March_2026.pdf", null);
expect("ICICIPRULI", "https://www.iciciprulife.com/content/dam/icicipru/about-us/PublicDisclosures/fy2026/yearly/Standalone_Financial_Statements.pdf",
  { periodEnd: "2026-03-31", grain: "annual" });
expect("ICICIPRULI", "https://www.iciciprulife.com/content/dam/icicipru/brochures/ICICI_Pru_Wealth.pdf", null);

console.log("\n-- GODIGIT: <span>/q<n>/ where the FY label is the SECOND year --");
expect("GODIGIT", "https://www.godigit.com/content/dam/godigit/directportal/en/financials/2017-2018/q3/nl-1.pdf",
  { periodEnd: "2017-12-31", grain: "quarterly" });
expect("GODIGIT", "https://www.godigit.com/content/dam/godigit/directportal/en/financials/2023-2024/q1/NL-1-B-RA.pdf",
  { periodEnd: "2023-06-30", grain: "quarterly" });
expect("GODIGIT", "https://www.godigit.com/content/dam/godigit/directportal/en/financials/2023-2024/q4/nl-2.pdf",
  { periodEnd: "2024-03-31", grain: "quarterly" });
expect("GODIGIT", "https://www.godigit.com/content/dam/godigit/directportal/en/financials/2023-2024/annual/report.pdf",
  { periodEnd: "2024-03-31", grain: "annual" });
expect("GODIGIT", "https://www.godigit.com/content/dam/godigit/en/brochures/motor.pdf", null);

console.log("\n-- HDFCLIFE: FY<label>/{Q1,H1,9M,FY} are CUMULATIVE folders --");
expect("HDFCLIFE", "https://www.hdfclife.com/content/dam/x/public-disclosure/FY2026/Q1/Website-publication-life-Quarter-ended-June-2025.pdf",
  { periodEnd: "2025-06-30", grain: "quarterly" });
expect("HDFCLIFE", "https://www.hdfclife.com/content/dam/x/public-disclosure/FY2026/H1/Website-publication-life-Quarter-ended-September-2025-V1.pdf",
  { periodEnd: "2025-09-30", grain: "quarterly" });
expect("HDFCLIFE", "https://www.hdfclife.com/content/dam/x/public-disclosure/FY2026/9M/Website-publication-life-Quarter-ended-December-2025-Final-v2.pdf",
  { periodEnd: "2025-12-31", grain: "quarterly" });
expect("HDFCLIFE", "https://www.hdfclife.com/content/dam/x/public-disclosure/FY2026/FY/Website-publication-life-Quarter-ended-March-26.pdf",
  { periodEnd: "2026-03-31", grain: "annual" });
expect("HDFCLIFE", "https://www.hdfclife.com/content/dam/x/about-us/pdf/agent-list.pdf", null);

console.log("\n-- CANHLIFE: month+year in the FILENAME; other-disclosure/ excluded --");
expect("CANHLIFE", "https://www.canarahsbclife.com/content/dam/chli/pdf/public-disclosure/disclosure/67/website-disclosures-june-2025.pdf",
  { periodEnd: "2025-06-30", grain: "quarterly" });
expect("CANHLIFE", "https://www.canarahsbclife.com/content/dam/chli/pdf/public-disclosure/disclosure/12/website-disclosures-march-2024.pdf",
  { periodEnd: "2024-03-31", grain: "quarterly" });
// Daily ULIP reconciliations live under other-disclosure/ and are hundreds of non-periodic files.
expect("CANHLIFE", "https://www.canarahsbclife.com/content/dam/chli/pdf/public-disclosure/other-disclosure/reconciliation-of-ulip/daily-31-oct-2013.pdf", null);
// A non-quarter month is not a periodic disclosure.
expect("CANHLIFE", "https://www.canarahsbclife.com/content/dam/chli/pdf/public-disclosure/disclosure/9/website-disclosures-august-2024.pdf", null);

console.log("\n-- the ADDITIONAL folder shapes each site also uses --");
// Every one of these was observed live and was previously unclassified. They are the
// difference between indexing one year and indexing eight.
expect("ICICIPRULI", "https://x/PublicDisclosures/FY2024/FY2024_Q1_Standalone/f.pdf",
  { periodEnd: "2023-06-30", grain: "quarterly", basis: "standalone" });
expect("ICICIPRULI", "https://x/PublicDisclosures/FY2024/FY2024_Q3_Consolidated/f.pdf",
  { periodEnd: "2023-12-31", grain: "quarterly", basis: "consolidated" });
expect("GODIGIT", "https://x/financials/2017-2018/quater1/nl-1.pdf",
  { periodEnd: "2017-06-30", grain: "quarterly" });
expect("GODIGIT", "https://x/financials/q12018-2019/Nl%201.pdf",
  { periodEnd: "2018-06-30", grain: "quarterly" });
expect("GODIGIT", "https://x/financials/q32018-19/nl-3.pdf",
  { periodEnd: "2018-12-31", grain: "quarterly" });
expect("GODIGIT", "https://x/financials/public-disclosure/fy-24-25/quarter-1/nl-1.pdf",
  { periodEnd: "2024-06-30", grain: "quarterly" });
expect("GODIGIT", "https://x/financials/2017-2018/nl-17.pdf",
  { periodEnd: "2018-03-31", grain: "annual" });

console.log("\n-- the Q4 roll, stated once more as a property --");
for (const [sym, u, want] of [
  ["ICICIPRULI", "https://x/PublicDisclosures/fy2025/fy2025q4/Standalone_Q4.pdf", "2025-03-31"],
  ["GODIGIT", "https://x/financials/2024-2025/q4/nl-1.pdf", "2025-03-31"],
  ["HDFCLIFE", "https://x/public-disclosure/FY2025/FY/f.pdf", "2025-03-31"],
] as [string, string, string][]) {
  const got = site(sym).classify(u, "");
  check(`${sym}: FY-label Q4 ends ${want} (calendar year advances)`, got?.periodEnd === want, `got ${got?.periodEnd}`);
}


console.log("\n-- the FORM-CODE filter: L1 is not L10 --");
// ICICIPRULI publishes L1..L44 as separate files. Wanting L-1/L-2/L-3 while
// matching "L1" as a substring pulls L10-L14 in too: five wasted fetches per
// unit, on 13 units, whose forms would then refuse to parse. The `(?![0-9])`
// is the whole defence -- `\b` cannot be used because `_` is a word character,
// so `L1_Consolidated` would never terminate the match.
for (const [f, fam, want] of [
  ["L1_Consolidated.pdf", "life", 1], ["L2_Consolidated.pdf", "life", 2], ["L3_Consolidated.pdf", "life", 3],
  ["L10_Consolidated.pdf", "life", null], ["L11_Consolidated.pdf", "life", null],
  ["L13_Consolidated.pdf", "life", null], ["L44_Consolidated.pdf", "life", null],
  ["L-1-A-RA.pdf", "life", 1], ["L_02_Profit_Loss.pdf", "life", 2], ["l3.pdf", "life", 3],
  ["NL-1-B-RA.pdf", "general", 1], ["nl-2.pdf", "general", 2],
  ["NL 44 MOTOR THIRD PARTY.pdf", "general", null], ["NL 45 Grievance Disposal-1.pdf", "general", null],
  ["nl-17.pdf", "general", null],
  ["NL-1-B-RA.pdf", "life", null], ["L1_Consolidated.pdf", "general", null],
  ["Website-publication-life-Quarter-ended-June-2025.pdf", "life", null],
] as [string, "life" | "general", number | null][]) {
  const got = wantedCode(f, fam);
  check(`wantedCode(${f.slice(0, 32)}, ${fam}) = ${want}`, got === want, `got ${got}`);
}

console.log("\n-- bundle vs per-form --");
const bundle = selectUrls(["https://x/FY2026/Q1/Website-publication-life-June-2025.pdf"], "life");
check("a single unnamed PDF is a BUNDLE, kept whole", bundle.mode === "bundle" && bundle.urls.length === 1);
const perForm = selectUrls(
  ["https://x/L1_Consolidated.pdf", "https://x/L2_Consolidated.pdf", "https://x/L3_Consolidated.pdf",
   "https://x/L10_Consolidated.pdf", "https://x/L44_Consolidated.pdf"], "life");
check("a per-form set keeps exactly L1,L2,L3", perForm.mode === "per-form" && perForm.urls.length === 3,
  `kept ${perForm.urls.map((u) => u.split("/").pop()).join(",")}`);
const none = selectUrls(["https://x/NL%2044%20MOTOR.pdf", "https://x/NL%2045%20Grievance-1.pdf"], "general");
check("a per-form set with no wanted form yields NOTHING (not everything)", none.urls.length === 0,
  `kept ${none.urls.length}`);

console.log(`\n=== ${fails === 0 ? "GATE PASSED" : `GATE FAILED — ${fails} failure(s)`} ===\n`);
process.exit(fails ? 1 : 0);
