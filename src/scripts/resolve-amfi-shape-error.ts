// One-off operator action: RESOLVE the AMFI shape error raised by the first run.
//
// WHAT HAPPENED (real, not synthetic): AMFI 302-redirects www.amfiindia.com →
// portal.amfiindia.com. node's https.get does NOT follow redirects, so the first run
// fetched 0 bytes. The shape guard fired (critical / source_code) and REFUSED to write —
// exactly the fail-closed behaviour it exists for. Had it not, a 0-row file would have
// been treated as "AMFI published nothing today".
//
// THE FIX WAS SOURCE_CODE (as the guard said it must be): fetchNavAll now follows redirects,
// bounded to 3 hops and HTTPS-only. The subsequent run ingested 17,567 rows.
//
// So this error is CLOSED the way the lifecycle intends — resolved with a citation, not
// deleted. The row stays as history.
//   npx tsx src/scripts/resolve-amfi-shape-error.ts
import { prisma } from "../db/prisma.js";

const open = await prisma.ingestionError.findMany({
  where: { cron: "daily_amfi_nav", guardType: "shape", status: "open" },
  select: { id: true, observed: true, occurrences: true },
});

for (const e of open) {
  console.log(`resolving shape error ${e.id} — observed "${e.observed}" (×${e.occurrences})`);
  await prisma.ingestionError.update({
    where: { id: e.id },
    data: {
      status: "resolved",
      resolvedBy: "step9-build",
      resolvedAt: new Date(),
      resolutionCitation: "AMFI 302 www.amfiindia.com → portal.amfiindia.com (verified via curl -I)",
      resolutionNote:
        "Fetch returned 0 bytes because https.get does not follow redirects. Fixed in source: " +
        "fetchNavAll() now follows redirects (max 3 hops, HTTPS-only). Re-run ingested 17,567 rows. " +
        "The guard behaved correctly — it refused to write an empty file.",
    },
  });
}

console.log(`✅ resolved ${open.length} shape error(s).`);
await prisma.$disconnect();
