// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 0, PROBE 1 (READ-ONLY). What does a scheme_name ACTUALLY look like?
//
// Designing a name-normalizer against an IMAGINED name shape is exactly the trap Step 9's
// stateful-parse and Step 13's EQUITY_L series-code hit. So this writes nothing and assumes
// nothing. It just LOOKS.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

// ── A. THE UNIVERSE ────────────────────────────────────────────────────────
rule("A. THE UNIVERSE — what am I grouping?");
console.log(J(await q(`
  SELECT asset_class,
         COUNT(*)                                   AS rows,
         COUNT(DISTINCT amfi_scheme_code)           AS scheme_codes,
         COUNT(DISTINCT scheme_name)                AS scheme_names,
         COUNT(*) FILTER (WHERE scheme_name IS NULL) AS name_null,
         COUNT(DISTINCT fund_house)                 AS fund_houses
  FROM instruments GROUP BY 1 ORDER BY 2 DESC
`)));

// ── B. RAW SAMPLE — a wide spread of AMCs, unfiltered, verbatim ────────────
rule("B. RAW scheme_name SAMPLE — 60 rows spread across AMCs (verbatim, untouched)");
for (const r of await q(`
  SELECT DISTINCT ON (fund_house) fund_house, amfi_scheme_code, scheme_name, plan_type
  FROM instruments WHERE asset_class = 'mutual_fund' AND scheme_name IS NOT NULL
  ORDER BY fund_house, amfi_scheme_code LIMIT 60
`)) console.log(`  [${r.amfi_scheme_code}] ${r.scheme_name}   |house=${r.fund_house} |plan=${r.plan_type}`);

// ── C. ONE FUND, ALL ITS VARIANTS — the thing a family must capture ────────
rule("C. THE TARGET SHAPE — every scheme whose name contains a known big fund");
for (const probe of ["HDFC Top 100", "SBI Bluechip", "Parag Parikh Flexi", "Axis Bluechip", "Mirae Asset Large"]) {
  console.log(`\n  ── probe: "${probe}" ──`);
  for (const r of await q(
    `SELECT amfi_scheme_code, isin, scheme_name, plan_type FROM instruments
     WHERE asset_class='mutual_fund' AND scheme_name ILIKE $1 ORDER BY scheme_name`, `%${probe}%`))
    console.log(`    [${r.amfi_scheme_code}] ${r.scheme_name}`);
}

// ── D. THE SEPARATOR / TOKEN CENSUS — what punctuation actually delimits? ──
rule("D. SEPARATOR CENSUS — how are the parts of a name delimited?");
console.log(J(await q(`
  SELECT
    COUNT(*) FILTER (WHERE scheme_name LIKE '%-%')  AS has_hyphen,
    COUNT(*) FILTER (WHERE scheme_name LIKE '%(%')  AS has_paren,
    COUNT(*) FILTER (WHERE scheme_name LIKE '%,%')  AS has_comma,
    COUNT(*) FILTER (WHERE scheme_name LIKE '%_%')  AS has_underscore,
    COUNT(*) AS total
  FROM instruments WHERE asset_class='mutual_fund' AND scheme_name IS NOT NULL
`)));

// ── E. THE PLAN/OPTION TOKEN VOCABULARY — measured, not assumed ────────────
rule("E. PLAN / OPTION TOKEN FREQUENCY — the vocabulary I would have to strip");
const TOKENS = ["Direct", "Regular", "Dir ", "Reg ", "Growth", "IDCW", "Dividend", "Payout",
  "Reinvest", "Bonus", "Daily", "Weekly", "Fortnightly", "Monthly", "Quarterly", "Half Yearly",
  "Annual", "Option", "Plan", "Institutional", "Retail", "Segregated", "Unclaimed"];
for (const t of TOKENS) {
  const [r] = await q(
    `SELECT COUNT(*) AS n FROM instruments WHERE asset_class='mutual_fund' AND scheme_name ILIKE $1`, `%${t}%`);
  console.log(`  ${t.padEnd(16)} ${String(Number(r.n)).padStart(6)}`);
}

// ── F. THE OVER-MERGE HAZARD — names that are prefixes of other names ──────
rule("F. OVER-MERGE HAZARD — near-miss names that must NOT merge");
for (const probe of ["HDFC Top", "%FMP%Series%", "ICICI Prudential Nifty"]) {
  console.log(`\n  ── probe: "${probe}" ──`);
  for (const r of await q(
    `SELECT DISTINCT scheme_name FROM instruments
     WHERE asset_class='mutual_fund' AND scheme_name ILIKE $1 ORDER BY 1 LIMIT 14`,
    probe.includes("%") ? probe : `%${probe}%`)) console.log(`    ${r.scheme_name}`);
}

// ── G. ETFs — do they even HAVE plan variants? ─────────────────────────────
rule("G. ETFs — is an ETF 1-scheme-1-fund (no Direct/Regular)?");
console.log(J(await q(`
  SELECT COUNT(*) AS etf_rows,
         COUNT(*) FILTER (WHERE scheme_name ILIKE '%direct%') AS etf_with_direct,
         COUNT(*) FILTER (WHERE scheme_name ILIKE '%regular%') AS etf_with_regular,
         COUNT(*) FILTER (WHERE scheme_name IS NULL) AS etf_no_name
  FROM instruments WHERE asset_class='etf'
`)));
for (const r of await q(
  `SELECT symbol, scheme_name, name FROM instruments WHERE asset_class='etf' ORDER BY symbol LIMIT 12`))
  console.log(`    ${String(r.symbol).padEnd(14)} name=${r.name}  |scheme_name=${r.scheme_name}`);

await prisma.$disconnect();
