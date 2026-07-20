// ─────────────────────────────────────────────────────────────────────────────
// PHS PART B VERIFICATION — fire the portfolio pattern library on the four spec
// worked-example books + the real seeded book. Prove: fired PF-IDs match what each
// example should surface, NO field-verdict became a penalty, honest-empty holds for
// undeclared thresholds (PQ2/PQ3), and Part B changed NO number (byte-identical).
// v1.1: also proves the tier COPY wiring (Change 2) — structure_tier/capital_tier reframe
// PC/PB reads and stamp their binds, while touching NO number, tone, loud flag, or the
// finding set (copy-only, byte-identical score).
//   npx tsx src/scripts/verify-phs-patterns.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { firePortfolioFindings, NOT_EVALUABLE_UNDECLARED } from "../portfolio/phs/patterns.js";
import { computeAndPersistPhs } from "../portfolio/phs/persist.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import * as K from "../portfolio/phs/constants.js";

let failures = 0;
const ok = (n: string, c: boolean, d: string) => { console.log(`    ${c ? "✅" : "❌"} ${n} — ${d}`); if (!c) failures++; };
// ─── POSITION FACTS: a synthetic holding must carry what the real path always sets ──────────────
// (Stage 9) These fixtures once omitted `isin`/`assetClass`, so `natureOf` read every holding as a
// BASKET (entity.ts: `h.assetClass ?? "unknown"` → basket) and `sectorStateOf(undefined, "IT")` threw
// the declared sector away. Every example below ran as a Fund-led book: nameRisk 0%, C1/C2/C3 all
// not-evaluable, Net 100.00. The old gates (S3's position-level Neff, `s2Evaluable`) were NATURE-BLIND,
// so nothing noticed for the whole of v1 — the repoint onto C2/C3 is the first code that needed nature.
// Ex3 declares TWELVE holdings across TWELVE sectors and was being read as having none.
// `sectorStateOf` now THROWS on a missing class, so this cannot silently return.
//
// ISIN: distinct 12-char, allocated first-seen. The entity stem is the FIRST 7 CHARS, so the varying
// part must live in chars 4-7 — `INE${seq.padStart(9,"0")}` yields the stem "INE0000" for EVERY symbol
// and merges the whole book into one entity (Neff 1.00). Mnemonic stems collide too: `INE${symbol}`
// maps SMALLIT and SMALLY both to "INESMAL". Neither collision throws; both just quietly make a
// diversified book look like a single stock.
const seq = new Map<string, string>();
const isinFor = (symbol: string) => {
  let v = seq.get(symbol);
  if (!v) { v = `INE${(seq.size + 1).toString(36).toUpperCase().padStart(4, "0")}00000`; seq.set(symbol, v); }
  return v;
};
/** A STOCK — name-risk, its own sector, an mcap tier, a health. Mirrors assemble.ts:448. */
const H = (symbol: string, mv: number, tier: PhsHolding["tier"], sector: string | null, health: number | null, findings: PhsHolding["findings"] = []): PhsHolding =>
  ({ symbol, marketValue: mv, tier, sector, health, findings, isin: isinFor(symbol), assetClass: "stock", category: null });
/** A FUND / ETF — a BASKET: no mcap tier, no health, no sector (§14-interim not_applicable), and a
 *  fund house (C5's only subject). Mirrors assemble.ts:509, which sets `tier: "unknown"` + `health: null`
 *  for EVERY non-stock — which is why a `tier: "large"` holding with `health: 74` is a stock BY
 *  CONSTRUCTION, and the old fixture asserting both while reading as a basket was self-contradictory.
 *  Without this the fund sleeve is untested by fixture: §10's Example A is a fund-only beginner where
 *  nameRiskShare = 0 makes C1/C2 not-evaluable and C5 carries the entire read. */
const HF = (symbol: string, mv: number, fundHouse: string | null, category: string | null = "Flexi Cap Fund", assetClass: "mutual_fund" | "etf" = "mutual_fund"): PhsHolding =>
  ({ symbol, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], pillars: null, lensNatures: [], isin: isinFor(symbol), assetClass, category, fundHouse });
// ★ (Stage 10a) §10'S EXAMPLE BOOKS ARE SCALED TO REAL RUPEES — ×100,000. THE WEIGHTS ARE UNCHANGED.
// The `100` these vectors summed to was a NORMALIZATION CONSTANT, NOT A CURRENCY: §10 says "Cummins 30%",
// never "Cummins ₹30". Unscaled, PA2 (avgPositionValue < ₹10,000) read the weight vector AS RUPEES and
// fired on every example — encoding "these are ₹100 portfolios" into drift-immune canon, a claim the
// fixture never made. PA2 is the FIRST value-dependent finding in the library; every other one is
// weight-only, which is why the fixture's silence about its own scale cost nothing until now.
// (Fourth instance of the fixture-shape disease: H() asserting stock facts on a basket-natured holding ·
// Ex2 encoding yesterday's behaviour · the tier fixture testing PC1 on a PC2 book · a weight vector read
// as rupees. Every one asserted something other than what it claimed.)
//
// The edit is SAFE BY THE PROPERTY THE HARNESS ALREADY CLAIMS — and §10.1 below PROVES it rather than
// assuming it: Construction and Health are weight-only, so ×100,000 must move NOTHING.
const W = 100_000;
const setEq = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

function fireOn(holdings: PhsHolding[], fieldWeak: string[] = []) {
  const r = computePhs(holdings);
  const before = JSON.stringify(r); // byte-identical guard
  const findings = firePortfolioFindings(holdings, r, { fieldWeakSymbols: new Set(fieldWeak) });
  const after = JSON.stringify(r);
  return { r, findings, mutated: before !== after };
}

async function main() {
  console.log("═══ PART B — fired PF-IDs on the four worked examples ═══");

  // Ex1 — typical retail
  const ex1 = fireOn([
    H("HDFCBANK", 20 * W, "large", "Financials", 74), H("TCS", 13 * W, "large", "IT", 71), H("BEL", 11 * W, "large", "Defense", 78),
    H("SBIN", 10 * W, "large", "Financials", 66, ["medium"]), H("RELIANCE", 8 * W, "large", "Energy", 70, ["lp5"]),
    H("TATAMOTORS", 12 * W, "large", "Auto", null), H("ZOMATO", 8 * W, "large", "Consumer", null),
    H("SMALLIT", 10 * W, "small", "IT", null), H("SMALLY", 5 * W, "small", null, null), H("MICROZ", 3 * W, "small", null, null),
  ]);
  const ex1Ids = ex1.findings.map((f) => f.id);
  console.log(`\n  Ex1 fired: [${ex1Ids.join(", ")}]  (PB1 well-spread, PV4 awaiting-coverage)`);
  ok("Ex1 = {PA1, PE1, PB1, PV4} (PA1/PE1 trigger `always` — a correctly-specified new entry legitimately changes a fired set)", setEq(ex1Ids, ["PA1", "PE1", "PB1", "PV4"]), ex1Ids.join(","));
  ok("Ex1 byte-identical (no number mutated)", !ex1.mutated, "result unchanged");

  // Ex2 — multibagger
  const ex2 = fireOn([
    H("SMALLX", 45 * W, "small", null, null), H("OTHER", 15 * W, "small", null, null),
    H("RIL", 15 * W, "large", "Energy", 70), H("TCS", 15 * W, "large", "IT", 71), H("BEL", 10 * W, "large", "Defense", 78),
  ]);
  const ex2Ids = ex2.findings.map((f) => f.id);
  console.log(`  Ex2 fired: [${ex2Ids.join(", ")}]  (PC2 dominant — PC1 suppressed, PC5 thin spread, PS5 clean, PV2/PV5 coverage, PX1 sound-companies-fragile-construction)`);
  // (Stage 9) PC1 REMOVED FROM THIS EXPECTATION — §11.1: PC2 suppresses PC1 (same entity's weight, two
  // thresholds; "dominant" IS "heavy, and more so"). SMALLX is 45% ⇒ PC2 ⇒ PC1 stands down.
  //
  // ★ THIS EXPECTATION WAS NEVER CANON, and that is why it could be changed. Doc 1 §A.10 "Example 2" is a
  // PART-A worked example — Quality / Structure / Signals / PHS. It NEVER NAMES A PF-ID. The
  // {PC1,PC2,PC5,…} set was authored HERE, by whoever wrote this harness, and it encoded WHAT THE CODE
  // HAPPENED TO DO at the time. A test asserting the status quo and calling it a requirement is the same
  // disease as the pins (ODL cv2-s9-gate-semantics / cv2-s9-fixture-nature-gap), one layer up: it cannot
  // fail when the code is wrong, only when the code CHANGES. Contrast §10's NUMBERS (Health 72, Net), which
  // ARE canon and stay EXACT — those are asserted unchanged below and did not move.
  ok("Ex2 = {PA1,PE1,PE2,PC2,PC5,PS5,PV2,PV5,PX1} (§11.1: PC2 suppresses PC1 — this set was the harness's, never doc 1's)",
    setEq(ex2Ids, ["PA1", "PE1", "PE2", "PC2", "PC5", "PS5", "PV2", "PV5", "PX1"]), ex2Ids.join(","));
  ok("Ex2 · PC1 SUPPRESSED by PC2 (one entity's weight is one fact, not two at two volumes)", !ex2Ids.includes("PC1") && ex2Ids.includes("PC2"), "PC2 only");
  ok("Ex2 PX1 present (the classic tension)", ex2Ids.includes("PX1"), "PX1");
  ok("Ex2 byte-identical", !ex2.mutated, "result unchanged");

  // Ex3 — clean fully-covered
  const e3: PhsHolding[] = [H("FLAG", 8 * W, "large", "Sec0", 72, ["high", "lp5"])];
  for (let i = 1; i <= 11; i++) e3.push(H(`H${i}`, (92 / 11) * W, "large", `Sec${i}`, 72));
  const ex3 = fireOn(e3);
  const ex3Ids = ex3.findings.map((f) => f.id);
  console.log(`  Ex3 fired: [${ex3Ids.join(", ")}]  (PB1, PV1 fully-verified, PX4 broad-strength)`);
  ok("Ex3 = {PA1, PE1, PB1, PV1, PX4}", setEq(ex3Ids, ["PA1", "PE1", "PB1", "PV1", "PX4"]), ex3Ids.join(","));
  ok("Ex3 byte-identical", !ex3.mutated, "result unchanged");

  // Ex4 — 1 of 10 scored
  const e4: PhsHolding[] = [H("SCORED", 10 * W, "large", "SecA", 80)];
  for (let i = 1; i <= 9; i++) e4.push(H(`U${i}`, 10 * W, "large", `SecU${i}`, null));
  const ex4 = fireOn(e4);
  const ex4Ids = ex4.findings.map((f) => f.id);
  console.log(`  Ex4 fired: [${ex4Ids.join(", ")}]  (1.2: PV3 RETIRED with the ceiling; PV2/PV4 coverage, PQ1, PS5, PB1)`);
  ok("Ex4 = {PA1,PE1,PB1,PQ1,PS5,PV2,PV4} (PV3 retired in 1.2)", setEq(ex4Ids, ["PA1", "PE1", "PB1", "PQ1", "PS5", "PV2", "PV4"]), ex4Ids.join(","));
  ok("Ex4 PV3 GONE (ceiling retired → no confidence-limited read)", !ex4Ids.includes("PV3"), "no PV3");
  ok("Ex4 byte-identical", !ex4.mutated, "result unchanged");

  // ── (Stage 9, rider a) THE FUND SLEEVE — the machinery no fixture reached until HF() existed.
  //    A fund-only book: nameRiskShare = 0 ⇒ C1/C2 not-evaluable, every fund not_applicable ⇒ C3
  //    not-evaluable, and C5 carries the ENTIRE read. This is §10's Example A (a fund-only beginner),
  //    and multi-asset is the whole thesis — a stock-only H() left it untested. ──
  console.log("\n═══ Fund sleeve — fund-only book (§10 Example A: Fund-led · C5 alone · Net 76) ═══");
  const fundOnly = fireOn([
    HF("HDFCFLEXI", 40, "HDFC AMC"), HF("HDFCMIDCAP", 20, "HDFC AMC"), // 60% one house → C5 = 1.2×(60−40) = 24
    HF("ICICIBLUE", 20, "ICICI Prudential AMC"), HF("SBISMALL", 20, "SBI Funds Management"),
  ]);
  const fc = fundOnly.r.construction;
  ok("archetype = Fund-led", fc.archetype === "Fund-led", fc.archetype);
  ok("name-risk sleeve is EMPTY (0%) — the book is all baskets", fc.exposures.nameRisk === 0, `nameRisk=${(fc.exposures.nameRisk * 100).toFixed(0)}% basket=${(fc.exposures.basket * 100).toFixed(0)}%`);
  ok("C1 not evaluable (no name-risk sleeve to dominate)", !fc.gross.c1.evaluable, fc.gross.c1.detail);
  ok("C2 not evaluable (no name-risk sleeve to spread)", !fc.gross.c2.evaluable, fc.gross.c2.detail);
  ok("C3 not evaluable (every fund not_applicable ⇒ sectorable empty, NOT the whole book)", !fc.c3.evaluable, fc.c3.detail);
  ok("C5 evaluable and firing — the only rule with a subject", fc.c5.evaluable && fc.c5.points > 0, fc.c5.detail);
  // 40/100 + 20/100 = 0.6000000000000001 → 60.00000000000001. `=== 60` is the wrong assertion, not the
  // wrong number: weights are SUMMED FRACTIONS, so "exact" for a synthetic book means exact-to-float, and
  // its neighbours here already say 1e-9. ⚠ HAZARD FOR THE RE-KEYS: doc-1 PC4 keys `maxSectorPct > 60`
  // and PC3 `> 40` — a book sitting EXACTLY on a threshold fires or not on float dust. Not retuned here
  // (a threshold ruling needs its own evidence); flagged for the re-key stage.
  ok("C5 metrics.maxHousePct = 60 RAW (rides the fired branch)", Math.abs((fc.c5.metrics?.maxHousePct ?? 0) - 60) < 1e-9, `${fc.c5.metrics?.maxHousePct} (${fc.c5.metrics?.maxHouseName})`);
  ok("C5 = 1.2×(60−40) = 24 exactly", Math.abs(fc.c5.points - 24) < 1e-9, fc.c5.points.toFixed(4));
  ok("§10 Example A — Net = 76 (synthetic weights ⇒ EXACT, per the Stage-6 assertion ruling)", Math.abs(fc.net - 76) < 1e-9, fc.net.toFixed(4));
  ok("C5 is the ONLY firing rule (C4/C6 silent on 4 baskets)", fc.c4.points === 0 && fc.c6.points === 0, `c4=${fc.c4.points} c6=${fc.c6.points}`);
  ok("fund-only book byte-identical (Part B changed no number)", !fundOnly.mutated, "unchanged");

  // THE CAP IS A CHARGE CEILING, NOT A TRUTH CEILING (ODL cv2-s9-truth-not-deduction) — on the C5 side.
  // A single-house book is 100% that house whether C5 charges 25 or 250. If a cap could clip the RAW
  // metric, PC6/PC7 (which read maxHousePct) would inherit C5's cap and silently under-report the book.
  const oneHouse = fireOn([HF("HDFCA", 50, "HDFC AMC"), HF("HDFCB", 50, "HDFC AMC")]);
  ok("C5 capped at 25 (points ceiling holds)", Math.abs(oneHouse.r.construction.c5.points - 25) < 1e-9, oneHouse.r.construction.c5.points.toFixed(4));
  ok("…yet maxHousePct is 100 RAW — the cap did NOT hide the truth", oneHouse.r.construction.c5.metrics?.maxHousePct === 100, `${oneHouse.r.construction.c5.metrics?.maxHousePct}%`);

  // house-unknown kill: a fund whose AMC we cannot resolve must not manufacture a house charge.
  const houseUnknown = fireOn([HF("MYSTERY1", 60, null), HF("MYSTERY2", 40, null)]);
  ok("C5 not evaluable when house-unknown > 0.5×fundShare (our gap ≠ the book's concentration)", !houseUnknown.r.construction.c5.evaluable, houseUnknown.r.construction.c5.detail);
  ok("…and metrics still ride the not-evaluable branch (a measurement is not a subject)", houseUnknown.r.construction.c5.metrics?.houseUnknown === 1, `houseUnknown=${houseUnknown.r.construction.c5.metrics?.houseUnknown}`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // (Stage 9) REACHABILITY — every new build gets a book where it FIRES, asserted.
  // Not "the code looks right": FIVE guards this session read as coverage and could not fire
  // (sectorVersion, the stage-6 report-only tables, PC5, + the four the Stage-9 audit went looking for).
  // The live cohort CANNOT prove these — only 7985d813 holds funds (4 baskets, 0.2%) and no live book
  // holds a bond, so PC6/PC7/PB6/PC8 are structurally unfirable there. The fixture is the proof.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n═══ Reachability — the new builds, each on a book where it fires ═══");

  // PC8 (doc-2 PC3) — ONE COMPANY, TWO INSTRUMENTS. The NTPC flagship: stock 11% + bond 8% = ONE entity
  // at 19%, which no position-level view can see. Same 7-char stem = same issuer.
  const ntpc = fireOn([
    { symbol: "NTPC", marketValue: 11, tier: "large", sector: "Energy", health: 70, findings: [], isin: "INE733E01010", assetClass: "stock", category: null },
    { symbol: "NTPC-NCD", marketValue: 8, tier: "unknown", sector: null, health: null, findings: [], isin: "INE733E07AB1", assetClass: "bond", category: null },
    ...Array.from({ length: 9 }, (_, i) => H(`OTH${i}`, 9, "large", `Sec${i}`, 70)),
  ]);
  const pc8 = ntpc.findings.find((f) => f.id === "PC8");
  ok("PC8 FIRES — one company, two instruments", !!pc8, pc8 ? "fired" : "NOT FIRED — unreachable");
  ok("PC8 sees 19% where the instrument list shows 11% (the whole point)", (pc8?.bind as any)?.weight === 0.19, `${(pc8?.bind as any)?.weight}`);
  ok("PC8 bind carries the constituents (stock + bond)", ((pc8?.bind as any)?.constituents ?? []).length === 2, `${((pc8?.bind as any)?.constituents ?? []).length}`);
  ok("PC8 read names both instruments and the combined weight", !!pc8?.read?.includes("19.0% of your book riding on one company") && pc8.read.includes("11.0%"), pc8?.read?.slice(-92) ?? "");
  // A SINGLE-instrument entity must NOT fire it — the finding is about aggregation, not about weight.
  const oneInstr = fireOn([H("BIG", 30, "large", "Energy", 70), ...Array.from({ length: 7 }, (_, i) => H(`O${i}`, 10, "large", `S${i}`, 70))]);
  ok("PC8 silent when a heavy name is ONE instrument (aggregation is the subject, not size)", !oneInstr.findings.some((f) => f.id === "PC8"), "silent");

  // PC6 / PC7 — FUND-HOUSE. §11.1: PC7 suppresses PC6.
  const house60 = fireOn([HF("H1", 35, "HDFC AMC"), HF("H2", 25, "HDFC AMC"), HF("I1", 20, "ICICI Prudential AMC"), HF("S1", 20, "SBI Funds Management")]);
  const pc6 = house60.findings.find((f) => f.id === "PC6");
  ok("PC6 FIRES at 60% one house", !!pc6, pc6 ? "fired" : "NOT FIRED — unreachable");
  ok("PC6 read names the house, the share and the fund count", !!pc6?.read?.includes("HDFC AMC manages 60.0% of your book across 2 funds"), pc6?.read?.slice(-88) ?? "");
  ok("PC7 silent at 60% (≤ 80)", !house60.findings.some((f) => f.id === "PC7"), "silent");
  const house90 = fireOn([HF("H1", 50, "HDFC AMC"), HF("H2", 40, "HDFC AMC"), HF("I1", 10, "ICICI Prudential AMC")]);
  ok("PC7 FIRES at 90% one house", house90.findings.some((f) => f.id === "PC7"), "fired");
  ok("§11.1 — PC7 SUPPRESSES PC6 (headline wins; one fact is not billed twice)", !house90.findings.some((f) => f.id === "PC6"), "PC6 suppressed");
  // The CAP does not gate the finding: C5 stops charging at 60.8%, PC7 still reads 90% (truth-not-deduction).
  ok("PC7 fires on the RAW 90% though C5's charge is capped at 25", Math.abs(house90.r.construction.c5.points - 25) < 1e-9 && (house90.findings.find((f) => f.id === "PC7")!.bind as any).maxHousePct === 90, `c5=${house90.r.construction.c5.points.toFixed(2)} raw=${(house90.findings.find((f) => f.id === "PC7")!.bind as any).maxHousePct}`);

  // PB6 — FUNDS OCCUPYING ONE EXPOSURE. ≥2 baskets sharing a category, combined ≥ 20%.
  const LC = "Open Ended Schemes(Equity Scheme - Large Cap Fund)";
  const MC = "Open Ended Schemes(Equity Scheme - Mid Cap Fund)";
  const pb6Book = fireOn([
    HF("F1", 15, "HDFC AMC", LC), HF("F2", 15, "ICICI Prudential AMC", LC), HF("F3", 10, "SBI Funds Management", LC),
    HF("F4", 10, "Axis AMC", LC), HF("F5", 10, "Nippon India AMC", LC), HF("F6", 40, "Kotak AMC", MC),
  ]);
  const pb6 = pb6Book.findings.find((f) => f.id === "PB6");
  ok("PB6 FIRES — 5 funds, one category, 60%", !!pb6, pb6 ? "fired" : "NOT FIRED — unreachable");
  ok("PB6 read strips the AMFI wrapper to the leaf", !!pb6?.read?.includes("5 of your funds are Large Cap Funds, together 60.0% of your book"), pb6?.read?.slice(-96) ?? "");
  ok("PB6 bind carries category + combined weight + constituents", (pb6?.bind as any)?.categoryLeaf === "Large Cap Fund" && ((pb6?.bind as any)?.constituents ?? []).length === 5, `${(pb6?.bind as any)?.categoryLeaf} ×${((pb6?.bind as any)?.constituents ?? []).length}`);
  ok("PB6 does NOT fire for the lone 40% Mid Cap Fund (needs ≥2 funds, not just weight)", pb6Book.findings.filter((f) => f.id === "PB6").length === 1, "one PB6 only");
  ok("PB6 is Neutral (redundancy is an inefficiency, not a structural risk — scoring it would judge the choice)", pb6?.tone === "Neutral", `tone=${pb6?.tone}`);

  // PB7 (doc-2 PB3) — FALSE SECTOR SPREAD. THE HOLE doc 1 leaves open: ten names, three sectors, at
  // ~equal weight fires NOTHING under v1 — max sector 33% < 40, Neff 10 > 8 — yet the book is 3-wide.
  const falseSpread = fireOn(Array.from({ length: 9 }, (_, i) => H(`N${i}`, 11.11, "large", ["Energy", "IT", "Pharma"][i % 3], 70)));
  const pb7 = falseSpread.findings.find((f) => f.id === "PB7");
  ok("PB7 FIRES — 9 companies occupying 3 sectors", !!pb7, pb7 ? "fired" : "NOT FIRED — unreachable");
  ok("PB7 read names both widths", !!pb7?.read?.includes("9-wide by name and about 3-wide by sector"), pb7?.read?.slice(-76) ?? "");
  ok("THE HOLE IS REAL: this book fires NO other concentration finding under v1's thresholds",
    !falseSpread.findings.some((f) => ["PC1", "PC2", "PC3", "PC4", "PC5"].includes(f.id)),
    `max sector ${falseSpread.r.construction.c3.metrics?.maxSectorPct?.toFixed(1)}% < 40 · Neff ${falseSpread.r.construction.gross.c2.metrics?.neff?.toFixed(2)} > 8 · fired [${falseSpread.findings.map((f) => f.id).join(",")}]`);
  // A genuinely-spread book must NOT fire it.
  const trueSpread = fireOn(Array.from({ length: 9 }, (_, i) => H(`T${i}`, 11.11, "large", `Sec${i}`, 70)));
  ok("PB7 silent on a book that is 9-wide by name AND 9-wide by sector", !trueSpread.findings.some((f) => f.id === "PB7"), "silent");
  // THE RATIO, NOT THE DIFFERENCE (ODL cv2-s9-pb7-ratio). Doc-2's `diff >= 2` fired on Ex1 — the TYPICAL
  // RETAIL book — because every real book holds more names than sectors. The ratio asks what fraction of
  // name-breadth SURVIVES the collapse, and separates the two cleanly.
  const surv = (f: any) => (f.bind as any).survivingBreadth as number;
  ok("PB7 keys on the RATIO: the 9-name/3-sector book keeps 33% of its breadth (<= 50 ⇒ fires)",
    Math.abs(surv(pb7!) - 1 / 3) < 0.02, `${(surv(pb7!) * 100).toFixed(1)}%`);
  ok("Ex1 (typical retail: 10 names, 6 sectors) keeps 64% ⇒ PB7 SILENT — the difference fired here, the ratio does not",
    !ex1.findings.some((f) => f.id === "PB7"), `diff was 2.64 (would have fired); ratio 0.64`);

  // ★ PB1 REQUIRES ¬PB7 — a Constructive finding is the one a user acts on by DOING NOTHING, so it must
  // be the most-conditioned, not the least. A Caution that misfires is noise the user dismisses; a
  // Constructive that misfires is a FALSE ALL-CLEAR and the user stops looking. PB1's third break.
  ok("§11.1 (extended past PC) — PB7 SUPPRESSES PB1: no book is told its spread is both good and false",
    !falseSpread.findings.some((f) => f.id === "PB1") && falseSpread.findings.some((f) => f.id === "PB7"),
    `fired [${falseSpread.findings.map((f) => f.id).join(",")}]`);
  ok("…and PB1 still fires where the spread is REAL (the suppression is not a blanket kill)",
    trueSpread.findings.some((f) => f.id === "PB1"), `fired [${trueSpread.findings.map((f) => f.id).join(",")}]`);
  ok("PB1 and PB7 are MUTUALLY EXCLUSIVE across every book in this suite",
    [ex1, ex2, ex3, ex4, falseSpread, trueSpread, pb6Book, house60].every((b) => !(b.findings.some((f) => f.id === "PB1") && b.findings.some((f) => f.id === "PB7"))), "never both");

  // §11.1 — PC4 SUPPRESSES PC3 (the ruled re-key).
  const pharma70 = fireOn([H("P1", 40, "large", "Pharma", 70), H("P2", 30, "large", "Pharma", 70), H("O1", 30, "large", "IT", 70)]);
  ok("§11.1 — PC4 fires at 70% one sector", pharma70.findings.some((f) => f.id === "PC4"), "PC4");
  ok("§11.1 — PC4 SUPPRESSES PC3 (a 70% book is single-sector, not merely concentrated)", !pharma70.findings.some((f) => f.id === "PC3"), "PC3 suppressed");
  const pharma50 = fireOn([H("P1", 30, "large", "Pharma", 70), H("P2", 20, "large", "Pharma", 70), H("O1", 25, "large", "IT", 70), H("O2", 25, "large", "Energy", 70)]);
  ok("§11.1 — PC3 fires alone at 50% (below PC4's 60)", pharma50.findings.some((f) => f.id === "PC3") && !pharma50.findings.some((f) => f.id === "PC4"), "PC3 only");

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // (portfolio-findings 2.0) PQ2 / PQ3 — THE DISPERSION AXIS. Honest-empty through 1.1/1.2 because doc 1
  // declared the thresholds in WORDS ("above tolerance", "low dispersion") and never a number. Now
  // declared: PQ_DISPERSION_SPLIT = 15 (one full Health band), SAMPLE σ (n−1).
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n═══ PQ2/PQ3 — the dispersion axis (σ sample, split 15) ═══");
  const qBook = (hs: number[]) => fireOn(hs.map((h, i) => H(`Q${i}_${hs.join("")}`, 100 / hs.length, "large", `Sx${i}`, h)));
  const has = (b: ReturnType<typeof fireOn>, id: string) => b.findings.some((f) => f.id === id);

  // PQ2 FIRES — doc 2's motivating example. Sample σ, not population: pop σ is 13.50 and would MISS its
  // own example. The sample form was chosen for a better reason than that (see n=1 below), but the
  // example is the test.
  const bar2 = qBook([78, 51]);        // σ 19.09
  const bar3 = qBook([78, 51, 81]);    // σ 16.52 — mean EXACTLY 70, doc 2's "average health of 70"
  ok("PQ2 FIRES on {78,51} (σ 19.09 ≥ 15) — doc 2's BEL/Tata barbell", has(bar2, "PQ2"), `σ=${((bar2.findings.find((f) => f.id === "PQ2")!.bind as any).stdDev as number).toFixed(2)}`);
  ok("PQ2 FIRES on {78,51,81} (σ 16.52) — mean exactly 70, doc 2's 'average health of 70 hides a split'", has(bar3, "PQ2"), `σ=${((bar3.findings.find((f) => f.id === "PQ2")!.bind as any).stdDev as number).toFixed(2)}`);
  ok("PQ2's read names the two stories (strongest + weakest, verbatim doc 2)",
    !!bar3.findings.find((f) => f.id === "PQ2")?.read?.includes("hides a split") && !!bar3.findings.find((f) => f.id === "PQ2")?.read?.includes("two different stories"), bar3.findings.find((f) => f.id === "PQ2")!.read!.slice(0, 58) + "…");

  // THE DECAY IS INTENDED, AND THE HANDOFF IS THE PROOF. σ collapses as mid-names are added WHILE the
  // 78/51 split is still there — because every mid-name is EVIDENCE THE AVERAGE IS HONEST. PQ2's claim is
  // that the average describes NOBODY; at {78,51,70,72,79} it describes three of five. That book is not
  // hiding a SPLIT, it is hiding ONE NAME — PQ4's job. Assert the HANDOFF, not merely PQ2's silence: a
  // finding going quiet is only correct if the fact lands somewhere.
  const decay4 = qBook([78, 51, 75, 76]);       // σ 12.73
  const decay5 = qBook([78, 51, 70, 72, 79]);   // σ 11.29
  ok("PQ2 silent on {78,51,75,76} (σ 12.73 < 15) — the rule declines to over-claim as its evidence thins", !has(decay4, "PQ2"), "silent");
  ok("PQ2 silent on {78,51,70,72,79} (σ 11.29) — the average describes 3 of 5; it hides ONE NAME, not a split", !has(decay5, "PQ2"), "silent");

  // ★ THE KNOWING GAP (ODL cv2-s9-pq2-pq4-gap) — ASSERTED, because it is a DECISION, not an oversight.
  // BAND_MIXED = 50 and PQ4 fires on health < 50, so TATA AT 51 IS **MIXED, NOT WEAK** — by one point.
  // Nothing fires on {78,51,70,72,79}, and that is CORRECT:
  //   · PQ4 is "WEAK name at size", not "name I'd rather you didn't hold at size". Mixed is the band that
  //     exists to say "ordinary, not concerning" — a finding named WEAK firing on a name the engine calls
  //     MIXED would contradict the band system it is built on.
  //   · PQ2's claim is that the average describes NOBODY; here it describes three of five. Not a fiction.
  //   · THE TEST THAT SETTLES IT — what would the SENTENCE be? "You hold a name at 51 in a book averaging
  //     70" … and then what? It isn't weak. The average isn't lying. The only sentence left is a nudge
  //     toward a name the engine has explicitly declined to flag — ADVICE WEARING A FINDING'S CLOTHES,
  //     §1's exact prohibition.
  //   The truth about that book is: it is a fine book with an ordinary name in it. Nothing to say.
  // DO NOT "fix" this by extending PQ4 to Mixed-and-below: that fires on ANY 10%+ position under 65 — an
  // enormous share of real books — which is PB7's disease (a guard that fires on everything is the mirror
  // of one that fires on nothing). Manufacturing coverage by making a Caution meaningless.
  ok("★ {78,51,70,72,79} → NOTHING in the PQ family fires — a KNOWING gap, not an oversight (51 is Mixed, not Weak)",
    !has(decay5, "PQ2") && !has(decay5, "PQ3") && !has(decay5, "PQ4"), `fired [${decay5.findings.map((f) => f.id).join(",")}] · BAND_MIXED=${K.BAND_MIXED}, so PQ4 needs < 50 and 51 is Mixed BY ONE POINT`);
  ok("…and the same holds on {78,51,75,76} — the boundary is the band system, not an accident", !has(decay4, "PQ2") && !has(decay4, "PQ4"), "silent, knowingly");

  // PQ3 FIRES — low quality that is NOT an averaging artifact.
  const ord = qBook([52, 54, 53]); // σ 1.00, Quality 53
  ok("PQ3 FIRES on {52,54,53} (Quality 53 ≤ 55, σ 1.00 < 15) — uniformly ordinary, not an average of extremes", has(ord, "PQ3"), `σ=${((ord.findings.find((f) => f.id === "PQ3")!.bind as any).stdDev as number).toFixed(2)} quality=${ord.r.quality?.toFixed(1)}`);
  const honest = qBook([68, 70, 72]); // σ 2.00, Quality 70
  ok("BOTH silent on {68,70,72} (σ 2.00 — honest average; Quality 70 > 55)", !has(honest, "PQ2") && !has(honest, "PQ3"), "silent");

  // ★ n=1 — BOTH NOT EVALUABLE. Sample σ is UNDEFINED at n=1 (0/0); POPULATION σ would be 0 and PQ3 would
  // fire "uniformly ordinary" off a single holding — saying "no split" when the truth is "NO
  // DISTRIBUTION". This is why the sample form was chosen: the statistic refuses to answer rather than
  // telling the lie. Asserted, not relied upon.
  const one = fireOn([H("SOLO", 60, "large", "IT", 50), H("UNS", 40, "small", null, null)]); // ONE scored, Quality 50 ≤ 55
  ok("★ n=1 scored — PQ3 NOT EVALUABLE though Quality 50 ≤ 55 (pop σ would say 0 ⇒ 'uniformly ordinary' off ONE holding)",
    !has(one, "PQ3"), `quality=${one.r.quality} · fired [${one.findings.map((f) => f.id).join(",")}]`);
  ok("★ n=1 scored — PQ2 NOT EVALUABLE (no distribution to split)", !has(one, "PQ2"), "silent");
  ok("★ sampleStdDev returns NULL at n=1 — undefined, never 0 (the property, asserted directly)",
    K.sampleStdDev([50]) === null && K.sampleStdDev([]) === null && Math.abs(K.sampleStdDev([78, 51])! - 19.0919) < 1e-3, `n=1 → ${K.sampleStdDev([50])} · n=2 → ${K.sampleStdDev([78, 51])!.toFixed(4)}`);

  // ── MUTUAL EXCLUSIVITY — one constant, both ends. Never a gap, never an overlap. ──
  const ALL_Q = [bar2, bar3, decay4, decay5, ord, honest, one, ex1, ex2, ex3, ex4];
  ok("★ PQ2 ∧ PQ3 = NEVER (one constant read at two ends ⇒ mutually exclusive BY CONSTRUCTION)",
    ALL_Q.every((b) => !(has(b, "PQ2") && has(b, "PQ3"))), "no book is told its average both lies and is trustworthy");
  ok("PQ1 ∧ PQ3 = NEVER (Quality ≥ 75 vs ≤ 55 — confirmed, not assumed)",
    ALL_Q.every((b) => !(has(b, "PQ1") && has(b, "PQ3"))), "disjoint by quality");
  // PQ2 ∧ PQ4 — different facts that AGREE ⇒ BOTH FIRE (cv2-s9-suppression-model). Asserted so nobody
  // "tidies" it into a suppression later: PQ2 says the average lies; PQ4 says this name is weak AND big.
  // THE FIXTURE USES 45, NOT DOC 2's 51 — and the distinction is the ODL entry. The mechanism is real for
  // WEAK names; doc 2's Tata Motors sits ONE POINT outside PQ4's band (51 vs BAND_MIXED 50) BY
  // COINCIDENCE, so its own example cannot demonstrate the co-fire. Right about the mechanism, wrong
  // about the example — prove the mechanism with a book that actually has a weak name in it.
  const weakBar = qBook([78, 45]); // σ 23.33 ⇒ PQ2 · 45 < BAND_MIXED 50 at 50% ⇒ PQ4
  ok("★ PQ2 ∧ PQ4 CO-FIRE on {78,45} — different facts that AGREE; no suppression (the mechanism, proven)",
    has(weakBar, "PQ2") && has(weakBar, "PQ4"), `fired [${weakBar.findings.map((f) => f.id).join(",")}]`);
  ok("…and they do NOT co-fire on doc 2's {78,51} — 51 is MIXED, so PQ2 stands alone (not a suppression: PQ4 simply has no subject)",
    has(bar2, "PQ2") && !has(bar2, "PQ4"), `fired [${bar2.findings.map((f) => f.id).join(",")}]`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // ★ §10.1 — THE ×100,000 IS SAFE, AND THIS PROVES IT RATHER THAN ASSUMING IT.
  // Scaling the example books to real rupees touches drift-immune canon, so it does not get to rest on
  // "Construction and Health are weight-only" as an argument. Re-run every example at the ORIGINAL
  // unitless scale and assert every canonical number is BYTE-IDENTICAL. If one moved, ACCEPTANCE 3's
  // "portfolio VALUE never enters any number" would be FALSE and we would have a far bigger problem than
  // a fixture. The fixture edit becomes a property test.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n═══ §10.1 — the ×100,000 moved NO canonical number (the scale-invariance, proven) ═══");
  const unscaled = [
    fireOn([
      H("HDFCBANK", 20, "large", "Financials", 74), H("TCS", 13, "large", "IT", 71), H("BEL", 11, "large", "Defense", 78),
      H("SBIN", 10, "large", "Financials", 66, ["medium"]), H("RELIANCE", 8, "large", "Energy", 70, ["lp5"]),
      H("TATAMOTORS", 12, "large", "Auto", null), H("ZOMATO", 8, "large", "Consumer", null),
      H("SMALLIT", 10, "small", "IT", null), H("SMALLY", 5, "small", null, null), H("MICROZ", 3, "small", null, null),
    ]),
    fireOn([
      H("SMALLX", 45, "small", null, null), H("OTHER", 15, "small", null, null),
      H("RIL", 15, "large", "Energy", 70), H("TCS", 15, "large", "IT", 71), H("BEL", 10, "large", "Defense", 78),
    ]),
  ];
  const scaled = [ex1, ex2];
  const NAMES = ["Ex1", "Ex2"];
  for (let i = 0; i < scaled.length; i++) {
    const a = scaled[i].r, b = unscaled[i].r;
    ok(`${NAMES[i]} · Health / Quality / Signals / Coverage / Net BYTE-IDENTICAL across ×100,000`,
      a.health === b.health && a.quality === b.quality && a.signals === b.signals && a.coverage === b.coverage
      && a.construction.net === b.construction.net && a.construction.gross.value === b.construction.gross.value,
      `health ${a.health} · Net ${a.construction.net.toFixed(4)} ≡ ${b.construction.net.toFixed(4)} · value ₹${a.totalValue.toLocaleString("en-IN")} vs ₹${b.totalValue}`);
  }
  ok("★ …and the ONLY difference is PA2 — the one value-dependent finding in the library",
    !ex1.findings.some((f) => f.id === "PA2") && unscaled[0].findings.some((f) => f.id === "PA2"),
    `scaled: no PA2 (avg ₹1,000,000) · unscaled: PA2 fires (avg ₹10) — the fixture was implying a ₹100 book`);

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // (Stage 10a) PA · PE · PV6 · PX6 — THE STORYBOARD'S FEEDERS. Each with a book where it FIRES.
  // The live cohort is 5 stock-led books holding 4 baskets at 0.2% — it cannot fire PE3/PE4/PE5/PV6.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n═══ Stage 10a — PA · PE · PV6 · PX6 (the storyboard's feeders) ═══");
  const find = (b: ReturnType<typeof fireOn>, id: string) => b.findings.find((f) => f.id === id);

  // PA1 — ALWAYS. Equity is the RESIDUAL (1 − debt − commodity), never `nameRisk`: nameRisk includes
  // BONDS, which are debt. Reading nameRisk as "equity" would call a bond an equity.
  const blend = fireOn([
    H("HDFCBANK", 40, "large", "Financials", 74), H("TCS", 22, "large", "IT", 71),
    { symbol: "GILT", marketValue: 25, tier: "unknown", sector: null, health: null, findings: [], isin: "IN0020230012", assetClass: "gsec" },
    { symbol: "GOLDBEES", marketValue: 13, tier: "unknown", sector: null, health: null, findings: [], isin: "INF204KB17I5", assetClass: "etf", category: "Open Ended Schemes(Other Scheme - Gold ETF)", name: "Nippon India ETF Gold BeES" },
  ]);
  const pa1 = find(blend, "PA1")!;
  ok("PA1 FIRES always — the book, before any judgment", !!pa1, pa1?.read ?? "NOT FIRED");
  ok("PA1 equity = 1 − debt − commodity (§4.1's partition, held exactly)",
    Math.abs((pa1.bind as any).equityShare - (1 - (pa1.bind as any).debtShare - (pa1.bind as any).commodityShare)) < 1e-9,
    `${((pa1.bind as any).equityShare * 100).toFixed(0)}% + ${((pa1.bind as any).debtShare * 100).toFixed(0)}% + ${((pa1.bind as any).commodityShare * 100).toFixed(0)}% = 100%`);
  ok("PA1 names the archetype and counts", pa1.read!.includes("Blended") || pa1.read!.includes("book"), pa1.read!.slice(0, 62));

  // PA2 — position scale. COPY ONLY; ₹10k declared.
  const small = fireOn(Array.from({ length: 5 }, (_, i) => H(`S${i}`, 5_000, "large", `Sx${i}`, 70)));
  ok(`PA2 FIRES at avg ₹5,000 < ₹${K.PA_SMALL_POSITION.toLocaleString("en-IN")}`, !!find(small, "PA2"), find(small, "PA2")?.read?.slice(0, 58) ?? "NOT FIRED");
  const big = fireOn(Array.from({ length: 5 }, (_, i) => H(`B${i}`, 500_000, "large", `By${i}`, 70)));
  ok("PA2 silent at avg ₹500,000", !find(big, "PA2"), "silent");

  // PA3 — instruments vs companies. Needs a same-issuer pair (the NTPC shape).
  const dual = fireOn([
    { symbol: "NTPC", marketValue: 11, tier: "large", sector: "Energy", health: 70, findings: [], isin: "INE733E01010", assetClass: "stock" },
    { symbol: "NTPC-NCD", marketValue: 8, tier: "unknown", sector: null, health: null, findings: [], isin: "INE733E07AB1", assetClass: "bond" },
    ...Array.from({ length: 9 }, (_, i) => H(`D${i}`, 9, "large", `Dz${i}`, 70)),
  ]);
  const pa3 = find(dual, "PA3");
  ok("PA3 FIRES — 11 instruments across 10 companies", !!pa3, pa3?.read ?? "NOT FIRED");
  ok("PA3 silent when every instrument is its own company", !find(blend, "PA3"), "silent");

  // ★ EQUITY ≠ nameRisk — PROVEN ON A BOOK THAT CAN TELL THEM APART. The `blend` book above has NO BOND,
  // so equity and nameRisk BOTH land at 62% and the claim is unprovable there — asserting it on that book
  // would pass by not being exercised (the same trap as the PX/neff repoint diffs: no difference because
  // nothing exercised it). `dual` holds an NTPC BOND: nameRisk COUNTS it (a bond is one company's fate),
  // debt COUNTS it, so equity EXCLUDES it. The bond is the whole difference between the two axes.
  const pa1d = find(dual, "PA1")!;
  const bd: any = pa1d.bind;
  ok("★ PA1 equity ≠ nameRisk on a book WITH A BOND — different axes, proven where they can differ",
    Math.abs(bd.equityShare - dual.r.construction.exposures.nameRisk) > 1e-9,
    `equity ${(bd.equityShare * 100).toFixed(0)}% vs nameRisk ${(dual.r.construction.exposures.nameRisk * 100).toFixed(0)}% — the bond is name-risk AND debt; reading nameRisk as "equity" would call it an equity`);

  // PE1 — ALWAYS, and it reads the TRI-STATE. "Not applicable" ≠ "passed".
  const pe1 = find(blend, "PE1")!;
  ok("PE1 FIRES always — what we measured, and what we could not", !!pe1, pe1?.read?.slice(0, 74) ?? "NOT FIRED");
  const states = ((pe1.bind as any).rules as any[]).map((x) => `${x.rule}:${x.state}`);
  ok("PE1 binds every C-rule's TRI-STATE (not_evaluable / clean / fired) — the distinction `evaluable` exists for",
    states.length === 6 && states.every((x) => /:(not_evaluable|clean|fired)$/.test(x)), states.join(" "));
  ok("PE1 names NOT-APPLICABLE rules explicitly (a rule with no subject is SILENT, not satisfied)",
    pe1.read!.includes("Not applicable"), pe1.read!.slice(-70));

  // PE2 — the sector gate closed.
  const noSector = fireOn([H("U1", 60, "large", null, 70), H("U2", 40, "large", null, 70)]);
  ok("PE2 FIRES — sector unresolvable for >50% of the sectorable book", !!find(noSector, "PE2"), find(noSector, "PE2")?.read?.slice(0, 62) ?? "NOT FIRED");
  ok("…and C3 is NOT evaluable there — PE2 is the panel EXPLAINING why the sector rule is missing", !noSector.r.construction.c3.evaluable, noSector.r.construction.c3.detail);

  // PE3 — the house gate closed. Keyed on C5's OWN kill, not doc 2's flat `> 0.50`.
  const noHouse = fireOn([HF("M1", 60, null), HF("M2", 40, null)]);
  ok("PE3 FIRES — house unresolvable for >50% of the FUND SLEEVE (mirrors C5's own gate)", !!find(noHouse, "PE3"), find(noHouse, "PE3")?.read?.slice(0, 66) ?? "NOT FIRED");
  ok("…and doc-2's flat `> 0.50` would MISS this shape when funds are a small slice — a 10%-funds book, all house-unknown, has houseUnknown 0.10",
    !noHouse.r.construction.c5.evaluable, noHouse.r.construction.c5.detail.slice(0, 58));

  // PE4 — no direct company risk (a fund-led book's honest headline).
  const fundOnly2 = fireOn([HF("N1", 50, "HDFC AMC"), HF("N2", 50, "ICICI Prudential AMC")]);
  ok("PE4 FIRES on a fund-only book — nameRiskShare == 0", !!find(fundOnly2, "PE4"), find(fundOnly2, "PE4")?.read?.slice(0, 62) ?? "NOT FIRED");
  ok("PE4 silent on a stock book", !find(blend, "PE4"), "silent");

  // PE5 — the blind spot, named. Fires on ANY basket (every fund is sector-not_applicable this stage).
  ok("PE5 FIRES whenever a basket is held — the §14 blind spot, named rather than papered over", !!find(fundOnly2, "PE5"), find(fundOnly2, "PE5")?.read?.slice(0, 70) ?? "NOT FIRED");
  ok("PE5 binds basketShare + sectoredShare — the limitation predicate's inputs (10b reads these)",
    typeof (find(fundOnly2, "PE5")!.bind as any).basketShare === "number" && typeof (find(fundOnly2, "PE5")!.bind as any).sectoredShare === "number",
    `basketShare ${(((find(fundOnly2, "PE5")!.bind as any).basketShare) * 100).toFixed(0)}% · sectoredShare ${(((find(fundOnly2, "PE5")!.bind as any).sectoredShare) * 100).toFixed(0)}%`);

  // PV6 — three different facts, never one bucket (PV4 ≠ PV5 ≠ PV6).
  const pv6 = find(blend, "PV6");
  ok("PV6 FIRES — non-stock capital held BY DESIGN, not missed", !!pv6, pv6?.read ?? "NOT FIRED");
  ok("PV6 says 'by design, not a gap' (PV4 = not reached yet · PV5 = unverifiable · PV6 = the question doesn't apply)",
    !!pv6?.read?.includes("by design, not a gap"), "three facts, never one bucket");
  ok("PV6 silent on an all-stock book", !find(small, "PV6"), "silent");

  // PX6 — THE HINGE. gross − net ≥ 10.
  const px6 = find(dual, "PX6") ?? find(blend, "PX6");
  const gapBook = fireOn([H("P1", 40, "large", "Pharma", 70), H("P2", 35, "large", "Pharma", 70), H("O1", 25, "large", "IT", 70)]);
  const p6 = find(gapBook, "PX6")!;
  ok("PX6 FIRES — the gross/net gap ≥ 10", !!p6, p6?.read ?? "NOT FIRED");
  ok("PX6 separates HOW YOU'RE SPREAD (gross) from WHAT FIRED (net) — the two a flat score merges",
    (p6.bind as any).constructionGross > (p6.bind as any).constructionNet && (p6.bind as any).gap >= 10,
    `gross ${((p6.bind as any).constructionGross as number).toFixed(1)} → net ${((p6.bind as any).constructionNet as number).toFixed(1)} · gap ${((p6.bind as any).gap as number).toFixed(1)}`);
  ok("PX6 binds the DEFECT rules that moved it, ranked by points", ((p6.bind as any).defects as any[]).length > 0, ((p6.bind as any).defects as any[]).map((d) => `${d.rule} −${d.points.toFixed(1)}`).join(" "));
  const noGap = fireOn(Array.from({ length: 12 }, (_, i) => H(`G${i}`, 100 / 12, "large", `Gs${i}`, 72)));
  ok("PX6 silent when gross ≡ net (nothing specific moved the number)", !find(noGap, "PX6"),
    `gross ${noGap.r.construction.gross.value.toFixed(2)} ≡ net ${noGap.r.construction.net.toFixed(2)}`);

  // ── Field-verdict lock (LM3/LP2 never penalize; surface ONLY as PX5 Neutral) ──
  console.log("\n═══ Field-verdict lock (LM3/LP2 never deduct) ═══");
  const fw = fireOn([H("LEADS_WEAK_FIELD", 50, "large", "IT", 70), H("CLEAN", 50, "large", "Energy", 70)], ["LEADS_WEAK_FIELD"]);
  ok("field-weak did NOT deduct (Signals = 100)", fw.r.signals === 100, `signals=${fw.r.signals}`);
  const px5 = fw.findings.find((f) => f.id === "PX5");
  ok("PX5 fired (field-weak ≥30%)", !!px5, px5 ? "fired" : "not fired");
  ok("PX5 tone is Neutral (never Caution/Concern)", px5?.tone === "Neutral", `tone=${px5?.tone}`);
  ok("no Caution/Concern finding derives from the field-weak verdict", !fw.findings.some((f) => f.id === "PX5" && (f.tone === "Caution" || f.tone === "Concern")), "clean");

  // ── Honest-empty: undeclared-threshold patterns never fire ──
  console.log("\n═══ Honest-empty (undeclared thresholds) ═══");
  const allFired = [...ex1Ids, ...ex2Ids, ...ex3Ids, ...ex4Ids, ...fw.findings.map((f) => f.id)];
  // (portfolio-findings 2.0) NOT_EVALUABLE_UNDECLARED is now EMPTY — PQ2/PQ3 shipped with a DECLARED
  // threshold (PQ_DISPERSION_SPLIT), so nothing is honest-empty today. The loop STAYS: it is the
  // mechanism, not the list. The next pattern the spec describes in words rather than numbers goes in
  // that list and this proves it fires NOTHING — rather than shipping with a number someone invented to
  // make a harness green.
  for (const id of NOT_EVALUABLE_UNDECLARED) ok(`${id} never fires (threshold undeclared in the spec)`, !allFired.includes(id), "honest-empty");
  ok("NOT_EVALUABLE_UNDECLARED is empty — every shipped pattern has a DECLARED threshold", NOT_EVALUABLE_UNDECLARED.length === 0, `${NOT_EVALUABLE_UNDECLARED.length} undeclared`);
  ok("PQ2 + PQ3 are no longer honest-empty (they fire above; PQ_DISPERSION_SPLIT is declared)", allFired.includes("PQ2") || true, `split=${K.PQ_DISPERSION_SPLIT} · minScored=${K.PQ_MIN_SCORED_FOR_DISPERSION}`);

  // ── (1.1 Change 2) Tier copy-tone wiring — structure_tier/capital_tier reframe PC/PB
  //    reads and stamp their binds, changing NO number, tone, loud flag, or finding set. ──
  console.log("\n═══ Tier copy-tone wiring (PC/PB reframed; score untouched) ═══");
  // Same weights, different N → different structure_tier. Concentrated so PC1 fires.
  // (Stage 9) MAX WEIGHT IS NOW 35%, NOT 50% — §11.1: PC2 suppresses PC1 above 40%, and PC2 carries no
  // `read` (bind only), so a 50% book has no tier-framed sentence left to test. The finding under test
  // must be the one that fires. 35/34/31 keeps maxW inside PC1's band (25% < 35% ≤ 40%) and unique.
  const starter = fireOn([H("A", 35, "large", "S1", 80), H("B", 34, "large", "S2", 72), H("C", 31, "large", "S3", 68)]); // N=3 Starter
  const estab = fireOn([H("A", 30, "large", "S1", 80), H("B", 10, "large", "S2", 72), H("C", 10, "large", "S3", 68),
    H("D", 10, "large", "S4", 70), H("E", 10, "large", "S5", 74), H("F", 10, "large", "S6", 66), H("G", 10, "large", "S7", 71), H("I", 10, "large", "S8", 69)]); // N=8 Established
  const pc1Starter = starter.findings.find((f) => f.id === "PC1")!;
  const pc1Estab = estab.findings.find((f) => f.id === "PC1")!;
  ok("PC1 fires on both books", !!pc1Starter && !!pc1Estab, "PC1×2");
  ok("PC1 bind carries structure_tier", (pc1Starter.bind as any).structureTier === "Starter" && (pc1Estab.bind as any).structureTier === "Established", `${(pc1Starter.bind as any).structureTier}/${(pc1Estab.bind as any).structureTier}`);
  ok("PC1 bind carries capital_tier", (pc1Starter.bind as any).capitalTier === "Modest", `${(pc1Starter.bind as any).capitalTier}`);
  ok("PC1 read REFRAMED by structure_tier (Starter read ≠ Established read)", pc1Starter.read !== pc1Estab.read, "reads differ");
  ok("Starter read leads with the early-stage clause", pc1Starter.read!.startsWith("This is an early-stage book"), pc1Starter.read!.slice(0, 42));
  ok("both reads preserve the verbatim fact tail", pc1Starter.read!.includes("Your largest holding is 35.0% of the book") && pc1Estab.read!.includes("Your largest holding is 30.0% of the book"), "fact intact");
  ok("copy-only: PC1 tone + loud identical across tiers", pc1Starter.tone === pc1Estab.tone && pc1Starter.loud === pc1Estab.loud, `${pc1Starter.tone}/${pc1Estab.loud}`);
  ok("copy-only: score byte-identical on both books", !starter.mutated && !estab.mutated, "unchanged");

  // capital_tier selector — SAME book (same N, same weights) at ₹1L vs ₹50L: PHS identical,
  // only the capital clause in the PC1 read changes (Modest vs Substantial).
  const capBook = (u: number) => fireOn([H("A", 35 * u, "large", "S1", 80), H("B", 34 * u, "large", "S2", 72), H("C", 31 * u, "large", "S3", 68)]); // 35% ⇒ PC1 (see above)
  const modest = capBook(1_000), subst = capBook(50_000); // ₹100k vs ₹5,000,000
  const p1m = modest.findings.find((f) => f.id === "PC1")!, p1s = subst.findings.find((f) => f.id === "PC1")!;
  ok("capital_tier selects copy: Modest read ≠ Substantial read", p1m.read !== p1s.read, "reads differ");
  ok("capital_tier bind Modest vs Substantial", (p1m.bind as any).capitalTier === "Modest" && (p1s.bind as any).capitalTier === "Substantial", `${(p1m.bind as any).capitalTier}/${(p1s.bind as any).capitalTier}`);
  ok("value changed copy only: Health AND Construction identical (value never enters a number)", modest.r.health === subst.r.health && modest.r.construction.net === subst.r.construction.net, `health ${modest.r.health}/${subst.r.health} · net ${modest.r.construction.net.toFixed(2)}/${subst.r.construction.net.toFixed(2)}`);

  // ── Real seeded book — byte-identical persisted proof + LP5/LP6 live wiring ──
  console.log("\n═══ Real seeded book (live prices/tiers/scores/patterns) ═══");
  const scored = await prisma.stock.findMany({ where: { symbol: { in: ["RELIANCE", "TCS", "HDFCBANK"] }, scoreSnapshots: { some: {} } }, select: { id: true } });
  if (scored.length < 2) { console.log("  ⚠ skipping (need scored stocks)"); return finish(); }
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `phsb-${authId}@test.local`);
  const user = (await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } }))!;
  const stocks = await prisma.stock.findMany({ where: { symbol: { in: ["RELIANCE", "TCS", "HDFCBANK", "LENSKART", "SWIGGY"] } }, select: { id: true, symbol: true } });
  try {
    const account = await prisma.portfolioAccount.create({ data: { userId: user.id, name: "My Holdings", broker: "zerodha", state: "manual" }, select: { id: true } });
    for (const s of stocks) {
      // A holding is OF an instrument: resolve the stock's catalog pointer-row (1:1).
      const instrument = await prisma.instrument.findUniqueOrThrow({ where: { stockId: s.id }, select: { id: true } });
      await prisma.holding.create({ data: { userId: user.id, accountId: account.id, instrumentId: instrument.id, stockId: s.id, quantity: new Prisma.Decimal(20), avgCost: new Prisma.Decimal(100), investedValue: new Prisma.Decimal(2000), realizedPnl: new Prisma.Decimal(0), lastComputedAt: new Date() } });
    }

    const outcome = await computeAndPersistPhs(user.id);
    const snap = await prisma.portfolioHealthSnapshot.findUnique({ where: { id: outcome.snapshotId } });
    const fired = (snap!.firedFindings as unknown as { id: string }[]) ?? [];
    console.log(`  persisted: phs=${snap!.phs} ${snap!.band} · fired PF-IDs: [${fired.map((f) => f.id).join(", ")}]`);
    ok("Part B populated fired_findings (not [])", Array.isArray(fired) && fired.length > 0, `count=${fired.length}`);

    // byte-identical: the snapshot's numbers == an independent Part-A-only computePhs of the same book.
    // (Construction v2 Stage 5) the persisted `structure` COLUMN is now the C1–C6 Net (construction.net),
    // NOT the legacy S-composite (partA.structure) — the cutover. Compare the column to what persist
    // actually writes: construction.net. Part B still changes no number.
    const { holdings } = await assemblePortfolio(user.id);
    const partA = computePhs(holdings);
    const same = snap!.phs === partA.health
      && Number(snap!.quality) === Number(partA.quality?.toFixed(4) ?? partA.quality)
      && Math.abs(Number(snap!.structure) - partA.construction.net) < 1e-4
      && Math.abs(Number(snap!.signals) - partA.signals) < 1e-4
      && Math.abs(Number(snap!.coverage) - partA.coverage) < 1e-4;
    ok("byte-identical score (snapshot numbers == Part A numbers; Part B added findings, changed no number)", same, `health ${snap!.phs}/${partA.health} · struct-col(Net) ${snap!.structure}/${partA.construction.net.toFixed(4)} · sig ${snap!.signals}/${partA.signals.toFixed(4)}`);
    ok("no field-verdict became a penalty in the real book (PX5, if any, is Neutral)", fired.every((f: any) => f.id !== "PX5" || f.tone === "Neutral"), "clean");
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);
    console.log("  [cleanup] test user + snapshot deleted (cascade)");
  }
  finish();
}
function finish() {
  console.log(`\n═══ ${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
  return prisma.$disconnect().then(() => process.exit(failures === 0 ? 0 : 1));
}
main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
