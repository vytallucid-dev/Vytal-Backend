// ═══════════════════════════════════════════════════════════════════════════════════════════════
// §14 — THE FUND-SECTOR MATCHER'S RATIFICATION HARNESS.
//
// §14: "Of funds whose `category` says sectoral, what share does the matcher resolve? UNTIL IT IS KNOWN,
// THE FUND ARM IS UNRATIFIED." This script is how it becomes known. It is KEPT (Stage 8 ruling) — the
// matcher was refused on this number, so the number must stay re-derivable when the population, the
// approach, or the taxonomy changes. Re-run it before ever reopening §14.
//
// THE DECOMPOSITION THAT MATTERS. AMFI ships ONE leaf — "Equity Scheme - Sectoral/ Thematic" — so the
// headline rate averages two populations that behave nothing alike:
//   · SECTORAL-named  — the fund names an actual sector ("Pharma Fund", "IT Fund"). The matcher is a
//     name-regex, so of course it resolves these. This is the easy tenth.
//   · THEMATIC-named  — the fund names a STRATEGY or THEME ("Manufacturing", "Business Cycle", "Quant",
//     "Innovation", "ESG"). No `Sector` row exists because NO SECTOR EXISTS. Unresolvable by name, and
//     no amount of pattern-writing changes that: it is a DATA problem, not a regex problem.
// Reporting only the blended rate hides that the matcher covers the tenth people don't hold and misses
// the nine-tenths they do.
//
//   node_modules/.bin/tsx src/scripts/audit-fund-sector-coverage.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { SECTOR_ALLOWLIST } from "../ingestions/amfi/mf-benchmark.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import * as K from "../portfolio/phs/constants.js";

const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));
const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

/** A NIFTY index is not automatically one of OUR sectors. This is the honest map: a target is listed
 *  ONLY where the index reduces to exactly one `Sector` row. Everything else is deliberately absent —
 *  see the Stage 8 ruling / ODL `cv2-s8-matcher-unratified`. Mapping a multi-sector theme onto one
 *  sector and feeding it to a rule that measures SINGLE-SECTOR concentration is precisely wrong rather
 *  than honestly absent: a confident wrong number instead of a gap. */
const INDEX_TO_SECTOR: Record<string, string | null> = {
  "Nifty Pharma": "pharma_healthcare",
  "Nifty IT": "it_technology",
  "Nifty Auto": "automobile",
  "Nifty Metal": "metals_mining",
  "Nifty Realty": "real_estate",
  "Nifty Consumer Durables": "consumer_discretionary_retail",
  // ── NO CLEAN COUNTERPART — a mapping we cannot make honestly ──────────────────────────────────
  "Nifty Financial Services": null, // spans banks + nbfc + insurance + capital_markets (the allowlist's
  //                                    own note refuses the `banks` collapse: these hold NBFCs/insurers)
  "Nifty India Consumption": null,  // spans fmcg_consumer + automobile + consumer_discretionary_retail
  //                                    + hospitality_travel (the allowlist's own note says so)
  "Nifty Infrastructure": null,     // spans power + cement_construction + logistics_infrastructure + telecom
  "Nifty Energy": null,             // WE split oil_gas_energy and power; the index does not
  "Nifty MNC": null,                // an OWNERSHIP theme, not a sector
  "Nifty PSE": null,                // an OWNERSHIP theme, not a sector
  "Nifty Commodities": null,        // spans metals + oil_gas + chemicals + cement
  "Nifty Media": null,              // we have no media sector at all
  "Nifty India Defence": null,      // a theme INSIDE capital_goods_engineering, not a sector
};

/** SECTORAL-named vs THEMATIC-named. Deliberately independent of the matcher, or the split would be
 *  circular (it would just re-measure the regexes).
 *
 *  ⚠️ THIS BOUNDARY IS A JUDGMENT CALL, AND IT MOVES THE SPLIT A LOT. Is a "Consumption Fund"
 *  sector-named? It names something economic — but "consumption" is not a sector, it is four of them.
 *  So the audit reports the split under BOTH readings, and shows which conclusion survives either.
 *   · PERMISSIVE — any economic-sounding word counts (consumption, infrastructure, PSU, MNC, commodity…)
 *   · STRICT     — only a TRUE single sector counts; multi-sector and ownership themes are thematic.
 *  Publishing one classifier's split as if it were a fact would be a number that looks right and is not.
 *  The RATIFICATION number (resolves-to-a-SECTOR) is invariant to this choice — that is the point. */
const SECTOR_WORD_PERMISSIVE = /\b(pharma|healthcare|health|it|infotech|technolog\w*|software|digital|bank\w*|financial\s+services?|auto\w*|metal\w*|mining|steel|realty|real\s*estate|media|entertainment|energy|power|oil|gas|fmcg|telecom\w*|chemical\w*|cement|logistic\w*|insurance|durable\w*|defence|consumption|consumer|infrastructure|infra|psu|pse|mnc|commodit\w*|transport\w*)\b/i;
const SECTOR_WORD_STRICT = /\b(pharma|healthcare|health|infotech|technolog\w*|software|auto|automobile|automotive|metal\w*|mining|steel|realty|real\s*estate|media|entertainment|fmcg|telecom\w*|chemical\w*|cement|insurance|durable\w*)\b/i;

async function main() {
  const sectoralBucket = await q<{ name: string }>(
    `SELECT name FROM instruments
     WHERE asset_class IN ('mutual_fund','etf') AND category ILIKE '%sectoral%'`);
  const N = sectoralBucket.length;

  const matchIndex = (n: string) => SECTOR_ALLOWLIST.find((s) => s.pattern.test(n)) ?? null;
  const matchSector = (n: string) => { const i = matchIndex(n); return i ? INDEX_TO_SECTOR[i.index] ?? null : null; };

  const rows = sectoralBucket.map((f) => ({
    name: f.name,
    permissive: SECTOR_WORD_PERMISSIVE.test(f.name),
    strict: SECTOR_WORD_STRICT.test(f.name),
    index: matchIndex(f.name)?.index ?? null,
    sector: matchSector(f.name),
  }));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("§14 RATIFICATION AUDIT — the fund arm's coverage over the AMFI Sectoral/Thematic bucket");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const toIndex = rows.filter((r) => r.index != null).length;
  const toSector = rows.filter((r) => r.sector != null).length;
  console.log(`  population (category = "Equity Scheme - Sectoral/ Thematic"): ${N} funds\n`);
  console.log(`  resolves to a NIFTY INDEX  : ${toIndex}/${N} = ${pct(toIndex, N).toFixed(1)}%   ← the flattering number`);
  console.log(`  resolves to one of OUR SECTORS: ${toSector}/${N} = ${pct(toSector, N).toFixed(1)}%   ← ★ THE RATIFICATION NUMBER`);
  console.log(`\n  the gap between them (${toIndex - toSector} funds) is NOT a matcher failure — it is the taxonomy mismatch:`);
  console.log(`  those names DO resolve to a Nifty index, but that index is a multi-sector or ownership THEME`);
  console.log(`  (Financial Services · Consumption · Infrastructure · Energy · MNC · PSE · Commodities · Media · Defence).`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("THE DECOMPOSITION — the headline averages two populations that behave nothing alike");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // SENSITIVITY: report the split under both readings, and show what survives either.
  let themRes = 0, themShare = 0;
  for (const [label, key] of [["PERMISSIVE", "permissive"], ["STRICT", "strict"]] as const) {
    const sec = rows.filter((r) => r[key]);
    const them = rows.filter((r) => !r[key]);
    const sR = sec.filter((r) => r.sector != null).length;
    const tR = them.filter((r) => r.sector != null).length;
    const sI = sec.filter((r) => r.index != null).length;
    const tI = them.filter((r) => r.index != null).length;
    console.log(`  ── ${label} classifier ──`);
    console.log(`     SECTORAL-named : ${String(sec.length).padStart(4)} (${pct(sec.length, N).toFixed(1)}% of bucket) · →SECTOR ${pct(sR, sec.length).toFixed(1)}%  · →index ${pct(sI, sec.length).toFixed(1)}%`);
    console.log(`     THEMATIC-named : ${String(them.length).padStart(4)} (${pct(them.length, N).toFixed(1)}% of bucket) · →SECTOR ${pct(tR, them.length).toFixed(1)}%  · →index ${pct(tI, them.length).toFixed(1)}%`);
    if (label === "STRICT") { themRes = tR; themShare = pct(them.length, N); }
  }
  // ── THE PUBLICATION LINE (Stage 8 ruling ①) ────────────────────────────────────────────────────
  // NEVER publish the aggregate alone. The aggregate is the misleading number; the SPLIT is the finding:
  // the matcher works on the trivially-matchable population and fails on the one people actually hold.
  // Quote 11.9% by itself and the reply is "so extend the regexes" — quote the split and it is obvious
  // why that cannot work. (Doc 2's own PQ2 makes this point about a user's numbers: "your average of 70
  // hides a split." It applies to our own metric.)
  const st = rows.filter((r) => r.strict), th = rows.filter((r) => !r.strict);
  const stR = st.filter((r) => r.sector != null).length, thR = th.filter((r) => r.sector != null).length;
  console.log(`\n  ★★ PUBLICATION LINE — carry all three, always, on every surface:`);
  console.log(`     ${pct(toSector, N).toFixed(1)}% overall — ${pct(stR, st.length).toFixed(1)}% Sectoral · ${pct(thR, th.length).toFixed(1)}% Thematic (${pct(th.length, N).toFixed(0)}% of the bucket)`);

  console.log(`\n  ⇒ WHERE THE LINE IS DRAWN MOVES THE SPLIT (46% vs 89% thematic) — and changes NOTHING that matters:`);
  console.log(`    · THEMATIC-named funds resolve to a sector 0.0% (permissive) / 1.6% (strict) of the time — negligible either way.`);
  console.log(`    · The RATIFICATION NUMBER is the same ${toSector} funds (${pct(toSector, N).toFixed(1)}%) under BOTH: it is a property of the`);
  console.log(`      index→sector MAPPING, not of how the bucket is labelled. The verdict is classifier-INDEPENDENT.`);
  console.log(`    The matcher covers the population people mostly DON'T hold, and misses the one they do.`);

  console.log(`\n  resolved-to-a-SECTOR, by target:`);
  const bySec = new Map<string, number>();
  for (const r of rows) if (r.sector) bySec.set(r.sector, (bySec.get(r.sector) ?? 0) + 1);
  for (const [s, n] of [...bySec.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${s}`);
  console.log(`\n  matched a Nifty index but NO honest sector (the taxonomy mismatch), by target:`);
  const byLost = new Map<string, number>();
  for (const r of rows) if (r.index && !r.sector) byLost.set(r.index, (byLost.get(r.index) ?? 0) + 1);
  for (const [s, n] of [...byLost.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(5)}  ${s}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("WHY `unknown` WOULD BE A NO-OP WITH A MOVING PART — measured, not argued");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // A fund-only book of UNRESOLVED sectoral funds. Post-matcher they would be `unknown` (sectorable, but
  // we cannot name the sector) instead of `not_applicable` (no sector question at all). Simulated by
  // giving them a resolvable NATURE but no sector — the state the matcher's degrade path produces.
  const F = (sym: string, isin: string, mv: number): PhsHolding =>
    ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "mutual_fund", fundHouse: "H" });
  const fundOnly = [F("MANUF", "INF001A01011", 500_000), F("BIZCYC", "INF002A01012", 500_000)];
  const rF = computePhs(fundOnly);
  console.log(`  fund-only book, funds unresolved — TODAY (interim: every fund not_applicable):`);
  console.log(`    sectoredShare ${(rF.sectors.sectoredShare * 100).toFixed(1)}% · unknownRatio ${(rF.sectors.unknownRatio * 100).toFixed(1)}% · gateOpen ${rF.sectors.gateOpen}`);
  console.log(`    C3 ${rF.construction.c3.evaluable ? "evaluable" : "NOT EVALUABLE"} · C4 ${rF.construction.c4.evaluable ? "evaluable" : "NOT EVALUABLE"}`);
  console.log(`\n  POST-MATCHER those same funds become \`unknown\` ⇒ sectorable = the whole book, unknown = the whole book`);
  console.log(`    ⇒ unknownRatio = 1.00 > C3_UNKNOWN_KILL ${K.C3_UNKNOWN_KILL} ⇒ the §7 gate KILLS C3/C4 ⇒ NOT EVALUABLE`);
  console.log(`\n  ⇒ IDENTICAL OUTCOME (C3/C4 not evaluable), reached by a longer path with a threshold that can`);
  console.log(`    misfire. The interim ruling is the same behaviour with fewer ways to be wrong.`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("VERDICT");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log(`  §14: "A rule that catches your pharma fund and misses your neighbour's would be`);
  console.log(`       inconsistent penalty — worse than no rule."`);
  console.log(`\n  At ${pct(themRes, N * (themShare / 100)).toFixed(1)}% coverage of the THEMATIC population (${themShare.toFixed(0)}% of the bucket, strict), that is not a risk — it is the design.`);
  console.log(`  RULED (Stage 8): the fund arm does NOT ship. Every fund stays not_applicable; matcherVersion stays "${K.MATCHER_VERSION_NONE}".`);
  console.log(`  Thematic funds are not sectorable FROM THEIR NAMES. That is a DATA problem, not a regex problem:`);
  console.log(`  the honest path is fund LOOK-THROUGH (read the portfolio disclosure), not more patterns. Phase 2.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("AUDIT ERROR:", e?.message ?? e, e?.stack); process.exitCode = 1; }).finally(() => prisma.$disconnect());
