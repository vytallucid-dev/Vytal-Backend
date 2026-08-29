// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PERIOD TRAP — and the basis assertion.
//
// ★ A MARCH FILING OF A MARCH-FY COMPANY CARRIES BOTH GRAINS IN ONE DOCUMENT:
//     OneD  = 2023-01-01 → 2023-03-31   (Q4 ONLY,  89 days)
//     FourD = 2022-04-01 → 2023-03-31   (FULL YEAR, 364 days)
//   BOTH declare DateOfEndOfReportingPeriod = 2023-03-31. MEASURED on ACC FY23, identical in the
//   NSE legacy copy and the BSE copy of the same filing.
//
//   ⚠ So the end date CANNOT distinguish them, and reading OneD for an annual row yields a Q4 number
//     that is the right company, the right basis and the right end date — and one quarter of the
//     truth. No arithmetic check catches it, because the number is internally consistent. This is the
//     S4.3 failure shape.
//
//   ★ THE ONLY DISCRIMINATOR IS THE DURATION. That is what this file asserts, per row grain, from the
//     context the parser actually read. It is a cheap check and it is the whole defence.
//
// The same document is legitimately used for the Q4 quarterly row AND the annual row — that is the
// one real 2-for-1 in this lane. Nothing here forbids that; it forbids reading the WRONG HALF.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Grain } from "./bse-discovery.js";

// ⚠ THE FACT PREFIX IS PER-DOCUMENT, NOT A CONSTANT — Stage 7a, 2026-08-25.
// Insurance filings carry the SAME context names (OneD/OneI/FourD/FourI) and the
// SAME date tags as every other filing, under a DIFFERENT prefix (`in-capmkt`,
// from bseindia.com/xbrl/…/GeneralInsurance or sebi.gov.in/xbrl/…/IntegratedFinance_LI).
// With the prefix hardcoded, readDate returned null for both dates and this guard
// reported "cannot prove" on 80 units whose periods were sitting right there.
import { factNs } from "../legacy/parser-legacy-common.js";

/** Quarter-grain durations seen in real filings: 89–92 days. Annual: 364–366. Bands are deliberately
 *  tight — a half-year or 9-month context must FAIL, not be rounded into the nearest grain. */
const DURATION_BAND: Record<Grain, { min: number; max: number; ctx: string }> = {
  quarterly: { min: 84, max: 95, ctx: "OneD" },
  annual: { min: 358, max: 372, ctx: "FourD" },
};

export interface PeriodAssertion {
  ok: boolean;
  grain: Grain;
  contextId: string;
  start: string | null;
  end: string | null;
  days: number | null;
  declaredBasis: string | null;
  failures: string[];
}

/**
 * The INSTANT counterpart of a duration context: OneD -> OneI, FourD -> FourI.
 *
 * ⚠ WHY THIS EXISTS. The GeneralInsurance/2018-11-30 taxonomy tags its reporting
 *   period dates against the INSTANT contexts while its facts sit in the DURATION
 *   ones — ICICIGI FY19 carries DateOfStartOfReportingPeriod only under OneI/FourI.
 *   Every other family puts both in the duration context. Without this the guard
 *   reads null for both dates and reports "cannot prove" on a period it is looking
 *   straight at, which is what blocked 72 general-insurance units.
 *
 *   The fallback is SAFE because it does not weaken the assertion: whatever dates
 *   it finds are still range-checked against the requested period and the grain's
 *   duration band below. It only widens WHERE the dates may be found, never what
 *   counts as proof.
 */
const INSTANT_OF: Record<string, string> = { OneD: "OneI", FourD: "FourI" };

function readDate(xml: string, tag: string, ctx: string): string | null {
  const direct = readDateIn(xml, tag, ctx);
  if (direct !== null) return direct;
  const inst = INSTANT_OF[ctx];
  return inst ? readDateIn(xml, tag, inst) : null;
}

function readDateIn(xml: string, tag: string, ctx: string): string | null {
  const NS = factNs(xml);
  const re = new RegExp(`<${NS}:${tag}\\b[^>]*?contextRef="${ctx}"[^>]*?>([^<]+)</${NS}:${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  const d = m[1].trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return d ? d[1] : null;
}

function readText(xml: string, tag: string): string | null {
  const NS = factNs(xml);
  const re = new RegExp(`<${NS}:${tag}\\b[^>]*?>([^<]+)</${NS}:${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Assert that the context the parser read for `grain` really spans that grain, that its end is the
 * period we asked for, and that the document's own basis assertion matches the URL field we chose.
 *
 * ⚠ FAILS LOUD. The caller must discard the document on `ok === false` — there is no partial credit,
 *   because every failure mode here produces a number that looks correct.
 */
export function assertPeriodAndBasis(
  xml: string,
  grain: Grain,
  expectedPeriodEnd: Date,
  expectedBasis: "standalone" | "consolidated",
): PeriodAssertion {
  const band = DURATION_BAND[grain];
  const start = readDate(xml, "DateOfStartOfReportingPeriod", band.ctx);
  const end = readDate(xml, "DateOfEndOfReportingPeriod", band.ctx);
  const declaredBasis = readText(xml, "NatureOfReportStandaloneConsolidated");
  const failures: string[] = [];

  let days: number | null = null;
  if (!start || !end) {
    failures.push(
      `context ${band.ctx} does not carry both DateOfStartOfReportingPeriod and ` +
        `DateOfEndOfReportingPeriod (start=${start} end=${end}) — cannot prove the grain`,
    );
  } else {
    days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
    if (days < band.min || days > band.max) {
      failures.push(
        `context ${band.ctx} spans ${days} days, outside the ${grain} band ` +
          `${band.min}–${band.max} — this is the period trap (a Q4 context read as a full year, or vice versa)`,
      );
    }
  }

  const wantEnd = expectedPeriodEnd.toISOString().slice(0, 10);
  if (end && end !== wantEnd) {
    failures.push(`document period end ${end} is not the requested period ${wantEnd}`);
  }

  if (!declaredBasis) {
    failures.push("document carries no NatureOfReportStandaloneConsolidated — basis cannot be confirmed");
  } else if (declaredBasis.trim().toLowerCase() !== expectedBasis) {
    failures.push(
      `document declares basis "${declaredBasis}" but it was fetched from the ${expectedBasis} URL field — ` +
        `the two must agree`,
    );
  }

  return {
    ok: failures.length === 0,
    grain,
    contextId: band.ctx,
    start,
    end,
    days,
    declaredBasis,
    failures,
  };
}
