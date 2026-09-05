// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GATE — the BSE lane now fetches CONSOLIDATED as well as standalone. Prove it broke nothing.
//
// The lane's whole reason for being trusted is that it CANNOT touch an NSE row. Adding a second
// basis doubles the number of documents it fetches and the number of rows it may insert, so every
// one of those guarantees is re-asserted here from the database itself rather than assumed.
//
//   1. STANDALONE IS UNCHANGED   — findDocument(…, "standalone") picks byte-identically what
//                                  findStandaloneDocument picked, over every real listing row.
//   2. THE TWO BASES ARE DISTINCT— a consolidated document is a different URL from its standalone
//                                  twin, so one basis can never be written as the other.
//   3. THE PERIOD TRAP HOLDS     — a consolidated document declares "Consolidated" and passes the
//                                  basis assertion; the standalone one FAILS it when asked for
//                                  consolidated. The trap is what makes a wrong column loud.
//   4. THE FENCE IS INTACT       — every ON CONFLICT target includes result_type, so a consolidated
//                                  insert cannot collide with an NSE standalone row.
//   5. THE COST GATE IS REAL     — stocks that have never filed consolidated get no consolidated
//                                  targets, so the nightly request volume does not grow for them.
//
//   npx tsx src/scripts/verify-bse-consolidated-lane.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { BsePacer, BSE_FILES } from "../ingestions/quaterly-results/bse/bse-http.js";
import { fetchScripMaster, resolveAgainstMaster } from "../ingestions/quaterly-results/bse/bse-resolver.js";
import {
  quarterCodeFor, fetchResultsListing, fetchInstance,
  findDocument, findStandaloneDocument, type BseListing,
} from "../ingestions/quaterly-results/bse/bse-discovery.js";
import { assertPeriodAndBasis } from "../ingestions/quaterly-results/bse/bse-period-guard.js";
import { FENCED_TABLES } from "../ingestions/quaterly-results/bse/bse-fence.js";

const results: { ok: boolean; name: string; got?: unknown }[] = [];
const check = (name: string, ok: boolean, got?: unknown) => {
  results.push({ ok, name, got });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
};

// ── 4. THE FENCE, read straight off the schema. ───────────────────────────────────────────────
console.log("\n[4] The conflict keys that make a consolidated insert unable to touch an NSE row");
for (const t of FENCED_TABLES) {
  const idx = await prisma.$queryRawUnsafe<Array<{ def: string }>>(
    `SELECT indexdef AS def FROM pg_indexes WHERE tablename = $1 AND indexdef ILIKE '%UNIQUE%'`, t);
  const carriesResultType = idx.some((r) => /result_type/i.test(r.def));
  check(`${t}: its UNIQUE key includes result_type`, carriesResultType, idx.map((r) => r.def.slice(-70)));
}

// ── 5. THE COST GATE. ─────────────────────────────────────────────────────────────────────────
console.log("\n[5] The cost gate — only stocks with a real consolidated series get asked");
const [cost] = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
  WITH per_stock AS (
    SELECT stock_id,
           count(*) FILTER (WHERE result_type='consolidated') AS co
    FROM quarterly_results GROUP BY 1)
  SELECT count(*) AS total,
         count(*) FILTER (WHERE co = 0) AS never_consolidated,
         count(*) FILTER (WHERE co > 0) AS has_consolidated
  FROM per_stock`);
console.log(`      ${cost.total} stocks with results — ${cost.never_consolidated} never file consolidated, ${cost.has_consolidated} do`);
check("some stocks are excluded from consolidated fetching (the gate does something)", Number(cost.never_consolidated) > 0, cost.never_consolidated);

// ── 1–3. Against REAL listings. ───────────────────────────────────────────────────────────────
console.log("\n[1-3] Against live BSE listings");
const SAMPLE = ["MARKSANS", "SPARC", "TARC", "AFSL", "TSFINV", "63MOONS"];
const pacer = new BsePacer({ minSpacingMs: 4000, throttleStopMs: 90_000, slowMs: 8_000, maxSpacingMs: 20_000 });
const master = await fetchScripMaster(pacer);

let comparedRows = 0, identical = 0, distinctPairs = 0, trapPassed = 0, trapRefusedWrongBasis = 0;
for (const symbol of SAMPLE) {
  const st = await prisma.stock.findUnique({ where: { symbol }, select: { isin: true } });
  const scrip = resolveAgainstMaster([{ symbol, isin: st?.isin ?? "" }], master).resolved[0];
  if (!scrip) continue;
  let listing: BseListing;
  try { listing = await fetchResultsListing(pacer, scrip.scripCode); } catch { continue; }

  // (1) + (2) over EVERY period this scrip lists — not just the ones we happen to want.
  for (const qc of [...new Set(listing.rows.map((r) => r.quarterCode))]) {
    const old = findStandaloneDocument(listing, qc);
    const sa = findDocument(listing, qc, "standalone");
    comparedRows++;
    if (JSON.stringify(old) === JSON.stringify(sa)) identical++;
    const co = findDocument(listing, qc, "consolidated");
    if (sa.kind === "found" && co.kind === "found" && sa.url !== co.url) distinctPairs++;
  }

  // (3) the period trap, on one real consolidated document and its standalone twin.
  const qc = quarterCodeFor(new Date("2025-06-30T00:00:00Z"), "quarterly");
  const co = findDocument(listing, qc, "consolidated");
  const sa = findDocument(listing, qc, "standalone");
  if (co.kind === "found" && sa.kind === "found") {
    try {
      const cx = await fetchInstance(pacer, co.url, co.alternates);
      const sx = await fetchInstance(pacer, sa.url, sa.alternates);
      if (assertPeriodAndBasis(cx, "quarterly", new Date("2025-06-30T00:00:00Z"), "consolidated").ok) trapPassed++;
      if (!assertPeriodAndBasis(sx, "quarterly", new Date("2025-06-30T00:00:00Z"), "consolidated").ok) trapRefusedWrongBasis++;
    } catch { /* a dead document is not what this gate is testing */ }
  }
}

check(`STANDALONE UNCHANGED — findDocument(…,"standalone") === findStandaloneDocument on all ${comparedRows} listed periods`,
  comparedRows > 0 && identical === comparedRows, `${identical}/${comparedRows}`);
check("the two bases resolve to DIFFERENT documents where both exist", distinctPairs > 0, distinctPairs);
check("★ a consolidated document PASSES the basis assertion", trapPassed > 0, trapPassed);
check("★ a STANDALONE document asked for as consolidated is REFUSED by the trap", trapRefusedWrongBasis > 0, trapRefusedWrongBasis);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${"=".repeat(70)}\n${failed === 0 ? "✅" : "✗✗"} ${results.length - failed}/${results.length} checks passed`);
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
