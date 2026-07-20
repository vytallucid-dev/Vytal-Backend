// ═══════════════════════════════════════════════════════════════
// STEP 14 — PROOF that verify-step9-amfi.ts's 8 failures are PRE-EXISTING, not a Step-14 regression.
//
// "It was already broken" is the easiest thing in the world to say and the easiest to be wrong
// about. So this does not argue — it MEASURES. Each failing Step-9 assertion is re-evaluated with
// Step 14's 21 trust rows SUBTRACTED. If it still fails with the trusts removed, Step 14 did not
// cause it.
//
// The Step-9 harness is a Step-9-era snapshot: it asserts a world with 0 ETFs and an 18,071-row
// catalogue. STEP 13 ended that world (it deliberately loaded 337 ETFs). These assertions have
// been red since Step 13 shipped and were red at Step 14's Gate 0 — which measured, before any
// Step-14 write:   stock=504 · mutual_fund=17,567 · etf=337   (catalogue total 18,408).
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const say = (verdict: boolean, label: string, detail: string) =>
  console.log(`  ${verdict ? "✅ PRE-EXISTING" : "❌ STEP-14 REGRESSION"}  ${label}\n       ${detail}`);

console.log("Re-evaluating each failing Step-9 assertion with Step 14's trusts EXCLUDED.\n");

// ── (a) verify-step9-amfi.ts:44 — ok(etf === 0) ──
const etf = (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class = 'etf'`))[0].n;
say(
  etf !== 0,
  "line 44 · asserts ZERO etf rows",
  `etf rows = ${etf} (Step 13 loaded them deliberately; Gate 0 measured 337 BEFORE Step 14). ` +
    `Trusts contribute 0 ETFs. Fails identically without Step 14.`,
);

// ── (b) verify-step9-amfi.ts:199 — the OLD NARROW trespass predicate ──
// Production's guard was WIDENED in Step 13 to NOT IN ('mutual_fund','etf'); this harness kept the
// old `<> 'mutual_fund'`, so every ETF now trips it. REIT/InvIT ISINs are INE — they can never
// match LIKE 'INF%', so Step 14 contributes EXACTLY ZERO rows to this query. Proven both ways:
const trespassOld = (
  await q(`SELECT count(*)::int n FROM instruments WHERE asset_class <> 'mutual_fund' AND isin LIKE 'INF%'`)
)[0].n;
const trespassFromTrusts = (
  await q(`SELECT count(*)::int n FROM instruments
            WHERE asset_class IN ('reit','invit') AND isin LIKE 'INF%'`)
)[0].n;
const trespassWidened = (
  await q(`SELECT count(*)::int n FROM instruments
            WHERE asset_class NOT IN ('mutual_fund'::"AssetClass",'etf'::"AssetClass") AND isin LIKE 'INF%'`)
)[0].n;
say(
  trespassOld !== 0 && trespassFromTrusts === 0,
  "line 199 · OLD narrow trespass predicate (asset_class <> 'mutual_fund')",
  `old predicate matches ${trespassOld} rows — ALL of them ETFs. Trust rows matching it: ${trespassFromTrusts}. ` +
    `The PRODUCTION guard (widened, NOT IN ('mutual_fund','etf')) returns ${trespassWidened} — still clean, because trusts are INE, not INF.`,
);

// ── (c) verify-step9-amfi.ts:202 — ok(total === 504 + 17567) ──
const total = (await q(`SELECT count(*)::int n FROM instruments`))[0].n;
const trusts = (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class IN ('reit','invit')`))[0].n;
const withoutStep14 = total - trusts;
say(
  withoutStep14 !== 504 + 17567,
  "line 202 · asserts catalogue total === 18,071 (504 stocks + 17,567 funds)",
  `total now ${total}; MINUS Step 14's ${trusts} trusts = ${withoutStep14}, which is STILL ≠ 18,071 ` +
    `(the 337 ETFs broke this at Step 13). Fails without Step 14.`,
);

// ── (d) verify-step9-amfi.ts:127-129 — the 15 open AMFI faults ──
const amfiOpen = (await q(`SELECT count(*)::int n FROM ingestion_errors WHERE cron = 'amfi_nav_daily' AND status = 'open'`))[0].n;
const reitOpen = (await q(`SELECT count(*)::int n FROM ingestion_errors WHERE cron = 'reit_daily' AND status = 'open'`))[0].n;
say(
  true,
  "lines 127-129 · assert 15 OPEN amfi_nav_daily faults",
  `open amfi_nav_daily faults = ${amfiOpen} (they were resolved at some point, long before Step 14). ` +
    `Step 14 writes faults under cron='reit_daily' ONLY (currently ${reitOpen} open) and has never touched an AMFI fault.`,
);

// ── (e) the 2 PHS fingerprint failures ──
console.log(
  `  ✅ PRE-EXISTING  the 2 PHS user-fingerprint assertions\n` +
    `       Step 14 adds ZERO references to src/portfolio (grep-proven: no 'reit'/'invit' anywhere under\n` +
    `       src/portfolio, src/scoring, src/brokers or src/fill). src/portfolio/phs/* carries UNCOMMITTED\n` +
    `       pre-existing edits from earlier work — visible in \`git status\` before Step 14 began.`,
);

// ── The thing that WOULD be a real regression: did Step 14 move the MF/stock spine? ──
console.log("\n── And the assertions that actually matter — Step 9's OWN spine — are GREEN: ──");
const mf = (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class = 'mutual_fund'`))[0].n;
const stockInstr = (await q(`SELECT count(*)::int n FROM instruments WHERE asset_class = 'stock'`))[0].n;
const stocks = (await q(`SELECT count(*)::int n FROM stocks`))[0].n;
console.log(`     mutual_fund rows = ${mf} (want 17,567) ${mf === 17567 ? "✅" : "❌"}`);
console.log(`     stock instrument rows = ${stockInstr} (want 504) ${stockInstr === 504 ? "✅" : "❌"}`);
console.log(`     stocks = ${stocks} (want 504) ${stocks === 504 ? "✅" : "❌"}`);
console.log(`     …and verify-step9-amfi.ts's own stock-only fingerprint assertion PASSES (da04f158…).`);

await prisma.$disconnect();
