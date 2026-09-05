// ═══════════════════════════════════════════════════════════════════════════
// THE ZEROED-BLOCK GUARD — refuse-and-null, the bse-ratio-gate discipline.
//
// ★ ONE IMPLEMENTATION, TWO TAXONOMIES. The rules are facts about how banks tag
//   a non-disclosure, not about a namespace, so they take an EXTRACTOR rather
//   than an xml string: the legacy parser passes its `in-bse-fin` reader, the v3
//   parser passes its `in-capmkt` one. A rule that lived in two files would drift.
//
// WHY THIS EXISTS. S7 A2 filled 3,330 cells and 780 of them landed as EXACTLY 0.
// Every one was adjudicated structural: 759 because the SAME bank's SAME period
// standalone row carried a real figure (BANKBARODA Q4FY23 consolidated
// gnpa_absolute 0.00 against its own standalone ₹36,763.68 Cr), 21 because the
// row's own P&L was populated. Zero unproven. A stored 0 that means "not
// disclosed" is the same failure class as the ÷1e7 unit bug — a wrong number
// wearing the clothes of a measurement.
//
// ⚠ WHAT A PARSER CAN AND CANNOT SEE — SAY IT PLAINLY.
//   The adjudication used the STANDALONE SIBLING: a different row, from a
//   different document. A parser holds ONE document and cannot reach it. Three
//   within-document discriminators were measured over the 194 affected rows:
//     D1  THE CONTEXT PAIR (OneD vs FourD) ... PROVABLE on 0 of 194. DEAD.
//         A filer who zeroes the block zeroes it in BOTH contexts.
//     D2  BLOCK COHERENCE (zero absolute beside a non-zero ratio) ... 7 of 194.
//     D3  THE CONJUNCTION IN RULE 1 ... 174 of 174.
//   So RULE 1 is a DOMAIN FLOOR, not a structural proof, and is written as one.
//   RULES 2 and 3 are identities and ARE proofs.
// ═══════════════════════════════════════════════════════════════════════════

/** Reads one numeric fact. Namespace and unit handling belong to the caller. */
export type FactReader = (tag: string, contextRef: string) => number | null;

export interface BlockVerdict {
  refused: boolean;
  /** One line for the ingestion log. Null when nothing was refused.
   *  A silent refusal is as bad as a silent write (bse-ratio-gate.ts). */
  note: string | null;
}

/** The asset-quality block. roa is NOT a member — see roaRefused. */
export const ASSET_QUALITY_TAGS = [
  "GrossNonPerformingAssets",
  "NonPerformingAssets",
  "PercentageOfGrossNpa",
  "PercentageOfNpa",
] as const;

/** Loan-book / asset denominators, read in the instant context. NetSegmentAssets
 *  stands in for Assets in a quarterly banking instance — bse-ratio-gate.ts
 *  measured the two equal to the rupee on AU Bank FY19, where both are tagged. */
export const LENDER_DENOMINATORS = ["Advances", "NetSegmentAssets", "Assets"] as const;

/**
 * ── RULE 1 · THE ZEROED BLOCK. A DOMAIN FLOOR. ────────────────────────────
 *
 * Refuse when EVERY asset-quality tag PRESENT reads exactly 0 (at least two
 * present, so one absent tag is not enough) AND the instance shows a LENDER: a
 * non-zero loan-book denominator, or failing that non-zero interest income.
 *
 * It is the CONJUNCTION that condemns — not "zero NPA", which a bank could
 * genuinely report, but "zero NPA to the rupee ON A LIVE LOAN BOOK".
 * MEASURED over all 1,042 legacy banking documents: 174 carry an all-zero block;
 * 137 of them tag a non-zero loan book in the same instance (NetSegmentAssets
 * 132, Advances 34, Assets 34) and all 174 carry non-zero InterestEarned.
 *
 * ⚠ THE FALSE-POSITIVE COST, STATED NOT HIDDEN. A bank that genuinely holds no
 *   non-performing assets AND has a live loan book would be refused. That is a
 *   deliberate trade, and the corpus says the population is empty: across every
 *   banking row this database holds from any source, the smallest NON-ZERO gross
 *   NPA is ₹302.74 Cr (quarterly) / ₹457.78 Cr (annual). The distribution is
 *   BIMODAL — real values start in the hundreds of crores and the only other
 *   value observed is exactly 0. There is no small-but-real population for a
 *   floor to misclassify.
 *   THE ESCAPE IS THE CONJUNCTION: a bank with no loan book and no interest
 *   income (a newly licensed entity, an empty instance) is NOT refused.
 *   And the refusal writes NULL, never 0 — "unavailable", never "none". A false
 *   null is recoverable by a hand-key with a citation; a false zero scores
 *   silently. This is fundamentals-view.service.ts:1417's ruling at parse time.
 */
export function assetQualityBlockRefused(
  read: FactReader,
  pnlContext: string,
  balanceSheetContext: string,
): BlockVerdict {
  const present = ASSET_QUALITY_TAGS
    .map((t) => ({ tag: t as string, v: read(t, pnlContext) }))
    .filter((x) => x.v !== null);

  // Fewer than two tags present: nothing here deserves to be called a block.
  if (present.length < 2) return { refused: false, note: null };
  // Any non-zero member: a real disclosure, possibly a partial one. Not refused.
  if (present.some((x) => x.v !== 0)) return { refused: false, note: null };

  const den = LENDER_DENOMINATORS
    .map((t) => ({ tag: t as string, v: read(t, balanceSheetContext) }))
    .find((x) => x.v !== null && x.v !== 0);
  if (den) {
    return {
      refused: true,
      note:
        `asset-quality block REFUSED - all ${present.length} tags read exactly 0 ` +
        `(${present.map((x) => x.tag).join(", ")}) while ${den.tag}=${den.v} in ` +
        `${balanceSheetContext}. A live loan book beside a gross NPA of exactly 0.00 ` +
        `is a zeroed block, not a measurement. Written NULL, never 0.`,
    };
  }
  const ie = read("InterestEarned", pnlContext);
  if (ie !== null && ie !== 0) {
    return {
      refused: true,
      note:
        `asset-quality block REFUSED - all ${present.length} tags read exactly 0 while ` +
        `InterestEarned=${ie} in ${pnlContext}. No loan-book tag in this instance, so the ` +
        `weaker leg applies: interest income proves lending. Written NULL, never 0.`,
    };
  }
  // No loan book, no interest income — nothing contradicts a genuine zero. LET IT THROUGH.
  return { refused: false, note: null };
}

/**
 * ── RULE 2 · ReturnOnAssets. AN IDENTITY, NOT A FLOOR. ────────────────────
 *
 * ★ roa IS NOT PART OF THE BLOCK. MEASURED over the 194 affected rows it moves
 *   INDEPENDENTLY in 22: 7 rows carry a zeroed block but a real roa (BANKBARODA
 *   FY22 consolidated, 0.0082) and 15 carry a real block but a zero roa (YESBANK
 *   Q2FY21 consolidated, gross NPA ₹32,344 Cr and roa exactly 0). Binding the two
 *   would refuse a good value one way and pass a bad one the other.
 *
 * ★ ITS TEST IS ARITHMETIC. ReturnOnAssets = PAT / Assets, so a non-zero PAT
 *   cannot produce a zero ROA, and the numerator sits in the same instance.
 *   MEASURED across all 1,272 legacy documents: ReturnOnAssets reads exactly 0 in
 *   200, and in 200 of 200 the filing's own PAT is NON-ZERO. Not one case exists
 *   where PAT is also 0 — precisely the case the guard must let through, and it
 *   is coded for anyway: a bank that breaks exactly even is arithmetically
 *   entitled to a zero ROA.
 */
export function roaRefused(read: FactReader, pnlContext: string): BlockVerdict {
  const roa = read("ReturnOnAssets", pnlContext);
  if (roa === null || roa !== 0) return { refused: false, note: null };

  const pat =
    read("ProfitLossForThePeriod", pnlContext) ??
    read("ProfitLossFromOrdinaryActivitiesAfterTax", pnlContext) ??
    read("ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates", pnlContext);

  // PAT absent or genuinely zero: the identity is not violated. LET IT THROUGH.
  if (pat === null || pat === 0) return { refused: false, note: null };

  return {
    refused: true,
    note:
      `ReturnOnAssets REFUSED - reads exactly 0 while PAT=${pat} in ${pnlContext}. ` +
      `ROA = PAT / Assets, so a non-zero PAT cannot yield a zero ROA: this is a ` +
      `non-disclosure tagged as a number. Written NULL, never 0.`,
  };
}

/**
 * ── RULE 3 · RATIO/ABSOLUTE COHERENCE. AN IDENTITY. ───────────────────────
 *
 * Rule 1 deliberately does not fire on a partly-zero block, because a partial
 * zero is a real disclosure and refusing it would throw away good data. A second,
 * narrower defect hides in exactly that gap:
 *
 *     BANDHANBNK Q1FY21 standalone — nnpa_absolute ₹335.78 Cr, nnpa_pct 0.
 *
 * A net NPA of ₹335.78 Cr cannot produce a net NPA ratio of zero.
 * MEASURED across all 1,272 legacy documents: gnpa pairs 1,272 / violations 0;
 * nnpa pairs 1,272 / violations 7; reverse shape (zero absolute, non-zero ratio) 0.
 * The seven include the five STANDALONE rows the scorer actually reads, since
 * Foundation and Momentum never fall back to consolidated (scoring/metrics/types.ts).
 *
 * ⚠ PER PAIR, NOT PER BLOCK. It nulls only the incoherent ratio and leaves its
 *   absolute — and the other pair — untouched. Refusing more than the arithmetic
 *   condemns would be the overreach the capital-ratio ruling exists to avoid.
 */
export function ratioCoherenceRefusals(
  read: FactReader,
  pnlContext: string,
): { gnpaPct: boolean; nnpaPct: boolean; notes: string[] } {
  const notes: string[] = [];
  const pair = (absTag: string, pctTag: string, label: string): boolean => {
    const abs = read(absTag, pnlContext);
    const pct = read(pctTag, pnlContext);
    if (abs === null || pct === null) return false;
    if (abs === 0 || pct !== 0) return false;
    notes.push(
      `${pctTag} REFUSED - reads exactly 0 while ${absTag}=${abs} in ${pnlContext}. ` +
        `A non-zero ${label} cannot yield a zero ${label} ratio: an identity violation, ` +
        `not a measurement. Written NULL, never 0.`,
    );
    return true;
  };
  return {
    gnpaPct: pair("GrossNonPerformingAssets", "PercentageOfGrossNpa", "gross NPA"),
    nnpaPct: pair("NonPerformingAssets", "PercentageOfNpa", "net NPA"),
    notes,
  };
}

/**
 * ── RULE 4 · THE ZEROED P&L BLOCK. THE SAME RULING, ON THE OTHER TAXONOMY. ─────────
 *
 * Rules 1-3 above are about a BANK's asset-quality block. This is the identical failure on the
 * IND-AS P&L, and it is the more common one: a filer publishes an instance in which EVERY line of
 * the quarter's profit-and-loss reads exactly 0.00, because the quarter is not what that document
 * is reporting.
 *
 * ⚠ IT IS NOT A COMPANY THAT EARNED NOTHING, AND THE DOCUMENT PROVES IT. MEASURED on
 *   HEROMOTOCO's Q4 FY19 CONSOLIDATED instance (INDAS_43660_99669_27042019032910_WEB.xml):
 *       OneD  (the quarter)   RevenueFromOperations 0.00 · ProfitLossForPeriod 0.00 · every line 0.00
 *       FourD (the full year) RevenueFromOperations 33,972,23,00,000 · ProfitLossForPeriod 3,466,35,00,000
 *   Hero MotoCorp did not have a zero quarter. It filed its CONSOLIDATED results annually and
 *   zero-filled the quarterly column. Stored as written, that is ₹0 of revenue and ₹0 of profit
 *   for a company that made ₹3,397 Cr that quarter — a wrong number wearing the clothes of a
 *   measurement, which is this file's whole subject. VEDPOWER Q4 FY26 is the same shape on the
 *   current in-capmkt taxonomy, so this is not a legacy-only artefact.
 *
 * ★ THE CONJUNCTION IS WHAT CONDEMNS — never "revenue is zero", which is ORDINARY. A holding
 *   company, a dormant shell, a company between projects: all genuinely report zero revenue from
 *   operations, and 225 rows in this database do exactly that with a real profit-and-loss beside
 *   them. Every one would be destroyed by a rule that read the revenue line alone. What cannot
 *   happen is a company that traded, filed, and reported ZERO ON EVERY LINE — no revenue, no
 *   other income, NO EXPENSES, no tax, no profit — while the same instance reports a live year.
 *   A dormant company still pays its auditor.
 *
 * ★ AND THE ESCAPE IS THE SAME CONJUNCTION. An instance whose comparative block is ALSO empty is
 *   not condemned here: that is a genuinely contentless document, and GUARD 1 (checkPlContentless)
 *   already rejects it by a route that does not need this evidence.
 *
 * REFUSAL WRITES NULL, NEVER 0 — and because revenue and netProfit both go null, the existing
 * shape guard rejects the upsert and any good row already stored survives untouched.
 */
export const INDAS_PNL_TAGS = [
  "RevenueFromOperations",
  "OtherIncome",
  "Expenses",
  "ProfitBeforeTax",
  "ProfitLossForPeriod",
  "ProfitLossForPeriodFromContinuingOperations",
] as const;

export function pnlBlockRefused(
  read: FactReader,
  pnlContext: string,
  comparativeContext: string,
  balanceSheetContext?: string,
): BlockVerdict {
  const present = INDAS_PNL_TAGS
    .map((t) => ({ tag: t as string, v: read(t, pnlContext) }))
    .filter((x) => x.v !== null);

  // Fewer than three lines present: not enough of a block to call it zeroed. A thin instance is
  // GUARD 1's business, not this rule's.
  if (present.length < 3) return { refused: false, note: null };
  // Any non-zero line: a real disclosure. Not refused — INCLUDING the dormant company whose
  // revenue is 0 but whose expenses are not, and including the tiny shell whose whole P&L is
  // ₹35,000 (LCCINFOTEC Q3 FY26: real at parse time, and only 0.00 after Decimal(18,2) rounding).
  if (present.some((x) => x.v !== 0)) return { refused: false, note: null };

  // ── THE CONJUNCTION. Two witnesses, in order of strength. ──
  // (a) The SAME instance reports a live COMPARATIVE period. Strongest: the document itself says
  //     the company traded, in the very column beside the zeros.
  const livePeriod = INDAS_PNL_TAGS
    .map((t) => ({ tag: t as string, v: read(t, comparativeContext) }))
    .find((x) => x.v !== null && x.v !== 0);
  if (livePeriod) {
    return {
      refused: true,
      note:
        `P&L block REFUSED - all ${present.length} lines read exactly 0 in ${pnlContext} ` +
        `(${present.map((x) => x.tag).join(", ")}) while ${livePeriod.tag}=${livePeriod.v} in ` +
        `${comparativeContext}. A company that reported a live period did not also have a period ` +
        `with no revenue, no expenses and no profit: this is a column the filer did not fill, not ` +
        `a period that did not happen. Written NULL, never 0.`,
    };
  }

  // (b) BOTH P&L columns are zero, but the instance still states a LIVE ENTITY — share capital,
  //     or a balance sheet. Weaker than (a) and it has to be, because the case is real:
  //     MEASURED on MRF's FY18 consolidated instance and NTPC's, both of which carry EVERY P&L
  //     line at 0.00 in BOTH contexts and nothing else at all except
  //     PaidUpValueOfEquityShareCapital — ₹4.24 Cr for MRF, ₹8,245.46 Cr for NTPC. A company with
  //     ₹8,245 Cr of paid-up equity did not have a year with no revenue and no expenses. Without
  //     this leg those rows land as a ₹0 year for a ₹90,000 Cr company, because GUARD 1 tests for
  //     NULL and a zero is not a null.
  const contexts = [pnlContext, comparativeContext, ...(balanceSheetContext ? [balanceSheetContext] : [])];
  for (const tag of LIVE_ENTITY_WITNESSES) {
    for (const ctx of contexts) {
      const v = read(tag, ctx);
      if (v !== null && v !== 0) {
        return {
          refused: true,
          note:
            `P&L block REFUSED - every line reads exactly 0 in BOTH ${pnlContext} and ` +
            `${comparativeContext}, while ${tag}=${v} in ${ctx}. The instance states a live entity ` +
            `and no profit-and-loss at all: it is a filing that did not carry a P&L, not a period ` +
            `in which nothing happened. Written NULL, never 0.`,
        };
      }
    }
  }

  // No live period, no capital, no balance sheet — nothing contradicts the zeros. The document is
  // simply empty, which is GUARD 1's case and not this rule's.
  return { refused: false, note: null };
}

/**
 * Facts that prove the instance describes a LIVE ENTITY even when it carries no profit-and-loss.
 * Deliberately short and deliberately structural: share capital and the balance-sheet totals are
 * what a filer states about the COMPANY rather than about the PERIOD, so a non-zero one cannot be
 * explained away by "this period had no activity".
 */
export const LIVE_ENTITY_WITNESSES = [
  "PaidUpValueOfEquityShareCapital",
  "Assets",
  "EquityAndLiabilities",
  "Equity",
  "EquityShareCapital",
  "NetWorth",
] as const;

/** All three rules for one banking instance, in one call. */
export function evaluateZeroBlock(
  read: FactReader,
  pnlContext: string,
  balanceSheetContext: string,
): {
  block: BlockVerdict;
  roa: BlockVerdict;
  coherence: { gnpaPct: boolean; nnpaPct: boolean; notes: string[] };
  notes: string[];
} {
  const block = assetQualityBlockRefused(read, pnlContext, balanceSheetContext);
  const roa = roaRefused(read, pnlContext);
  const coherence = ratioCoherenceRefusals(read, pnlContext);
  const notes = [block.note, roa.note]
    .filter((n): n is string => n !== null)
    .concat(coherence.notes);
  return { block, roa, coherence, notes };
}
