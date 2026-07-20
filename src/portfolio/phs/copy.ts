// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PORTFOLIO FINDINGS COPY MODULE (§3) — ONE content home, imported by the engine.
//
// Not duplicated into comments, not inlined per rule, not in the DB. That is how copy rots: two homes
// for one sentence and the wrong one ships. `patterns.ts` MEASURES and BINDS; this file SAYS.
// (Mirrors `scoring/lens-patterns/catalog.ts`, which does the same job for the LM/LP stock library.)
//
// ── THE INVIOLABLE RULE (§1) — the bar every sentence here clears ──────────────────────────────────
//   A finding describes what the book IS. It never says what to DO, and never says what will happen NEXT.
//
//   ✅ "38% of your capital sits in a single company — the read leans heavily on that one name."
//   ❌ "38% is too concentrated — consider trimming."
//   ✅ "This is the Regular plan. The Direct plan of this same fund exists; Direct plans carry lower
//      expense ratios."
//   ❌ "Switch to Direct to save on fees."
//
//   The Read states the structural fact and, at most, HOW TO READ THE NUMBER in light of it — never an
//   instruction. Enforced in CI, not review: `no-forward-guard.ts` scans every `read` on every build
//   (PORTFOLIO_ADVICE_DENY_LIST). §1 is the platform's spine and it erodes one well-meaning copy edit at
//   a time.
//
// ── THE THREE JOBS A `doesntMean` DOES (§3) ───────────────────────────────────────────────────────
//   Classify BEFORE writing. Written as 31 individual judgment calls, they come out in 31 registers.
//
//   • advice-block        — negates the ACTION the Read invites.
//                           PC1: "≠ the position is a mistake, ≠ trim it."
//   • misread-block       — negates a wrong reading OF THE NUMBER.
//                           PV2: "≠ the unscored half is bad — it is unread."
//   • misattribution-block — names WHOSE gap it is. Ours, not the book's.
//                           PV4: "The gap is ours."
//
//   `job` is a REQUIRED literal union, not a comment: a comment cannot be asserted, and a required field
//   makes the COMPILER prove classification before the verify runs. The next person adding a finding must
//   answer "what is this sentence for?" before TypeScript lets them ship it.
//
// ── ⚠ THE FIVE CONSTRUCTIVE ONES (PQ1 · PB1 · PS5 · PV1 · PX4) ────────────────────────────────────
//   Per ODL `cv2-s9-constructive-most-conditioned`: a Constructive finding's failure mode is INACTION —
//   the user's response to good news is to stop looking. So its `doesntMean` is the ONLY one whose job is
//   to STOP THE USER RELAXING, the inverse of every other finding's.
//
//   The lazy version is "≠ this is a recommendation" — a NON-SENTENCE: nobody was about to act on good
//   news. The real question is WHAT DOES THIS FINDING NOT COVER. Write the SCOPE, not a disclaimer.
//     PV1 does not mean the holdings are good — it means we could READ them.
//     PX4 does not mean nothing can go wrong — it means nothing is CURRENTLY FIRING.
//   All five are `misread-block`, because that is what they are: a fence around what was measured.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** What a `doesntMean` sentence is FOR. Required — see the header. */
export type DoesntMeanJob = "advice-block" | "misread-block" | "misattribution-block";

export interface FindingCopy {
  /** The spec's Read, with `{}` placeholders `patterns.ts` interpolates. Absent ⇒ the finding carries
   *  label + bind only and the UI composes (a deliberate choice per finding, never an oversight). */
  read?: string;
  /** REQUIRED. A finding without a Doesn't-mean does not ship — asserted in CI, not noticed in review. */
  doesntMean: string;
  /** REQUIRED. What the sentence above is FOR. More than one when it genuinely does more than one job. */
  job: DoesntMeanJob[];
}

export const FINDING_COPY: Record<string, FindingCopy> = {
  // ── PA — archetype & composition (movement 1). Describes; never judges (§1 sub-lock 2). ──
  PA1: {
    doesntMean: "≠ this mix is right or wrong for you. We describe what you hold. There is no correct equity/debt ratio without knowing your goals, and we don't know them.",
    job: ["advice-block", "misread-block"],
  },
  PA2: {
    doesntMean: "≠ you hold too many things, ≠ consolidate. A fact about arithmetic, not a verdict on your choices: brokerage and charges are a near-fixed floor per trade, so they are a larger share of a smaller position.",
    job: ["advice-block", "misread-block"],
  },
  PA3: {
    doesntMean: "≠ duplication is a mistake. It states how much rides on one company — which the instrument count hides.",
    job: ["advice-block", "misread-block"],
  },

  // ── PE — evaluability (movement 2). What we measured, and what we could not. ──
  PE1: {
    doesntMean: "≠ the not-applicable rules were passed. They had nothing to measure in your book. A rule with no subject is silent, not satisfied.",
    job: ["misread-block"],
  },
  PE2: {
    doesntMean: "≠ your holdings have no sector, ≠ they are unclassifiable. We could not resolve one for enough of your book to read sector concentration honestly, so we did not. The gap is ours.",
    job: ["misattribution-block", "misread-block"],
  },
  PE3: {
    doesntMean: "≠ these funds have no manager. We could not resolve which house runs enough of them to read house concentration, so that rule stayed silent. The gap is ours.",
    job: ["misattribution-block", "misread-block"],
  },
  PE4: {
    doesntMean: "≠ your book is safe, ≠ it carries no risk. It states that no single company's fate reaches you directly — the rules that measure company concentration had nothing to measure.",
    job: ["misread-block"],
  },
  PE5: {
    doesntMean: "≠ the fund is risky, ≠ we're hiding something. It's a limit of what we can currently verify, and it's ours to close.",
    job: ["misattribution-block", "misread-block"],
  },

  // ── PV6 — the finding that makes multi-asset honest. ──
  PV6: {
    doesntMean: "≠ these holdings are unhealthy, ≠ we failed to cover them, ≠ they're worse than your stocks. Health reads businesses; a fund owns businesses we can't see inside, and gold isn't a business at all. Health has nothing to say about them, and saying nothing is the honest answer.",
    job: ["misread-block", "misattribution-block"],
  },

  // ── PX6 — the gross/net gap. The storyboard's hinge. ──
  PX6: {
    doesntMean: "≠ the defect is fatal, ≠ fix it. It separates how you're spread from what specifically moved the number — two different explanations that a single score merges.",
    job: ["advice-block", "misread-block"],
  },

  // ── PC — concentration. The Read is the HEADLINE for the C-rule already in the number (§B.7): present
  //    it as the explanation of where the number is, never as an additional penalty. ──
  PC1: {
    doesntMean: "≠ the position is a mistake, ≠ it will fall, ≠ trim it. Concentration is a fact about how much the score depends on one name, not a judgment on the name.",
    job: ["advice-block"],
  },
  PC2: {
    doesntMean: "≠ a dominant position is a mistake. It states how much of the book's read comes from one company — a name that carries the book carries it in both directions.",
    job: ["advice-block", "misread-block"],
  },
  PC3: {
    doesntMean: "≠ over-exposed in a bad way, ≠ the sector will underperform. It states how sector-dependent the book is. Financials-heavy books are ordinary in India — 40% is the trigger precisely because of that.",
    job: ["advice-block", "misread-block"],
  },
  PC4: {
    doesntMean: "≠ a single-sector book is wrong — a conviction book is a choice. It states that sector risk and book risk are now the same risk.",
    job: ["advice-block", "misread-block"],
  },
  PC5: {
    doesntMean: "≠ you hold too few names — the count is what it is. It states that weight, not count, is what breadth is made of: holdings at unequal size do not spread risk equally.",
    job: ["advice-block", "misread-block"],
  },
  PC6: {
    doesntMean: "≠ this AMC is unsound, ≠ move your money. Fund assets sit in a trust, separate from the manager — but the 2020 debt-scheme freezes are why single-house exposure is a structural fact rather than a theoretical one.",
    job: ["advice-block", "misread-block"],
  },
  PC7: {
    doesntMean: "≠ this fund house is a risk in itself. It states that one set of operational and governance arrangements sits behind nearly the whole book.",
    job: ["advice-block", "misread-block"],
  },
  PC8: {
    doesntMean: "≠ the bond and the equity carry identical risk — they do not; a bondholder is ahead of a shareholder. ≠ either is a mistake. But one company's fate is one company's fate, and that is what concentration measures.",
    job: ["misread-block", "advice-block"],
  },

  // ── PB — breadth. ──
  PB1: {
    // CONSTRUCTIVE — scope, not disclaimer. What it does NOT cover: quality, deterioration, whether the
    // book suits its owner. It is a statement about SHAPE and nothing else.
    doesntMean: "≠ your holdings are good — spread is a fact about shape, not about the companies in it. A well-spread book of ordinary names is still ordinary. It says the book's read does not hang on one name or one sector.",
    job: ["misread-block"],
  },
  PB2: {
    doesntMean: "≠ too many holdings, ≠ prune it. Breadth at this width is a description of how the book is built, not a verdict on it.",
    job: ["advice-block"],
  },
  PB3: {
    doesntMean: "≠ owning an index is a mistake — it is a reasonable way to invest. It states that a book this wide reads much like the index it resembles, while carrying the work of holding every name separately.",
    job: ["advice-block", "misread-block"],
  },
  PB6: {
    doesntMean: "≠ these funds are identical, ≠ redundancy is a mistake, ≠ sell four. Different managers make different calls — but they fish in the same pond, so for breadth they count closer to one exposure than to several.",
    job: ["advice-block", "misread-block"],
  },
  PB7: {
    doesntMean: "≠ a few sectors is wrong. It names a collapse the holding count hides: a book can be wide by name and narrow by sector at the same time, and the name count is the number people read.",
    job: ["advice-block", "misread-block"],
  },

  // ── PQ — quality distribution. ──
  PQ1: {
    // CONSTRUCTIVE — scope. Quality reads the SCORED holdings only, and reads them TODAY.
    doesntMean: "≠ the book is safe, ≠ nothing here can deteriorate. It reads the holdings we scored, as they are today — soundness is a reading of the companies, not of how they are weighted or of what happens next.",
    job: ["misread-block"],
  },
  PQ2: {
    doesntMean: "≠ a barbell is a mistake — a strong name and a weak name at size can be deliberate. It states that your average hides a split: no holding actually sits where the average points.",
    job: ["advice-block", "misread-block"],
  },
  PQ3: {
    doesntMean: "≠ ordinary is bad, ≠ these are poor companies. It states that the book's holdings cluster together in the middle, so the aggregate is a fair description of nearly every name in it rather than an average of extremes.",
    job: ["advice-block", "misread-block"],
  },
  PQ4: {
    doesntMean: "≠ the name is doomed, ≠ cut it. It states that a holding in the weakest band carries enough weight to move the book's read on its own.",
    job: ["advice-block"],
  },

  // ── PS — signals. The Read is the headline for the Signals deduction already in the number (§B.7). ──
  PS1: {
    doesntMean: "≠ the companies are failing. Red flags are findings we can currently see on names you hold — they describe the present state of the evidence, not an outcome.",
    job: ["misread-block"],
  },
  PS2: {
    doesntMean: "≠ a loss is coming, ≠ exit. Distress is the strongest reading our lenses produce about a company as it stands — it is the state of the evidence, not a forecast of the ending.",
    job: ["advice-block", "misread-block"],
  },
  PS3: {
    doesntMean: "≠ these companies are deteriorating everywhere at once. Broad erosion means several lenses agree on the same names — agreement across lenses, not severity in any one of them.",
    job: ["misread-block"],
  },
  PS4: {
    doesntMean: "≠ the strength is gone. Fading strength describes a direction our lenses currently read, on names that still read as strong.",
    job: ["misread-block"],
  },
  PS5: {
    // CONSTRUCTIVE — scope. "No red flags" is the ABSENCE of a finding, and absence has two causes:
    // nothing is wrong, or nothing is visible. This sentence must not let those be confused.
    doesntMean: "≠ nothing is wrong — it means nothing our lenses read is firing right now, on the names we scored. An unscored holding cannot raise a flag, and a flag that has not appeared yet is indistinguishable from one that never will.",
    job: ["misread-block", "misattribution-block"],
  },

  // ── PV — coverage / verification. Mostly misattribution: the gap is OURS. ──
  PV1: {
    // CONSTRUCTIVE — scope. The sharpest one: "verified" is about US, not about the book.
    doesntMean: "≠ your holdings are good, ≠ the book is verified as sound. It means we could READ nearly all of it: coverage describes how much of your capital our lenses can see, and says nothing at all about what they saw.",
    job: ["misread-block"],
  },
  PV2: {
    doesntMean: "≠ the unscored part is bad — it is unread. A partly verified book is a statement about the reach of our coverage, and the number you see describes only the part we could reach.",
    job: ["misread-block", "misattribution-block"],
  },
  PV4: {
    doesntMean: "≠ these names are unscoreable or low quality. They are companies we recognise and have not scored yet. The gap is ours, not the book's.",
    job: ["misattribution-block", "misread-block"],
  },
  PV5: {
    doesntMean: "≠ small-caps are bad, ≠ they do not belong here. It states that a quarter of the book sits in names outside our tracked universe, so the read covers less of your capital than the number's confidence suggests.",
    job: ["advice-block", "misread-block", "misattribution-block"],
  },

  // ── PX — pillar RELATIONSHIPS. Orthogonal to PC/PS (§B.7): both may fire; they describe different
  //    things and must never be merged. ──
  PX1: {
    doesntMean: "≠ the companies are the problem, ≠ the construction is a mistake. It names a disagreement: sound holdings held in a shape that concentrates the read on a few of them.",
    job: ["misread-block", "advice-block"],
  },
  PX2: {
    doesntMean: "≠ good construction makes up for ordinary components, ≠ the reverse. It names the two reading in different directions — the shape is sound, the names it is made of read as ordinary.",
    job: ["misread-block"],
  },
  PX3: {
    doesntMean: "≠ the companies have stopped being sound. It names a disagreement between what the holdings read as and what is currently firing on them — the second is the newer fact.",
    job: ["misread-block"],
  },
  PX4: {
    // CONSTRUCTIVE — scope. Broad strength is a reading of RIGHT NOW across four pillars; it is not
    // durability, and it explicitly is not a forecast.
    doesntMean: "≠ nothing can go wrong here. Every pillar reads well at once, today, over the part of the book we can see — it describes a state, and a state is the thing most capable of changing.",
    job: ["misread-block"],
  },
  PX5: {
    doesntMean: "≠ these holdings are weak, ≠ their field is a reason to hold or drop them. A field-weak verdict is a fact about the PEER GROUP a name is measured against, never a penalty on the name: it is why a comparison reads the way it does.",
    job: ["misread-block", "misattribution-block"],
  },
};

/** Every id this module carries copy for. The verify asserts this EQUALS the emitted set + PQ2/PQ3.
 *  PE6 is NOT here — it is not a member of the persisted library. See READ_TIME_COPY below. */
export const COPY_IDS = Object.keys(FINDING_COPY);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// READ-TIME COPY — a SEPARATE map, and the separation is the guard.
//
// PE6 is not in FINDING_COPY because PE6 IS NOT A MEMBER OF THAT LIBRARY. Everything above is fired by
// `firePortfolioFindings` INSIDE `persist` and frozen into `fired_findings`. PE6 cannot be:
//
//   THE FIRED SET is derived from HASHED INPUTS  → persistable (it changes only when an input changes).
//   PE6 is derived from a LIVE FACT              → not.
//   ★ DIFFERENT PROVENANCE, DIFFERENT HOME.
//
// `unvaluedShare` is a live fact — the catalog can learn a price tomorrow (ODL cv2-s7-refuse-live-facts).
// persist.ts deliberately does NOT take `heldNotValued`: "whether a symbol is valuable is a LIVE fact…
// The READ serves it, fresh." And `firePortfolioFindings` runs inside persist, where the value is
// deliberately absent. Computing PE6 there would freeze the same staleness ONE LAYER UP: an append-only
// row asserting "₹270 of your book cannot be valued" long after we could value it, with nothing to
// correct it.
//
// ⚠ IF YOU ARE HERE TO "TIDY" PE6 INTO FINDING_COPY: that is the move this comment exists to stop. The
// two maps are not disorganised — they are two different lifetimes.
//
// ── (Stage 10a batch 2) THE WHOLE PD FAMILY LIVES HERE TOO, AND FOR A DEEPER REASON ───────────────
//
// PE6 is read-time because its INPUT is live. Every PD finding is read-time because of its SUBJECT:
//
//   ★ A PD FINDING DESCRIBES VYTAL, NOT THE BOOK. The persisted row is a snapshot of the USER'S
//     PORTFOLIO. A fact about our data coverage has a DIFFERENT SUBJECT — wrong subject, wrong
//     lifetime, wrong home. It was never eligible for the book's snapshot. (ODL cv2-s10a-pd-read-time.)
//
// Doc 2 named this without noticing it had named the home: "Facts about OUR DATA, not about the holding"
// and "reference only, always". PD7 makes it unarguable — `oldestSyncAgeDays = f(now)` and `fingerprintOf`
// has NO time input, so a persisted PD7 would never rewrite and would serve "synced 3 days ago" forever.
// PD1/PD2/PD3/PD5 change when WE improve, not when the user trades: freeze "we have no credit ratings"
// and the day we source ratings, every stored row still says we don't.
//
// ★ AND THIS IS WHERE PD1's "NEVER SUPPRESSIBLE" IS ENFORCED — by ARCHITECTURE, not by a flag. Triage and
// ranking operate on the PERSISTED fired set. PD is never in it. The sort does not decline to drop PD1;
// THE SORT NEVER SEES IT. There is no flag to respect and no flag to forget.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const READ_TIME_COPY: Record<string, FindingCopy> = {
  PE6: {
    doesntMean: "≠ these holdings are worthless, ≠ they are worth ₹0. We don't know what they're worth, and we won't pretend — they are simply not part of the number.",
    job: ["misread-block", "misattribution-block"],
  },

  // ── THE PD FAMILY (doc 2 §10) — disclosures. Panel 6, reference-only, always. ────────────────────
  //
  // ⚠ THE FAMILY'S JOB IS `misattribution-block`, and that is not a stylistic observation. Every PD
  // finding reports a hole in OUR data while sitting on a page about the USER'S money. The default
  // reading of "no credit ratings" on a portfolio page is "MY BONDS have no rating" — the user takes our
  // gap and attributes it to their book. That misreading is not a risk of the PD family; it is its
  // natural failure mode, and every sentence below is written against it.
  PD1: {
    doesntMean:
      "≠ your bonds are unrated — they almost certainly are rated, by CRISIL or ICRA or CARE, and that rating exists whether or not we can see it. ≠ they are risky, and ≠ they are safe: we are not saying anything about them. WE don't have the rating. The gap is ours.",
    job: ["misattribution-block", "misread-block"],
  },
  PD2: {
    doesntMean:
      "≠ your bonds have no yield. A bond's yield to maturity is a fact about its price, its coupon and its remaining life — it exists right now for every bond you hold. We just don't compute it. The gap is ours.",
    job: ["misattribution-block"],
  },
  PD3: {
    doesntMean:
      "≠ you didn't receive the interest — it was paid to your bank account on schedule and it is yours. ≠ the gain shown is wrong; it is a PRICE return, and it is correct as a price return. What it is not is your total return, because we hold no coupon schedule for Indian debt to add the income leg to it.",
    job: ["misattribution-block", "misread-block"],
  },
  PD4: {
    doesntMean:
      "≠ the holding is worthless, ≠ it isn't yours. You own it and it has a value; we could not source a price for it. It sits outside every number on this page rather than inside them at zero.",
    job: ["misattribution-block", "misread-block"],
  },
  PD5: {
    doesntMean:
      "≠ funds are opaque — AMCs publish their portfolios every month, and your fund's holdings are a matter of public record. This is a source we haven't built yet, not a wall. ≠ the sector and company figures on this page are wrong: they are complete for what they cover, and what they cover is your direct holdings.",
    job: ["misattribution-block", "misread-block"],
  },
  PD6: {
    doesntMean:
      "≠ the fund is new, and ≠ it performed badly over the period we can't see. It means our NAV history for it starts where it starts. The fund's life before that date happened; we just weren't reading.",
    job: ["misattribution-block", "misread-block"],
  },
  PD7: {
    doesntMean:
      "≠ you sold anything, and ≠ these holdings are gone. The account stopped sending us data; the shares are still yours. The quantities we're showing are the last ones we were told about, so they are as current as that date and no more.",
    job: ["misattribution-block", "misread-block"],
  },

  /**
   * (Stage 10a batch 3) PD8 — the finding PI1's re-gate created. Its Doesn't-mean has the hardest job in
   * the family: the sentence "we can't tell you whether your ETF trades away from its NAV" arrives on a
   * page about the user's money and reads as "something is wrong with this ETF". Nothing is wrong with
   * the ETF. Our two feeds run on different clocks.
   */
  PD8: {
    doesntMean:
      "≠ your ETF is trading away from its NAV, and ≠ it isn't. We don't know, and this is not a hint in either direction. ≠ the price or the NAV we show you is wrong — each is correct for the day it came from. They are simply from different days, because we fetch them on different schedules, and a premium is only meaningful between two numbers struck on the same day.",
    job: ["misattribution-block", "misread-block"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // (Stage 10a batch 3) THE PI FAMILY (doc 2 §9) — INSTRUMENT FACTS. Panel 5. None deducts.
  //
  // ★ THE FAMILY'S JOB IS `advice-block`, AND IT IS THE FIRST FAMILY WHERE THAT IS THE PRIMARY ONE.
  //
  // PD's natural failure mode is MISATTRIBUTION: the reader takes our gap and reads it as a fact about
  // their book. PI has the opposite problem. Every PI finding is a TRUE, SPECIFIC, ACTIONABLE FACT about
  // an instrument the user owns — a 12% premium, a dormant scheme, a 42% drawdown, a category rank. There
  // is nothing to misattribute. The fact is real, it is theirs, and it is exactly the kind of fact that
  // arrives already sounding like an instruction.
  //
  // ⚠ THIS IS WHY §11.2 SAYS "PI OUTRANKS BY USEFULNESS, NOT BY TONE" AND WHY THAT RULING NEEDS THESE
  // SENTENCES TO HOLD. A 12% premium is allowed to sit ABOVE a Caution-tone PC finding, at the top of the
  // page, because it is the most useful FACT there — and a fact that useful, that prominent, with no
  // Doesn't-mean under it, is a recommendation wearing a finding's clothes. Prominence without a
  // Doesn't-mean is exactly the thing the separation of prominence from arithmetic was supposed to buy.
  //
  // The advice-verb grep proves the READ contains no instruction. Only these sentences prove the reader
  // was not handed one anyway.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  PI1: {
    doesntMean:
      "≠ the fund is bad, ≠ don't buy it, ≠ sell it. Premiums arise when creation of new units is constrained — most often because an overseas investment cap is full — and they can persist for months or close in a week. This is what the market last paid against what the assets were worth on the same day. Nothing here says which of those two numbers is going to move.",
    job: ["advice-block", "misread-block"],
  },
  PI2: {
    doesntMean:
      "≠ switch, ≠ you were mis-sold, and ≠ we know what this costs you. We do not have expense ratios. We can tell you which plan you hold and that its twin exists — that is the whole of it. The difference between them is real, and we are not the ones who can size it for you.",
    job: ["advice-block", "misattribution-block"],
  },
  PI3: {
    doesntMean:
      "≠ your money is gone, and ≠ the AMC failed. Schemes close, merge and mature routinely, and a scheme leaving AMFI's daily file is usually the paperwork of one of those. It means we cannot mark this position to a current price — the units are still yours, and the AMC still knows what they are worth.",
    job: ["misread-block", "advice-block"],
  },
  PI4: {
    doesntMean:
      "≠ underperformance, and ≠ a bad fund. Tracking error measures fidelity to the mandate — deviation in EITHER direction, including the year it beat the index — not whether you made money. A fund that tracks perfectly and falls 30% has zero tracking error.",
    job: ["misread-block", "advice-block"],
  },
  PI5: {
    doesntMean:
      "≠ it will fall again, and ≠ it is riskier than your other holdings. This is a record of what has already happened, over the window we hold and no further back. It is not a forecast, and it is NOT COMPARABLE ACROSS CATEGORIES — a 42% fall is ordinary for a small-cap fund and would be extraordinary for a liquid one.",
    job: ["advice-block", "misread-block"],
  },
  PI6: {
    doesntMean:
      "≠ sell it, ≠ it will keep lagging, and ≠ rank predicts anything. A rank is past returns against category peers, arranged in order. It says nothing about the businesses inside the fund, and the fund ranked first this year is not the one ranked first next year.",
    job: ["advice-block", "misread-block"],
  },
  PI7: {
    doesntMean:
      "≠ this is a yield you will receive, and ≠ it is guaranteed. It is what the trust has distributed over the last twelve months against today's price. Distributions come from rent and toll collections that vary, the price moves daily, and both halves of that fraction can change tomorrow.",
    job: ["advice-block", "misread-block"],
  },
  PI8: {
    doesntMean:
      "≠ a ladder is good or bad, and ≠ you should spread them differently. Longer maturities move more with interest rates; that is arithmetic, not advice. We are telling you when your debt comes due because you cannot see it anywhere else on this page.",
    job: ["advice-block", "misread-block"],
  },
};

/** Every read-time id. PD → reference-only: asserted to carry no `storyClause`, ever (doc 2 §9.2). */
export const READ_TIME_IDS = Object.keys(READ_TIME_COPY);
