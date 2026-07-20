// ═══════════════════════════════════════════════════════════════════════════
// STEP 19 — DISTRIBUTIONS: an IDCW plan's NAV is a PRICE series, not a TOTAL-RETURN one.
//
// AMFI publishes NAV as the AMC reports it, and an IDCW (payout) plan's NAV FALLS by the
// distribution every time one is paid. A return measured from that series understates the fund by
// exactly what it handed back to its holders. Measured against each plan's OWN Growth twin — same
// fund, same portfolio, same window, so the gap IS the distribution and nothing else:
//
//     2,146 IDCW plans understate ret_3y by >1pp · 1,534 by >6pp · mean 3.9pp · max 19.3pp
//     scheme 109446:  IDCW says -7.8%   ·   its Growth twin says +11.5%
//
// And it is not only the returns. A payout is a step DOWN in the NAV series, so it inflates
// volatility, deepens max-drawdown, and drags Sharpe/Sortino/beta/alpha with it. Every NAV-derived
// metric on an IDCW plan is affected, which is why this module replaces the whole metric block
// rather than patching the six return columns.
//
// THE FIX, AND WHY IT IS NOT A FUDGE: a Growth plan of the SAME FUND in the SAME PLAN TIER holds
// the identical portfolio and retains its distributions — its NAV *is* the total-return series we
// are missing. Handing its figures to the IDCW plan is not an estimate; it is the same fund's
// return, measured on the series that actually tracks it.
//
// ⚠️  TIER-MATCHED, AND THAT IS LOAD-BEARING. Direct and Regular plans differ by expense ratio
//     (Direct is cheaper, so it earns more). Inheriting from "any Growth plan in the family" would
//     hand a REGULAR-IDCW plan the DIRECT-Growth figure and OVERSTATE it by the whole distributor
//     commission. Direct↔Direct, Regular↔Regular, or nothing.
//
// IDCW-ONLY FUNDS get nothing to inherit from, and no distribution history is sourceable anywhere,
// so their metrics are DECLINED with a reason. That is the honest end of this: 708 families.
// ═══════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { OmissionCode } from "./mf-omissions.js";
import type { Computed } from "./mf-analytics.js";

/** Direct and Regular are DIFFERENT expense ratios, so they are different returns. */
export type PlanTier = "direct" | "regular" | "none";

export interface PlanInfo {
  familyId: string;
  tier: PlanTier;
  isGrowth: boolean;
}

/**
 * `plan_option` is Step 16's normalised token string ("direct plan + growth option",
 * "regular plan + idcw"). Both facts we need are in it.
 *
 * GROWTH is the positive test, and deliberately so: the option vocabulary for a payout plan is long
 * and drifting (idcw, dividend, payout, reinvestment, daily/weekly/fortnightly/monthly…), while
 * "growth" is one word that has never moved. Testing FOR growth and treating everything else as
 * distributing means a NEW payout spelling degrades to "not growth" — which is the SAFE side of the
 * line (it declines or inherits) rather than silently computing a price return and calling it a
 * total return.
 *
 * ⚠️  BUT "GROWTH" IS ALSO A TIER NAME, AND THAT PUNCHED A HOLE IN THE POSITIVE TEST.
 *
 *     A bare /growth/ over the whole token string was the rule, and it was safe against every new
 *     PAYOUT spelling — which is what it was designed for. It was not safe against an AMC putting
 *     the word "Growth" in the PLAN TIER:
 *
 *         "Nippon India Multi Cap Fund - Direct Plan Growth Plan - Bonus Option"
 *                                                    ^^^^^^^^^^^   ^^^^^^^^^^^^
 *                                                    the TIER      the OPTION
 *
 *     → "direct plan + growth plan + bonus option" MATCHES /growth/, so a BONUS plan was classified
 *     as a Growth plan and offered to IDCW plans as their total-return twin.
 *
 *     A BONUS option is not a total-return series. It issues bonus UNITS instead of paying cash, so
 *     its NAV steps DOWN on every bonus issue — the same corruption a unit split inflicts, and the
 *     same reason an IDCW NAV cannot be trusted. Measured live: 52 plans matched, 31 of them WON
 *     their slot's twin race, and because most Bonus plans are dormant (nav_points = 0) they handed
 *     out NULLs — 10 live IDCW plans with 1,230+ NAV points each were reporting NO RETURN AT ALL
 *     while their real Growth twin sat in the same slot holding 6.12%.
 *
 *     So Growth means growth AND NOT bonus. A Bonus plan now falls to the safe side with everything
 *     else: it INHERITS the true Growth plan's figures, which is exactly right — same fund, same
 *     tier, same portfolio, and the Growth plan's NAV *is* the total return that the bonus issues
 *     stripped out of its own.
 */
export function classifyPlanOption(planOption: string): { tier: PlanTier; isGrowth: boolean } {
  const s = planOption.toLowerCase();
  const tier: PlanTier = s.includes("direct") ? "direct" : s.includes("regular") ? "regular" : "none";
  return { tier, isGrowth: /growth/.test(s) && !/\bbonus\b/.test(s) };
}

/**
 * Scheme code → its family, tier and option. MUTUAL FUNDS ONLY — ETFs have no plan structure.
 *
 * ⚠️  FALLS BACK TO THE RAW SCHEME NAME WHEN `plan_option` IS NULL, AND THAT IS NOT A SHORTCUT.
 *
 *     165 MF codes have no normalised `plan_option` — Step 16's tokenizer declined them. But
 *     "unnormalised" is NOT "unknown": 30 of those 165 are named, in AMFI's own words,
 *
 *         "BANDHAN Fixed Term Plan Series 179 DIRECT PLAN-GROWTH (3652 days)"
 *
 *     — a Growth plan whose only sin is a "(3652 days)" suffix the tokenizer could not chew. Their
 *     NAV retains its distributions, their returns are CORRECT, and declining them would withhold
 *     30 true numbers to no purpose. So when the normalised token is missing we read the SAME fact
 *     off the raw name AMFI published. That is real source data, not an inference: the fund is
 *     telling us it is a Growth plan.
 *
 *     The test is still FOR growth (see classifyPlanOption), so anything the name does not call a
 *     Growth plan still lands on the safe side — inherited or declined, never computed as a price
 *     return and served as a total return.
 */
export async function loadPlanMap(): Promise<Map<string, PlanInfo>> {
  const rows = await prisma.$queryRawUnsafe<
    { scheme_code: string; family_id: string; plan_option: string | null; scheme_name: string }[]
  >(`
    SELECT m.scheme_code, m.family_id, m.plan_option, m.scheme_name
    FROM mf_family_members m
    JOIN mf_families f ON f.id = m.family_id
    WHERE f.asset_class = 'mutual_fund'`);

  const out = new Map<string, PlanInfo>();
  for (const r of rows) {
    const source = r.plan_option ?? r.scheme_name; // normalised token first; AMFI's own name second
    if (!source) continue; // neither → genuinely unclassifiable → declined by the caller
    const { tier, isGrowth } = classifyPlanOption(source);
    out.set(String(r.scheme_code), { familyId: String(r.family_id), tier, isGrowth });
  }
  return out;
}

/**
 * The MF scheme codes — the ONLY rows this module may touch.
 *
 * An ETF has no Direct/Regular and no Growth/IDCW: there is one class of unit, its NAV retains
 * everything, and it is already a total-return series. Running distribution logic over ETFs would
 * honest-NULL all 337 of them for having no Growth sibling — destroying the very metrics Step 19
 * exists to repair. The set is the fence.
 */
export async function loadMfSchemeCodes(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ code: string }[]>(`
    SELECT DISTINCT amfi_scheme_code AS code FROM instruments
    WHERE asset_class = 'mutual_fund' AND amfi_scheme_code IS NOT NULL`);
  return new Set(rows.map((r) => String(r.code)));
}

/** The mf_analytics columns whose value is folded from the NAV series — i.e. everything a
 *  distribution corrupts. Used to keep the omissions ledger in step with the values. */
const NAV_DERIVED_COLS = [
  "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y_cagr", "ret_5y_cagr",
  "vol_1y", "vol_3y",
  "sharpe_1y", "sharpe_3y", "sharpe_5y",
  "sortino_1y", "sortino_3y",
  "max_drawdown_1y", "max_drawdown_3y", "max_drawdown_5y",
  "roll_1y", "roll_1y_min", "roll_1y_max", "roll_1y_avg", "roll_1y_pct_positive",
  "beta_1y", "beta_3y", "beta_5y",
  "alpha_1y", "alpha_3y", "alpha_5y",
  "tracking_error_1y", "tracking_error_3y", "tracking_error_5y",
] as const;

/** Take the Growth twin's whole NAV-derived block — values AND the reasons behind its own gaps.
 *  (If the twin has no 5Y because the FUND is too young, the IDCW plan has no 5Y for that same
 *  reason. Copying the values but not the reasons would leave an unexplained NULL.) */
function inheritMetrics(dst: Computed, src: Computed): void {
  // The chart must inherit EXACTLY where the metric inherits: record the twin whose series these
  // numbers came from, so /chart draws that same series (one stored fact, not a re-resolution).
  dst.seriesSchemeCode = src.schemeCode;
  dst.ret = { ...src.ret };
  // ★ (T-4) vol5y is transient (guard input, never stored) but MUST inherit — an IDCW plan that inherits
  // a contaminated Growth twin inherits its impossibility, and the guard runs AFTER this. Omitting it here
  // would re-open the y5 blind spot for exactly the inherited-plan shape the 65 rows are in.
  dst.vol1y = src.vol1y; dst.vol3y = src.vol3y; dst.vol5y = src.vol5y;
  dst.sharpe1y = src.sharpe1y; dst.sharpe3y = src.sharpe3y; dst.sharpe5y = src.sharpe5y;
  dst.sortino1y = src.sortino1y; dst.sortino3y = src.sortino3y;
  dst.maxDD1y = src.maxDD1y; dst.maxDD3y = src.maxDD3y; dst.maxDD5y = src.maxDD5y;
  dst.roll1yN = src.roll1yN; dst.roll1yMin = src.roll1yMin; dst.roll1yMax = src.roll1yMax;
  dst.roll1yAvg = src.roll1yAvg; dst.roll1yPctPositive = src.roll1yPctPositive;
  dst.beta1y = src.beta1y; dst.beta3y = src.beta3y; dst.beta5y = src.beta5y;
  dst.alpha1y = src.alpha1y; dst.alpha3y = src.alpha3y; dst.alpha5y = src.alpha5y;
  dst.te1y = src.te1y; dst.te3y = src.te3y; dst.te5y = src.te5y;

  for (const col of NAV_DERIVED_COLS) {
    delete dst.omissions[col];
    if (src.omissions[col] !== undefined) dst.omissions[col] = src.omissions[col]!;
  }
}

/** No total-return series exists and none can be sourced → withhold, with the reason. Never a 0. */
function declineMetrics(c: Computed, reason: string): void {
  // No total-return series we stand behind → no series for /chart to draw. NULL is the decline.
  c.seriesSchemeCode = null;
  c.ret = {};
  c.vol1y = null; c.vol3y = null; c.vol5y = null; // (T-4) transient, but nulled with its siblings on decline
  c.sharpe1y = null; c.sharpe3y = null; c.sharpe5y = null;
  c.sortino1y = null; c.sortino3y = null;
  c.maxDD1y = null; c.maxDD3y = null; c.maxDD5y = null;
  c.roll1yN = null; c.roll1yMin = null; c.roll1yMax = null;
  c.roll1yAvg = null; c.roll1yPctPositive = null;
  c.beta1y = null; c.beta3y = null; c.beta5y = null;
  c.alpha1y = null; c.alpha3y = null; c.alpha5y = null;
  c.te1y = null; c.te3y = null; c.te5y = null;

  for (const col of NAV_DERIVED_COLS) c.omissions[col] = reason;
}

export interface DistributionResult {
  inherited: number;
  honestNull: number;
  /** Slots where two or more LIVE Growth plans disagreed → we could not tell which is the true twin,
   *  so we withheld rather than pick one. */
  ambiguousTwins: number;
  /** Growth plans skipped as twins because they carry NO NAV in the window (dormant duplicates). */
  deadTwinsSkipped: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHOOSING THE TWIN — the part that was silently wrong.
//
// The old rule was one line:
//
//     if (p?.isGrowth) growthBy.set(`${p.familyId}|${p.tier}`, c);   // LAST WRITER WINS
//
// Last-writer-wins, with no check that the winner has any data. It is not a tie-break; it is an
// accident of array order. And a DORMANT plan can win it.
//
// Measured on the stored fold output, 17 LIVE plans were reporting NO RETURN AT ALL while a live
// Growth plan sat in the same family and tier holding a real number:
//
//     Sundaram Banking & PSU  100784 [regular+growth]  r1y=5.09%  nav_points=1230   ← the real twin
//                             134356 [regular+growth]  r1y=NULL   nav_points=   0   ← WON the race
//     → 100782, 100783, 100793 (live IDCW, 737–1230 points) all inherited its NULLs.
//
// A duplicate AMFI scheme code with no NAV history is not a total-return source. You cannot inherit
// a total return from a series that does not exist. So the twin is now CHOSEN, not stumbled into:
//
//   1. DEAD PLANS ARE NOT TWINS. A Growth plan with nav_points = 0 has no series at all. Skip it.
//      (If EVERY Growth plan in the slot is dead, there is genuinely nothing to inherit → honest-NULL,
//      which is what already happened — that case was never the bug.)
//
//   2. TWO LIVE GROWTH PLANS THAT DISAGREE ⇒ WE DO NOT KNOW WHICH IS THE TWIN ⇒ WITHHOLD.
//      Franklin India Low Duration publishes 118530 (r1y 17.38%) and 153368 (r1y 6.51%) under ONE
//      name — two genuinely different NAV series. One of them is the right twin for each IDCW plan
//      and we cannot tell which. Picking the last-iterated one is not a decision, it is a coin flip
//      with a number attached. The names *suggest* a pairing (old-style ↔ old-style), but pairing on
//      naming style is exactly the inference this codebase refuses everywhere else. So: decline.
//
// Same fund, same tier, same portfolio ⇒ same return. So two live Growth plans that disagree by more
// than rounding are not one fund, and no tolerance can make them one.
// ═══════════════════════════════════════════════════════════════════════════

/** 0.5pp — orders of magnitude above any rounding difference between two plans of one fund, and far
 *  below the gap between two genuinely different funds (Franklin's pair differ by 10.9pp). */
const SAME_FUND_TOL = 0.005;

/** Everything twin-resolution actually looks at. Narrowed so the GATE-3 harness can drive the REAL
 *  function over rows read straight from mf_analytics — a verification that re-implements the logic
 *  it is verifying proves only that two copies agree, and they drift. */
export type TwinCandidate = Pick<Computed, "schemeCode" | "navPoints" | "ret">;

/** A plan with NO NAV in the window has no series to inherit FROM. `navPoints` is the fold's own
 *  count, so this asks the data, not the name. */
const isLive = (c: TwinCandidate) => c.navPoints > 0;

/** Do two Growth plans describe the same fund? Compared on the returns they actually folded. NULL on
 *  a horizon is not evidence either way, so it is skipped; if NO horizon is comparable we cannot say
 *  they differ, and we do not invent a disagreement. */
function agreeOnReturns(a: TwinCandidate, b: TwinCandidate): boolean {
  for (const h of ["y1", "y3", "y5", "m6"] as const) {
    const x = a.ret[h] ?? null;
    const y = b.ret[h] ?? null;
    if (x === null || y === null) continue; // not evidence either way — skip, do not invent a gap
    if (Math.abs(x - y) > SAME_FUND_TOL) return false;
  }
  return true; // no horizon disagreed
}

/**
 * The tier-matched Growth twin for each (family, tier), or `null` where we refuse to choose one.
 * `null` is a DECISION — "we cannot tell" — and it is honoured downstream as an honest-NULL.
 */
export function resolveTwins<T extends TwinCandidate>(
  computed: readonly T[],
  plans: Map<string, PlanInfo>,
): { twins: Map<string, T | null>; ambiguous: number; deadSkipped: number } {
  const candidates = new Map<string, T[]>();
  for (const c of computed) {
    const p = plans.get(c.schemeCode);
    if (!p?.isGrowth) continue;
    const k = `${p.familyId}|${p.tier}`;
    const l = candidates.get(k) ?? [];
    l.push(c);
    candidates.set(k, l);
  }

  const twins = new Map<string, T | null>();
  let ambiguous = 0, deadSkipped = 0;

  for (const [k, all] of candidates) {
    const alive = all.filter(isLive);
    deadSkipped += all.length - alive.length;

    if (alive.length === 0) { twins.set(k, null); continue; }   // nothing to inherit from
    if (alive.length === 1) { twins.set(k, alive[0]!); continue; }

    // More than one LIVE Growth plan. If they all describe the same fund, any of them is the twin —
    // take the one with the longest series, which is a preference among IDENTICAL answers, not a
    // guess between different ones.
    const agree = alive.every((c) => agreeOnReturns(c, alive[0]!));
    if (!agree) { twins.set(k, null); ambiguous++; continue; }  // ← refuse. Never coin-flip.

    let best = alive[0]!;
    for (const c of alive) if (c.navPoints > best.navPoints) best = c;
    twins.set(k, best);
  }

  return { twins, ambiguous, deadSkipped };
}

/**
 * MUTATES `computed` in place. MUST run AFTER computeAll and BEFORE applyRanks — a rank computed
 * on an IDCW plan's price return would rank the fund by how much it paid out.
 *
 * A GROWTH plan is untouched: its NAV already retains distributions, so it was never wrong.
 * An ETF is untouched: it is not in `mfCodes`, so it cannot reach this code.
 */
export function applyDistributionHandling(
  computed: Computed[],
  plans: Map<string, PlanInfo>,
  mfCodes: Set<string>,
): DistributionResult {
  const { twins, ambiguous, deadSkipped } = resolveTwins(computed, plans);
  const res: DistributionResult = {
    inherited: 0, honestNull: 0, ambiguousTwins: ambiguous, deadTwinsSkipped: deadSkipped,
  };

  for (const c of computed) {
    if (!mfCodes.has(c.schemeCode)) continue; // ETF — no plan structure, NAV is already total return

    const p = plans.get(c.schemeCode);

    // plan_option we could not classify at all (Step 16 declined to group it, or the AMC's naming
    // is novel). We do not know whether this NAV retains its distributions — and "probably growth"
    // is not a standard we compute a published return to.
    if (!p) {
      declineMetrics(c, OmissionCode.IDCW_NAV_NOT_TOTAL_RETURN);
      res.honestNull++;
      continue;
    }

    // A true GROWTH plan retains its distributions, so its own NAV already IS the total return.
    // (A BONUS plan is NOT one of these — see classifyPlanOption. It falls through and inherits,
    // which is what repairs it: bonus issues step its NAV down, its Growth twin's does not.)
    if (p.isGrowth) continue;

    const key = `${p.familyId}|${p.tier}`;
    const twin = twins.get(key) ?? null;

    if (!twin) {
      // THREE ways to land here, and all three are honest:
      //   · an IDCW-only fund — no Growth sibling exists in this tier at all;
      //   · every Growth plan in the slot is DORMANT (no NAV in the window) — nothing to inherit;
      //   · two or more LIVE Growth plans DISAGREE — we cannot tell which is this fund's, so we
      //     refuse to pick. (resolveTwins counts this case separately; the ledger does not, because
      //     the user-facing truth is the same: no total-return series we can honestly hand you.)
      declineMetrics(c, OmissionCode.IDCW_NAV_NOT_TOTAL_RETURN);
      res.honestNull++;
      continue;
    }

    inheritMetrics(c, twin);
    res.inherited++;
  }

  return res;
}
