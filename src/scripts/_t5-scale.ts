// ═══════════════════════════════════════════════════════════════
// T5.5 — THE SIX SCALE ANOMALIES. READ-ONLY.
//   T5.5a raw tag / unit / decimals / context, and the arithmetic raw → stored
//   T5.5b ⚠ decimals is deliberately IGNORED (xbrl/extract.ts:10-13) — check
//         whether any of these declare a decimals that CONTRADICTS the unit
//   T5.5c verdict per row: document defect (keep) or our misreading (fix)
//   npx tsx src/scripts/_t5-scale.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const CUT = process.env.T4_CUT ?? "2026-08-16 09:30:03";
const CR = 1e7;
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function occ(xml: string, tag: string) {
  const out: { ctx: string; unit: string; dec: string; val: number }[] = [];
  const re = new RegExp(`<in-bse-fin:${tag}\\b([^>]*)>([^<]*)</in-bse-fin:${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({
      ctx: /contextRef="([^"]+)"/.exec(m[1])?.[1] ?? "-",
      unit: /unitRef="([^"]+)"/.exec(m[1])?.[1] ?? "-",
      dec: /decimals="([^"]+)"/.exec(m[1])?.[1] ?? "-",
      val: parseFloat(m[2]),
    });
  }
  return out;
}

async function main() {
  const rows = await raw<any>(
    `SELECT st."symbol" s, q."quarter" qq, q."fiscal_year" fy, q."result_type" rt,
            q."revenue"::float8 rev, q."net_profit"::float8 np, q."xbrl_url" u, q."report_date"::text rd
       FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
      WHERE q."stock_id" IN (SELECT "id" FROM stocks WHERE "symbol" = ANY($1::text[]))
        AND q."revenue" IS NOT NULL AND q."revenue" < 100
      ORDER BY q."revenue" LIMIT 8`, (await import("./_t4-cohort-def.js")).COHORT.map((c) => c.symbol));

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T5.5 — SCALE ANOMALIES: ${String(rows.length).padStart(2)} newly-written quarterly rows, revenue < ₹100 Cr ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  parser rule (xbrl/extract.ts:10-13): unitRef is authoritative; decimals is IGNORED.`);
  console.log(`    unitRef="INR" → value / 1e7 = ₹Cr · "pure"/"shares" → as-is\n`);

  const verdicts: string[] = [];
  for (const r of rows) {
    let xml: string;
    try { xml = await fetchXbrlFile(r.u); } catch (e) { console.log(`  ${r.s} ${r.fy} ${r.qq}: unreachable`); continue; }
    console.log(`  ── ${r.s} ${r.fy} ${r.qq} ${r.rt} (period end ${String(r.rd).slice(0, 10)})`);
    console.log(`     stored: revenue=${r.rev} Cr · net_profit=${r.np} Cr`);

    let contradiction = false, arithmeticOk = true;
    // ⚠ net_profit tag preference MUST mirror the parser (parser-legacy-common.ts:158-161):
    //   consolidated → ProfitOrLossAttributableToOwnersOfParent ?? ProfitLossForPeriod
    //   standalone   → ProfitLossForPeriod
    // Comparing against ProfitLossForPeriod alone falsely flags a consolidated row whose
    // stored value legitimately came from the attributable-to-owners tag.
    const npTags = r.rt === "consolidated"
      ? ["ProfitOrLossAttributableToOwnersOfParent", "ProfitLossForPeriod"]
      : ["ProfitLossForPeriod"];
    for (const [tag, stored] of [["RevenueFromOperations", r.rev], [npTags.join("|"), r.np]] as const) {
      const cands = tag.split("|");
      let one: ReturnType<typeof occ>[number] | undefined;
      let usedTag = cands[0];
      for (const t of cands) {
        const hit = occ(xml, t).find((o) => o.ctx === "OneD");
        if (hit) { one = hit; usedTag = t; break; }
      }
      void usedTag;
      if (!one) { console.log(`     ${pad(tag, 26)} (no OneD occurrence)`); continue; }
      const computed = one.unit === "INR" ? one.val / CR : one.val;
      const match = Math.abs(computed - Number(stored)) < 0.02;
      if (!match) arithmeticOk = false;
      console.log(`     ${pad(usedTag, 26)} raw=${pad(one.val, 16)} unit=${pad(one.unit, 6)} decimals=${pad(one.dec, 5)} ctx=OneD`);
      console.log(`     ${pad("", 26)} arithmetic: ${one.val} ${one.unit === "INR" ? "/ 1e7" : "(no division — non-INR unit)"} = ${computed.toFixed(2)} → stored ${stored}  ${match ? "✓ matches" : "✗ MISMATCH"}`);
      // T5.5b — does `decimals` contradict the unit?
      // decimals=-N means "accurate to the nearest 10^N RUPEES". It is a PRECISION
      // hint, never a scale factor. A contradiction would be a decimals implying the
      // value is already in crore (e.g. a positive decimals on a crore-sized number).
      const d = parseInt(one.dec, 10);
      if (Number.isFinite(d)) {
        const impliedPrecision = Math.pow(10, -d);
        // ⚠ A ZERO value carries no scale information — 0 can never clear a magnitude
        // threshold, so the consistency test is vacuous for it and must not fail it.
        const consistent = one.unit !== "INR" || one.val === 0 || Math.abs(one.val) >= impliedPrecision / 10;
        console.log(`     ${pad("", 26)} decimals=${one.dec} ⇒ precise to ₹${impliedPrecision.toLocaleString()} — ${consistent ? "consistent with a rupee-denominated value ✓" : "⚠ INCONSISTENT with unit=INR"}`);
        if (!consistent) contradiction = true;
      }
    }

    const [nb] = await raw<any>(
      `SELECT count(*)::int n, round(avg("revenue"))::text avg FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
        WHERE st."symbol"=$1 AND q."result_type"=$2 AND q."revenue" >= 100`, r.s, r.rt);
    console.log(`     neighbours (same symbol+basis, revenue ≥ 100 Cr): n=${nb.n} mean ${nb.avg} Cr`);
    const verdict = !arithmeticOk ? "✗ OUR MISREADING — arithmetic does not reproduce the stored value"
      : contradiction ? "✗ OUR MISREADING — decimals contradicts unitRef"
      : "✓ DOCUMENT DEFECT — parser applied the document's own declared unit correctly; KEEP";
    console.log(`     VERDICT: ${verdict}`);
    console.log(`     ${r.u}\n`);
    verdicts.push(`${r.s} ${r.fy} ${r.qq} ${r.rt}: ${verdict}`);
    await sleep(350);
  }

  console.log(`  ── T5.5c SUMMARY ──`);
  for (const v of verdicts) console.log(`    ${v}`);
  const bad = verdicts.filter((v) => v.includes("MISREADING")).length;
  console.log(`\n  ${bad === 0 ? "✓ all are document defects — parser reading is correct, KEEP per Aman's ruling" : `✗ ${bad} are OUR misreading and need fixing`}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
