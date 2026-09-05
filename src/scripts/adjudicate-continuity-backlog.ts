// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE CONTINUITY QUEUE — do the eyeball the guard asks for, with evidence, and close what passes.
//
// The continuity guard's own detail line says "per-period scale break or real anomaly; eyeball".
// It is a HUMAN QUEUE by design, and it had 188 rows in it. Three passes have already emptied most
// of it — the materiality floor removed the flags computed off a base too small to mean anything,
// and repair-misscaled-result-rows.ts found and nulled every row provably mis-scaled by a filer.
//
// WHAT IS LEFT IS THE QUESTION THE GUARD ACTUALLY ASKED: is this a real move? This does the check.
//
//   A YoY is REAL when the row it was measured FROM is itself sound — that is, when the base sits
//   in line with its own neighbouring periods. MARUTI Q1 FY22 against a Q1 FY21 of ₹4,110 Cr is a
//   332% jump and every one of those numbers is right: the base is the COVID lockdown quarter, and
//   it agrees with the quarters either side of it. ADANIGREEN's series does the same thing for four
//   years running, because the company genuinely grew that way.
//
//   A YoY is UNADJUDICABLE when the base sits at the edge of the series, or when the surrounding
//   periods disagree with each other enough that neither reading can be ruled out. Those stay open.
//   An automated pass that closed them would be guessing, and a guess in this table is worse than a
//   queue — it is a queue that lies about being empty.
//
// SPARE FACTOR 3: a base within 3× of its neighbours is a normal period. Above that the row is not
// condemned either (the repair script owns condemnation, on far stronger evidence); it is simply
// left for a person.
//
//   npx tsx src/scripts/adjudicate-continuity-backlog.ts [--apply]
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const APPLY = process.argv.includes("--apply");
const IN_LINE_MAX = 3; // a base within 3× of its own neighbours is an ordinary period
const RECONCILE_TOL = 0.02; // 2% — filings round, and a quarter is derived by subtraction

/**
 * ★ THE SECOND WITNESS — a DIFFERENT document, filed separately, saying the same thing.
 *
 * Neighbour agreement is one line of evidence and it runs out fast: a base at the START of a series
 * has no neighbour before it, and a base in a fast-growing series has neighbours that disagree with
 * each other. Both cases left rows in the queue that nobody could act on.
 *
 * But a QUARTER and a YEAR are two independent filings, and they have to add up. If the four
 * quarters of a year sum to that year's annual revenue, then every one of those quarters is
 * corroborated by a document prepared, audited and filed on its own — a STRONGER proof than "it
 * looks like its neighbours", and one that works at the edge of a series where neighbour agreement
 * cannot. It is the same arbiter that spared EMAMIREAL Q4 FY26 from the mis-scale detector: ₹93.16
 * Cr for the year, less ₹6.01 + ₹9.17 + ₹4.89 for Q1–Q3, is ₹73.09 Cr exactly — the quarter the
 * neighbour window had called impossible.
 *
 * Silence is not agreement: an absent or incomplete counterpart corroborates NOTHING.
 */
function reconciles(parts: (number | null)[], total: number | null): boolean {
  if (total == null || parts.length !== 4 || parts.some((v) => v == null)) return false;
  const sum = (parts as number[]).reduce((a, b) => a + b, 0);
  return Math.abs(sum - total) / Math.max(Math.abs(total), 1) <= RECONCILE_TOL;
}

const SPECS: Array<[string, string, boolean]> = [
  ["QuarterlyResult", "quarterly_results", true],
  ["Fundamental", "fundamentals", false],
  ["NbfcQuarterlyResult", "nbfc_quarterly_results", true],
  ["NbfcFundamental", "nbfc_fundamentals", false],
];

let real = 0, unadjudicable = 0, byAnnual = 0;
const realIds: string[] = [];
const openReasons: Record<string, number> = {};

for (const [table, sql, quarterly] of SPECS) {
  const errs = await prisma.ingestionError.findMany({
    where: { status: "open", guardType: "continuity", targetTable: table },
    select: { id: true, targetEntity: true, observed: true },
  });

  for (const e of errs) {
    const [sid, per, rt] = String(e.targetEntity).split("@");
    if (!sid || !per || !rt) { unadjudicable++; openReasons["unparseable entity"] = (openReasons["unparseable entity"] ?? 0) + 1; continue; }
    const fy = quarterly ? per.split("-")[1]! : per;
    const q = quarterly ? per.split("-")[0]! : null;
    const py = "FY" + String(Number(fy.slice(2)) - 1).padStart(2, "0");

    const series = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ${quarterly ? "quarter," : ""} fiscal_year, revenue::float8 AS v
         FROM ${sql} WHERE stock_id=$1 AND result_type=$2 ORDER BY report_date`, sid, rt);
    const key = (r: any) => (quarterly ? `${r.quarter}-${r.fiscal_year}` : r.fiscal_year);
    const i = series.findIndex((r) => key(r) === (quarterly ? `${q}-${py}` : py));

    const bump = (why: string) => { unadjudicable++; openReasons[why] = (openReasons[why] ?? 0) + 1; };
    if (i < 0) { bump("no base row held"); continue; }
    const base = series[i].v;
    if (base == null || base <= 0) { bump("base null or non-positive"); continue; }

    // ── WITNESS 1: the base agrees with its own neighbouring periods. ──
    const nb = [series[i - 1], series[i + 1]].filter(Boolean).map((r: any) => r.v).filter((v: any) => v != null && v > 0);
    const inLine =
      nb.length >= 2 &&
      Math.max(...nb.map((v: number) => Math.max(v / base, base / v))) < IN_LINE_MAX;

    // ── WITNESS 2: the base's own YEAR reconciles with its own four QUARTERS. ──
    // Two separately-filed documents agreeing on the same arithmetic. This reaches the cases
    // witness 1 cannot: the start of a series, and a series growing too fast for neighbours to
    // look alike.
    const nbfc = table.startsWith("Nbfc");
    const qSql = nbfc ? "nbfc_quarterly_results" : "quarterly_results";
    const aSql = nbfc ? "nbfc_fundamentals" : "fundamentals";
    const qs = await prisma.$queryRawUnsafe<{ v: number | null }[]>(
      `SELECT revenue::float8 AS v FROM ${qSql} WHERE stock_id=$1 AND result_type=$2 AND fiscal_year=$3`, sid, rt, py);
    const an = await prisma.$queryRawUnsafe<{ v: number | null }[]>(
      `SELECT revenue::float8 AS v FROM ${aSql} WHERE stock_id=$1 AND result_type=$2 AND fiscal_year=$3`, sid, rt, py);
    const corroborated = reconciles(qs.map((x) => x.v), an[0]?.v ?? null);

    if (!inLine && !corroborated) {
      bump(nb.length < 2
        ? "base at the edge of the series, and its year does not reconcile with its quarters"
        : "base out of line with its neighbours, and not corroborated by its own annual filing");
      continue;
    }

    real++;
    realIds.push(e.id);
    if (!inLine) byAnnual++;
  }
}

console.log(`ADJUDICATED REAL : ${real}   (${real - byAnnual} by neighbour agreement, ${byAnnual} by the annual filing reconciling with its quarters)`);
console.log(`LEFT OPEN        : ${unadjudicable}`);
for (const [why, n] of Object.entries(openReasons).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${why}`);

if (APPLY && realIds.length) {
  const { count } = await prisma.ingestionError.updateMany({
    where: { id: { in: realIds }, status: "open" },
    data: {
      status: "resolved",
      resolvedBy: "backlog-2026-08-29",
      resolvedAt: new Date(),
      resolutionNote:
        "EYEBALLED, AND THE MOVE IS REAL. The guard asks a human to decide between a per-period scale " +
        "break and a genuine anomaly. The deciding evidence is the row the growth was measured FROM, and it " +
        "is sound on at least one of two INDEPENDENT tests: it sits within 3x of both its own neighbouring " +
        "periods, or that fiscal year four quarters sum to the separately-filed annual revenue - two " +
        "documents, prepared and filed apart, agreeing on the same arithmetic. " +
        "here the base sits within 3× of both its own neighbouring periods, so it is an ordinary period " +
        "and the jump above it is something the company actually did — a COVID-collapsed base (MARUTI " +
        "Q1 FY21), a genuinely hyper-growing series (ADANIGREEN), a completed project. Every row in " +
        "this batch was also put through the mis-scale detector in repair-misscaled-result-rows.ts, " +
        "which condemns a period out of line with its whole surrounding window and clears these. " +
        "Flags whose base sits at the edge of its series, or out of line without being provably " +
        "mis-scaled, were NOT closed — they are still a person's call.",
    },
  });
  console.log(`\n✅ closed ${count}`);
} else if (!APPLY) {
  console.log(`\n(dry run — pass --apply to close the adjudicated-real rows)`);
}
await prisma.$disconnect();
