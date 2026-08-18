// ═══════════════════════════════════════════════════════════════
// STAGE 3b — THE 442 COHORT DEFINITION. Shared by preflight, run, audit.
//
// The cohort is DERIVED from the DB, not hand-listed: every active stock whose
// industryType is non_financial or banking. The 62 nbfc / life_insurance /
// general_insurance stocks are OUT — no live scoring consumer, and they defer
// with their retention floors.
//
// ⚠ TO_DATE is the ONLY protection for v3-era rows. T3d proved the legacy path
//   hardcodes the "ingest" decision, never consults decideIngest, and would
//   stamp nse_xbrl_*_legacy over good v3 rows. 2025-01-31 sits in the clean gap
//   between the legacy ceiling (2024-12-31) and the v3 floor (2025-03-31).
//   It must be passed on EVERY invocation.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

export const FROM_DATE = "2017-04-01";
export const TO_DATE = "2025-01-31";
export const IN_SCOPE = ["non_financial", "banking"] as const;

export interface CohortStock {
  id: string;
  symbol: string;
  industryType: string;
  fiscalYearEnd: string;
}

export async function loadCohort(): Promise<CohortStock[]> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT "id", "symbol", "industryType"::text AS "industryType", "fiscalYearEnd"::text AS "fiscalYearEnd"
       FROM stocks
      WHERE "is_active" = true AND "industryType"::text = ANY($1::text[])
      ORDER BY "symbol" ASC`,
    IN_SCOPE as unknown as string[],
  )) as CohortStock[];
  return rows;
}
