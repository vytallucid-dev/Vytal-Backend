// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 4 — GATE 3 VERIFICATION (sector resolution — three states, the gate).
//
//   1. §13 — Health/Quality/Signals byte-identical (73·73·69·65·50) + Gross unchanged.
//   2. THE THREE STATES NEVER POOL — G-Sec/unresolved-bond/gold-ETF are not_applicable, NOT unknown;
//      the 90%-gilt book is NOT killed (the v1 regression proven impossible); the unknown branch exists.
//   3. Bond sector INHERITANCE — a bond's issuer sector (NTPC bond → Energy with the NTPC stock); live.
//   4. INTERIM ruling — every fund is not_applicable; no fund touches unknownSectorValue.
//   5. THE GATE — unknownRatio > 0.50 → not-evaluable state.
//   6. sectoredShare (whole-book) ≠ unknownRatio (sectorable) — two denominators, not conflated.
//   7. Byte-identical: 9 fps + 95 scored-stock fp.
//
//   node_modules/.bin/tsx src/scripts/verify-cv2-stage4.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { sectorStateOf } from "../portfolio/phs/entity.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(84) + "\n" + s + "\n" + "═".repeat(84));
const near = (a: number, b: number, t = 1e-9) => Math.abs(a - b) < t;
const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
const GOLD = "Open Ended Schemes(Other Scheme - Gold ETF)";
const THEMATIC = "Open Ended Schemes(Equity Scheme - Sectoral/ Thematic)";

const stock = (sym: string, isin: string, mv: number, sector: string | null, health: number | null = null): PhsHolding => ({ symbol: sym, marketValue: mv, tier: "large", sector, health, findings: [], isin, assetClass: "stock" });
const bond = (sym: string, isin: string, mv: number, sector: string | null): PhsHolding => ({ symbol: sym, marketValue: mv, tier: "unknown", sector, health: null, findings: [], isin, assetClass: "bond" });
const gilt = (sym: string, isin: string, mv: number): PhsHolding => ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "gsec" });
const gold = (sym: string, isin: string, mv: number): PhsHolding => ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "etf", category: GOLD });
const fund = (sym: string, isin: string, mv: number, category: string | null = null): PhsHolding => ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "mutual_fund", category });

// (Stage 9) SAME-RUN-DELTA — the Stage-6 assertion ruling, applied to the file its list missed. These
// tables are fed by a NIGHTLY EOD job: they MUST drift, so a literal pin measures the ENVIRONMENT, not
// the code, and goes red on a schedule forever. Stage 4 persists NOTHING, so the honest permanent claim
// is: nothing moved between the head and the tail of THIS run. A delta is a REAL signal — a scheduler
// leaked into the build (ODL cv2-scheduler-hazard). Compared as TEXT: these sums exceed 2^53 and would
// lose precision through Number(). Idiom mirrors verify-cv2-stage3/5/6 exactly.
const CATALOG = ["mf_analytics", "daily_prices", "stock_prices", "score_snapshots", "market_cap_tier_snapshot",
  "instruments", "instrument_corporate_events", "instrument_prices", "index_prices"] as const;
const SCORED_SQL = `SELECT COUNT(*)::int AS n, COALESCE(SUM(('x'||substr(md5(composite::text||label_band),1,8))::bit(32)::bigint),0)::text AS fp
  FROM (SELECT DISTINCT ON (stock_id) stock_id, composite, label_band FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC) s`;
async function catalogSnapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of CATALOG) {
    out[t] = (await q<{ fp: string }>(`SELECT COALESCE(SUM(('x'||substr(md5(x::text),1,8))::bit(32)::bigint),0)::text AS fp FROM ${t} x`))[0].fp;
  }
  const s = (await q<{ n: number; fp: string }>(SCORED_SQL))[0];
  out["scored-stocks"] = `${s.n}:${s.fp}`;
  return out;
}

async function main() {
  const catalogBefore = await catalogSnapshot(); // HEAD of the run — the same-run-delta baseline

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · §13 — sector is a derived fact; it touches neither Health nor Gross.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const users = await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`);
  for (const u of users) {
    const stored = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u.user_id }, orderBy: { createdAt: "desc" }, select: { phs: true } });
    const r = computePhs((await assemblePortfolio(u.user_id)).holdings);
    // §13 Health — persisted-row-to-persisted-row, UN-WAIVABLE. Stays exact.
    ok(`${u.user_id.slice(0, 8)} · Health byte-identical (persisted row)`, r.health === (stored?.phs ?? null), `health ${r.health} vs ${stored?.phs} · sectoredShare ${(r.sectors.sectoredShare * 100).toFixed(1)}%`);
    // "Gross unchanged" was pinned to a GROSS literal map { e3c6bd3c: 62.56, 7985d813: 70.38, … } captured
    // days ago. Gross is priced off a LIVE book — an EOD move re-weights it and the pin goes red on a
    // schedule, forever, having measured the environment rather than the code. (7985d813's 70.38 is the
    // very number the Stage-6 ruling already ordered turned into a property; Stage 4 carried a second copy
    // its list never reached.) The CLAIM is "sector touches not Gross" — which is an IDENTITY, provable
    // outright: Gross = max(0, 100 − C1 − C2), and C1/C2 are ENTITY rules that never read a sector. So
    // strip every sector and Gross must not move a bit. That measures the CODE, on any book, at any price.
    const rNoSectors = computePhs((await assemblePortfolio(u.user_id)).holdings.map((h) => ({ ...h, sector: null })));
    ok(`${u.user_id.slice(0, 8)} · Gross is sector-INDEPENDENT (identity: strip all sectors ⇒ Gross unmoved)`,
      near(r.gross.value, rNoSectors.gross.value), `gross ${r.gross.value.toFixed(4)} ≡ ${rNoSectors.gross.value.toFixed(4)} (sectors stripped)`);
  }
  const mBook = [stock("A", "INE001A01011", 100_000, "IT", 60), fund("F", "INF001A01011", 900_000)];
  const wF = computePhs(mBook), woF = computePhs(mBook.map((h) => ({ ...h, sector: null, assetClass: undefined, isin: undefined })));
  ok("micro-proof: Health identical with vs without the sector facts", wF.health === woF.health && wF.quality === woF.quality);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · THE THREE STATES NEVER POOL");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const mixed = computePhs([
    stock("NTPC", "INE733E01010", 20_000, "Energy", 70), bond("NTPC-NCD", "INE733E07AB1", 15_000, "Energy"),
    bond("UNRESOLVED", "INE999X07001", 10_000, null), gilt("GS", "IN0020240070", 15_000),
    gold("GOLDBEES", "INF204KB17I5", 20_000), fund("FND", "INF001A01011", 20_000),
  ]); // total 100k
  ok("G-Sec / unresolved-bond / gold-ETF / fund are all not_applicable — NOT pooled into unknown", mixed.sectors.unknownSectorValue === 0, `unknownSectorValue = ₹${mixed.sectors.unknownSectorValue}`);
  ok("not_applicable count = 4 (unresolved bond + gilt + gold + fund)", mixed.sectors.counts.notApplicable === 4 && mixed.sectors.counts.unknown === 0, `counts ${JSON.stringify(mixed.sectors.counts)}`);
  ok("sectorStateOf: a null-sector STOCK → unknown (the branch exists, 0 live)", sectorStateOf("stock", null) === "unknown");
  ok("sectorStateOf: a null-sector BOND → not_applicable (our gap, never unknown)", sectorStateOf("bond", null) === "not_applicable");

  // The 90%-gilt un-waivable: gilt = not_applicable → tiny sectorable → NOT killed by gilt weight.
  const gilt90 = computePhs([stock("S", "INE001A01011", 100_000, "IT", 70), gilt("GS", "IN0020240070", 900_000)]);
  ok("90%-GILT book: gilt is not_applicable, sectorable is ONLY the ₹100k stock", gilt90.sectors.sectorableValue === 100_000 && gilt90.sectors.unknownSectorValue === 0);
  ok("90%-GILT book: unknownRatio 0% → gate OPEN (v1's whole-book regression PROVEN impossible)", gilt90.sectors.unknownRatio === 0 && gilt90.sectors.gateOpen === true, `unknownRatio ${(gilt90.sectors.unknownRatio * 100).toFixed(1)}% · gate ${gilt90.sectors.gateOpen}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · BOND SECTOR INHERITANCE (issuer's sector; catalogued — ODL cv2-s4-bond-sector-catalogued).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok("NTPC bond resolves into ENERGY, WITH the NTPC stock (Energy weight = both = 35%)",
    mixed.sectors.sectorWeights.some((s) => s.sector === "Energy" && near(s.weight, 0.35)), JSON.stringify(mixed.sectors.sectorWeights));
  // Live data proof: a real resolved-issuer bond's stem points at a stock WITH a sector.
  const liveBond = (await q<{ bond_isin: string; issuer: string | null; stock_sector: string | null }>(`
    SELECT b.isin bond_isin, b.attributes->>'issuer' issuer, sec.name stock_sector
    FROM instruments b JOIN stocks s ON substring(s.isin,1,7)=substring(b.isin,1,7)
    LEFT JOIN sectors sec ON sec.id = s.sector_id
    WHERE b.asset_class='bond' AND b.attributes->>'issuer' IS NOT NULL LIMIT 1`))[0];
  ok("live: a real resolved-issuer bond inherits a non-null sector from its catalogued issuer", !!liveBond && liveBond.stock_sector != null, liveBond ? `${liveBond.bond_isin} (${liveBond.issuer}) → ${liveBond.stock_sector}` : "no bond");

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · INTERIM — every fund is not_applicable; no fund touches unknownSectorValue.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const thematicHeavy = computePhs([fund("THEME", "INF900A01011", 900_000, THEMATIC), stock("S", "INE001A01011", 100_000, "IT", 70)]);
  ok("a 90%-THEMATIC-FUND book: the thematic fund is not_applicable (interim), NOT unknown", thematicHeavy.sectors.unknownSectorValue === 0 && thematicHeavy.sectors.counts.notApplicable === 1);
  ok("…so the gate stays OPEN (marking thematic funds unknown would kill C3/C4 for OUR gap)", thematicHeavy.sectors.gateOpen === true && thematicHeavy.sectors.unknownRatio === 0);
  // grep-guard: sectorStateOf never returns unknown for a fund/etf.
  ok("sectorStateOf(mutual_fund/etf, *) is never unknown", (["mutual_fund", "etf"] as const).every((a) => sectorStateOf(a, null) === "not_applicable" && sectorStateOf(a, "Energy") === "not_applicable"));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · THE GATE — unknownRatio > 0.50 → not-evaluable state.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const tripped = computePhs([stock("NULL1", "INE001A01011", 60_000, null, 70), stock("OK", "INE002A01012", 40_000, "IT", 70)]); // 60% unknown of a 100% sectorable book
  ok("unknownRatio 60% (> 50%) → gate KILLED (C3/C4 will be not-evaluable, not zero)", near(tripped.sectors.unknownRatio, 0.6, 1e-6) && tripped.sectors.gateOpen === false, `unknownRatio ${(tripped.sectors.unknownRatio * 100).toFixed(1)}% · gate ${tripped.sectors.gateOpen}`);
  const boundary = computePhs([stock("N", "INE001A01011", 50_000, null, 70), stock("OK", "INE002A01012", 50_000, "IT", 70)]);
  ok("boundary: exactly 50% does NOT kill (≤ threshold — gate open)", near(boundary.sectors.unknownRatio, 0.5, 1e-6) && boundary.sectors.gateOpen === true);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · TWO DENOMINATORS — sectoredShare (whole-book) ≠ unknownRatio (sectorable).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const two = computePhs([stock("S", "INE001A01011", 20_000, "IT", 70), stock("N", "INE002A01012", 10_000, null, 70), gilt("GS", "IN0020240070", 70_000)]);
  ok("sectoredShare = 20% (resolved ÷ WHOLE book)", near(two.sectors.sectoredShare, 0.20), `${(two.sectors.sectoredShare * 100).toFixed(1)}%`);
  ok("unknownRatio = 33.3% (unknown ÷ SECTORABLE ₹30k) — a DIFFERENT denominator", near(two.sectors.unknownRatio, 1 / 3, 1e-6) && two.sectors.sectorableValue === 30_000, `${(two.sectors.unknownRatio * 100).toFixed(1)}% of ₹${two.sectors.sectorableValue}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · SAME-RUN-DELTA — nothing persisted this stage; the catalog did not move DURING this proof.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // The old form pinned 9 fps to literals captured days ago, through Number() (which silently loses
  // precision above 2^53 — a pin that cannot even represent what it claims to compare). Same ruling,
  // same fix as stage3/5/6: head→tail of THIS run.
  const catalogAfter = await catalogSnapshot();
  for (const t of Object.keys(catalogBefore)) {
    const held = catalogBefore[t] === catalogAfter[t];
    ok(`${t} · same-run-delta (unchanged head→tail of THIS run)`, held,
      held ? catalogBefore[t] : `DRIFTED ${catalogBefore[t]} → ${catalogAfter[t]} — a scheduler leaked into the build (ODL cv2-scheduler-hazard)`);
  }
  // STRUCTURAL invariant — the scored COHORT SIZE is price-independent: an EOD rescore changes the scores,
  // never how many stocks are scored. This one stays EXACT.
  ok("95 scored stocks (STRUCTURAL: cohort size is price-independent)", catalogBefore["scored-stocks"].startsWith("95:"), catalogBefore["scored-stocks"]);

  console.log(`\n${fail === 0 ? "✅ STAGE 4 VERIFIED — three states resolved; the gate runs over sectorable; Health did not move" : `❌ ${fail} FAILURE(S)`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch((e) => { console.error("VERIFY ERROR:", e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
