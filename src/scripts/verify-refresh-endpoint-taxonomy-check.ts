// Smoke-test the refreshIndustryTypes + findIndustryTaxonomyDisagreements pairing exactly as
// runRefreshIndustryTypes (the admin controller) now calls them, without spinning up the HTTP server.
import { prisma } from "../db/prisma.js";
import { refreshIndustryTypes, refreshFiscalYearEnds, findIndustryTaxonomyDisagreements } from "../seed/industry-types.js";

async function main() {
  const result = await refreshIndustryTypes({ dryRun: true }); // dry-run: don't mutate in a smoke test
  const fy = await refreshFiscalYearEnds();
  const taxonomyDisagreements = await findIndustryTaxonomyDisagreements();
  console.log(JSON.stringify({ success: true, data: result, fiscalYearEndResult: fy, taxonomyDisagreements }, null, 2));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
