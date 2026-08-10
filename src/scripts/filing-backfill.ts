// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE FILING BACKFILL — the operator entry point for THE STANDING LAW.
//
//   Any change to a filing rule's logic or its constants requires a full backfill of all 504 stocks.
//   The law, and why it exists, is in src/scoring/findings/rules/BACKFILL-LAW.md — beside the rules,
//   where someone editing a threshold is actually standing.
//
//   npx tsx src/scripts/filing-backfill.ts --reason "P8 ratio 1.25 -> 1.40"
//   npx tsx src/scripts/filing-backfill.ts --symbols RELIANCE,TCS --reason "spot check"
//   npx tsx src/scripts/filing-backfill.ts --feeds annual --reason "R3 depth guard"
//   npx tsx src/scripts/filing-backfill.ts --reset-rule H --reason "window anchor corrected"
//   npx tsx src/scripts/filing-backfill.ts --dry-run
//
// ⚠ --symbols AND --feeds NARROW THE RUN AND DO NOT DISCHARGE THE LAW. They exist for a targeted
//   re-run while you are working. The law's default — no flags — is everything.
//
// ⚠ --reset-rule DELETES that rule's rows before recomputing, so the new rows have no prior period to
//   be compared against and cannot be stamped `newly_standing` by a change that was ours rather than
//   the company's. Only for logic now known to be WRONG. See the law.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { runFilingBackfill } from "../filing/pass.js";
import { FILING_REGISTRY, filingRulesForFeeds, type FilingFeed } from "../filing/registry.js";

const FEEDS: FilingFeed[] = ["shareholding", "annual", "quarterly", "insider", "blocks"];

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : null;
}
const list = (v: string | null): string[] => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

async function main() {
  const symbols = list(arg("symbols"));
  const feedsRaw = list(arg("feeds"));
  const resetRules = list(arg("reset-rule")).concat(list(arg("reset-rules")));
  const reason = arg("reason");
  const dryRun = process.argv.includes("--dry-run");

  const bad = feedsRaw.filter((f) => !FEEDS.includes(f as FilingFeed));
  if (bad.length) {
    console.error(`unknown feed(s) [${bad.join(", ")}] — expected any of ${FEEDS.join(", ")}`);
    process.exit(2);
  }
  const feeds = feedsRaw as FilingFeed[];
  const rules = feeds.length ? filingRulesForFeeds(feeds) : FILING_REGISTRY;

  console.log("════ FILING BACKFILL ════");
  console.log(`  scope : ${symbols.length ? `${symbols.length} symbol(s): ${symbols.join(", ")}` : "the ACTIVE UNIVERSE"}`);
  console.log(`  rules : ${rules.length} of ${FILING_REGISTRY.length} — ${rules.map((r) => r.ruleRef).join(", ")}`);
  if (resetRules.length) console.log(`  reset : ${resetRules.join(", ")} — existing rows DELETED before recompute (false-transition guard)`);
  console.log(`  reason: ${reason ?? "(none given)"}`);
  if (!reason && !dryRun) {
    console.log(`\n  ⚠ NO --reason. Not fatal, but the run leaves no record of WHY the rows were rewritten,`);
    console.log(`    which is the one thing a future reader of a moved verdict will want.`);
  }
  if (symbols.length || feeds.length) {
    console.log(`\n  ⚠ THIS IS A NARROWED RUN AND DOES NOT DISCHARGE THE STANDING LAW.`);
    console.log(`    A rule-logic or constant change needs the unflagged form. See rules/BACKFILL-LAW.md.`);
  }

  if (dryRun) {
    const n = await prisma.stock.count({ where: { isActive: true } });
    console.log(`\n  DRY RUN — would run ${rules.length} rule(s) over ${symbols.length || n} stock(s). Nothing written.`);
    await prisma.$disconnect();
    return;
  }

  const t0 = Date.now();
  let lastPct = -1;
  const r = await runFilingBackfill({
    symbols: symbols.length ? symbols : undefined,
    feeds: feeds.length ? feeds : undefined,
    resetRules: resetRules.length ? resetRules : undefined,
    onProgress: (done, total, symbol) => {
      const pct = Math.floor((done / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        process.stdout.write(`\r  ${String(pct).padStart(3)}%  ${done}/${total}  ${symbol.padEnd(14)}`);
      }
    },
  });
  process.stdout.write("\r" + " ".repeat(60) + "\r");

  console.log(`\n  stocks processed : ${r.stocks}`);
  console.log(`  rows upserted    : ${r.written}`);
  console.log(`  rule-runs with no filing period to key on: ${r.skippedNoPeriod}`);
  console.log(`  failed           : ${r.failed.length}`);
  r.failed.slice(0, 20).forEach((f) => console.log(`    ${f.symbol}: ${f.error}`));
  console.log(`  duration         : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`\n════ ${r.failed.length === 0 ? "COMPLETE" : `COMPLETE WITH ${r.failed.length} FAILURE(S)`} ════`);
  await prisma.$disconnect();
  process.exit(r.failed.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
