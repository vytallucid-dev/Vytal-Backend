// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE MISS-LOG REPORT — "what are readers asking that has no family?"
//
// ★ THIS IS WHAT T-0 EXISTS FOR. §6.4 says the miss-log is what writes composition #199 "with
// evidence attached, not guesswork". T-22 says the family coverage plan is re-ordered from this log
// before each phase, because a family with rows beats a family with a number. This is the command
// that produces the rows.
//
//   npx tsx src/scripts/miss-log-report.ts [--days N] [--limit N] [--all-sources] [--include-harness]
//
// ── ★ THE DEFAULT EXCLUDES LEXICAL ROWS, AND THAT DEFAULT IS §6.5's RULING ────────────────────────
// A lexical `unresolved` is what we produce when we could not afford to ask the model. It lands in
// `clarify_operation` no matter how clear the question was, so counting it as evidence about the
// question attributes OUR budget to the READER. Read undivided, a week of quota denials looks
// exactly like a week of question shapes we cannot classify — and that is the reading that gets
// someone to build a family nobody needed. `--all-sources` shows the whole log; the split is printed
// either way so the denial volume is never invisible.
//
// ── ★ AND IT IS UNBOUNDED BY DEFAULT ─────────────────────────────────────────────────────────────
// No `--days` means every row ever. The TAIL is the signal — a question shape asked three times in
// six months is exactly the miss a purpose-built family should answer — so a default window would
// hide the thing the table was created to collect.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  summariseMisses, topMissedQuestions, missShapes, missingDataCensus, sectionsAlmostServed,
} from "../composition/miss-log.js";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const days = arg("--days") ? Number(arg("--days")) : undefined;
const limit = arg("--limit") ? Number(arg("--limit")) : 25;
const modelOnly = !process.argv.includes("--all-sources");
// ★ HARNESS ROWS ARE EXCLUDED BY DEFAULT AND THEIR COUNT IS PRINTED ANYWAY (T-0b). A harness turn is
//   not demand; an exclusion you cannot see is indistinguishable from data never collected.
const readerOnly = !process.argv.includes("--include-harness");

const h = (s: string) => console.log(`\n══ ${s} ══`);
const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`);

async function main(): Promise<void> {
  const window = days ? `last ${days} days` : "all time";
  console.log(`\n★ MISS-LOG REPORT · ${window} · ${modelOnly ? "MODEL rows only (§6.5)" : "ALL sources"} · ${readerOnly ? "READER rows only" : "reader + harness"}`);

  const s = await summariseMisses(days, readerOnly);
  h("THE SPLIT (§6.5) — our budget vs the reader's question");
  console.log(`  rows                 ${s.total}`);
  console.log(`  window               ${s.firstAt ?? "—"}  →  ${s.lastAt ?? "—"}`);
  console.log(`  branch · generic     ${s.byBranch.generic}  (${pct(s.byBranch.generic, s.total)})   "we answered, but not well"`);
  console.log(`  branch · clarify     ${s.byBranch.clarify_operation}  (${pct(s.byBranch.clarify_operation, s.total)})   "we did not answer"`);
  console.log(`  source · model       ${s.bySource.model}  (${pct(s.bySource.model, s.total)})   evidence about the QUESTION`);
  console.log(`  source · lexical     ${s.bySource.lexical}  (${pct(s.bySource.lexical, s.total)})   evidence about OUR QUOTA — never a build reason`);
  console.log(`  origin · reader      ${s.byOrigin.reader}   ${readerOnly ? "← counted above" : ""}`);
  console.log(`  origin · harness     ${s.byOrigin.harness}   ${readerOnly ? "← EXCLUDED from everything above; a harness turn is not demand" : "← included (--include-harness)"}`);
  console.log(`  genuine clarifies    ${s.genuineClarifies}   (clarify AND model — the shapes with no home at all)`);
  if (s.degradedReasons.length) {
    console.log(`  degraded reasons     ${s.degradedReasons.join(" · ")}`);
  }
  if (s.total === 0) {
    console.log("\n  (empty — no generic or clarify_operation turn has been recorded yet)");
    await prisma.$disconnect();
    return;
  }

  h(`WHAT READERS ASK THAT HAS NO FAMILY — top ${limit}, ranked by DISTINCT READERS then asks`);
  const qs = await topMissedQuestions({ days, limit, modelOnly, readerOnly });
  if (!qs.length) console.log("  (none)");
  for (const q of qs) {
    console.log(`  ${String(q.readers).padStart(3)} rdr · ${String(q.asks).padStart(3)} ask · ${q.branches.join(",").padEnd(18)} ${JSON.stringify(q.sample)}`);
  }

  h("QUESTION SHAPES — (operation, lens) pairs landing here");
  for (const sh of await missShapes(days, modelOnly, readerOnly)) {
    console.log(`  ${String(sh.n).padStart(4)}  ${sh.operation} / ${sh.lens ?? "—"}`);
  }

  h("MISSING FAMILY vs MISSING DATA — one composition file, or an ingest project");
  const c = await missingDataCensus(days, readerOnly);
  console.log(`  generic rows                 ${c.genericRows}`);
  console.log(`  missing FAMILY only          ${c.missingFamilyOnly}  (${pct(c.missingFamilyOnly, c.genericRows)})  — we held the data and had no view`);
  console.log(`  named missing DATA lines:`);
  if (!c.namedMissingData.length) console.log("    (none — every generic miss was a missing family)");
  for (const m of c.namedMissingData) console.log(`    ${String(m.n).padStart(4)}  ${m.line}`);

  h("WHAT THE READER ALMOST GOT — sections the generic path assembled");
  const secs = await sectionsAlmostServed(days, readerOnly);
  if (!secs.length) console.log("  (none)");
  for (const x of secs) console.log(`  ${String(x.n).padStart(4)}  ${x.combo}`);

  console.log("\n  A purpose-built family has to beat the combination above. That is the bar this log sets.\n");
  await prisma.$disconnect();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
