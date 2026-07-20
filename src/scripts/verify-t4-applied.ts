// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// T-4 — THE FIX, AS APPLIED IN LIVE DATA. The DATA-side twin of verify-t4-guard.ts (the CODE-side gate).
//
// verify-t4-guard.ts proves the code: the y5 window now SURFACES vol5y, so a hardcoded `vol: null` fails.
// backfill-t4-y5-dryrun.ts proved the NEGATIVE against the DB: flip == 0 — no row ships a 5y drawdown
// while its 1y/3y series is impossible. But flip == 0 is only meaningful if the contaminated cohort still
// EXISTS and its dd5 is NULL because it was WITHHELD — not because those funds simply have no 5y history.
// This asserts the POSITIVE, and a NEGATIVE CONTROL:
//
//   A · the vol-contaminated cohort is NON-EMPTY               (flip==0 is not vacuous)
//   B · NOT ONE of them ships a 5y drawdown                    (the invariant — the flip, restated)
//   C · every one that HAS a y5 window carries the y5 WITHHELD marker on max_drawdown_5y
//        (positive proof the guard's vol5y test FIRED — the exact path T-4 wired; under old code, a
//         side-pocket with dd5==0 and a fine 5y CAGR would NOT have been withheld and would ship the 0)
//   D · NEGATIVE CONTROL — a TRUE 0% drawdown (overnight/liquid, uncontaminated) is NEVER withheld.
//        The guard keys on the impossibility, NEVER on the value 0. (cv2-t4-guard-not-blind.)
//   E · refusal-nesting holds — |dd5| >= |dd3| wherever both survive (cv2-s10a-refusal-nesting).
//
//   npx tsx src/scripts/verify-t4-applied.ts   (reads mf_analytics only; NO writes)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));
const q = <T = any>(s: string) => prisma.$queryRawUnsafe<T[]>(s);
const N = (x: any) => Number(x);

async function main() {
  // The vol-contaminated cohort = a fund whose SHORTER window (1y or 3y) was already withheld for
  // impossible volatility. Its 5y series CONTAINS that impossible stretch, so vol5y is impossible too —
  // which is exactly the fact the OLD y5 window (vol: null) could not see, and T-4 restored.
  const CONTAM = `(omissions::jsonb->>'vol_1y' = 'withheld_implausible' OR omissions::jsonb->>'vol_3y' = 'withheld_implausible')`;
  const Y5_WITHHELD = `omissions::jsonb->>'max_drawdown_5y' = 'withheld_implausible'`;

  const [r] = await q(`
    SELECT
      (SELECT count(*) FROM mf_analytics WHERE ${CONTAM})                                            AS cohort,
      (SELECT count(*) FROM mf_analytics WHERE ${CONTAM} AND max_drawdown_5y IS NOT NULL)            AS ships_dd5,
      (SELECT count(*) FROM mf_analytics WHERE ${CONTAM} AND ${Y5_WITHHELD})                         AS cohort_y5_withheld,
      (SELECT count(*) FROM mf_analytics WHERE ${Y5_WITHHELD})                                       AS all_y5_withheld,
      (SELECT count(*) FROM mf_analytics WHERE max_drawdown_5y = 0)                                  AS true_zeros,
      (SELECT count(*) FROM mf_analytics WHERE max_drawdown_5y = 0 AND ${Y5_WITHHELD})               AS zeros_wrongly_withheld,
      (SELECT count(*) FROM mf_analytics WHERE max_drawdown_5y = 0 AND ${CONTAM})                    AS zeros_contaminated,
      (SELECT count(*) FROM mf_analytics WHERE max_drawdown_5y IS NOT NULL AND max_drawdown_3y IS NOT NULL
                                          AND abs(max_drawdown_5y) < abs(max_drawdown_3y))           AS nesting_violations
  `);

  rule("A · THE COHORT EXISTS — flip==0 is not vacuous (there ARE vol-impossible funds to withhold)");
  ok("★ vol-contaminated cohort is NON-EMPTY (a 1y/3y series ruled impossible still exists)",
    N(r.cohort) > 0, `${N(r.cohort)} funds withheld at y1/y3 for impossible volatility`);

  rule("B · THE INVARIANT — not one contaminated fund ships a 5y drawdown (T-4, restated positively)");
  ok("★★ NO vol-contaminated fund ships max_drawdown_5y (== the dry-run's flip)",
    N(r.ships_dd5) === 0, `${N(r.ships_dd5)} contaminated funds still carry a 5y drawdown (must be 0)`);

  rule("C · POSITIVE — the y5 window was ACTIVELY WITHHELD on the cohort (the vol5y path T-4 wired FIRED)");
  ok("★★ the contaminated cohort's max_drawdown_5y carries the withheld_implausible marker (not merely NULL)",
    N(r.cohort_y5_withheld) > 0 && N(r.cohort_y5_withheld) === N(r.cohort),
    `${N(r.cohort_y5_withheld)}/${N(r.cohort)} contaminated funds have y5 actively withheld` +
    (N(r.cohort_y5_withheld) === N(r.cohort) ? " (all)" : " — a gap means a contaminated fund's y5 escaped the guard"));
  console.log(`       (context: ${N(r.all_y5_withheld)} funds total have y5 withheld across all causes — vol/dd/cagr)`);

  rule("D · NEGATIVE CONTROL — a TRUE 0% drawdown is NEVER withheld. The guard keys on impossibility, not on 0");
  ok("★★ no true-zero drawdown fund is withheld (an overnight fund really never fell — the 0 survives)",
    N(r.zeros_wrongly_withheld) === 0, `${N(r.true_zeros)} funds carry a real dd5==0; ${N(r.zeros_wrongly_withheld)} wrongly withheld (must be 0)`);
  ok("★ and none of those true zeros is vol-contaminated (every surviving 0 is a clean 0)",
    N(r.zeros_contaminated) === 0, `${N(r.zeros_contaminated)} contaminated zeros survived (must be 0)`);

  rule("E · REFUSAL-NESTING — |dd5| >= |dd3| wherever both survive (a longer window can't be shallower)");
  ok("★ nesting holds: no fund's 5y drawdown is shallower than its 3y drawdown",
    N(r.nesting_violations) === 0, `${N(r.nesting_violations)} violations of |dd5| >= |dd3| (must be 0)`);

  console.log("\n" + "═".repeat(96));
  console.log(fail === 0 ? "  ✅ T-4 — APPLIED AND HONEST IN LIVE DATA" : `  ❌ ${fail} FAILURE(S)`);
  console.log("═".repeat(96));
  await prisma.$disconnect();
  process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
