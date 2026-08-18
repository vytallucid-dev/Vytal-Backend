// ═══════════════════════════════════════════════════════════════
// S4.4a/b — ENRIN: establish the CAUSE, then test whether the S4.3 fix corrects it.
// READ-ONLY, in memory. Fetches the stored xbrl_url of each row directly (ENRIN's
// rows are v3-sourced, so they are not in the legacy listing).
//   npx tsx src/scripts/_s44-enrin.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
import { deriveFiscalPeriod } from "../ingestions/quaterly-results/xbrl/parser-common.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const grab = (xml: string, tag: string) => {
  for (const ns of ["in-bse-fin", "in-capmkt"]) {
    const m = new RegExp(`<${ns}:${tag}\\b[^>]*>([^<]*)</${ns}:${tag}>`, "i").exec(xml);
    if (m) return m[1].trim();
  }
  return null;
};
const D = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S4.4a — ENRIN: what do its OWN documents declare?                          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const rows = await raw<any>(
    `SELECT q."fiscal_year" fy, q."quarter" qq, q."report_date"::text rd, q."source" src, q."xbrl_url" u
       FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
      WHERE st."symbol"='ENRIN' AND q."result_type"='standalone' ORDER BY q."report_date"`);

  console.log(`  ${pad("report_date", 13)}${pad("stored", 9)}${pad("declared FY window", 28)}${pad("NEW label", 11)}verdict`);
  let wouldThrow = 0, wouldFix = 0, unchanged = 0, unreachable = 0;
  for (const r of rows) {
    let xml: string;
    try { xml = await fetchXbrlFile(r.u); }
    catch (e) { unreachable++; console.log(`  ${pad(String(r.rd).slice(0, 10), 13)}${pad(r.fy + r.qq, 9)}document unreachable (${(e as Error).message.slice(0, 34)})`); continue; }
    const s = grab(xml, "DateOfStartOfFinancialYear");
    const e2 = grab(xml, "DateOfEndOfFinancialYear");
    const pe = grab(xml, "DateOfEndOfReportingPeriod") ?? String(r.rd).slice(0, 10);
    const win = s && e2 ? `${s} .. ${e2}` : "(tags absent)";
    let neu = "—", verdict = "";
    if (s && e2) {
      try {
        const x = deriveFiscalPeriod(D(pe)!, D(s)!, D(e2)!, "quarterly");
        neu = x.fiscalYear + x.quarter;
        if (neu === r.fy + r.qq) { unchanged++; verdict = "unchanged"; }
        else { wouldFix++; verdict = "⚠ CHANGES — S4.3 relabels this row"; }
      } catch (err) {
        wouldThrow++; neu = "THROW";
        verdict = `⚠ S4.3 REJECTS: ${(err as Error).message.slice(0, 60)}`;
      }
    }
    console.log(`  ${pad(String(r.rd).slice(0, 10), 13)}${pad(r.fy + r.qq, 9)}${pad(win, 28)}${pad(neu, 11)}${verdict}`);
    await new Promise((z) => setTimeout(z, 350));
  }

  console.log(`\n  ── S4.4b — WOULD THE S4.3 FIX CORRECT ENRIN? ──`);
  console.log(`  rows unchanged by the fix        : ${unchanged}`);
  console.log(`  rows the fix RELABELS            : ${wouldFix}`);
  console.log(`  rows the fix REJECTS (throws)    : ${wouldThrow}`);
  console.log(`  documents unreachable            : ${unreachable}`);
  if (wouldThrow) {
    console.log(`\n  ⚠ A THROW IS A BEHAVIOUR CHANGE WORTH RULING ON. The old code silently`);
    console.log(`    mislabelled an incoherent window; the new code refuses it. That is`);
    console.log(`    fail-loud rather than fail-quiet, but the row would NOT INGEST at all.`);
    console.log(`    See S4.3e — the validity guard should decide this, not the deriver.`);
  }
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
