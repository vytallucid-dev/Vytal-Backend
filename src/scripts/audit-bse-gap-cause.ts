// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AUDIT PART 2 — FOR EACH GAP, IS IT A WRITER OMISSION OR A SOURCE LIMITATION? Read-only.
//
//   npx tsx src/scripts/audit-bse-gap-cause.ts
//
// Part 1 found columns the NSE lanes fill and the BSE lane does not. That list mixes two completely
// different things, and treating them the same would be the mistake:
//
//   (a) THE WRITER NEVER NAMES THE COLUMN.  Structurally unfillable — no BSE row can ever carry a
//       value, no matter what the filing says. This is the `operating_profit` defect exactly.
//
//   (b) THE WRITER NAMES IT AND IT IS STILL EMPTY.  The lane tried; the document did not carry the
//       number, or the extractor could not find it. A different problem with a different fix, and
//       often not a problem at all — a quarterly results filing does not contain a balance sheet.
//
// The writer's column set is `BSE_COLUMNS` — verify-bse-writer-parity.ts asserts on every build that
// it is exactly the set the INSERT statements name, so it is a faithful stand-in for the writer.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { BSE_COLUMNS } from "../ingestions/quaterly-results/bse/bse-column-fill.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const NOT_A_DATA_CELL = new Set([
  "id", "stock_id", "symbol", "quarter", "fiscal_year", "report_date", "filing_date",
  "result_type", "xbrl_url", "source", "xbrl_taxonomy", "audit_pending", "created_at", "updated_at",
]);
/** Below this many BSE rows a fill percentage is noise, not evidence. */
const MIN_ROWS = 20;

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`AUDIT 2 — writer omission (structurally unfillable) vs source/extraction gap`);
  console.log("=".repeat(104));

  const unfillable: Array<{ t: string; c: string; nse: number }> = [];
  const tried: Array<{ t: string; c: string; bse: number; nse: number }> = [];

  for (const [t, pairs] of Object.entries(BSE_COLUMNS)) {
    const written = new Set(pairs.map(([, col]) => col));
    const cols = (await raw<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, t))
      .map((c) => c.column_name).filter((c) => !NOT_A_DATA_CELL.has(c));

    const counts = await raw<Record<string, string>>(`
      SELECT count(*) FILTER (WHERE source = 'bse_xbrl')::text AS __nbse,
             count(*) FILTER (WHERE source <> 'bse_xbrl' OR source IS NULL)::text AS __nnse,
             ${cols.map((c) => `count("${c}") FILTER (WHERE source = 'bse_xbrl')::text AS "b_${c}",
                                count("${c}") FILTER (WHERE source <> 'bse_xbrl' OR source IS NULL)::text AS "n_${c}"`).join(",\n             ")}
        FROM "${t}"`);
    const r = counts[0];
    const nBse = Number(r.__nbse), nNse = Number(r.__nnse);
    if (nBse < MIN_ROWS) { console.log(`\n  ${t}  — only ${nBse} BSE row(s), too few to judge; skipped`); continue; }

    const gapsW: string[] = [], gapsS: string[] = [];
    for (const c of cols) {
      const b = (Number(r[`b_${c}`]) / nBse) * 100;
      const n = nNse ? (Number(r[`n_${c}`]) / nNse) * 100 : 0;
      if (n < 40 || b >= 5) continue;
      if (written.has(c)) { gapsS.push(`${c} (nse ${n.toFixed(0)}%)`); tried.push({ t, c, bse: b, nse: n }); }
      else { gapsW.push(`${c} (nse ${n.toFixed(0)}%)`); unfillable.push({ t, c, nse: n }); }
    }
    console.log(`\n  ${t}  (${nBse} BSE rows · writer names ${written.size} column(s))`);
    console.log(`     (a) NOT NAMED BY THE WRITER — can never be filled: ${gapsW.length}`);
    for (const g of gapsW.slice(0, 60)) console.log(`         ${g}`);
    console.log(`     (b) named but empty — document or extractor: ${gapsS.length}`);
    for (const g of gapsS.slice(0, 60)) console.log(`         ${g}`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  (a) STRUCTURALLY UNFILLABLE (the operating_profit class): ${unfillable.length}`);
  console.log(`  (b) named by the writer but empty anyway:                 ${tried.length}`);
  console.log("");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
