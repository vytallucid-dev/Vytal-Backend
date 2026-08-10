// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// VERIFY INDUSTRY TAXONOMY — the validation pass classification-hardening asked for.
//
// Compares every stock's CURRENT Stock.industryType against the taxonomy namespace its own most
// recently scanned filing actually declared (ground truth: result_fetch_logs "Industry mismatch"
// rows — see findIndustryTaxonomyDisagreements in src/seed/industry-types.ts for the full method
// and its scope/blind-spot notes). Read-only. Reports EVERY disagreement, named.
//
// This is deliberately a STANDALONE reporting script, not a gate: SYMBOL_OVERRIDES is
// hand-maintained on purpose (a taxonomy mismatch needs a human to decide the correction, exactly
// the way BAJAJHLDNG's wrong "non_financial" override sat confidently wrong until someone checked
// it against the filed XBRL) — so this never writes. The SAME check also runs automatically inside
// POST /api/v1/admin/results-scan/refresh-industry-types (taxonomyDisagreements in its response),
// so a disagreement surfaces passively on every admin click too. Two surfaces, one function —
// see findIndustryTaxonomyDisagreements.
//
//   npx tsx src/scripts/verify-industry-taxonomy.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { findIndustryTaxonomyDisagreements } from "../seed/industry-types.js";

async function main() {
  console.log("════ INDUSTRY TAXONOMY VALIDATION ════");
  console.log("Comparing every stock's Stock.industryType against the taxonomy namespace its own");
  console.log("most-recently-scanned filing declared (result_fetch_logs 'Industry mismatch' trail).\n");

  const disagreements = await findIndustryTaxonomyDisagreements();

  if (disagreements.length === 0) {
    console.log("✅ No disagreements — every stock with a recorded filing matches its own filed taxonomy.");
  } else {
    console.log(`❌ ${disagreements.length} disagreement(s):\n`);
    for (const d of disagreements) {
      const period = d.fiscalYear ? `${d.fiscalYear}${d.quarter && d.quarter !== "Y" ? d.quarter : ""}` : "?";
      console.log(
        `  ${d.symbol.padEnd(12)} classified=${d.currentIndustryType.padEnd(18)} filed=${d.filedTaxonomy.padEnd(18)} ` +
          `(${d.basis}, ${period}, seen ${d.fetchedAt.toISOString().slice(0, 10)})`,
      );
    }
    console.log(
      "\n  Fix: add/correct a SYMBOL_OVERRIDES entry in src/scripts/industry-type-utils.ts, then run",
    );
    console.log("  refresh-industry-types (script or the admin endpoint) to apply it.");
  }

  console.log(
    "\n  ⚠ Scope: this only sees stocks that have been scanned at least once and hit a mismatch.",
  );
  console.log(
    "    A never-scanned stock produces no signal either way — unobserved, not confirmed correct.",
  );

  await prisma.$disconnect();
  process.exit(disagreements.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
