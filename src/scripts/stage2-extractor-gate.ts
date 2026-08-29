// ═══════════════════════════════════════════════════════════════
// STAGE 2 GATE (A) — the extractor, against SAVED payloads. No network, no DB.
// Runs in a second, so it can be re-run after every edit to the mapping.
//
//   npx tsx src/scripts/stage2-extractor-gate.ts
//
// The negative controls are the point. It is easy to write a mapping that agrees
// with the happy path and still reads the wrong subtotal in the other vintage, so
// this asserts the SPECIFIC wrong answers are NOT produced:
//   · split form must NOT return the Governments subtotal as FII
//   · "Sub Total B2" must resolve differently in the two forms
//   · an unrecognisable payload must return null, never a guess
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import {
  toRows, detectVintage, extractPublicBreakdown, extractSecurity,
  parseBseShareholding, qidToDate, dateToQid, QID_MAR2023,
} from "../ingestions/shareholdings/bse/bse-shp-extract.js";

let fails = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  if (!ok) fails++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};
const near = (a: number | null, b: number, eps = 1e-6): boolean => a !== null && Math.abs(a - b) <= eps;

const load = (f: string): unknown => JSON.parse(readFileSync(f, "utf8"));
const pubRowsOf = (f: string) => toRows((load(f) as Record<string, unknown>).Table1);
const secRowsOf = (f: string) => toRows((load(f) as Record<string, unknown>).Table1);

console.log("\n=== STAGE 2 GATE A — extractor vs saved payloads (offline) ===\n");

// ── quarter-id arithmetic ────────────────────────────────────────────────────
console.log("-- quarter id <-> date --");
check("117 -> 2023-03-31", qidToDate(QID_MAR2023) === "2023-03-31", qidToDate(QID_MAR2023));
check("130 -> 2026-06-30", qidToDate(130) === "2026-06-30", qidToDate(130));
check("101 -> 2019-03-31", qidToDate(101) === "2019-03-31", qidToDate(101));
check("97  -> 2018-03-31", qidToDate(97) === "2018-03-31", qidToDate(97));
check("round-trip 97..131", Array.from({ length: 35 }, (_, i) => 97 + i).every((q) => dateToQid(qidToDate(q)) === q));

// ── COMBINED form (qtr 109, RELIANCE) ────────────────────────────────────────
// Ground truth read off the saved payload:
//   Sub Total B1 = 38.28 (all institutions)   B1e FPI = 25.64
//   => FII 25.64, DII 12.64
//   Sub Total B2 = 0.20  <- Central Government. MUST NOT become FII.
console.log("\n-- COMBINED form (_bse_pub2_109.00.json, RELIANCE Mar-2021) --");
const c109 = pubRowsOf("_bse_pub2_109.00.json");
check("detected as combined", detectVintage(c109) === "combined", String(detectVintage(c109)));
const b109 = extractPublicBreakdown(c109)!;
check("fii = 25.64 (the FPI line)", near(b109.fiiPct, 25.64), `got ${b109.fiiPct}`);
check("dii = 12.64 (SubTotalB1 - FPI)", near(b109.diiPct, 12.64), `got ${b109.diiPct}`);
check("mutualFund = 4.43", near(b109.mutualFundPct, 4.43), `got ${b109.mutualFundPct}`);
check("insurance = 5.91", near(b109.insurancePct, 5.91), `got ${b109.insurancePct}`);
check("banksFis = 0.01 (merged FI/Banks line)", near(b109.banksFisPct, 0.01), `got ${b109.banksFisPct}`);
check("publicTotal = 49.42", near(b109.publicTotalPct, 49.42), `got ${b109.publicTotalPct}`);
// NEGATIVE CONTROL — the Central Government subtotal must not leak into FII/DII.
check("NEG: fii is NOT the 0.20 Govt subtotal", !near(b109.fiiPct, 0.2), `fii=${b109.fiiPct}`);
check("NEG: dii is NOT the 0.20 Govt subtotal", !near(b109.diiPct, 0.2), `dii=${b109.diiPct}`);
// Internal consistency: institutions must not exceed the public total.
check("fii+dii <= publicTotal", (b109.fiiPct ?? 0) + (b109.diiPct ?? 0) <= (b109.publicTotalPct ?? 0) + 0.05);

// ── SPLIT form (qtr 130, RELIANCE) ───────────────────────────────────────────
//   Sub Total B1 = 21.19 (DOMESTIC)   Sub Total B2 = 17.20 (FOREIGN)
//   Sub Total B3 = 0.10 Governments, but its row carries Fld_Code="STB2"  <- TRAP
console.log("\n-- SPLIT form (_bse_pub2_130.00.json, RELIANCE Jun-2026) --");
const c130 = pubRowsOf("_bse_pub2_130.00.json");
check("detected as split", detectVintage(c130) === "split", String(detectVintage(c130)));
const b130 = extractPublicBreakdown(c130)!;
check("fii = 17.20 (SubTotalB2 = foreign)", near(b130.fiiPct, 17.2), `got ${b130.fiiPct}`);
check("dii = 21.19 (SubTotalB1 = domestic)", near(b130.diiPct, 21.19), `got ${b130.diiPct}`);
check("mutualFund = 10.11", near(b130.mutualFundPct, 10.11), `got ${b130.mutualFundPct}`);
check("insurance = 9.20", near(b130.insurancePct, 9.2), `got ${b130.insurancePct}`);
check("banksFis = 0.05 (Banks + Other FI)", near(b130.banksFisPct, 0.05), `got ${b130.banksFisPct}`);
check("publicTotal = 49.52", near(b130.publicTotalPct, 49.52), `got ${b130.publicTotalPct}`);
// THE TRAP, ASSERTED DIRECTLY — Fld_Code "STB2" in this payload is the
// Governments row (0.10). If the mapping ever regresses to keying on Fld_Code,
// fii becomes 0.10 and this fails loudly.
const staleStb2 = c130.find((r) => !r.holder && r.code === "STB2");
check("payload really does carry a STALE Fld_Code=STB2", staleStb2 !== undefined && near(staleStb2.pct, 0.1),
  `Fld_Code=STB2 -> level="${staleStb2?.level}" pct=${staleStb2?.pct}`);
check("NEG: fii is NOT that stale-coded 0.10 row", !near(b130.fiiPct, 0.1), `fii=${b130.fiiPct}`);
check("fii+dii <= publicTotal", (b130.fiiPct ?? 0) + (b130.diiPct ?? 0) <= (b130.publicTotalPct ?? 0) + 0.05);

// ── COMBINED form WITH a non-zero FVCI line (ASTERDM Sep-2021) ───────────────
// RELIANCE's combined fixture has no B1d row at all (FVCI is zero and BSE omits
// the row), so it CANNOT catch the FVCI misclassification. This fixture can:
//   B1d foreign venture capital investors = 2.60   <- FOREIGN
//   B1e foreign portfolio investors       = 8.20
//   STB1 sub total b1                     = 19.28
//   => FII 10.80, DII 8.48   (NSE reports exactly these)
// Reading FII as the FPI line alone gives 8.20 / 11.08 — the TOTAL still comes to
// 19.28, so any check on sums alone would pass it. Hence the explicit assertions.
console.log("\n-- COMBINED form with non-zero FVCI (_bse_pub2_ASTERDM_111.json) --");
const cAst = pubRowsOf("_bse_pub2_ASTERDM_111.json");
check("detected as combined", detectVintage(cAst) === "combined", String(detectVintage(cAst)));
const bAst = extractPublicBreakdown(cAst)!;
check("B1d FVCI really is 2.60 in this payload",
  near(cAst.find((r) => !r.holder && r.level === "foreign venture capital investors")?.pct ?? null, 2.6));
check("fii = 10.80 (FPI 8.20 + FVCI 2.60)", near(bAst.fiiPct, 10.8), `got ${bAst.fiiPct}`);
check("dii = 8.48 (SubTotalB1 - FII)", near(bAst.diiPct, 8.48), `got ${bAst.diiPct}`);
check("NEG: fii is NOT the bare FPI line 8.20", !near(bAst.fiiPct, 8.2), `fii=${bAst.fiiPct}`);
check("NEG: dii is NOT 11.08 (FVCI wrongly left domestic)", !near(bAst.diiPct, 11.08), `dii=${bAst.diiPct}`);
check("the wrong split has the SAME total — why sums cannot catch it",
  near((bAst.fiiPct ?? 0) + (bAst.diiPct ?? 0), 19.28, 1e-4));

// -- OMITTED SUBTOTAL = ZERO, but only when the partition CLOSES ------------
// AIIL Sep-2023 files "sub total b2" (foreign) = 7.14 and NO "sub total b1" row
// at all, because it has no domestic institutional holders. BSE omits zero
// subtotals. Writing null there loses a real fact; zero-filling blindly would
// invent one. The closure test settles it: 7.14 + 18.33 = 25.47 = the published
// B total, so the missing B1 is provably 0.
console.log("\n-- omitted subtotal, partition closes (_bse_pub2_AIIL_119.json) --");
const cAiil = pubRowsOf("_bse_pub2_AIIL_119.json");
check("detected as split", detectVintage(cAiil) === "split", String(detectVintage(cAiil)));
check("payload really has NO 'sub total b1' row",
  cAiil.find((r) => !r.holder && r.level === "sub total b1") === undefined);
const bAiil = extractPublicBreakdown(cAiil)!;
check("fii = 7.14 (sub total b2)", near(bAiil.fiiPct, 7.14), `got ${bAiil.fiiPct}`);
check("dii = 0 (omitted subtotal, closure proves zero)", bAiil.diiPct === 0, `got ${bAiil.diiPct}`);
check("NOT null - a null DII and a 0 DII are different facts", bAiil.diiPct !== null);
check("partition closes to the B total 25.47",
  near((bAiil.fiiPct ?? 0) + (bAiil.diiPct ?? 0) + 18.33, 25.47, 0.05));
// NEGATIVE CONTROL: strip the non-institutions subtotal so nothing closes any
// more. The absent B1 must go back to null rather than being invented as 0.
const truncated = cAiil.filter((r) => r.level !== "sub total b4");
const bTrunc = extractPublicBreakdown(truncated)!;
check("NEG: payload that does NOT close keeps dii null", bTrunc.diiPct === null, `got ${bTrunc.diiPct}`);

// ── "Sub Total B2" means different things — asserted head-on ─────────────────
console.log("\n-- the label that changes meaning --");
const b2combined = c109.find((r) => !r.holder && r.level === "sub total b2")?.pct ?? null;
const b2split = c130.find((r) => !r.holder && r.level === "sub total b2")?.pct ?? null;
check('combined "Sub Total B2" = 0.20 (Central Govt)', near(b2combined, 0.2), `got ${b2combined}`);
check('split "Sub Total B2" = 17.20 (Foreign inst)', near(b2split, 17.2), `got ${b2split}`);
check("same label, different meaning -> vintage detection is mandatory", b2combined !== b2split);

// ── SECURITY payload — stable Fld_Code across both forms ─────────────────────
console.log("\n-- SECURITY payload (Fld_Code stable) --");
const s109 = extractSecurity(secRowsOf("_bse_shp_109.00.json"));
const s130 = extractSecurity(secRowsOf("_bse_shp_130.00.json"));
check("109 promoter = 50.58", near(s109.promoterPct, 50.58), `got ${s109.promoterPct}`);
check("109 public = 49.42", near(s109.publicPct, 49.42), `got ${s109.publicPct}`);
// FULLY-PAID, not Fld_TotalNoOfShares. RELIANCE Mar-2021 held 422,626,894 partly-paid
// rights shares plus a DR block, so the two columns differ by 615,161,026 here — and
// only the fully-paid figure matches what the NSE lane stores in the same column.
check("109 totalShares = 6146907788 (fully paid)", s109.totalShares === 6146907788, `got ${s109.totalShares}`);
check("109 NOT the Fld_TotalNoOfShares 6762068814", s109.totalShares !== 6762068814);
check("109 promoterShares = 3098084968 (fully paid)", s109.promoterShares === 3098084968, `got ${s109.promoterShares}`);
check("109 NOT the promoter total 3323114981", s109.promoterShares !== 3323114981);
check("130 promoter = 50.48", near(s130.promoterPct, 50.48), `got ${s130.promoterPct}`);
check("130 public = 49.52", near(s130.publicPct, 49.52), `got ${s130.publicPct}`);
check("130 totalShares = 13303071854 (fully paid)", s130.totalShares === 13303071854, `got ${s130.totalShares}`);
check("130 NOT the Fld_TotalNoOfShares 13532538722", s130.totalShares !== 13532538722);
check("130 promoterShares = 6715496096", s130.promoterShares === 6715496096, `got ${s130.promoterShares}`);
check("130 employeeTrust defaults to 0 when STC2 absent", s130.employeeTrustPct === 0, `got ${s130.employeeTrustPct}`);
check("109 partition sums to ~100", near(s109.promoterPct! + s109.publicPct!, 100, 0.01));
check("130 partition sums to ~100", near(s130.promoterPct! + s130.publicPct!, 100, 0.01));

// ── FULL PARSE + the zeroed/empty refusals ───────────────────────────────────
console.log("\n-- full parse and refusals --");
const full = parseBseShareholding(secRowsOf("_bse_shp_130.00.json"), c130);
check("full parse succeeds", full.ok, full.ok ? "" : full.reason);
if (full.ok) {
  const v = full.value;
  check("vintage recorded as split", v.vintage === "split");
  check("others = public - fii - dii", near(v.othersPct, 49.52 - 17.2 - 21.19, 1e-4), `got ${v.othersPct}`);
  check("retail mirrors others", v.retailPct === v.othersPct);
  check("promoterPledgedSharesPct derived from counts", v.promoterPledgedSharesPct === null || v.promoterPledgedSharesPct >= 0);
}
check("empty security -> empty", parseBseShareholding([], c130).ok === false);
const zeroed = toRows([
  { Fld_Code: "STA1A2", Fld_TotalPercentageOf_A_B_C2: 0, Fld_TotalNoOfShares: 0 },
  { Fld_Code: "STB1B2B3", Fld_TotalPercentageOf_A_B_C2: 0, Fld_TotalNoOfShares: 0 },
  { Fld_Code: "STABC", Fld_TotalPercentageOf_A_B_C2: 0, Fld_TotalNoOfShares: 0 },
]);
const zres = parseBseShareholding(zeroed, c130);
check("all-zero 200 body -> refused as zeroed", zres.ok === false && zres.reason === "zeroed",
  zres.ok ? "accepted!" : zres.reason);
const unknownPub = toRows([{ Fld_Code: "X", Fld_Level: "something new", Fld_TotalPercentageOf_A_B_C2: 1 }]);
const ures = parseBseShareholding(secRowsOf("_bse_shp_130.00.json"), unknownPub);
check("unrecognised public form -> refused, not guessed",
  ures.ok === false && ures.reason === "unknown_public_form", ures.ok ? "accepted!" : ures.reason);
check("detectVintage(unknown) is null", detectVintage(unknownPub) === null);

// -- VINTAGE DETECTION keys on the grand-total ARITY, not on any leaf line ----
// CANFINHOME Sep-2021 is an ordinary COMBINED filing with NO "foreign portfolio
// investors" row at all (zero FPI that quarter, and BSE omits zero rows). The
// old detector required that row and returned null, so the whole stock was
// rejected. The B grand-total row is the partition total and is never omitted;
// its label spells out the form's arity. Third time the omitted-zero-row pattern
// has bitten this lane, so it is asserted directly.
console.log("\n-- vintage detection via grand-total arity --");
const cCan = pubRowsOf("_bse_pub2_CANFINHOME_111.json");
check("CANFINHOME really has NO 'foreign portfolio investors' row",
  cCan.find((r) => !r.holder && r.level === "foreign portfolio investors") === undefined);
check("still detected as combined (via b=b1+b2+b3)", detectVintage(cCan) === "combined", String(detectVintage(cCan)));
const bCan = extractPublicBreakdown(cCan)!;
check("fii = 0 (no FPI line, block closes)", bCan.fiiPct === 0, `got ${bCan.fiiPct}`);
check("dii = 21.66 (all institutions are domestic)", near(bCan.diiPct, 21.66), `got ${bCan.diiPct}`);
check("dii agrees with its own sub-lines (MF 19.19 + ins 2.46 + banks 0)",
  near((bCan.mutualFundPct ?? 0) + (bCan.insurancePct ?? 0) + (bCan.banksFisPct ?? 0), 21.65, 0.02));
// The arity label itself, in both forms.
const arity = (f: string): string =>
  pubRowsOf(f).filter((r) => !r.holder).find((r) => r.code === "STB1B2B3")?.level ?? "(missing)";
check('combined total row reads "b=b1+b2+b3"', arity("_bse_pub2_109.00.json") === "b=b1+b2+b3", arity("_bse_pub2_109.00.json"));
check('split total row reads "b=b1+b2+b3+b4"', arity("_bse_pub2_130.00.json") === "b=b1+b2+b3+b4", arity("_bse_pub2_130.00.json"));
check("all six fixtures classify",
  (["_bse_pub2_109.00.json", "_bse_pub2_110.00.json", "_bse_pub2_ASTERDM_111.json", "_bse_pub2_CANFINHOME_111.json"]
    .every((f) => detectVintage(pubRowsOf(f)) === "combined")) &&
  (["_bse_pub2_130.00.json", "_bse_pub2_AIIL_119.json"].every((f) => detectVintage(pubRowsOf(f)) === "split")));

console.log(`\n=== ${fails === 0 ? "GATE A PASSED" : `GATE A FAILED — ${fails} failure(s)`} ===\n`);
process.exit(fails ? 1 : 0);
