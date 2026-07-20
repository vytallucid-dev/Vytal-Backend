// ═══════════════════════════════════════════════════════════════
// THE ISIN CLASSIFIER (Step 17) — what KIND of thing is this, read from the identifier itself.
//
// WHY THIS EXISTS, AND WHY IT IS SHARED. Two problems in this codebase turned out to be the same
// problem, and they were about to be solved twice, differently:
//
//   1. THE BOND FENCE (Part A). Which rows of the NSE udiff BhavCopy are corporate debt? The obvious
//      answer — the NSE series code (N*/Y*/Z*/P*) — IS WRONG, and recon proved it on live data. A
//      SERIES IS A TRADING BOARD, NOT AN INSTRUMENT TYPE. The `BL` series is a block-deal board for
//      EQUITY: fencing on series admits INE462A01022 = BAYERCROP, one of our 504 SCORED STOCKS, as a
//      "bond". The `P1` series is a preference-share board: it admits INE494B04019 = TVS Motor.
//
//   2. THE BROKER FALL-THROUGH (Part B). A broker sends a holding whose ISIN we have never seen.
//      universe-admit's Pass 3 has no asset-class branch, so it calls admitBareStock() on ANYTHING
//      with an ISIN — fabricating a corporate bond, a G-sec or a mutual fund into `stocks`, which is
//      precisely where loadUniverse() and the scoring engine go looking. (This is the ETF bug of
//      Step 13. Step 13 fixed it for ETFs by CATALOGUING them; it never fixed the fall-through.)
//
// Both questions are "what is this ISIN?", and the ISIN answers. So there is ONE answer, here, and
// the two callers cannot drift apart.
//
// ══ THE STRUCTURE ══
// SEBI/NSDL number Indian securities as:
//
//     IN │ E/F/0-9 │ ─── 4-char issuer ─── │ 2-char SECURITY TYPE │ 3-char serial
//     ── namespace ──                        ▲
//      0  1  2                               └── chars [7..8]: WHAT KIND OF THING IT IS
//
//   namespace  INE = a company (corporate)  ·  INF = a fund  ·  IN0-IN9 = government
//   type       01 = equity  ·  04 = preference  ·  07/08/24/A7 = debt  ·  30 = fund unit
//
// ══ THE DISCIPLINE — AND THE MISTAKE THIS FILE IS BUILT NOT TO REPEAT ══
// The first cut of the bond fence used an ALLOW-LIST of debt type codes (/^(0[789]|[A-Z][789])$/).
// It SILENTLY DROPPED 12 real bonds — the Indore / Nagpur / Surat Municipal Corporation green bonds,
// type "24" ("SEC RE NCGB 8.25% STRPP B"). Real debt, really holdable, gone without a trace.
//
// The lesson: the type-code space is OPEN-ENDED and we do not control it. An allow-list of codes is
// exactly as unsafe as an allow-list of series. So this module does NOT pattern-match, and it does
// NOT guess. It classifies ONLY what there is evidence for, and it returns `unclassifiable` for
// everything else — which the callers surface as a VISIBLE fault and an honest gap, never a silent
// drop and never a fabricated class.
//
// EVERY CODE BELOW IS GROUNDED, and the grounding is named. Nothing here is inferred from a spec we
// half-remember; it is measured against instruments we already own or against the instruments' own
// self-description in the feed.
//
// PURE. No I/O, no DB, no clock. Same ISIN in, same class out — which is what lets the ingest and
// the broker resolver share it without either one reaching into the other.
// ═══════════════════════════════════════════════════════════════

/** The ISIN's namespace — WHO issued it. Read from chars [0..2]. */
export type IsinNamespace =
  /** INE — a body corporate. Companies, and also municipal corporations (they are bodies corporate). */
  | "corporate"
  /** INF — a fund house. Mutual-fund and ETF units. */
  | "fund"
  /** IN0-IN9 — the sovereign. IN0 central, IN1-IN9 the states. */
  | "government"
  | "unknown";

/**
 * What the instrument IS. Deliberately NOT `AssetClass`: this is what the IDENTIFIER can prove, and
 * it is a strictly weaker claim. `equity` and `debt` map onto asset classes; `unclassifiable` is the
 * honest refusal that keeps a guess out of the catalogue.
 */
export type IsinKind =
  /** A company's ordinary shares. → `stocks` + asset_class='stock'. Scoreable (once given a PG). */
  | "equity"
  /** A debenture / bond / NCD. → catalogue-only, asset_class='bond', stock_id NULL, held-NOT-scored. */
  | "debt"
  /** We cannot prove what this is. NO ROW IS CREATED. A visible fault + an honest gap — never a guess. */
  | "unclassifiable";

export interface IsinClassification {
  kind: IsinKind;
  namespace: IsinNamespace;
  /** chars [7..8] — the security-type code, verbatim. Kept for the audit trail even when unclassifiable. */
  securityType: string | null;
  /** The 7-char issuer stem (e.g. "INE031A") — the HARD key that links a bond to its issuer's equity. */
  issuerStem: string | null;
  /** Why, in one line. Populated for EVERY outcome — an admission is as worth explaining as a refusal. */
  why: string;
}

/** An Indian ISIN: IN, then E/F/digit, then 9 alphanumerics. 12 chars. */
export const INDIAN_ISIN = /^IN[EF0-9][0-9A-Z]{9}$/;

// ── THE EQUITY CODES ────────────────────────────────────────────────────────────────────────
// GROUNDING: these are the security types NSE ITSELF stamps on an EQUITY board (series EQ/BE/BZ/
// SM/ST/SZ/E1) in the udiff BhavCopy, cross-checked against our own scored universe — all 504
// stocks are "01", measured, uniformly. This is not a reading of a spec; it is what the exchange
// and our own database both say.
const EQUITY_TYPES = new Set([
  "01", // ordinary equity shares. ALL 504 of our scored stocks. The overwhelming majority.
  "20", // also seen on an NSE equity board (SUMEET INDUSTRIES). An equity share.
]);

// ── THE DEBT CODES ──────────────────────────────────────────────────────────────────────────
// GROUNDING: every one of these was confirmed against the INSTRUMENTS' OWN NAMES in the feed —
// they self-describe as debt (NCD / BOND / DEBENTURE / TAX FREE / STRPP / NCGB, or a coupon). The
// call is made on what the instrument says it is, never on the shape of the number.
const DEBT_TYPES = new Set([
  "07", // the main debenture/NCD code. 326 of the 356. "7.40% TAX FREE TRI SRIII", "SEC RE NCD 10% SR 4"
  "08", // unsecured NCDs. 16. "UNS RED NCD 9.15% SR.IX", "UNSEC RE NCD 0% SR.III"
  "24", // MUNICIPAL bonds — the 12 Indore/Nagpur/Surat green-bond STRPP tranches. "SEC RE NCGB 8.25% STRPP B".
  //     THE ONE THAT NEARLY GOT SILENTLY DROPPED. It is why this list is evidence, not a regex.
  "A7", // the extended debt roll — NSDL moves into a letter when an issuer exhausts a numeric serial.
  //     2 seen (INE804IA7014/22, "SEC RED NCD 10.15% SR. VI"). Same instrument kind, different digit.
]);

// ── THE CODES WE DELIBERATELY REFUSE TO CLASSIFY ────────────────────────────────────────────
// Each of these is a thing we can NAME but have no honest home for. Naming it in the refusal is the
// point: the operator reads "preference share", not "unknown".
const NAMED_REFUSALS: Record<string, string> = {
  "04":
    "a PREFERENCE SHARE (NSE series P1 — e.g. TVS Motor INE494B04019). It is a share, not a bond, " +
    "and it is not ordinary equity either. There is no asset_class for it, and calling it 'stock' " +
    "would put a non-common-equity security into `stocks` — the table the scoring universe reads. " +
    "Held as an honest gap until a `preference` class is a deliberate decision.",
};

/**
 * Classify an ISIN. The ONE place this question is answered.
 *
 * Returns `unclassifiable` far more readily than a clever function would — and that is the design.
 * A wrong class is a permanent, invisible lie in shared canonical data (a bond scored as equity, a
 * fund priced as a stock). An honest gap is visible, reversible, and costs the user nothing they
 * were owed: identity, quantity and invested amount are all still known without it.
 */
export function classifyIsin(isin: string | null | undefined): IsinClassification {
  const none = (why: string): IsinClassification => ({
    kind: "unclassifiable",
    namespace: "unknown",
    securityType: null,
    issuerStem: null,
    why,
  });

  if (!isin) return none("no ISIN — the broker sent none. No identity, so no row (see universe-admit).");
  const s = isin.trim().toUpperCase();
  if (!INDIAN_ISIN.test(s)) {
    return none(`"${s}" is not a well-formed Indian ISIN (/^IN[EF0-9][0-9A-Z]{9}$/) — refused, never coerced.`);
  }

  const n = s[2]!;
  const namespace: IsinNamespace = n === "E" ? "corporate" : n === "F" ? "fund" : "government";
  const securityType = s.slice(7, 9);
  const issuerStem = s.slice(0, 7);
  const base = { namespace, securityType, issuerStem };

  // ── FUND (INF) ────────────────────────────────────────────────────────────────────────────
  // An ETF and a mutual fund are BOTH INF, and the ISIN cannot tell them apart — INF|01 in the feed
  // covers both. Guessing one would put a wrong asset_class on a shared row. In practice this is
  // nearly unreachable: all 337 ETFs and 17,567 MFs are already catalogued, so the catalogue (Pass 0)
  // answers first and this branch only sees a genuine miss.
  if (namespace === "fund") {
    return {
      ...base,
      kind: "unclassifiable",
      why:
        "a FUND unit (INF namespace). The ISIN cannot distinguish an ETF from a mutual fund — both " +
        "are INF — and a wrong asset_class on a shared catalogue row is a permanent lie. The 337 ETFs " +
        "and 17,567 MFs are already catalogued, so this is a genuine miss worth an operator's eye.",
    };
  }

  // ── GOVERNMENT (IN0-IN9) ──────────────────────────────────────────────────────────────────
  // Same refusal, same reason: a G-sec and a Sovereign Gold Bond are both IN0, and only the NSE
  // SERIES (GS vs GB) separates them — which we do not have here. The govt lane accumulates daily,
  // so an uncatalogued one is usually days from being catalogued properly, with its real name.
  if (namespace === "government") {
    return {
      ...base,
      kind: "unclassifiable",
      why:
        "GOVERNMENT paper (IN0-IN9 namespace). The ISIN cannot distinguish a G-sec/T-bill/SDL from a " +
        "Sovereign Gold Bond — only the NSE series can, and that is not in an ISIN. The govt lane " +
        "(Step 15) catalogues these with their real names and accumulates daily.",
    };
  }

  // ── CORPORATE (INE) — the only namespace we admit from ────────────────────────────────────
  if (EQUITY_TYPES.has(securityType)) {
    return { ...base, kind: "equity", why: `security-type "${securityType}" — ordinary equity shares (all 504 scored stocks are "01").` };
  }
  if (DEBT_TYPES.has(securityType)) {
    return { ...base, kind: "debt", why: `security-type "${securityType}" — a debenture/bond/NCD.` };
  }

  const named = NAMED_REFUSALS[securityType];
  if (named) return { ...base, kind: "unclassifiable", why: `security-type "${securityType}" — ${named}` };

  // ── THE UNKNOWN CODE. The whole reason this function refuses instead of pattern-matching. ──
  // A code we have never seen is NOT assumed to be debt because it looks like debt, and NOT assumed
  // to be equity because it is INE. It surfaces, an operator looks at it, and the taxonomy above
  // grows by EVIDENCE. That is how "24" would have been caught on day one instead of silently lost.
  return {
    ...base,
    kind: "unclassifiable",
    why:
      `security-type "${securityType}" is UNKNOWN to the taxonomy (known: equity ${[...EQUITY_TYPES].join("/")}, ` +
      `debt ${[...DEBT_TYPES].join("/")}). NOT guessed in either direction. A new code is how the ` +
      `municipal green bonds ("24") first appeared — surfaced, verified against the instrument's own ` +
      `name, then added. Refused until then: an honest gap, never a fabricated class.`,
  };
}

/** Convenience for the bond fence — does this ISIN denote corporate debt? */
export const isDebtIsin = (isin: string): boolean => classifyIsin(isin).kind === "debt";

/** The named ISIN security-type codes, exported so recon/verify can assert the taxonomy has not drifted. */
export const ISIN_TAXONOMY = {
  EQUITY_TYPES: [...EQUITY_TYPES],
  DEBT_TYPES: [...DEBT_TYPES],
  NAMED_REFUSALS: Object.keys(NAMED_REFUSALS),
} as const;
