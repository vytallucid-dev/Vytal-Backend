// ─────────────────────────────────────────────────────────────
// STEP 14 — close the ONE stale fault the build left behind.
//
// The first version of the distribution parser required a currency token ("Rs") before the
// declared total. SEITINVIT's 30-Jul-2025 record declares its total WITHOUT one:
//     "Distribution - 3.04316 Consisting Of Interest Rs 3.04013 Per Unit / Other Income - Rs 0.00303"
// so the parser refused a record it should have read — a FALSE REFUSAL that cost a real trust its
// yield, and raised a validity fault against NSE for something that was our bug.
//
// The parser is fixed (currency token optional; the total is now CHECKSUMMED against its own
// itemised components, 3.04013 + 0.00303 = 3.04316 ✓), SEITINVIT now carries a real yield, and the
// fault no longer reproduces. It is a source_code fault whose source_code fix has shipped — so it
// is RESOLVED, with the reason recorded. An open fault that cannot reproduce is just noise, and
// noise is how real faults get ignored.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";

const r = await prisma.ingestionError.updateMany({
  where: {
    cron: "reit_daily",
    guardType: "validity",
    targetEntity: "SEITINVIT",
    status: "open",
  },
  data: {
    status: "resolved",
    resolvedBy: "step-14",
    resolvedAt: new Date(),
    resolutionNote:
      "FALSE REFUSAL by the first parser: the subject DOES declare a per-unit total (3.04316), it " +
      "just omits the 'Rs' token. Parser fixed — the currency token is now optional, and the declared " +
      "total is checksummed against its itemised components (3.04013 + 0.00303 = 3.04316). SEITINVIT " +
      "now carries a real yield and this fault no longer reproduces.",
  },
});

console.log(`resolved ${r.count} stale fault(s)`);

const open = await prisma.ingestionError.count({ where: { cron: "reit_daily", status: "open" } });
console.log(`open reit_daily faults remaining: ${open}`);

await prisma.$disconnect();
