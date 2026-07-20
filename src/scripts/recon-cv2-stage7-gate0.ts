// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 7 — GATE 0 RECON (READ-ONLY. Writes nothing. Persists nothing.)
//
//   1. DUPLICATION: what construction_data already carries vs §12's field list — and whether the
//      facts §12 wants are even RECOVERABLE from the JSONB today (the neff/clean-rule trap).
//   2. FINGERPRINT: the current inputs, and the PROJECTED write/skip split for the §12 additions.
//      Decomposed: does the OLD fp still match (⇒ no data change) while the NEW fp differs (⇒ the
//      shape change alone is the blast radius)?
//   3. MATCHER VERSION: what a null-vs-sentinel carries through JSON.stringify → sha256.
//   4. BOND TRIGGER: can refreshPhsForSymbols reach a bond-ONLY holder? (Stage 4: catalogued, not scored.)
//   5. DEAD COLUMNS: is there real HISTORY in phs_raw / ceiling_applied / ceiling_value? (If yes, a
//      DROP destroys it — retire ≠ drop.)
//   6. neffPosSectored: does the value carry UNITS (entities) or POSITIONS?
//   8. Baselines: same-run-delta on the catalog + the 5 served rows.
//
//   node_modules/.bin/tsx src/scripts/recon-cv2-stage7-gate0.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import crypto from "crypto";
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { fingerprintOf, type PhsProvenance } from "../portfolio/phs/persist.js";
import { natureOf, constructionDataOf } from "../portfolio/phs/entity.js";
import { CONSTANT_VERSION, constructionBandOf } from "../portfolio/phs/constants.js";

const rule = (s: string) => console.log("\n" + "═".repeat(92) + "\n" + s + "\n" + "═".repeat(92));
const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

const CATALOG = ["mf_analytics", "daily_prices", "stock_prices", "score_snapshots", "market_cap_tier_snapshot",
  "instruments", "instrument_corporate_events", "instrument_prices", "index_prices"] as const;
async function catalogSnapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of CATALOG) out[t] = (await q<{ fp: string }>(`SELECT COALESCE(SUM(('x'||substr(md5(x::text),1,8))::bit(32)::bigint),0)::text AS fp FROM ${t} x`))[0].fp;
  const s = (await q<{ n: number; fp: string }>(`SELECT COUNT(*)::int AS n, COALESCE(SUM(('x'||substr(md5(composite::text||label_band),1,8))::bit(32)::bigint),0)::text AS fp
    FROM (SELECT DISTINCT ON (stock_id) stock_id, composite, label_band FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC) s`))[0];
  out["scored-stocks"] = `${s.n}:${s.fp}`;
  return out;
}

// (POST-GATE-2 NOTE) This recon originally carried a hand-written PROTOTYPE of the §12 fingerprint, to
// project the write/skip split before building it. That prototype is now REAL — `fingerprintOf` in
// persist.ts implements exactly it — so the copy has been deleted rather than left to rot: a second
// hand-maintained copy of the most load-bearing function in the system is precisely the two-homes hazard
// this stage exists to close, and a verify that hashes its own idea of the inputs proves nothing about
// the one that ships. Section 2 below now reports against the SHIPPED fingerprint.
//
// The Gate 0 projection it produced (recorded in the Gate 0 report, before any of this was built):
//     OLD fp MATCHES stored 5/5  →  no data had moved
//     NEW fp DIFFERS       5/5  →  PROJECTED 5 written / 0 skipped, attributable to the hash-shape change alone.

async function main() {
  const catalogBefore = await catalogSnapshot();
  const users = (await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`)).map((u) => u.user_id).sort();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("8 · BASELINE — the 5 served rows (post-zombie state).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  for (const uid of users) {
    const s = await prisma.portfolioHealthSnapshot.findFirst({
      where: { userId: uid }, orderBy: { createdAt: "desc" },
      select: { phs: true, quality: true, signals: true, structure: true, constantVersion: true, constructionData: true, fingerprint: true, structureTier: true, capitalTier: true },
    });
    const cd = s?.constructionData as { net?: number } | null;
    const agree = cd?.net != null && Math.abs(Number(s!.structure) - cd.net) < 0.005;
    console.log(`  ${uid.slice(0, 8)} · cv=${s?.constantVersion} · phs=${s?.phs} · structure=${Number(s?.structure).toFixed(2)} · cd=${cd == null ? "NULL" : `net ${cd.net?.toFixed(2)}`} · ONE-HOME? ${cd == null ? "n/a" : agree ? "agree" : "❌ DRIFTED"} · band=${constructionBandOf(Number(s?.structure))}`);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · DUPLICATION — is each §12 fact RECOVERABLE from construction_data today?");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const probe = users[0];
  const asmP = await assemblePortfolio(probe);
  const rP = computePhs(asmP.holdings);
  const cdP = constructionDataOf(rP.construction, rP.entityLedger, rP.basketLedger, rP.sectors, asmP.holdings.length, asmP.holdings.filter((h) => h.health != null).length);
  console.log(`  probe ${probe.slice(0, 8)} — construction_data keys: ${Object.keys(cdP).join(", ")}`);
  console.log(`  rules[] CDeduction keys: ${Object.keys(cdP.rules[0]).join(", ")}`);
  console.log(`  exposures keys: ${Object.keys(cdP.exposures).join(", ")}`);
  for (const rl of cdP.rules) {
    const fsKind = rl.firedSubject == null ? "null" : rl.firedSubject.kind;
    console.log(`    ${rl.rule} evaluable=${rl.evaluable} points=${rl.points.toFixed(2)} subjectShare=${rl.subjectShare.toFixed(4)} firedSubject=${fsKind}`);
  }
  const c2 = cdP.rules.find((x) => x.rule === "C2")!, c4 = cdP.rules.find((x) => x.rule === "C4")!;
  const c2NeffRecoverable = c2.firedSubject?.kind === "breadth";
  const c4NeffRecoverable = c4.firedSubject?.kind === "breadth";
  console.log(`\n  §12 wants neffEntity / neffPosSectored / neffSector as first-class facts. Today:`);
  console.log(`    neffEntity  (C2) — in firedSubject? ${c2NeffRecoverable ? "yes (fired)" : "❌ NO — firedSubject is null (rule clean/not-evaluable); the Neff exists ONLY in the `detail` prose"}`);
  console.log(`    neffSector  (C4) — in firedSubject? ${c4NeffRecoverable ? "yes (fired)" : "❌ NO — same trap"}`);
  console.log(`    neffUnit    (C4) — NEVER in firedSubject (it carries neffSECTOR when fired); prose only → ❌ unrecoverable`);
  console.log(`    C4 detail: "${c4.detail}"`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · FINGERPRINT — current inputs, and the PROJECTED write/skip for the §12 additions.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log(`  CURRENT canonical keys (persist.ts fingerprintOf): weights(POSITION-level), health, findings, tier, sector, cv`);
  console.log(`  §12 additions → entity-aggregated weights · assetClass+nature per holding · sector-resolution outputs · fund_house per basket · matcher version`);
  console.log(`  §12 ALSO lists "mcap_tier_snapshot version" + CONSTANT_VERSION — both are ALREADY inputs (tier / cv). Not additions.\n`);
  let newMatch = 0;
  for (const uid of users) {
    const asm = await assemblePortfolio(uid);
    const stored = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: uid }, orderBy: { createdAt: "desc" }, select: { fingerprint: true, constantVersion: true } });
    const fp = fingerprintOf(asm.holdings, asm.prov); // the SHIPPED §12 fingerprint
    const same = fp === stored?.fingerprint;
    if (same) newMatch++;
    console.log(`  ${uid.slice(0, 8)} · §12 fp ${same ? "matches stored → skip" : "DIFFERS from stored → WILL WRITE"}`);
  }
  console.log(`\n  §12 fingerprint vs the served rows: ${users.length - newMatch} would write / ${newMatch} would skip.`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · MATCHER VERSION — which sentinel survives JSON.stringify and flips the hash at Stage 8?");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const shapes: Array<[string, unknown]> = [["null", null], ['"none"', "none"], ['"0"', "0"], ["undefined", undefined]];
  for (const [label, val] of shapes) {
    const now = JSON.stringify({ a: 1, matcher: val, z: 2 });
    const at8 = JSON.stringify({ a: 1, matcher: "v1", z: 2 });
    const present = now.includes("matcher");
    console.log(`  matcher=${label.padEnd(11)} → canonical ${present ? "CONTAINS" : "❌ OMITS"} the key · ${now}  →(Stage 8)→  ${at8}  · flips? ${now !== at8 ? "YES" : "NO"}`);
  }
  console.log(`  RULED: "none" — non-null, always present, never confusable with "field missing". Now in constants.ts as MATCHER_VERSION_NONE.`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · BOND TRIGGER — can the existing trigger reach a bond-ONLY holder? (Stage 4: catalogued ≠ scored)");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const bondInstr = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM instruments WHERE asset_class = 'bond'`);
  const bondHeld = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM holdings h JOIN instruments i ON i.id = h.instrument_id WHERE i.asset_class = 'bond' AND h.quantity > 0`);
  const bondWithStock = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM instruments WHERE asset_class = 'bond' AND stock_id IS NOT NULL`);
  console.log(`  bond instruments catalogued: ${bondInstr[0].n} · bonds HELD (open qty): ${bondHeld[0].n} · bonds with a stock_id relation: ${bondWithStock[0].n}`);
  console.log(`  refreshPhsForSymbols matches users via  instrument.stock.symbol IN (changed symbols).`);
  console.log(`  ⇒ a bond whose stock_id is NULL can NEVER be matched by that query — its holder is unreachable by the symbol trigger.`);
  console.log(`  (Gate 0 also found prov.sectorVersion = "nse-sector-v1" — a HARDCODED literal that could never fire, so`);
  console.log(`   §12's "symbol-master refresh resolving a sector" invalidated NOTHING. RULED: removed; the fingerprint now`);
  console.log(`   hashes the sector-resolution OUTPUTS themselves — the fact, not a label asserting the fact is fresh.)`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · DEAD COLUMNS — is there real HISTORY in phs_raw / ceiling_applied / ceiling_value?");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const dead = await q<{ total: number; raw_nn: number; capp: number; cval_nn: number; st_nn: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(phs_raw)::int AS raw_nn,
            COUNT(*) FILTER (WHERE ceiling_applied IS TRUE)::int AS capp,
            COUNT(ceiling_value)::int AS cval_nn,
            COUNT(structure_tier)::int AS st_nn
     FROM portfolio_health_snapshot`);
  const d = dead[0];
  console.log(`  rows=${d.total} · phs_raw NON-NULL=${d.raw_nn} · ceiling_applied TRUE=${d.capp} · ceiling_value NON-NULL=${d.cval_nn} · structure_tier NON-NULL=${d.st_nn}`);
  console.log(`  ⇒ ${d.raw_nn + d.capp + d.cval_nn === 0 ? "NO history — a DROP destroys nothing." : "❌ HISTORY PRESENT — a DROP would destroy it."}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · neffPosSectored — does the value carry UNITS (entities) or POSITIONS?");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // NTPC stock + NTPC bond = ONE entity in TWO positions. If the value is unit-based it sees 2 units;
  // position-based would see 3. Synthetic — no live book has a bond.
  const S = (sym: string, isin: string, mv: number, sector: string | null): PhsHolding => ({ symbol: sym, marketValue: mv, tier: "large", sector, health: 70, findings: [], isin, assetClass: "stock" });
  const B = (sym: string, isin: string, mv: number, sector: string | null): PhsHolding => ({ symbol: sym, marketValue: mv, tier: "unknown", sector, health: null, findings: [], isin, assetClass: "bond" });
  const unitBook = [S("NTPC", "INE733E01010", 250_000, "oil_gas_energy"), B("NTPC-NCD", "INE733E07AB1", 250_000, "oil_gas_energy"), S("HDFCBANK", "INE040A01034", 500_000, "banks")];
  const rU = computePhs(unitBook);
  console.log(`  3 positions → ${rU.entityLedger.length} entities (NTPC stock+bond aggregate). C4 detail:`);
  console.log(`    "${rU.construction.c4.detail}"`);
  console.log(`  ⇒ C4's units come from the entityLedger (c4Of(entityLedger, sectors)) — the value is ENTITY-aggregated.`);
  console.log(`  ⇒ §12's name "neffPosSectored" (pos = positions) would persist a name that LIES. → neffUnitSectored`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("8b · SAME-RUN-DELTA — the catalog did not move during this recon.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const catalogAfter = await catalogSnapshot();
  let held = 0;
  for (const t of Object.keys(catalogBefore)) if (catalogBefore[t] === catalogAfter[t]) held++;
  console.log(`  ${held}/${Object.keys(catalogBefore).length} catalog fps unchanged head→tail · scored ${catalogBefore["scored-stocks"]}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error("RECON ERROR:", e?.message ?? e, e?.stack); process.exitCode = 1; }).finally(() => prisma.$disconnect());
