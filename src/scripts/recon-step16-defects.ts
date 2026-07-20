// ═══════════════════════════════════════════════════════════════
// STEP 16 — GATE 0, PROBE 4 (READ-ONLY). PIN THE DEFECTS.
//
// The danger probe found the draft normalizer SPLITTING funds by plan — a family key ending
// "- regular - payout of" means the strip STOPPED mid-phrase, orphaning a preposition and
// stranding the plan word inside the key. Direct and Regular then land in DIFFERENT families:
// the exact "a fund's variant split off" failure the brief forbids.
//
// THE QA METRIC THIS ESTABLISHES: after a correct normalization, NO family key may still contain
// a plan word (direct/regular). A key containing one is PROOF of a split. Count = 0 is the target.
//
// Writes NOTHING.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);
const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));

rule("D1. THE SPLIT BUG — the RAW names behind the 'payout of' orphan keys");
for (const r of await q(
  `SELECT amfi_scheme_code AS c, scheme_name AS n FROM instruments
   WHERE asset_class='mutual_fund' AND scheme_name ILIKE '%Retirement Fund%30%'
   ORDER BY scheme_name LIMIT 10`)) console.log(`  [${r.c}] ${JSON.stringify(r.n)}`);

rule("D1b. EVERY DISTINCT 'payout/reinvestment of ...' TAIL — the exact legalese AMFI publishes");
for (const r of await q(`
  SELECT DISTINCT substring(scheme_name from '(?i)((?:payout|re-?investment)\\s+of\\s+.*)$') AS tail, COUNT(*) AS n
  FROM instruments WHERE asset_class='mutual_fund'
    AND scheme_name ~* '(payout|re-?investment)\\s+of\\s'
  GROUP BY 1 ORDER BY n DESC LIMIT 25`))
  console.log(`  ${String(Number(r.n)).padStart(4)}  ${JSON.stringify(r.tail)}`);

rule("D1c. ALL distinct tails after the LAST hyphen — the option vocabulary, measured exhaustively");
for (const r of await q(`
  SELECT lower(btrim(regexp_replace(scheme_name, '^.*-', ''))) AS tail, COUNT(*) AS n
  FROM instruments WHERE asset_class='mutual_fund' AND scheme_name LIKE '%-%'
  GROUP BY 1 HAVING COUNT(*) >= 12 ORDER BY n DESC LIMIT 60`))
  console.log(`  ${String(Number(r.n)).padStart(4)}  ${JSON.stringify(r.tail)}`);

rule("D3. BONUS — is 'Bonus' ever IDENTITY (not followed by Option/Plan)?");
const b = await q(`
  SELECT amfi_scheme_code AS c, scheme_name AS n FROM instruments
  WHERE asset_class='mutual_fund' AND scheme_name ~* '\\mbonus\\M'
    AND scheme_name !~* 'bonus\\s*(option|plan)' ORDER BY scheme_name LIMIT 12`);
console.log(`  schemes with "Bonus" NOT followed by Option/Plan: ${b.length}`);
for (const r of b) console.log(`  [${r.c}] ${r.n}`);
const [bt] = await q(`SELECT COUNT(*) AS n FROM instruments WHERE asset_class='mutual_fund' AND scheme_name ~* '\\mbonus\\M'`);
console.log(`  total schemes containing "Bonus": ${Number(bt.n)}`);

rule("D4. INSTITUTIONAL / RETAIL — is the parent fund ALSO present? (i.e. would we be splitting?)");
for (const r of await q(`
  SELECT amfi_scheme_code AS c, scheme_name AS n FROM instruments
  WHERE asset_class='mutual_fund' AND scheme_name ~* '\\m(institutional|retail)\\M'
  ORDER BY scheme_name LIMIT 12`)) console.log(`  [${r.c}] ${r.n}`);

rule("D5. THE SPOT-CHECK SET — the REAL names of India's biggest funds (the prompt's are renamed)");
for (const probe of ["HDFC Large Cap", "SBI Large Cap", "Axis Large Cap", "HDFC Flexi Cap",
                     "SBI Small Cap", "Nippon India Small Cap", "HDFC Balanced Advantage"]) {
  console.log(`\n  ── "${probe}" ──`);
  const hits = await q(
    `SELECT amfi_scheme_code AS c, scheme_name AS n FROM instruments
     WHERE asset_class='mutual_fund' AND scheme_name ILIKE $1 ORDER BY amfi_scheme_code`, `${probe}%`);
  if (!hits.length) console.log("     (none)");
  for (const r of hits) console.log(`     [${r.c}] ${r.n}`);
}

await prisma.$disconnect();
