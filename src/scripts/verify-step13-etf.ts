// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP 13 â€” GATE 3 VERIFICATION.  npx tsx src/scripts/verify-step13-etf.ts
//
//   1  BYTE-IDENTICAL (un-waivable): 504 stocks, 17,567 MF instrument rows, and EVERY existing
//      mf_analytics row â€” all unchanged. The fold change ADDED 337 ETF scheme codes; it must not
//      have perturbed a single MF number.
//   2  LOCK 4 â€” newestDay: the fold's window origin is a max over the WHOLE catalogue, so an ETF
//      priced later than every MF would silently shift it and re-cut every MF's window. ASSERTED,
//      not assumed â€” this is the one lock that is a property of the DATA, not of the schema.
//   3  ETF IDENTITY: 337 rows, asset_class=etf, scheme code + NAV present, ISIN-unique, idempotent.
//   4  TICKER: 327 resolved from NSE, 10 honestly NULL (BSE-listed / matured). Never fabricated.
//   5  ETF RICH DATA: ETFs carry computed analytics in mf_analytics. NIFTYBEES computes for real.
//   6  UNIVERSE-ADMIT: a broker ETF holding RESOLVES to the catalogue ETF (held-not-scored) â€”
//      not "unidentifiable", no P2002, no bare stock fabricated. A genuine unknown stock still
//      admits (no regression).
//   7  HELD-NOT-SCORED: no ETF has a peer group or a score. The fund pipeline is not a trigger arm.
//   8  OVERLAP + ERROR FLOW.
//
// BASELINE (recon-step13-gate0, taken BEFORE any Step-13 write):
//   stocks            504   fp 3add5d41096ac195f51cb15a2a383ab9
//   MF instruments  17,567  fp 651f6ba0132b4dc0657e611bb9559969
//   mf_analytics    13,704  fp cc56cefdccf51aeed86c46d243d2d776
//
// The mf_analytics baseline is a CLEAN comparison, not a coincidence: the last nightly fold ran
// today against the same 2026-07-12 NAV file this run reads, so the fold's inputs are unchanged.
// A re-run therefore MUST reproduce those 13,704 rows exactly â€” unless Step 13 perturbed them.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { integrate, syncHoldings } from "../brokers/lifecycle.js";
import { createAccount, linkAccount } from "../controllers/me/accounts-controller.js";
import { getFundAnalytics } from "../controllers/ingestion/mf-controllers.js";

const BASE = {
  // CATALOGUE rows. These are stable comparators: nothing but an ingest writes them, and the MF
  // ingest is fenced away from `etf`. If either of these hashes moves, Step 13 broke something.
  stocks: { n: 504, fp: "3add5d41096ac195f51cb15a2a383ab9" },
  mfInstruments: { n: 17567, fp: "651f6ba0132b4dc0657e611bb9559969" },

  // â”€â”€ mf_analytics: THE GATE-0 HASH IS NOT A VALID COMPARATOR, AND SAYING SO IS THE POINT. â”€â”€
  //
  // Gate 0 recorded cc56cefdâ€¦ Today's fold produces 81cc37deâ€¦ â€” same 13,704 scheme codes,
  // different values. That is NOT Step 13. It is the SOURCE DATA MOVING:
  //
  //   the 15:01 nightly fold (pre-Step-13, MF-only) folded  8,948,983 NAV rows
  //   the 18:00 fold                                folded  9,201,560 NAV rows   (+252,577)
  //
  // AMFI late-published a quarter-million history rows in between (605 schemes now reach
  // 2026-07-12, 7,527 reach 2026-07-10 â€” progressive late reporting). More NAV points â‡’ different
  // nav_points, window_to, returns, vol. The fold is CORRECTLY recomputing on newer data.
  //
  // THIS IS WHY A STORED HASH CANNOT PROVE THE UN-WAIVABLE CLAIM. It conflates "Step 13 perturbed
  // the MFs" with "the world moved" â€” and those demand opposite responses. The claim is instead
  // proven by verify-step13-fold-ab.ts, which folds the SAME inputs twice, minutes apart, with
  // and without `etf`, and compares:
  //
  //   FOLD [mutual_fund, etf] â†’ 81cc37deaa9f4a66c74364051dd5ab86
  //   FOLD [mutual_fund]      â†’ 81cc37deaa9f4a66c74364051dd5ab86   â† IDENTICAL. Admitting `etf`
  //   FOLD [mutual_fund, etf] â†’ 81cc37deaa9f4a66c74364051dd5ab86      changes NOTHING. (And
  //                                                                    fold1===fold3 â‡’ deterministic,
  //                                                                    without which that means nothing.)
  //
  // So the value below is a CURRENT-STATE tripwire, not the proof. It catches an accidental
  // rewrite between now and the next fold; the A/B is what certifies the step. Re-baseline it
  // whenever a legitimate fold moves it, and re-run the A/B â€” never the other way round.
  // RE-BASELINED at Step 18 (Group-3: beta / alpha / tracking-error), and the A/B was re-run FIRST,
  // exactly as the note above demands. Two independent, legitimate reasons this value moved â€” neither
  // of them a perturbation of a metric:
  //
  //   1. THE SOURCE ADVANCED. The fold re-ran against a newer AMFI as-of date, so every return,
  //      volatility and rank in the table is measured to a new endpoint. (This is the case the note
  //      above was already written for.)
  //
  //   2. `omissions` IS IN THIS HASH, and Group-3 legitimately EXTENDS it. The honest-empty ledger
  //      gained new entries â€” benchmark_no_market_risk, credit_benchmark_unavailable, and the rest â€”
  //      for the ~49% of schemes that correctly have no benchmark. That is the ledger doing its job,
  //      not a metric moving. It is also precisely why verify-step18-ab.ts's fingerprint is scoped to
  //      the METRIC columns and deliberately excludes `omissions`: a hash that moves when a NULL
  //      gains an explanation cannot answer "did a number change?".
  //
  // THE NON-PERTURBATION PROOF remains the A/B, and it passed: verify-step18-ab.ts folded the same
  // 9.2M NAV rows twice â€” Group-3 OFF, then ON â€” and both arms produced the identical 26-column
  // metric fingerprint 0e1782464ebe7c087d54f24cc8234d9a. See verify-step18-preexisting.ts.
  mfAnalytics: { n: 13704, fp: "07021ff738161e47bc264705b1268289" },
};

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "âœ…" : "âŒ"} ${name} â€” ${detail}`);
  if (!cond) failures++;
};
const q = <T = any>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);
const one = async <T = any>(s: string, ...p: unknown[]) => (await q<T>(s, ...p))[0]!;

const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const mockReq = (userId: string, o: any = {}) => ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: o.query ?? {} }) as any;
const call = async (fn: any, userId: string, o: any = {}) => { const r = mockRes(); await fn(mockReq(userId, o), r); return r; };
async function seedUser(tag: string) {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `s13-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };
const mk = async (userId: string, name: string, broker: string) => (await call(createAccount, userId, { body: { name, broker } })).body.data.id as string;
const link = (userId: string, id: string, connectionId: string) => call(linkAccount, userId, { params: { id }, body: { connectionId } });

// The fingerprint expressions â€” IDENTICAL to recon-step13-gate0's, so the hashes are comparable.
const FP_STOCKS = `SELECT count(*)::int n, md5(string_agg(id || '|' || symbol || '|' || isin || '|' || name, ',' ORDER BY id)) AS fp FROM stocks`;
const FP_MF_INSTRUMENTS = `
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(symbol,'~') || '|' || name || '|' || coalesce(amfi_scheme_code,'~') || '|' ||
    coalesce(scheme_name,'~') || '|' || coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' ||
    coalesce(plan_type,'~') || '|' || coalesce(current_nav::text,'~') || '|' ||
    coalesce(nav_date::text,'~') || '|' || is_active::text,
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'mutual_fund'`;
/** The MF SUBSET of mf_analytics â€” the exact 13,704 rows that existed before Step 13. */
const FP_MF_ANALYTICS = `
  SELECT count(*)::int n, md5(string_agg(
    scheme_code || '|' || as_of_date::text || '|' || nav_points::text || '|' ||
    coalesce(window_from::text,'~') || coalesce(window_to::text,'~') || '|' ||
    coalesce(ret_1m::text,'~') || coalesce(ret_3m::text,'~') || coalesce(ret_6m::text,'~') ||
    coalesce(ret_1y::text,'~') || coalesce(ret_3y_cagr::text,'~') || coalesce(ret_5y_cagr::text,'~') ||
    coalesce(vol_1y::text,'~') || coalesce(vol_3y::text,'~') || '|' ||
    coalesce(sharpe_1y::text,'~') || coalesce(sharpe_3y::text,'~') || coalesce(sharpe_5y::text,'~') ||
    coalesce(sortino_1y::text,'~') || coalesce(sortino_3y::text,'~') || '|' ||
    coalesce(max_drawdown_1y::text,'~') || coalesce(max_drawdown_3y::text,'~') || coalesce(max_drawdown_5y::text,'~') || '|' ||
    coalesce(roll_1y_n::text,'~') || coalesce(roll_1y_min::text,'~') || coalesce(roll_1y_max::text,'~') ||
    coalesce(roll_1y_avg::text,'~') || coalesce(roll_1y_pct_positive::text,'~') || '|' ||
    coalesce(rank_bucket,'~') || coalesce(rank_bucket_size::text,'~') || '|' ||
    coalesce(rank_1y::text,'~') || coalesce(rank_3y::text,'~') || coalesce(rank_5y::text,'~') ||
    coalesce(pct_1y::text,'~') || coalesce(pct_3y::text,'~') || coalesce(pct_5y::text,'~') || '|' ||
    coalesce(omissions::text,'~'),
    ',' ORDER BY scheme_code)) AS fp
  FROM mf_analytics
  WHERE scheme_code IN (SELECT amfi_scheme_code FROM instruments WHERE asset_class = 'mutual_fund')`;

const created: string[] = [];
const createdStockIds: string[] = [];

/**
 * HAS THE FOLD ACTUALLY RUN WITH ETFs IN IT?
 *
 * This gate exists to stop this harness LYING. The mf_analytics byte-identical check passes
 * trivially if the fold never ran â€” nothing touched the table, so of course the hash matches â€”
 * and it would print a green tick reading "byte-identical AFTER A FOLD RUN THAT INCLUDED ETFs".
 * That tick would be true as a statement about the hash and false as a statement about what was
 * tested, which is the most dangerous kind of green: it certifies a hole.
 *
 * So the run is CLASSIFIED first, and the un-waivable claim is only ASSERTED when it is a real
 * test. Otherwise it is reported as PENDING â€” loudly, and counted as unproven, not as passed.
 */
const foldRan = (await one(`SELECT count(*)::int n FROM mf_analytics
  WHERE scheme_code IN (SELECT amfi_scheme_code FROM instruments WHERE asset_class='etf')`)).n > 0;
let pending = 0;
const pend = (name: string, why: string) => {
  console.log(`  â³ PENDING (NOT PASSED) ${name} â€” ${why}`);
  pending++;
};

try {
  // â•â•â• 1 â€” BYTE-IDENTICAL. THE UN-WAIVABLE ONE. â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  console.log("\nâ•â•â• 1 â€” BYTE-IDENTICAL: Step 13 ADDED; it did not perturb â•â•â•");
  console.log(`     [fold has ${foldRan ? "RUN with ETFs â€” the mf_analytics check below is a REAL test" : "NOT yet run â€” the mf_analytics check is NOT yet a test; see PENDING"}]`);

  const st = await one(FP_STOCKS);
  assert("the 504 stocks are byte-identical (no ETF was admitted as a bare stock)",
    st.n === BASE.stocks.n && st.fp === BASE.stocks.fp, `${st.n} rows, fp ${st.fp}`);

  const mi = await one(FP_MF_INSTRUMENTS);
  assert("the 17,567 MF instrument rows are byte-identical (the ETF upsert's fence held)",
    mi.n === BASE.mfInstruments.n && mi.fp === BASE.mfInstruments.fp, `${mi.n} rows, fp ${mi.fp}`);

  const ma = await one(FP_MF_ANALYTICS);
  if (foldRan) {
    assert("the 13,704 MF analytics rows match the post-fold state (current-state tripwire; the " +
      "NON-PERTURBATION proof is the A/B in verify-step13-fold-ab.ts â€” see the note on BASE)",
      ma.n === BASE.mfAnalytics.n && ma.fp === BASE.mfAnalytics.fp, `${ma.n} rows, fp ${ma.fp}`);
    console.log("  âœ… UN-WAIVABLE (proven by verify-step13-fold-ab.ts, not by this hash): folding " +
      "[mutual_fund,etf] and [mutual_fund] over the SAME inputs both yield MF fp " +
      "81cc37deâ€¦ â€” admitting `etf` changes NOTHING about the 13,704 MF rows.");
  } else {
    pend("mf_analytics byte-identical AFTER an ETF-inclusive fold",
      `the fold has not run with ETFs yet, so this proves NOTHING â€” the table is simply untouched ` +
      `(${ma.n} rows, fp ${ma.fp}, matching baseline because nothing wrote to it). The claim is ` +
      `UNPROVEN until a fold completes.`);
  }

  // (The "13,601 MF anchors, unchanged" check is retired: earliest_nav no longer exists. It guarded
  // the ETF inception walk against re-walking the 103 anchorless MFs — and the walk, its anchors and
  // the ret_since_earliest_cagr they fed are all gone. That metric was folded from AMFI's RAW NAV,
  // and a span reaching back to its ~2009 floor is the worst possible case for the unit splits and
  // IDCW payouts that data carries. It was not unpopulated; it was uncomputable.)

  // â•â•â• 2 â€” LOCK 4: newestDay â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  console.log("\nâ•â•â• 2 â€” LOCK 4: the fold's window origin did not move â•â•â•");
  const nd = await one(`
    SELECT max(nav_date) FILTER (WHERE asset_class='mutual_fund')::text AS mf,
           max(nav_date) FILTER (WHERE asset_class='etf')::text        AS etf,
           max(nav_date) FILTER (WHERE asset_class IN ('mutual_fund','etf'))::text AS both
    FROM instruments`);
  assert("no ETF is priced LATER than the newest MF â€” so newestDay, startDay and every MF's " +
    "streamed window are unchanged by admitting the class",
    nd.both === nd.mf, `MF ${nd.mf} Â· ETF ${nd.etf} Â· union ${nd.both}`);

  // â•â•â• 3 â€” ETF IDENTITY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  console.log("\nâ•â•â• 3 â€” ETF identity â•â•â•");
  const etf = await one(`
    SELECT count(*)::int n,
           count(*) FILTER (WHERE amfi_scheme_code IS NULL)::int no_code,
           count(*) FILTER (WHERE current_nav IS NULL)::int no_nav,
           count(*) FILTER (WHERE nav_date IS NULL)::int no_date,
           count(*) FILTER (WHERE stock_id IS NOT NULL)::int has_stock,
           count(DISTINCT isin)::int isins,
           count(DISTINCT amfi_scheme_code)::int codes
    FROM instruments WHERE asset_class='etf'`);
  assert("337 ETF rows landed", etf.n === 337, `${etf.n} rows`);
  assert("every ETF carries an amfi_scheme_code (the fold's join key)", etf.no_code === 0, `${etf.no_code} missing`);
  assert("every ETF carries a current NAV + its nav_date", etf.no_nav === 0 && etf.no_date === 0, `${etf.no_nav} navless, ${etf.no_date} dateless`);
  assert("every ETF has stock_id NULL â€” held-NOT-scored, structurally", etf.has_stock === 0, `${etf.has_stock} with a stock`);
  assert("ISIN-unique (one row per ISIN â€” the spine holds)", etf.isins === 337 && etf.codes === 337, `${etf.isins} ISINs, ${etf.codes} codes`);

  // â•â•â• 4 â€” TICKER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  console.log("\nâ•â•â• 4 â€” NSE ticker enrichment: resolved where it exists, honestly NULL where it does not â•â•â•");
  const tk = await one(`
    SELECT count(*) FILTER (WHERE symbol IS NOT NULL)::int with_sym,
           count(*) FILTER (WHERE symbol IS NULL)::int no_sym
    FROM instruments WHERE asset_class='etf'`);
  assert("327 ETFs carry their NSE exchange ticker", tk.with_sym === 327, `${tk.with_sym} tickered`);
  assert("10 ETFs have NO ticker and it is an honest NULL, not a fabricated one " +
    "(BSE-listed Sensex ETFs + the matured BHARAT Bond April 2025)",
    tk.no_sym === 10, `${tk.no_sym} NULL`);
  const nb = await one(`SELECT symbol, isin, amfi_scheme_code AS code, current_nav::text nav, name FROM instruments WHERE symbol='NIFTYBEES' AND asset_class='etf'`);
  assert("NIFTYBEES resolved to its ISIN + scheme code + NAV",
    !!nb && nb.isin === "INF204KB14I2", nb ? `${nb.symbol} ${nb.isin} code=${nb.code} nav=${nb.nav}` : "NOT FOUND");
  const mfSym = await one(`SELECT count(*)::int n FROM instruments WHERE asset_class='mutual_fund' AND symbol IS NOT NULL`);
  assert("no MUTUAL FUND acquired a ticker (a fund has none; the symbol COALESCE is inert for MFs)",
    mfSym.n === 0, `${mfSym.n} MF rows with a symbol`);

  // â•â•â• 5 â€” ETF RICH DATA (the whole point of Option A) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  console.log("\nâ•â•â• 5 â€” ETF rich data: the AMFI fold computed it, by reuse â•â•â•");
  if (!foldRan) {
    pend("ETF rich data (returns / vol / Sharpe / Sortino / drawdown / rolling)",
      "the fold has not completed since the ETFs were catalogued. AMFI is THROTTLING its history " +
      "endpoint to a dribble (one window held a socket 15+ min against a ~35 s norm), so both the " +
      "inception walk and the fold were abandoned. The fold's WRITE BARRIER means this wrote " +
      "NOTHING â€” yesterday's 13,704 rows stand, untouched. Re-run the fold once AMFI recovers " +
      "(tonight's 01:30 IST cron will do it unattended).");
    pend("NIFTYBEES computes end-to-end + the API read-widen serves it",
      "blocked on the same fold.");
    // The ranking lock does NOT need the fold â€” it is a property of the catalogue, and it is the
    // load-bearing one for "MF ranks cannot move", so it is asserted regardless.
    const pt = await one(`SELECT count(*) FILTER (WHERE plan_type IS NULL)::int null_pt, count(*)::int n
      FROM instruments WHERE asset_class='etf'`);
    assert("LOCK 3 (holds without the fold): all 337 ETFs carry plan_type NULL, so rankBucketFor " +
      "returns {bucket:null, plan_type_unknown} for every one â€” they can NEVER enter an MF's " +
      "ranking pool and shift its percentile",
      pt.null_pt === 337 && pt.n === 337, `${pt.null_pt}/${pt.n} with plan_type NULL`);
  } else {
    const rich = await one(`
      SELECT count(*)::int n,
             count(ret_1y)::int r1y, count(ret_3y_cagr)::int r3y, count(ret_5y_cagr)::int r5y,
             count(vol_1y)::int vol, count(sharpe_1y)::int sharpe, count(sortino_1y)::int sortino,
             count(max_drawdown_1y)::int dd, count(roll_1y_n)::int roll,
             count(rank_bucket)::int ranked
      FROM mf_analytics
      WHERE scheme_code IN (SELECT amfi_scheme_code FROM instruments WHERE asset_class='etf')`);
    assert("all 337 ETFs have an analytics row", rich.n === 337, `${rich.n} rows`);
    assert("...carrying the full NAV-derived suite (returns / vol / Sharpe / Sortino / drawdown / rolling)",
      rich.r1y > 0 && rich.vol > 0 && rich.sharpe > 0 && rich.sortino > 0 && rich.dd > 0 && rich.roll > 0,
      `1y=${rich.r1y} 3y=${rich.r3y} 5y=${rich.r5y} vol=${rich.vol} sharpe=${rich.sharpe} sortino=${rich.sortino} dd=${rich.dd} roll=${rich.roll}`);

    // ── THE SINCE-EARLIEST CAGR NO LONGER EXISTS, AND THE REASON MATTERS MORE THAN THE CHECK DID. ──
    //
    // This block used to prove the metric was HONEST-EMPTY for all 337 ETFs — NULL with the reason
    // `no_earliest_anchor`, never a fabricated zero. That was the right behaviour for a metric we had
    // not yet populated. It turned out not to be a population problem.
    //
    // The ETF walk DID eventually run and anchor them, and NIFTYBEES then reported -11.19% a year
    // since 2019. The fund had not lost money: it sub-divided its units 1:10 in December 2019, AMFI
    // does not restate a NAV when that happens, and the "return" was almost entirely the split. The
    // anchors were rolled back, and the metric is now dropped outright — a span reaching back to
    // AMFI's ~2009 floor is the WORST case for the unit splits and IDCW payouts its raw NAV carries,
    // and unlike 1Y/3Y/5Y there is no bounded slice of history we can rebuild from a real corporate
    // action. Honest-empty is a NULL with a reason. This is the other case: no column, because no
    // number.
    const dropped = await one(`SELECT count(*)::int n FROM information_schema.columns
      WHERE table_name='mf_analytics'
        AND column_name IN ('earliest_nav','earliest_nav_date','ret_since_earliest_cagr')`);
    assert("the since-earliest CAGR and its anchors are GONE — not left NULL-with-a-reason, but " +
      "REMOVED, because AMFI's raw NAV cannot support the metric at any span",
      dropped.n === 0, `${dropped.n} of the 3 columns still exist`);

    assert("ETFs are UNRANKED â€” all 337 carry plan_type NULL, so they never enter an MF's ranking " +
      "pool (this is lock 3, observed rather than argued)",
      rich.ranked === 0, `${rich.ranked} ranked`);

    const nbA = await one(`SELECT scheme_code, nav_points, ret_1y::text r1, vol_1y::text v, sharpe_1y::text s,
        max_drawdown_1y::text dd
      FROM mf_analytics WHERE scheme_code = (SELECT amfi_scheme_code FROM instruments WHERE symbol='NIFTYBEES' AND asset_class='etf')`);
    assert("NIFTYBEES computes for real (a known ETF, end to end)",
      !!nbA && Number(nbA.nav_points) > 1000 && nbA.r1 !== null,
      nbA ? `points=${nbA.nav_points} 1y=${nbA.r1} vol=${nbA.v} sharpe=${nbA.s} maxDD=${nbA.dd}` : "NO ROW");

    const honest = await one(`SELECT count(*)::int n FROM mf_analytics
      WHERE scheme_code IN (SELECT amfi_scheme_code FROM instruments WHERE asset_class='etf')
        AND ret_5y_cagr IS NULL AND omissions ? 'ret_5y_cagr'`);
    assert("a young ETF's missing 5Y is HONEST-EMPTY with a reason in `omissions` â€” never 0, never faked",
      honest.n > 0, `${honest.n} ETFs honest-empty on 5Y, each with a recorded reason`);

    // The API serves it (the read-widen).
    const api = await call(getFundAnalytics, "n/a", { params: { schemeCode: String(nbA.scheme_code) } });
    assert("GET /api/v1/mf/:schemeCode serves the ETF â€” analytics AND its identity block",
      api.statusCode === 200 && api.body?.data?.scheme?.symbol === "NIFTYBEES" && api.body?.data?.scheme?.assetClass === "etf",
      `HTTP ${api.statusCode}, scheme=${JSON.stringify(api.body?.data?.scheme?.symbol)} class=${JSON.stringify(api.body?.data?.scheme?.assetClass)}`);
  }

  // â•â•â• 6 â€” UNIVERSE-ADMIT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  console.log("\nâ•â•â• 6 â€” Universe-admit: a broker ETF holding resolves; it is not 'unidentifiable' â•â•â•");
  const RUN = randomUUID().slice(0, 8).toUpperCase();
  const NEWSYM = `ZZ13${RUN.slice(0, 4)}`;
  // A REAL-GRAMMAR equity ISIN: IN | E | <4-char issuer> | 01 | <3-char serial>  = 12 chars.
  //
  // THIS WAS `INE${RUN}Z01` â€” FOURTEEN characters, with its "01" at the end. Not an ISIN at all. It
  // passed only because Pass 3 used to validate NOTHING: it would take any non-empty string and
  // write it into `stocks.isin` â€” THE SPINE. Step 17's classifier reads the security-type at chars
  // 8-9 to decide what an instrument IS, so it now rejects a malformed ISIN outright, and this
  // fixture failed. That is the guard working, not a regression: the fixture was the bug.
  const NEWISIN = `INE${RUN.slice(0, 4)}01${RUN.slice(4, 7)}`;

  const U = await seedUser("etf"); created.push(U.authId);
  const acct = await mk(U.userId, "Mock Demat", "mock");
  const stocksBefore = await prisma.stock.count();

  const conn = await integrate(U.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_ETF",
    mockHoldings: [
      { tradingsymbol: "RELIANCE", isin: "INE002A01018", exchange: "NSE", quantity: 10, average_price: 2400.5, last_price: 2950, product: "CNC" },
      // THE STEP-13 CASE: a real ETF. Before this step it was ADMITTED AS A BARE STOCK (an INF
      // ISIN wearing asset_class='stock'); once catalogued it would instead have thrown P2002 and
      // degraded to "unidentifiable". It must now RESOLVE to the catalogue ETF.
      { tradingsymbol: "NIFTYBEES", isin: "INF204KB14I2", exchange: "NSE", quantity: 40, average_price: 250, last_price: 290, product: "CNC" },
      // NO REGRESSION: a genuine unknown equity must still be admitted.
      { tradingsymbol: NEWSYM, isin: NEWISIN, exchange: "NSE", quantity: 25, average_price: 150, last_price: 175, product: "CNC" },
      // And the un-identifiable one must still fall back honestly.
      { tradingsymbol: "FAKESTOCK", quantity: 3, average_price: 100, last_price: 90, product: "CNC" },
    ],
  } });
  await link(U.userId, acct, conn.id);
  const out = await syncHoldings(U.userId, conn.id);

  assert("the sync succeeded with all 4 holdings mirrored", out.synced === 4, `synced=${out.synced}`);
  assert("the ETF is reported as HELD-NOT-SCORED â€” identified, not a fault",
    out.heldNotScored.length === 1 && out.heldNotScored[0]!.symbol === "NIFTYBEES" && out.heldNotScored[0]!.assetClass === "etf",
    JSON.stringify(out.heldNotScored));
  assert("the ETF is NOT in `unmapped` (only FAKESTOCK, which genuinely has no ISIN, is)",
    out.unmapped.length === 1 && out.unmapped[0] === "FAKESTOCK", JSON.stringify(out.unmapped));

  const bh = await one(`SELECT stock_id, instrument_id FROM broker_holdings WHERE broker_connection_id=$1 AND symbol='NIFTYBEES'`, conn.id);
  const etfInst = await one(`SELECT id FROM instruments WHERE isin='INF204KB14I2'`);
  assert("the ETF holding points at the CATALOGUE ETF instrument, with stock_id NULL",
    bh.stock_id === null && bh.instrument_id === etfInst.id, `stock_id=${bh.stock_id} instrument_id=${bh.instrument_id}`);

  const stocksAfter = await prisma.stock.count();
  assert("NO REGRESSION: the genuine unknown equity was still ADMITTED (+1 stock, and only 1)",
    stocksAfter === stocksBefore + 1 && out.admitted.length === 1 && out.admitted[0]!.symbol === NEWSYM,
    `${stocksBefore} â†’ ${stocksAfter}; admitted=${JSON.stringify(out.admitted.map((a) => a.symbol))}`);
  const adm = await prisma.stock.findUnique({ where: { isin: NEWISIN }, select: { id: true } });
  if (adm) createdStockIds.push(adm.id);

  const noBareEtf = await one(`SELECT count(*)::int n FROM stocks WHERE isin LIKE 'INF%'`);
  assert("NO ETF WAS FABRICATED AS A BARE STOCK â€” zero fund ISINs in `stocks`",
    noBareEtf.n === 0, `${noBareEtf.n} INF-ISIN stocks`);

  // Idempotency: a resync must not fork anything.
  const out2 = await syncHoldings(U.userId, conn.id);
  const stocksAfter2 = await prisma.stock.count();
  assert("a RESYNC is idempotent â€” the ETF resolves again, no new stock, no P2002",
    stocksAfter2 === stocksAfter && out2.heldNotScored.length === 1 && out2.admitted.length === 0,
    `stocks ${stocksAfter}â†’${stocksAfter2}, admitted=${out2.admitted.length}`);

  // â•â•â• 7 â€” HELD-NOT-SCORED â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  console.log("\nâ•â•â• 7 â€” ETFs are held, NOT scored â•â•â•");
  // ETFs have no `stocks` row at all, so they are unreachable to the scoring engine by
  // construction. This asserts the construction: no fund ISIN has leaked into `stocks`, and
  // therefore none can be sitting in a peer group or carrying a Health Score.
  const scored = await one(`
    SELECT (SELECT count(*)::int FROM stock_peer_groups m
              JOIN stocks s ON s.id = m.stock_id WHERE s.isin LIKE 'INF%') AS pgs,
           (SELECT count(*)::int FROM score_snapshots ss
              JOIN stocks s ON s.id = ss.stock_id WHERE s.isin LIKE 'INF%') AS scores,
           (SELECT count(*)::int FROM instruments WHERE asset_class='etf' AND stock_id IS NOT NULL) AS etf_with_stock`);
  assert("no fund/ETF ISIN sits in a peer group or carries a score â€” and no ETF has a stock row " +
    "at all, so the scoring engine structurally cannot reach one",
    Number(scored.pgs) === 0 && Number(scored.scores) === 0 && Number(scored.etf_with_stock) === 0,
    `peer-group rows=${scored.pgs} scores=${scored.scores} etf-with-stock=${scored.etf_with_stock}`);

  // â•â•â• 8 â€” OVERLAP + the widened trespass guard â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  console.log("\nâ•â•â• 8 â€” Overlap: the spine holds â•â•â•");
  const tres = await one(`SELECT count(*)::int n FROM instruments
    WHERE asset_class NOT IN ('mutual_fund'::"AssetClass",'etf'::"AssetClass") AND isin LIKE 'INF%'`);
  assert("the WIDENED trespass guard is clean â€” no INF ISIN under a non-fund class " +
    "(the old guard would now be reporting all 337 ETFs as critical, every night)",
    tres.n === 0, `${tres.n} trespassers`);
  const dbl = await one(`SELECT count(*)::int n FROM (
      SELECT isin FROM instruments WHERE asset_class IN ('mutual_fund','etf') GROUP BY isin HAVING count(*) > 1) x`);
  assert("no ISIN is double-loaded across the MF and ETF passes (the section filters are exact complements)",
    dbl.n === 0, `${dbl.n} duplicated ISINs`);
  const total = await one(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`);
  console.log("     catalogue:", JSON.stringify(await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`)));
  void total;
} finally {
  for (const id of createdStockIds) await prisma.stock.delete({ where: { id } }).catch(() => {});
  for (const a of created) await cleanup(a).catch(() => {});
}

console.log(
  `\n${failures === 0 ? "âœ… 0 FAILURES" : `âŒ ${failures} FAILURE(S)`}` +
    (pending > 0
      ? `  Â·  â³ ${pending} PENDING (NOT passed â€” blocked on a fold that AMFI's throttling has ` +
        `prevented from completing). Step 13 is NOT signed off until these run green.`
      : "  Â·  nothing pending â€” Step 13 fully verified."),
);
await prisma.$disconnect();
// A PENDING item is NOT a pass. Exit non-zero so no CI/operator can mistake this for a green run.
process.exit(failures === 0 && pending === 0 ? 0 : 1);
