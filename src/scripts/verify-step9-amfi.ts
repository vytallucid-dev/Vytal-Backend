// ═══════════════════════════════════════════════════════════════════════════════════════════════
// STEP 9 — GATE 3 VERIFY. AMFI MF identity + current NAV, error-flow wired.
//   npx tsx src/scripts/verify-step9-amfi.ts
//
// ── REFRESHED (2026-07-14). WHY, AND WHAT THAT DID AND DID NOT LICENCE. ────────────────────────
//
// This harness was a STEP-9-ERA SNAPSHOT. It asserted a world with 0 ETFs, a catalogue of exactly
// 18,071 rows, and 15 OPEN ingestion faults. Steps 13–17 LEGITIMATELY ENDED that world:
//
//     Step 13  loaded  337 ETFs          Step 14  loaded  21 REIT/InvIT trusts
//     Step 15  loaded  215 G-Sec/SGB     Step 17  loaded  356 bonds
//     an admin RESOLVED the 15 ISIN faults on 2026-07-12 (they are still in the table, resolved)
//
// So 8 assertions went red — none of them because anything broke. Each new asset-class load
// re-triggered them, and each needed a hand-written "these are pre-existing" proof
// (verify-step14-step9-preexisting.ts, verify-step16-preexisting.ts, verify-step18-preexisting.ts).
// A harness that cries wolf on every legitimate load is not protecting anything; it is training
// its reader to ignore it.
//
// THE REFRESH RE-EXPRESSES THOSE 8 AS INVARIANTS THAT ARE STILL TRUE AND WILL STAY TRUE.
// It did NOT lower the bar. The rule applied to each:
//
//   ✔ RE-EXPRESSED (6) — the assertion pinned a number that a later step CORRECTLY changed. It is
//     re-stated as the thing it was actually protecting, scoped so a future load cannot re-trigger
//     it. Every re-baseline below is justified against a PROVEN-CORRECT underlying value, and says
//     so inline.  ("catalogue = 18,071 rows"  →  "the STEP-9 SUBSET (stock+MF) = 18,071 rows".)
//
//   ✔ REPLACED, NOT RE-BASELINED (2) — the two PHS assertions (arman=66 / aman=51). These pinned a
//     LIVE, MARKET-DRIVEN OUTPUT. The drift was traced and RESOLVED — an ordinary price-driven
//     rescore, not a bug (probe-phs-drift-timeline.ts) — which showed the assertion was not stale
//     but MIS-SPECIFIED: it froze a number the system is DESIGNED to move, so it was guaranteed to
//     go red on the next price tick. Pinning today's 67/50 would buy one green run and break
//     tomorrow. They are replaced with a STRUCTURAL check — the PHS pipeline computes, non-null,
//     in [0,100], valid band — which asserts the machinery without pinning its output. See §0.
//
// THE ANCHOR. Every re-expression below rests on one measured fact: THE MF SPINE NEVER MOVED.
// All 17,567 MF rows are byte-identical to the baselines recorded before Steps 13–17 ran:
//     Step-16 Gate-0 md5 (NAV-inclusive) 9a573df845df745ffe74277aff455734   ✅ identical today
//     Step-13 full-fidelity md5          651f6ba0132b4dc0657e611bb9559969   ✅ identical today
// The later loads ADDED asset classes; they did not perturb one MF byte. That is what makes it
// honest to refresh a count instead of chasing it.  (probe-mf-spine-hashes.ts re-proves this.)
//
// ── THE ONE TRAP THIS REFRESH DELIBERATELY AVOIDS ─────────────────────────────────────────────
// Both baselines above hash current_nav · nav_date · is_active — columns THE NIGHTLY AMFI CRON
// REWRITES BY DESIGN. Anchoring on them would re-arm exactly the trap being removed: the harness
// would go red on the next NAV refresh, and someone would have to write a fourth "pre-existing"
// proof. So the un-waivable anchor here is the IDENTITY-ONLY hash (§1) — isin · scheme code ·
// scheme name · fund house · category · plan type · name · symbol · stock_id — which the NAV feed
// cannot move, and which still goes red on a lost ISIN, a rewritten scheme code, a fabricated
// ticker, or an MF that acquired a stock_id. The NAV columns are then asserted where they belong:
// as PROPERTIES (§5), not as a hash.
//
// WHEN A RE-BASELINE IS LEGITIMATE HERE (the standard verify-step13-etf.ts sets, adopted):
//   · SPINE_IDENTITY (§1) — re-baseline ONLY after proving the identity change came from AMFI
//     re-issuing an identity. A silent move here is a REGRESSION. Never re-baseline to make it pass.
//   · The census counts (§2, §9) — re-baseline freely when a new asset class lands; they are
//     scoped to the Step-9 subset precisely so you should not have to.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { applyRawFieldEdit } from "../fill/raw-field-edit.js";
import { resolveErrorRowId, fillMetaFor } from "../fill/error-resolution.js";
import { AMFI_CRON, parseNav } from "../ingestions/amfi/amfi-parse.js";
import { checkPhsStructural, PHS_TEST_USERS } from "./phs-structural.js";

let fail = 0;
const ok = (c: boolean, msg: string) => { console.log(`  ${c ? "✅" : "❌"} ${msg}`); if (!c) fail++; };
const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);
const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);

// ── THE STEP-9 WORLD, as it was measured at Step 9 and as it remains today. ───────────────────
const STEP9 = {
  stocks: 504,
  mf: 17567,
  /** stock + mutual_fund. The number the OLD `total === 504 + 17567` was really about. */
  subset: 504 + 17567, // 18,071
  /** Un-waivable. IDENTITY ONLY — the NAV feed is deliberately excluded (see header). */
  mfIdentityFp: "9ac2bbdf4761f99406fe8622bfec5f25",
  stockFp: "da04f158478175140addfa3b6db045ed",
  /** The ISIN faults AMFI's file genuinely contained. A CENSUS, not an open-queue depth (§6). */
  validityFaults: 10,
  uniquenessFaults: 5,
};

// ═══ 0. PHS — STRUCTURAL, NOT PINNED ══════════════════════════════════════════════════════════
hdr("0. PHS — the pipeline COMPUTES. Its VALUE is reported, never asserted.");
// ── WAS: ok(phs === 66 && band === "Steady" && fingerprint === "056bc16b…")  ×2 users ─────────
//
// REMOVED — and NOT re-baselined to the live 67/50, which would have been the tempting move and
// the wrong one. The old assertion was MIS-SPECIFIED, not stale: it pinned a LIVE, MARKET-DRIVEN
// OUTPUT as if it were a fixed fact.
//
// THE DRIFT IS RESOLVED, and it was never a bug. Traced end to end
// (probe-phs-drift-timeline.ts): the EOD price cron → hook:eod_prices_daily → pg_rescore → a new
// ScoreSnapshot per held stock → the PHS recomputes. It ran on 2026-07-10 (→66/51, the pair this
// file froze) and again on 2026-07-13 (→67/50). Aman's own history oscillates 51→50→51→50 across
// 07-08…07-13 on nothing but price ticks. A pinned PHS value is therefore STRUCTURALLY GUARANTEED
// to go red on the next tick — re-baselining buys one green run and breaks tomorrow.
//
// A CATALOGUE / ANALYTICS-INTEGRITY HARNESS HAS NO BUSINESS ASSERTING THAT NUMBER AT ALL. What it
// IS entitled to assert is that the pipeline still WORKS — so that is what it now asserts:
// assemblePortfolio() → computePhs() must produce a non-null, in-range [0,100] score with a valid
// band, for both fixture users. Real machinery, exercised for real, no value pinned.
//
// (Read-only: assemble + engine contain zero writes, so this persists no snapshot and leaves no
// trace. And it is not a fossil-read of the last stored row — it recomputes, so a rotted pipeline
// cannot hide behind a snapshot written back when things still worked. See phs-structural.ts.)
//
// NOTE, LOGGED NOT FIXED: the 50↔51 flicker on tiny price ticks is a real PRODUCT question about
// band-edge damping / hysteresis in the score. It is not a test defect and is out of scope here.
for (const email of PHS_TEST_USERS) {
  const r = await checkPhsStructural(email);
  ok(r.ok, `${email} — ${r.detail}`);
}

// ═══ 1. BYTE-IDENTICAL — THE UN-WAIVABLE ONE ══════════════════════════════════════════════════
hdr("1. BYTE-IDENTICAL — the 504 stocks + the 17,567-row MF identity spine");
const fp = (await q(`
  SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) AS fp, count(*)::int AS n
  FROM instruments WHERE asset_class='stock'`))[0];
ok(fp.fp === STEP9.stockFp, `stock-only fingerprint = ${fp.fp} (want da04f158…)`);
ok(fp.n === STEP9.stocks, `${STEP9.stocks} stock instrument rows (got ${fp.n})`);

// ── THE ANCHOR. Identity only: the nightly NAV cron cannot move this, a real spine break can. ──
// This REPLACES nothing — it is NEW, and it is what licences every count refresh further down.
const spine = (await q(`
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(amfi_scheme_code,'~') || '|' || coalesce(scheme_name,'~') || '|' ||
    coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' || coalesce(plan_type,'~') || '|' ||
    name || '|' || coalesce(symbol,'~') || '|' || coalesce(stock_id,'~'),
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'mutual_fund'`))[0];
ok(spine.n === STEP9.mf && spine.fp === STEP9.mfIdentityFp,
  `MF IDENTITY SPINE byte-identical — ${spine.n} rows, fp ${spine.fp} (want 9ac2bbdf…). ` +
  `Steps 13–17 ADDED asset classes; not one MF identity byte moved.`);

// The NAV-inclusive hashes are reported, NOT asserted — they move every night, by design.
const navFp = (await q(`
  SELECT md5(string_agg(isin||'|'||COALESCE(amfi_scheme_code,'')||'|'||COALESCE(scheme_name,'')||'|'||
    COALESCE(current_nav::text,'')||'|'||COALESCE(nav_date::text,''),'~' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class='mutual_fund'`))[0];
console.log(`  ℹ NAV-inclusive md5 (Step-16 Gate-0 expr): ${navFp.fp}`);
console.log(`     ${navFp.fp === "9a573df845df745ffe74277aff455734"
  ? "=== the 9a573df8… baseline ⇒ the NAV feed has not advanced since it was taken."
  : "≠ the 9a573df8… baseline ⇒ THE NAV FEED ADVANCED. Expected after an AMFI run — NOT a fault."}`);
console.log(`     Reported, never asserted: a hash over a column the cron rewrites nightly is a`);
console.log(`     stale-failure generator, which is the exact defect this refresh exists to remove.`);

// The AMFI columns must be NULL on every stock — AMFI must not have leaked into the equity rows.
const polluted = await prisma.instrument.count({
  where: { assetClass: "stock", OR: [{ amfiSchemeCode: { not: null } }, { currentNav: { not: null } }, { navDate: { not: null } }, { schemeName: { not: null } }] },
});
ok(polluted === 0, `no stock row carries an AMFI field (got ${polluted})`);
const symNull = await prisma.instrument.count({ where: { assetClass: "stock", symbol: null } });
ok(symNull === 0, `every stock still has a symbol despite the column becoming nullable (nulls=${symNull})`);

// ═══ 2. LOADED — MF identity + current NAV ════════════════════════════════════════════════════
hdr("2. LOADED — MF identity, and the fence that keeps later asset classes out of it");
const mf = await prisma.instrument.count({ where: { assetClass: "mutual_fund" } });
ok(mf === STEP9.mf, `${mf} mutual_fund rows (want ${STEP9.mf})`);

// ── WAS: ok(etf === 0, "0 etf rows — MF-only step") ──────────────────────────────────────────
// STALE BY DESIGN. Step 13 loaded 337 ETFs ON PURPOSE. "Zero ETFs exist" was never the invariant
// Step 9 needed — it was a side-effect of Step 9 being first. What Step 9 actually needed is that
// the MF class is FENCED: no later fund-shaped load may dilute, re-tag or contaminate the 17,567.
// That claim is TRUE TODAY, stays true after the next fund-shaped load, and is what is asserted now.
const census = await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`);
console.log(`  catalogue census now: ${census.map((c) => `${c.ac}=${c.n}`).join(" · ")}`);
const contaminated = (await q(`
  SELECT count(*)::int n FROM instruments
  WHERE asset_class = 'mutual_fund' AND (symbol IS NOT NULL OR stock_id IS NOT NULL)`))[0].n;
ok(contaminated === 0,
  `THE FENCE: no mutual_fund row acquired a ticker or a stock_id from any later load ` +
  `(ETF/REIT/G-Sec/bond all carry their own class) (got ${contaminated})`);
const isinOverlap = (await q(`
  SELECT count(*)::int n FROM (
    SELECT isin FROM instruments WHERE asset_class IN ('mutual_fund','etf') GROUP BY isin HAVING count(*) > 1) x`))[0].n;
ok(isinOverlap === 0,
  `no ISIN is double-loaded across the MF and ETF passes — the AMFI section filters are exact ` +
  `complements, so admitting ETFs took nothing from the MF set (got ${isinOverlap})`);

const noCode = await prisma.instrument.count({ where: { assetClass: "mutual_fund", amfiSchemeCode: null } });
ok(noCode === 0, `amfiSchemeCode present on EVERY MF row — the Layer-C join key (missing=${noCode})`);
const noScheme = await prisma.instrument.count({ where: { assetClass: "mutual_fund", schemeName: null } });
ok(noScheme === 0, `schemeName captured on every row (material for family derivation) (missing=${noScheme})`);
const badStock = await prisma.instrument.count({ where: { assetClass: "mutual_fund", stockId: { not: null } } });
ok(badStock === 0, `every MF has stock_id = NULL (held-not-scored) (got ${badStock})`);
const badSym = await prisma.instrument.count({ where: { assetClass: "mutual_fund", symbol: { not: null } } });
ok(badSym === 0, `every MF has symbol = NULL — a fund has no ticker, none was fabricated (got ${badSym})`);

// ═══ 3. PAYLOAD COMPLETENESS (forward-compat for Layers C/D/E) ═════════════════════════════════
hdr("3. PAYLOAD COMPLETENESS");
const sample = await prisma.instrument.findFirst({
  where: { assetClass: "mutual_fund", currentNav: { not: null }, planType: { not: null } },
  select: { isin: true, name: true, schemeName: true, fundHouse: true, category: true, planType: true, amfiSchemeCode: true, currentNav: true, navDate: true, isActive: true },
});
console.log(`  sample: ${JSON.stringify(sample, null, 0)}`);
ok(!!(sample?.fundHouse && sample?.category && sample?.amfiSchemeCode && sample?.currentNav && sample?.navDate),
  `fundHouse + category + schemeCode + nav + navDate all captured (not dropped)`);
const houses = await prisma.instrument.groupBy({ by: ["fundHouse"], where: { assetClass: "mutual_fund" }, _count: true });
ok(houses.length >= 40, `${houses.length} distinct fund houses captured (AMFI has 51)`);

// ═══ 4. PLAN EXPLOSION + SCHEME-CODE LINKAGE ══════════════════════════════════════════════════
hdr("4. TWO-ISIN LINKAGE — growth + reinvest share ONE amfiSchemeCode");
const shared = await q(`
  SELECT amfi_scheme_code, count(*) AS n FROM instruments
  WHERE asset_class='mutual_fund' GROUP BY amfi_scheme_code HAVING count(*) = 2 LIMIT 1`);
ok(shared.length === 1, `scheme codes yielding TWO catalogue rows exist (the growth+reinvest pair)`);
const pairCount = (await q(`
  SELECT count(*)::int AS n FROM (
    SELECT amfi_scheme_code FROM instruments WHERE asset_class='mutual_fund'
    GROUP BY amfi_scheme_code HAVING count(*) = 2) t`))[0];
console.log(`  scheme codes with 2 rows: ${pairCount.n}`);
if (shared.length) {
  const pair = await prisma.instrument.findMany({
    where: { amfiSchemeCode: shared[0].amfi_scheme_code }, select: { isin: true, amfiSchemeCode: true, currentNav: true },
  });
  for (const p of pair) console.log(`      ${p.isin}  code=${p.amfiSchemeCode}  nav=${p.currentNav}`);
  ok(pair.length === 2 && pair[0]!.amfiSchemeCode === pair[1]!.amfiSchemeCode, `both ISINs share the SAME scheme code (the grouping key)`);
}
// A scheme code must never span 3+ rows (the file has only 2 ISIN columns).
// SCOPED to mutual_fund: ETFs carry scheme codes too, and this is a claim about the MF file's shape.
const over = (await q(`
  SELECT count(*)::int AS n FROM (
    SELECT amfi_scheme_code FROM instruments WHERE asset_class='mutual_fund'
    GROUP BY amfi_scheme_code HAVING count(*) > 2) t`))[0];
ok(over.n === 0, `no scheme code yields >2 rows (the file has exactly 2 ISIN columns) (got ${over.n})`);

// ═══ 5. NAV HONESTY — where the NAV feed is asserted as PROPERTIES, not as a hash ══════════════
hdr("5. NAV HONESTY — null vs 0 vs stale");
const navNull = await prisma.instrument.count({ where: { assetClass: "mutual_fund", currentNav: null } });
const navZero = await prisma.instrument.count({ where: { assetClass: "mutual_fund", currentNav: 0 } });
console.log(`  currentNav NULL: ${navNull}   currentNav = 0: ${navZero}`);
ok(navZero > 0, `AMFI's genuinely-published 0.0000 NAVs stored AS 0 (defunct/written-off portfolios) — not discarded`);
const coerced = (await q(`
  SELECT count(*)::int AS n FROM instruments WHERE asset_class='mutual_fund' AND current_nav = 0 AND nav_date IS NULL`))[0];
ok(coerced.n === 0, `no row has nav=0 with a NULL date (would smell like a coerced missing value)`);
// Counts, not a frozen pair: the active/stale SPLIT moves every night as funds mature. The
// invariant is that staleness is EXPRESSED (both sides non-empty), not that it is 11,633/5,934.
const stale = await prisma.instrument.count({ where: { assetClass: "mutual_fund", isActive: false } });
const active = await prisma.instrument.count({ where: { assetClass: "mutual_fund", isActive: true } });
ok(stale > 0 && active > 0, `staleness expressed via is_active: ${active} active / ${stale} stale (matured funds still listed)`);
ok(active + stale === STEP9.mf, `…and the split is TOTAL — every one of the ${STEP9.mf} MFs is on one side (${active}+${stale})`);
const maxNav = await prisma.instrument.aggregate({ where: { assetClass: "mutual_fund" }, _max: { currentNav: true, navDate: true } });
ok(Number(maxNav._max.currentNav) > 2_000_000, `full precision kept — max NAV ${maxNav._max.currentNav} (Decimal(18,8), not truncated by (12,2))`);

// HONEST-NULL: today's file happens to contain ZERO blank/"N.A." NAVs, so no live row
// exercises this path. Proving it against the DB would be proving nothing. Prove it where
// the rule actually lives — the parser — so the claim is real rather than vacuous.
ok(parseNav("N.A.").kind === "absent", `parseNav("N.A.") → absent ⇒ stored NULL, never 0`);
ok(parseNav("").kind === "absent", `parseNav("")    → absent ⇒ stored NULL, never 0`);
ok(parseNav("-").kind === "absent", `parseNav("-")   → absent ⇒ stored NULL, never 0`);
const zeroParse = parseNav("0.0000");
ok(zeroParse.kind === "value" && zeroParse.nav === "0.0000", `parseNav("0.0000") → value 0 (a PUBLISHED zero is real data, not a missing value)`);
const dotParse = parseNav("10.");
ok(dotParse.kind === "value" && dotParse.nav === "10", `parseNav("10.")  → 10 (trailing-dot formatting — not a fault)`);
ok(parseNav("abc").kind === "malformed", `parseNav("abc")  → malformed ⇒ a fault (admin_fill)`);
console.log(`  → absent and 0 are DIFFERENT things, and the parser keeps them different.`);

// ═══ 6. ERROR FLOW — the fault / honest-empty line ═════════════════════════════════════════════
hdr("6. ERROR FLOW — faults RECORDED, honest-empty silent");
// ── WAS: 15 OPEN faults · 10 open validity · 5 open uniqueness ────────────────────────────────
// STALE BY DESIGN, and it was hiding THREE VACUOUS GREENS. An admin resolved all 15 ISIN faults on
// 2026-07-12 21:27 (`resolved_by = user:admin`). The rows are STILL IN THE TABLE, status=resolved —
// the audit trail is intact; this was a LIFECYCLE EVENT, not a deletion. But the old query filtered
// `status: "open"`, so it returned [] — and `errs.every(...)` and `!errs.some(...)` over an EMPTY
// ARRAY are both trivially TRUE. Three assertions were printing ✅ while testing nothing.
//
// So the census is now taken STATUS-AGNOSTICALLY. What Step 9 must prove is that the ingest SAW
// AMFI's 15 bad ISINs and RECORDED them with the right guard, severity and path. Whether an
// operator has since triaged them is THEIR workflow, and it cannot be allowed to empty out the test.
const errs = await prisma.ingestionError.findMany({
  where: { cron: AMFI_CRON },
  select: { guardType: true, severity: true, resolutionPath: true, targetField: true, targetEntity: true, observed: true, status: true, occurrences: true },
});
const byGuard = errs.reduce<Record<string, number>>((a, e) => { a[e.guardType] = (a[e.guardType] ?? 0) + 1; return a; }, {});
const byStatus = errs.reduce<Record<string, number>>((a, e) => { a[e.status] = (a[e.status] ?? 0) + 1; return a; }, {});
console.log(`  AMFI IngestionErrors RECORDED (all statuses): ${errs.length} → ${JSON.stringify(byGuard)}`);
console.log(`  …by status: ${JSON.stringify(byStatus)}   (open=${byStatus.open ?? 0} — triage state, NOT an invariant)`);

const isinFaults = errs.filter((e) => e.guardType === "validity" || e.guardType === "uniqueness");
ok(isinFaults.length === STEP9.validityFaults + STEP9.uniquenessFaults,
  `${STEP9.validityFaults + STEP9.uniquenessFaults} ISIN faults RECORDED (10 junk-ISIN + 5 duplicate-ISIN) — got ${isinFaults.length}`);
ok(byGuard.validity === STEP9.validityFaults, `${STEP9.validityFaults} × validity (junk in the ISIN column) — got ${byGuard.validity ?? 0}`);
ok(byGuard.uniqueness === STEP9.uniquenessFaults, `${STEP9.uniquenessFaults} × uniqueness (one ISIN under two scheme codes) — got ${byGuard.uniqueness ?? 0}`);
// NON-VACUOUS NOW: asserted over the 15 RECORDED faults, not over an empty open-queue.
ok(isinFaults.length > 0 && isinFaults.every((e) => e.resolutionPath === "source_code"),
  `every one of the ${isinFaults.length} ISIN faults is source_code — a hand-typed ISIN would poison the spine ` +
  `(asserted over the RECORDED set; the old check ran over an empty open-queue and passed vacuously)`);

// The shape guard DID fire, for real: AMFI 302-redirects and the first run fetched 0 bytes.
// It refused to write (fail-closed). Fixed in source (follow redirects) → resolved, not deleted.
const shapeHist = await prisma.ingestionError.findMany({
  where: { cron: AMFI_CRON, guardType: "shape" }, select: { status: true, severity: true, resolutionPath: true, observed: true },
});
ok(shapeHist.length === 1 && shapeHist[0]!.status === "resolved",
  `the shape guard fired for real (0-byte fetch via AMFI's 302) and is now RESOLVED — it refused to write an empty file`);

const junk = errs.filter((e) => e.guardType === "validity");
console.log(`  junk values AMFI shipped in the ISIN column: ${[...new Set(junk.map((e) => e.observed))].join(", ")}`);
const dup = errs.find((e) => e.guardType === "uniqueness");
console.log(`  e.g. uniqueness → ${dup?.targetEntity}: ${dup?.observed}`);

// HONEST-EMPTY, asserted NON-VACUOUSLY. The old form was `errs.length < 20` and `!errs.some(...)`
// over an open-queue that had drained to [] — both true for the wrong reason. The real claim is
// that the ingest recorded EXACTLY the 16 faults it should have (15 ISIN + 1 shape) and NOT ONE
// MORE: the ~10k absent-plan ("-") cells and the ~6k stale NAVs are ABSENCES, not faults, and if
// either had been miscounted as one, THIS is the number that would have blown up.
ok(errs.length === 16,
  `EXACTLY 16 AMFI faults recorded (15 ISIN + 1 shape) — so the ~10k absent-plan "-" cells and the ` +
  `~6k stale NAVs produced ZERO errors. An absence is not a fault, and neither is staleness. (got ${errs.length})`);
ok(!errs.some((e) => /stale/i.test(e.observed)), `no fault's observed value mentions staleness (it would have buried the queue)`);

// ═══ 7. FILL BRIDGE — one currentNav fill, end-to-end, ROLLED BACK ═════════════════════════════
hdr("7. FILL BRIDGE — currentNav fillable, ISIN not");
const target = await prisma.instrument.findFirstOrThrow({
  where: { assetClass: "mutual_fund", currentNav: { not: null } },
  select: { id: true, isin: true, currentNav: true },
});
const resolvedId = await resolveErrorRowId("Instrument", target.isin, null);
ok(resolvedId === target.id, `resolveErrorRowId("Instrument", "${target.isin}") → the right row`);
const meta = fillMetaFor("Instrument", "currentNav");
ok(meta.unit === "₹/unit" && meta.bounds?.min === 0, `fill modal meta: ${JSON.stringify(meta)} (min 0 — a published 0 is legal)`);

const before = target.currentNav!.toString();
const edit = await applyRawFieldEdit({
  table: "Instrument", rowId: target.id, field: "currentNav",
  newValue: 123.45678 as never, citation: "AMFI NAVAll.txt (GATE-3 harness)",
  editedBy: "verify-step9", note: "rolled back",
} as never);
ok((edit as any).ok !== false, `applyRawFieldEdit(Instrument.currentNav) succeeded: ${JSON.stringify((edit as any).cascade ?? (edit as any).reason)}`);
ok((edit as any).cascade === "none", `cascade = "none" — a fund is HELD-NOT-SCORED, a NAV fill must never rescore`);
const after = await prisma.instrument.findUniqueOrThrow({ where: { id: target.id }, select: { currentNav: true } });
ok(after.currentNav?.toString() === "123.45678", `the fill landed (${after.currentNav})`);

// restore — the harness must leave zero trace
await prisma.instrument.update({ where: { id: target.id }, data: { currentNav: before } });
await prisma.rawFieldEdit.deleteMany({ where: { editedBy: "verify-step9" } });
const restored = await prisma.instrument.findUniqueOrThrow({ where: { id: target.id }, select: { currentNav: true } });
ok(restored.currentNav?.toString() === before, `ROLLED BACK to ${restored.currentNav} — harness leaves no trace`);
// And prove the rollback restored the SPINE, not just the one cell: the identity hash still holds.
const spineAfter = (await q(`
  SELECT md5(string_agg(
    isin || '|' || coalesce(amfi_scheme_code,'~') || '|' || coalesce(scheme_name,'~') || '|' ||
    coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' || coalesce(plan_type,'~') || '|' ||
    name || '|' || coalesce(symbol,'~') || '|' || coalesce(stock_id,'~'),
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'mutual_fund'`))[0];
ok(spineAfter.fp === STEP9.mfIdentityFp, `…and the MF identity spine is UNMOVED after the fill+rollback (${spineAfter.fp})`);

// ISIN must NOT be fillable.
const { FILLABLE } = await import("../fill/raw-field-edit.js");
ok(!FILLABLE.Instrument?.has("isin"), `isin is NOT in FILLABLE — an ISIN is never hand-typed (spine discipline)`);
ok(FILLABLE.Instrument?.has("currentNav") === true, `currentNav IS fillable`);

// ═══ 8. HELD-NOT-SCORED ═══════════════════════════════════════════════════════════════════════
hdr("8. HELD-NOT-SCORED — no MF may carry a peer group or a score");
const scored = (await q(`
  SELECT count(*)::int AS n FROM instruments i
  JOIN stocks s ON s.id = i.stock_id
  WHERE i.asset_class = 'mutual_fund'`))[0];
ok(scored.n === 0, `no MF instrument joins to a stock ⇒ structurally unscorable (got ${scored.n})`);
const scoringSees = await prisma.holding.count({ where: { instrument: { assetClass: "mutual_fund" } } });
console.log(`  holdings of an MF today: ${scoringSees} (0 expected — the ledger can't hold one yet: transactions.stock_id is NOT NULL)`);

// ═══ 9. OVERLAP — no ISIN double-loaded ═══════════════════════════════════════════════════════
hdr("9. OVERLAP — the spine holds across EVERY asset class");
const dupIsin = (await q(`
  SELECT count(*)::int AS n FROM (SELECT isin FROM instruments GROUP BY isin HAVING count(*)>1) t`))[0];
ok(dupIsin.n === 0, `zero duplicate ISINs across the whole catalogue (the spine holds)`);

// ── WAS: asset_class <> 'mutual_fund' AND isin LIKE 'INF%' ───────────────────────────────────
// STALE BY DESIGN — and it was asserting a predicate PRODUCTION NO LONGER USES. An INF ISIN means
// "fund", and since Step 13 that legitimately covers TWO classes: mutual_fund AND etf. Production's
// trespass guard was WIDENED to NOT IN ('mutual_fund','etf') at Step 13; this harness kept the old
// narrow form, so all 337 ETFs tripped it every run. The test was stricter than the code it tests,
// and so it was simply wrong. It now asserts THE PREDICATE PRODUCTION ACTUALLY RUNS — and it still
// catches the real thing it was written for: a fund ISIN masquerading as a stock/bond/trust.
const trespass = (await q(`
  SELECT count(*)::int AS n FROM instruments
  WHERE asset_class NOT IN ('mutual_fund'::"AssetClass",'etf'::"AssetClass") AND isin LIKE 'INF%'`))[0];
ok(trespass.n === 0,
  `no INF (fund) ISIN sits under a NON-FUND asset class — the WIDENED production guard, ` +
  `which is the one that actually runs (got ${trespass.n})`);

// ── WAS: ok(total === 504 + 17567) ───────────────────────────────────────────────────────────
// STALE BY DESIGN, and the single worst offender: it asserted a whole-catalogue total, so EVERY
// future asset-class load was guaranteed to break it. Re-scoped to THE STEP-9 SUBSET — the two
// classes Step 9 actually created. That is the claim it was always making, it is true today, and
// the bond/G-Sec/REIT/ETF loads (and the next one) cannot re-trigger it.
// Re-baseline justified: the subset is UNCHANGED at 18,071, and the MF identity hash in §1 proves
// those 17,567 rows are byte-identical — the number is not merely equal, the rows are the same rows.
const subset = (await q(`
  SELECT count(*)::int AS n FROM instruments WHERE asset_class IN ('stock','mutual_fund')`))[0];
const total = await prisma.instrument.count();
ok(subset.n === STEP9.subset,
  `the STEP-9 SUBSET (stock + mutual_fund) = ${subset.n} rows (want ${STEP9.subset} = ${STEP9.stocks} + ${STEP9.mf}) ` +
  `— unchanged by every later load`);
console.log(`  ℹ whole catalogue is now ${total} rows across ${census.length} asset classes ` +
  `(+${total - STEP9.subset} from Steps 13–17). GROWTH here is expected and is NOT asserted — ` +
  `asserting it is what made this harness cry wolf on every load.`);

// ═══ VERDICT ══════════════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? "✅ GATE 3 PASSED — 0 failures." : `❌ ${fail} FAILURE(S)`}`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
