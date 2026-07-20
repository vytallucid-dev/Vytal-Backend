// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 7 — GATE 3 VERIFICATION (persistence + the §12 fingerprint).
//
//   1. §13 (8th) — Health byte-identical, PERSISTED-ROW-TO-PERSISTED-ROW. Not a live recompute:
//      the table is append-only, so the evidence is already in it.
//   2. THE FINGERPRINT GATES BOTH WAYS — change an input ⇒ hash changes ⇒ it writes; change nothing
//      ⇒ hash matches ⇒ it skips. The anti-staleness proof, which is the whole point of the stage.
//   3. EVERY §12 INPUT IS IN THE HASH — asserted PER INPUT, never in aggregate. A missing input is a
//      silent staleness bug that surfaces months later as one wrong row.
//   4. MATCHER VERSION invalidates on change — proves Stage 8 cannot ship a silent re-rating.
//   5. ONE HOME PER FACT — `structure` == `construction_data.net` on every persisted row.
//   6. The CATALOGUED-not-scored bond trigger: reachable, and its resolution moves the hash.
//   7. Dead columns GONE from the table (not merely unwritten).
//   8. `neffUnitSectored` carries the UNIT (entity-aggregated) value, whatever §12 named it.
//   9. DRY-RUN: the projected write/skip split. Nothing here writes.
//  10. Same-run-delta on the catalog + the 95-stock structural invariant.
//
//  ASSERTION DISCIPLINE (ruling ②): synthetic (fixed weights) → EXACT · live → PROPERTY or
//  SAME-RUN-DELTA. Every fingerprint proof below is SYNTHETIC and therefore drift-immune: it compares
//  two hand-built books to each other, so no EOD fetch can move it. THIS SCRIPT WRITES NOTHING.
//
//   node_modules/.bin/tsx src/scripts/verify-cv2-stage7.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { fingerprintOf, type PhsProvenance } from "../portfolio/phs/persist.js";
import { constructionDataOf, buildSleeves, buildExposures, sleevesOf } from "../portfolio/phs/entity.js";
import { CONSTANT_VERSION, MATCHER_VERSION_NONE } from "../portfolio/phs/constants.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(92) + "\n" + s + "\n" + "═".repeat(92));
const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

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

// ── synthetic builders — fixed weights, drift-immune ──────────────────────────────────────────────
const S = (sym: string, isin: string, mv: number, sector: string | null = null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "large", sector, health: 70, findings: [], isin, assetClass: "stock" });
const BOND = (sym: string, isin: string, mv: number, sector: string | null = null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "unknown", sector, health: null, findings: [], isin, assetClass: "bond" });
const FUND = (sym: string, isin: string, mv: number, fundHouse: string | null): PhsHolding =>
  ({ symbol: sym, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "mutual_fund", fundHouse });

const PROV: PhsProvenance = { healthSnapshotIds: ["h1", "h2"], findingIds: ["f1"], tierAsOfDate: "2026-07-16", matcherVersion: MATCHER_VERSION_NONE };
const fp = (h: PhsHolding[], p: PhsProvenance = PROV) => fingerprintOf(h, p);

async function main() {
  const catalogBefore = await catalogSnapshot();
  const users = (await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`)).map((u) => u.user_id).sort();

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · §13 UN-WAIVABLE (8th) — Health byte-identical, PERSISTED-ROW-TO-PERSISTED-ROW.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Not a live recompute: the table is APPEND-ONLY, so every row a book has ever had is still there —
  // across the 1.2→2.0 cutover, across the zombie's cv-1.2 writes, across Stage 6's JSONB.
  //
  // ⚠️ §13 IS NOT "HEALTH NEVER MOVES". Health tracks Quality, and Quality moves with EOD prices — so
  // asserting `phs` identical across an append-only history pins a value a scheduled job legitimately
  // changes (ruling ②, learned the hard way: this assertion was written that way first and flagged
  // 7985d813, whose Quality sits ON the .5 rounding knife-edge — 64.4964 → 64, 64.5548 → 65, while its
  // Construction was pinned at 70.48 throughout. The flicker was price, not contamination).
  //
  // §13's actual claim is CAUSAL: Construction cannot move Health. Asserted two ways, both properties.
  const EXP: Record<string, number> = { "4c5ca537": 73, "ae8c6537": 73, "e3c6bd3c": 69, "7985d813": 65, "108fd2a6": 50 };

  // (i) THE FORMULA, verbatim, on EVERY persisted row: Health = round(max(0, Quality − 0.20×(100−Signals))).
  //     There is no structure term. Contamination of any size would break this on the row it touched.
  const allRows = await prisma.portfolioHealthSnapshot.findMany({
    where: { phs: { not: null } }, orderBy: { createdAt: "asc" },
    select: { userId: true, createdAt: true, phs: true, quality: true, signals: true, structure: true, constantVersion: true },
  });
  const bad = allRows.filter((r) => r.phs !== Math.round(Math.max(0, Number(r.quality) - 0.2 * (100 - Number(r.signals)))));
  ok(`Health = round(Quality − 0.20×(100−Signals)) on ALL ${allRows.length} persisted rows — no structure term, ever`,
    bad.length === 0, bad.length ? `${bad.length} row(s) violate the formula` : "the §13 law holds row-by-row across every cv");

  // (ii) THE NATURAL EXPERIMENT the append-only table already contains: rows with byte-identical
  //      (Quality, Signals) but DIFFERENT Construction. If Construction reached Health, these would
  //      disagree. 7985d813 supplies the sharpest pair — an 86.65 S-composite and a 70.48 Net, same book.
  const pairs: string[] = [];
  let checked = 0, disagreed = 0;
  for (const uid of users) {
    const rs = allRows.filter((r) => r.userId === uid);
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (Number(a.quality) !== Number(b.quality) || Number(a.signals) !== Number(b.signals)) continue;
      const dStruct = Math.abs(Number(a.structure) - Number(b.structure));
      if (dStruct < 0.005) continue; // same Construction too — proves nothing
      checked++;
      if (a.phs !== b.phs) disagreed++;
      else if (pairs.length < 3) pairs.push(`${uid.slice(0, 8)}: Construction ${Number(a.structure).toFixed(2)} vs ${Number(b.structure).toFixed(2)} (Δ${dStruct.toFixed(2)}) · Quality ${Number(a.quality).toFixed(4)} both · Health ${a.phs} both`);
    }
  }
  ok(`${checked} persisted row-PAIRS share byte-identical Quality+Signals but differ in Construction — Health identical in all`,
    checked > 0 && disagreed === 0, disagreed ? `${disagreed} disagreed` : pairs[0] ?? "");
  for (const p of pairs.slice(1)) console.log(`     ↳ ${p}`);

  // (iii) the SERVED row per user is at the frozen cohort value (a property of the latest row only).
  for (const uid of users) {
    const s = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: uid }, orderBy: { createdAt: "desc" }, select: { phs: true, structure: true } });
    const tag = uid.slice(0, 8);
    ok(`${tag} · served Health = ${EXP[tag]}`, s?.phs === EXP[tag], `phs ${s?.phs} · Construction ${Number(s?.structure).toFixed(2)}`);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · THE FINGERPRINT GATES BOTH WAYS — the anti-staleness proof (what 108fd2a6 lacked).");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // THE DIRECTION THAT MATTERS. Two books with byte-identical POSITION weights — same symbols, same
  // market values — that differ ONLY in how the issuer aggregates: in `agg` the bond shares NTPC's
  // 7-char stem (one 50% entity); in `split` it does not (two 25% entities). C1/C2 read the ENTITY
  // vector, so Construction differs — and before Stage 7 the hash saw only position weights, so this
  // change produced NO new fingerprint and NO write. The book kept serving a number its own inputs no
  // longer supported, invisibly, exactly like a served 55.01 against an engine 32.38.
  const agg = [S("NTPC", "INE733E01010", 250_000), BOND("NTPC-NCD", "INE733E07AB1", 250_000), S("HDFCBANK", "INE040A01034", 500_000)];
  const split = [S("NTPC", "INE733E01010", 250_000), BOND("NTPC-NCD", "INE999Z07AB1", 250_000), S("HDFCBANK", "INE040A01034", 500_000)];
  const aggLedger = computePhs(agg).entityLedger, splitLedger = computePhs(split).entityLedger;
  ok("the two books have IDENTICAL position weights (same symbols, same values) — only the stem differs",
    JSON.stringify(agg.map((h) => [h.symbol, h.marketValue])) === JSON.stringify(split.map((h) => [h.symbol, h.marketValue])));
  ok("…but they aggregate differently: 2 entities vs 3 (the bond joins its issuer, or does not)",
    aggLedger.length === 2 && splitLedger.length === 3, `agg ${aggLedger.length} · split ${splitLedger.length}`);
  ok("CHANGE AN INPUT ⇒ HASH CHANGES ⇒ IT WRITES — a re-aggregation with unchanged position weights now moves the fingerprint",
    fp(agg) !== fp(split), `${fp(agg).slice(0, 12)}… ≠ ${fp(split).slice(0, 12)}…`);
  ok("CHANGE NOTHING ⇒ HASH MATCHES ⇒ IT SKIPS — deterministic over the same inputs",
    fp(agg) === fp([...agg]) && fp(agg) === fp(agg.slice().reverse()), "stable, and order-independent (canonical sort)");
  console.log(`     ↳ the write/skip WIRING itself is exercised end-to-end against the live DB by verify-phs-persist.ts`);
  console.log(`       ("first compute writes a snapshot" → "re-run skips (fingerprint idempotency)").`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · EVERY §12 INPUT IS IN THE HASH — asserted PER INPUT, never in aggregate.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Each pair below differs in exactly ONE §12 input where that is achievable; where a mutation
  // necessarily cascades (a sector cannot change without the entity carrying it changing too) it is
  // labelled honestly rather than claimed as isolated. In aggregate this proves no §12 input is absent.
  const base = [S("A", "INE001A01011", 400_000, "banks"), FUND("F", "INF001A01011", 600_000, "HDFC Mutual Fund")];

  // position weights
  const wMoved = [S("A", "INE001A01011", 500_000, "banks"), FUND("F", "INF001A01011", 500_000, "HDFC Mutual Fund")];
  ok("weights (position) — a market-value move changes the hash", fp(base) !== fp(wMoved));

  // entity-aggregated weights — ISOLATED (proven above with identical position weights)
  ok("entities (entity-aggregated vector) — ISOLATED: identical position weights, different aggregation", fp(agg) !== fp(split));

  // assetClass — ISOLATED: reit→invit keeps nature (both name_risk), weight, sector, house identical
  const reit: PhsHolding = { symbol: "R", marketValue: 1_000_000, tier: "unknown", sector: null, health: null, findings: [], isin: "INE700A01011", assetClass: "reit" };
  const invit: PhsHolding = { ...reit, assetClass: "invit" };
  ok("assetClass — ISOLATED: reit → invit (same nature, weight, sector, house) still changes the hash", fp([reit]) !== fp([invit]));

  // nature — ISOLATED: a gold ETF (commodity) vs a plain ETF (basket); same class, same weight, no house
  const goldEtf: PhsHolding = { symbol: "G", marketValue: 1_000_000, tier: "unknown", sector: null, health: null, findings: [], isin: "INF000G01011", assetClass: "etf", category: "Other Scheme - Gold ETF", fundHouse: "X" };
  const plainEtf: PhsHolding = { ...goldEtf, category: "Other Scheme - Index Fund" };
  ok("nature — ISOLATED: commodity → basket via AMFI category (same assetClass/weight/house)", fp([goldEtf]) !== fp([plainEtf]));

  // fund_house — ISOLATED: baskets carry no sector and are not entities
  const houseA = [FUND("F", "INF001A01011", 1_000_000, "HDFC Mutual Fund")];
  const houseB = [FUND("F", "INF001A01011", 1_000_000, "SBI Mutual Fund")];
  const houseNull = [FUND("F", "INF001A01011", 1_000_000, null)];
  ok("fund_house — ISOLATED: a house change moves the hash (C5's subject)", fp(houseA) !== fp(houseB));
  ok("fund_house — LEARNING a house (unknown → known) moves the hash (recorded as itself, not dropped)", fp(houseNull) !== fp(houseA));

  // sector-resolution outputs — cascades into `entities.sector` by construction; labelled honestly
  const secA = [S("A", "INE001A01011", 1_000_000, "banks")];
  const secB = [S("A", "INE001A01011", 1_000_000, "it_technology")];
  const secNull = [S("A", "INE001A01011", 1_000_000, null)];
  ok("sector-resolution outputs — a resolved sector CHANGING moves the hash (cascades into entities.sector — not isolated, by design)", fp(secA) !== fp(secB));
  ok("sector-resolution outputs — a sector RESOLVING (null → banks) moves the hash [the dead `sectorVersion` could not do this]", fp(secNull) !== fp(secA));

  // matcher version — ISOLATED (provenance only)
  ok("matcher version — ISOLATED: prov-only, moves the hash", fp(base) !== fp(base, { ...PROV, matcherVersion: "v1" }));
  // tier — ISOLATED (provenance only)
  ok("mcap_tier_snapshot version — ISOLATED: prov-only, moves the hash (already an input pre-Stage-7)", fp(base) !== fp(base, { ...PROV, tierAsOfDate: "2026-07-17" }));
  // score + finding ids — ISOLATED (provenance only)
  ok("health-snapshot ids — ISOLATED: a rescore moves the hash", fp(base) !== fp(base, { ...PROV, healthSnapshotIds: ["h1", "h9"] }));
  ok("finding ids — ISOLATED: a finding change moves the hash", fp(base) !== fp(base, { ...PROV, findingIds: ["f9"] }));
  // CONSTANT_VERSION — present by construction (a constant; asserted by its stamp, and by Stage 5's cutover)
  ok("CONSTANT_VERSION — in the hash (a constant, so proven by the cutover it delivered, not by mutation)", CONSTANT_VERSION === "portfolio-spec 2.0", CONSTANT_VERSION);
  // the REMOVED input
  ok("sectorVersion — REMOVED: `PhsProvenance` no longer carries it (it was a constant that could never fire)",
    !("sectorVersion" in PROV), "replaced by the sector-resolution OUTPUTS above");

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · MATCHER VERSION — Stage 8 cannot ship a silent re-rating.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  ok(`the sentinel is a NON-NULL value ("${MATCHER_VERSION_NONE}") — undefined would be DROPPED by JSON.stringify`,
    typeof MATCHER_VERSION_NONE === "string" && MATCHER_VERSION_NONE.length > 0);
  ok("simulating Stage 8's landing (none → v1) invalidates the book — every affected snapshot rescores",
    fp(base, { ...PROV, matcherVersion: MATCHER_VERSION_NONE }) !== fp(base, { ...PROV, matcherVersion: "v1" }));
  ok("…and an ACCIDENTAL undefined would be caught: it hashes differently from the sentinel (never silently equal)",
    fp(base, { ...PROV, matcherVersion: undefined as unknown as string }) !== fp(base, { ...PROV, matcherVersion: MATCHER_VERSION_NONE }));

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · ONE HOME PER FACT — `structure` == `construction_data.net`, on every persisted row.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const drift = await q<{ n: number; total: number }>(
    `SELECT COUNT(*) FILTER (WHERE construction_data IS NOT NULL
              AND ABS(structure - (construction_data->>'net')::numeric) > 0.005)::int AS n,
            COUNT(*) FILTER (WHERE construction_data IS NOT NULL)::int AS total
     FROM portfolio_health_snapshot`);
  ok("no persisted row disagrees with its own evidence (structure == construction_data.net)",
    drift[0].n === 0, `${drift[0].total} rows carry construction_data · ${drift[0].n} drifted`);
  // the STRUCTURAL guarantee, not just the current state: both come from ONE object in ONE write.
  const src = await import("fs").then((fs) => fs.readFileSync("src/portfolio/phs/persist.ts", "utf8"));
  ok("…and it is structural: `structure` is assigned FROM cData.net, and cData has exactly one builder",
    /structure:\s*new Prisma\.Decimal\(cData\.net\)/.test(src) && (src.match(/constructionDataOf\(/g) ?? []).length === 1,
    "persist.ts writes both from the same in-memory object");
  ok("`state` is NOT persisted (a pure function of evaluable+points — a fact with zero homes cannot drift)",
    !/["']state["']\s*:/.test(src) && !src.includes("constructionBand:"), "band + state stay derived at read");
  // sleeves ≡ exposures — the engine no longer computes one fact twice
  const probe = [S("A", "INE001A01011", 400_000, "banks"), FUND("F", "INF001A01011", 600_000, "HDFC")];
  const e = buildExposures(probe, 1_000_000);
  ok("buildSleeves COLLAPSED into buildExposures — byte-identical projection, not a parallel sum",
    JSON.stringify(buildSleeves(probe, 1_000_000)) === JSON.stringify(sleevesOf(e)) &&
    buildSleeves(probe, 1_000_000).nameRisk === e.nameRisk && buildSleeves(probe, 1_000_000).basket === e.basket,
    `nameRisk ${e.nameRisk.toFixed(4)} · basket ${e.basket.toFixed(4)}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · THE CATALOGUED-not-scored BOND TRIGGER — reachable, and its resolution moves the hash.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const bonds = await q<{ total: number; with_stock: number }>(
    `SELECT COUNT(*)::int AS total, COUNT(stock_id)::int AS with_stock FROM instruments WHERE asset_class = 'bond'`);
  ok("the OLD symbol trigger is STRUCTURALLY blind to bonds — 0 of them carry a stock_id to match on",
    bonds[0].with_stock === 0, `${bonds[0].total} bonds catalogued · ${bonds[0].with_stock} with a stock relation`);
  // the two halves of the chain: (a) the trigger can SELECT the holder, (b) the recompute WRITES.
  const trigSrc = await import("fs").then((fs) => fs.readFileSync("src/portfolio/phs/refresh.ts", "utf8"));
  ok("(a) the NEW trigger selects on the ISIN STEM + assetClass='bond' — needing no stock relation",
    /refreshPhsForCataloguedIsins/.test(trigSrc) && /assetClass:\s*"bond"/.test(trigSrc) && /startsWith/.test(trigSrc));
  ok("(a) …and it reads BOTH holding tables, broker included WITHOUT an `enabled` filter (severed ≠ gone)",
    /prisma\.holding\.findMany/.test(trigSrc) && /prisma\.brokerHolding\.findMany/.test(trigSrc));
  // (b) a bond's sector resolving genuinely moves that book's fingerprint → the recompute writes.
  const bondUnres = [S("NTPC", "INE733E01010", 500_000, null), BOND("NTPC-NCD", "INE733E07AB1", 500_000, null)];
  const bondRes = [S("NTPC", "INE733E01010", 500_000, "oil_gas_energy"), BOND("NTPC-NCD", "INE733E07AB1", 500_000, "oil_gas_energy")];
  ok("(b) the issuer's sector resolving moves that book's hash ⇒ the triggered recompute WRITES (not a no-op)",
    fp(bondUnres) !== fp(bondRes));
  const wired = await import("fs").then((fs) => fs.readFileSync("src/scripts/apply-nifty500-pass1-sectors.ts", "utf8"));
  ok("the trigger is WIRED to the real event — the script that actually resolves sectors calls it",
    /refreshPhsForCataloguedIsins\(/.test(wired), "apply-nifty500-pass1-sectors.ts (there is no runtime symbol-master job — this IS the event)");

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("7 · DEAD COLUMNS GONE — dropped from the TABLE, not merely unwritten.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const dead = await q<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'portfolio_health_snapshot' AND column_name IN ('phs_raw','ceiling_applied','ceiling_value')`);
  ok("phs_raw / ceiling_applied / ceiling_value are GONE from the table", dead.length === 0, `${dead.length} still present`);
  ok("…and structure_tier SURVIVES (patterns.ts still reads r.structureTier — Stage 9, cv2-s6-delete-defer)",
    (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name='portfolio_health_snapshot' AND column_name='structure_tier'`))[0].n === 1);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("8 · neffUnitSectored CARRIES THE UNIT VALUE — §12's name said 'pos'; the ruling says units.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // 3 positions, 2 entities: NTPC stock + NTPC bond are ONE unit in Energy; HDFCBANK is a second in
  // Financials. A POSITION-based Neff would see 3 things collapsing into 2 sectors and charge for it.
  const unitBook = [S("NTPC", "INE733E01010", 250_000, "oil_gas_energy"), BOND("NTPC-NCD", "INE733E07AB1", 250_000, "oil_gas_energy"), S("HDFCBANK", "INE040A01034", 500_000, "banks")];
  const rU = computePhs(unitBook);
  const cdU = constructionDataOf(rU.construction, rU.entityLedger, rU.basketLedger, rU.sectors, unitBook.length, unitBook.filter((h) => h.health != null).length);
  ok("3 positions → 2 entities (the NTPC pair aggregates)", rU.entityLedger.length === 2);
  ok("neff.unitSectored = 2.00 (UNITS = entities). Positions would give 3 — and would break the C4 guarantee",
    cdU.neff.unitSectored != null && Math.abs(cdU.neff.unitSectored - 2) < 0.01, `${cdU.neff.unitSectored?.toFixed(2)} · holdingCount ${cdU.holdingCount} (positions)`);
  ok("C4 = 0 — the anti-double-charge still holds (every unit owns its sector)", rU.construction.c4.points === 0);
  // THE GAP THIS CLOSED: the Neffs are present when the rule is CLEAN (they used to live only in prose).
  ok("the Neffs survive a CLEAN rule — recoverable as FIELDS, not by parsing `detail`",
    cdU.neff.entity != null && cdU.neff.sector != null && cdU.neff.unitSectored != null && rU.construction.c4.points === 0,
    `entity ${cdU.neff.entity?.toFixed(2)} · unitSectored ${cdU.neff.unitSectored?.toFixed(2)} · sector ${cdU.neff.sector?.toFixed(2)} — all with C4 clean`);
  ok("§12's shares land too: unknownSectorRatio + houseUnknown (measured by C5, projected here)",
    typeof cdU.shares.unknownSectorRatio === "number", `unknownSectorRatio ${cdU.shares.unknownSectorRatio.toFixed(4)} · houseUnknown ${cdU.shares.houseUnknown === null ? "null (no funds — never a fabricated 0)" : cdU.shares.houseUnknown}`);
  ok("the entity ledger is persisted with its constituents — THIS is the NTPC story (PC3)",
    cdU.entities.length === 2 && cdU.entities.some((x) => x.constituentInstruments.length === 2),
    cdU.entities.map((x) => `${x.displayName}:${x.constituentInstruments.length}`).join(" · "));
  // REFUSED (ODL cv2-s7-refuse-live-facts)
  const cdKeys = Object.keys(cdU);
  ok("REFUSED: unvaluedShare / unvaluedValue / provisionalConstruction are NOT persisted (live facts)",
    !cdKeys.some((k) => /unvalued|provisional/i.test(k)), `keys: ${cdKeys.join(", ")}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("9 · DRY-RUN (§12) — the projected write/skip. NOTHING HERE WRITES.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // The split is a POINT IN TIME, not a constant: 5-write BEFORE the mass backfill (the §12 hash shape
  // changed for every book), 0-write AFTER (idempotent). Pinning either is the ruling-② error — a value
  // a legitimate, expected operation changes. (It was pinned at 5/0 first, and went red the moment the
  // backfill landed. Third time that lesson has been learned; it is written down properly now.)
  // So: assert the PROPERTY that holds in both states, and NAME which state the cohort is in.
  let willWrite = 0;
  for (const uid of users) {
    const asm = await assemblePortfolio(uid);
    const stored = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: uid }, orderBy: { createdAt: "desc" }, select: { fingerprint: true } });
    const fresh = fingerprintOf(asm.holdings, asm.prov);
    const writes = fresh !== stored?.fingerprint;
    if (writes) willWrite++;
    console.log(`  ${uid.slice(0, 8)} · ${writes ? "WILL WRITE (inputs moved since its served row)" : "would skip (served row is current)"}`);
  }
  const allWrite = willWrite === users.length, allSkip = willWrite === 0;
  ok("the cohort is in a COHERENT state — all-write (mass backfill pending) or all-skip (it landed, idempotent)",
    allWrite || allSkip,
    allSkip ? `0 write / ${users.length} skip → THE BACKFILL LANDED. This is Gate 3 item 2's skip direction, proven on the LIVE cohort.`
      : allWrite ? `${willWrite} write / 0 skip → the §12 shape change reaches every book; the mass write is pending.`
      : `MIXED (${willWrite} write / ${users.length - willWrite} skip) — legitimate if a book just moved, but a mixed split is also the signature of a PARTIAL apply or a stale racer (ODL cv2-scheduler-hazard). Inspect.`);
  if (allSkip) ok("…and idempotency is the whole gate: unchanged inputs ⇒ unchanged hash ⇒ no churn", true, "re-running the backfill would write nothing");

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  rule("10 · SAME-RUN-DELTA — the catalog did not move DURING this proof.");
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const catalogAfter = await catalogSnapshot();
  for (const t of Object.keys(catalogBefore)) {
    const held = catalogBefore[t] === catalogAfter[t];
    ok(`${t} · same-run-delta`, held, held ? catalogBefore[t] : `DRIFTED ${catalogBefore[t]} → ${catalogAfter[t]} — a scheduler leaked into the build (ODL cv2-scheduler-hazard)`);
  }
  ok("95 scored stocks (STRUCTURAL: cohort size is price-independent)", catalogBefore["scored-stocks"].startsWith("95:"), catalogBefore["scored-stocks"]);

  console.log(`\n${fail === 0 ? "✅ STAGE 7 VERIFIED — the fingerprint gates both ways; every §12 input is in it; one home per fact; Health untouched" : `❌ ${fail} FAILURE(S)`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch((e) => { console.error("VERIFY ERROR:", e?.message ?? e, e?.stack); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
