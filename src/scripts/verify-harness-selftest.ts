// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SELF-TEST — the ten defects, reintroduced one at a time, and the harness catching each.
//
// ── ★ WHY THIS FILE IS THE MOST IMPORTANT ONE IN THE HARNESS ──────────────────────────────────────
// A harness that has never failed has not been tested. Thirty-one green assertions and a closed
// checklist coexisted with two-thirds of question shapes broken in front of a reader, and every one
// of those assertions was honestly written. The way that happens is that nobody ever confirmed the
// assertions could go red for the reasons they claim to guard.
//
// This is the same negative-control discipline that caught the fake resolver at GATE 0: for each
// defect, build the broken artefact, assert the check FIRES, then assert the same check is SILENT on
// the corrected artefact. Both halves are needed — a check that fires on everything is as useless as
// one that fires on nothing, and only the pair distinguishes them.
//
// ── ★ EVERY CASE BELOW IS A REAL DEFECT THAT SHIPPED ──────────────────────────────────────────────
// Not hypotheticals. Each is reconstructed from the stage-9 browser pass, and the ones this harness
// CANNOT catch are asserted as such — a row that says "not caught here, caught by layer N" is worth
// more than a row quietly omitted.
//
// ⚠ IT IS PURE. No database, no model, no network, no filesystem outside a synthetic string. It runs
//   in milliseconds, so it sits in `verify:live` beside the gate it validates and can never drift out
//   of step with it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  iFalseZero, iPlaceholder, iRepeatedLabel, iSetReconciles, iInterpolation, iActionable, iDistinct,
  iProseCollision, iBasis, iPledgeSilent, iStepped, iDenominator, iFrameStated,
  type AnswerUnderTest,
  iRawToken,
  iWalkCloses,
  iDerivedMethod,
  iBoundary,
  iSplitHonest,
  iWindowStated
} from "../harness/invariants.js";
import { PLEDGE_PHRASE } from "../resolve/pledge.js";
import { scanBareFetch, scanDeadControl, unreadFields } from "../harness/client-contract.js";
import { SLOT_OBLIGATIONS } from "../harness/obligations.js";
import type { MatrixAnswer } from "../harness/matrix.js";
import { pairDeals, type DealLeg } from "../resolve/deal-pairs.js";
import { splitTwoPonds } from "../resolve/peer-group-versus.js";
import { prosePasses } from "../compose/plan.js";
import { CANONICAL_METRICS } from "../scoring/bars-loader/label-map.js";
import { findingAsked } from "../composition/families/finding-one.js";

let pass = 0, fail = 0;
const section = (s: string) => console.log(`\n══ ${s} ══`);

/**
 * ★ THE UNIT OF THIS FILE: a defect, a broken artefact, a fixed one, and the check that must tell
 *   them apart. Both directions are asserted in one call so neither can be forgotten.
 */
function control<T>(
  defect: string,
  run: (x: T) => { length: number },
  broken: T,
  fixed: T,
): void {
  const fired = run(broken).length;
  const quiet = run(fixed).length;
  const good = fired > 0 && quiet === 0;
  if (good) { pass++; console.log(`  ✅ ${defect}\n       caught (${fired} violation${fired === 1 ? "" : "s"}) · silent on the corrected artefact`); }
  else {
    fail++;
    console.log(`  ❌ ${defect}`);
    if (fired === 0) console.log(`       ⚠ THE HARNESS DID NOT CATCH IT — this check does not guard what it claims to`);
    if (quiet > 0) console.log(`       ⚠ IT ALSO FIRES ON THE CORRECT ARTEFACT (${quiet}) — a check that fires on everything catches nothing`);
  }
}

/** A minimal well-formed answer; each case perturbs one thing. */
const answer = (over: Partial<AnswerUnderTest> = {}): AnswerUnderTest => ({
  label: "synthetic", question: "synthetic", compositionId: "synthetic",
  sections: [], prose: { opening: [], leads: {}, after: {}, close: "" },
  ...over,
});
const heroSet = (payload: unknown) => answer({ sections: [{ kind: "ANCHOR", renderer: "hero-set", payload }] });


// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ PHASE 1 · BATCH 1 — CONTROLS FOR THE THREE NEW INVARIANTS.
//
// ⚠ EVERY ONE OF THESE IS A DEFECT THAT ACTUALLY SHIPPED OR ACTUALLY SLIPPED THROUGH IN THIS BATCH,
//   and two of them are mistakes made WHILE writing the guard that was supposed to stop them:
//
//   · the pledge-absence sentence in `ownership-split.tsx` shipped and was rendering
//   · `I-PLEDGE-SILENT`'s first version fired 17 times on the RULING'S OWN sentences, which is the
//     "fires on everything catches nothing" half of this control's contract
//   · the pillar card's "no adjustment — nothing pledged" slipped past the first full harness run,
//     because `pillar-bars` was not yet in an ownership answer when that run happened
//
// The last one is the argument for these controls existing at all: the gate was correct and the path
// was unexercised, which is indistinguishable from a pass until someone reads the payload by hand.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function phase1Batch1Controls(): void {
  section("★ PHASE 1 · BATCH 1 — the basis, the pledge silence, and the step");

  const statement = (basis: unknown) => answer({
    sections: [{ kind: "SERIES", renderer: "statement-table", payload: { periods: ["FY25", "FY26"], groups: [], basis } }],
  });

  control(
    "I-BASIS · a filed statement with no basis on it",
    iBasis,
    statement(undefined),
    statement({ read: "consolidated", available: ["consolidated"], sentence: "Read on a consolidated basis, which is the only basis this company files." }),
  );
  control(
    "I-BASIS · both bases filed and the sentence does not say the other exists",
    iBasis,
    statement({ read: "consolidated", available: ["consolidated", "standalone"], sentence: "Read on a consolidated basis." }),
    statement({ read: "consolidated", available: ["consolidated", "standalone"], sentence: "Read on a consolidated basis. This company also files standalone results for the same periods, and those are different figures." }),
  );

  const split = (pledge: unknown, extra: Record<string, unknown> = {}) => answer({
    sections: [{ kind: "DECOMPOSITION", renderer: "ownership-split", payload: { periodKey: "FY27Q1", pledge, ...extra } }],
  });

  // ── THE SENTENCE THAT SHIPPED, verbatim from `ownership-split.tsx` before this batch. ───────────
  control(
    "I-PLEDGE-SILENT · the exact sentence that shipped, asserting a pledge absence",
    iPledgeSilent,
    answer({ prose: { opening: ["None of the promoter holding is pledged."], leads: {}, after: {}, close: "" } }),
    answer({ prose: { opening: [PLEDGE_PHRASE.not_established], leads: {}, after: {}, close: "" } }),
  );
  control(
    "I-PLEDGE-SILENT · a pledge MAGNITUDE in prose",
    iPledgeSilent,
    answer({ prose: { opening: ["51.4% of the promoter holding is pledged."], leads: {}, after: {}, close: "" } }),
    answer({ prose: { opening: [PLEDGE_PHRASE.disclosed_unquantified], leads: {}, after: {}, close: "" } }),
  );
  control(
    "I-PLEDGE-SILENT · a numeric pledge field crossing to the browser",
    iPledgeSilent,
    split({ state: "not_established", phrase: PLEDGE_PHRASE.not_established }, { pledgedPctOfPromoter: 51.37 }),
    split({ state: "not_established", phrase: PLEDGE_PHRASE.not_established }),
  );
  control(
    "I-PLEDGE-SILENT · a pledge sentence resolve/pledge.ts did not author",
    iPledgeSilent,
    split({ state: "not_established", phrase: "Pledging figures were not disclosed." }),
    split({ state: "not_established", phrase: PLEDGE_PHRASE.not_established }),
  );
  // ⚠ THE ONE THAT SLIPPED PAST THE FIRST FULL RUN. `pillar-bars` carried "no adjustment — nothing
  //   pledged" and no OA answer had a pillar card yet, so the gate was correct and unexercised.
  control(
    "I-PLEDGE-SILENT · the health pillar card's own pledge note",
    iPledgeSilent,
    answer({ sections: [{ kind: "DECOMPOSITION", renderer: "pillar-bars", payload: { parts: [{ label: "Pledging", state: "scored", note: "no adjustment — nothing pledged" }] } }] }),
    answer({ sections: [{ kind: "DECOMPOSITION", renderer: "pillar-bars", payload: { parts: [{ label: "Pledging", state: "scored", note: "did not move the reading either way" }] } }] }),
  );
  // ★ AND THE OTHER HALF OF THE CONTRACT, WHICH THIS GATE FAILED ON ITS FIRST RUN. `control` asserts
  //   `quiet === 0` on the fixed artefact, so passing this row IS the assertion that the 17 false
  //   positives on the ruling's own sentences cannot come back.
  control(
    "I-PLEDGE-SILENT · silent on all three authored sentences",
    iPledgeSilent,
    answer({ prose: { opening: ["Nothing is pledged here."], leads: {}, after: {}, close: "" } }),
    answer({ prose: { opening: Object.values(PLEDGE_PHRASE), leads: {}, after: {}, close: "" } }),
  );

  // ── THE STEP. A register drawn as a continuous line is the small lie. ──────────────────────────
  const filedPoints = [{ at: "FY26Q3", value: 71.8 }, { at: "FY26Q4", value: 71.2 }, { at: "FY27Q1", value: 70.1 }];
  control(
    "I-STEPPED · filed periods drawn by a continuous renderer",
    iStepped,
    answer({ sections: [{ kind: "SERIES", renderer: "value-line", payload: { points: filedPoints } }] }),
    answer({ sections: [{ kind: "SERIES", renderer: "stepped-filing-line", payload: { plots: [{ label: "Promoter", points: filedPoints }] } }] }),
  );
  // ⚠ AND IT MUST NOT FIRE ON A PRICE LINE, which is continuous BECAUSE a price exists on every
  //   trading day — the distinction the whole invariant rests on. Dated points, not period keys.
  control(
    "I-STEPPED · silent on a genuinely continuous series (dated points, not filed periods)",
    iStepped,
    answer({ sections: [{ kind: "SERIES", renderer: "composite-spine", payload: { points: filedPoints } }] }),
    answer({ sections: [{ kind: "SERIES", renderer: "composite-spine", payload: { points: [{ at: "2026-08-01", value: 3100 }, { at: "2026-08-02", value: 3120 }] } }] }),
  );
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ PHASE 1 · BATCH 2 — CONTROLS FOR THE TWO NEW INVARIANTS.
//
// ⚠ BOTH GUARD DEFECTS THIS BATCH SHIPPED AND THEN CAUGHT BY READING ITS OWN LIVE OUTPUT, which is
//   the argument for making them properties rather than review notes:
//
//   · the frame-declined answer ran a RANKING and its table reported "Matched 95 · Out of 95",
//     directly contradicting the sentence above it that said nothing had been filtered
//   · a peer roster states a group median, and the median's denominator is a different number from
//     the roster — three different counts, and collapsing any two is a lie a reader cannot detect
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function phase2Batch1Controls(): void {
  section("★ PHASE 2 · BATCH 1 — an engine token in prose, a walk that does not close, a derived object");

  // ══ I-RAW-TOKEN ════════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ THE DEFECT WAS LIVE. `WaterfallPayload` carried `redistributionReason` — `missing_pillar` —
  //   and the frontend rendered it into a paragraph, so a reader on VEDL saw the token in a sentence.
  const walk = (note: string | null) => answer({
    sections: [{
      kind: "DECOMPOSITION", renderer: "waterfall",
      payload: { basis: "shortfall", reconciles: true, residual: 0, redistributionNote: note, bars: [] },
    }],
  });
  control(
    "I-RAW-TOKEN · an engine enum in a reader-facing sentence field",
    iRawToken,
    walk("missing_pillar"),
    walk("Market could not be scored this period, so that share of the weight was carried by the parts that could."),
  );

  // ★ AND IT MUST NOT FIRE ON A FIELD WHOSE CONTRACT IS "THIS IS A TOKEN". `band: "below_par"` and
  //   `state: "unavailable_redistributed"` are meant to be tokens; a blanket string scan would fire on
  //   every answer in the system and be switched off within a week. This is the control that keeps the
  //   rule narrow enough to survive.
  const tokenFields = answer({
    sections: [{
      kind: "DECOMPOSITION", renderer: "waterfall",
      payload: {
        band: "below_par", basis: "shortfall", reconciles: true, residual: 0, redistributionNote: null,
        bars: [{ key: "market", label: "Market", state: "unavailable_redistributed", band: "not_scored", note: "could not be scored this period" }],
      },
    }],
  });
  control(
    "I-RAW-TOKEN · silent on fields that are MEANT to carry tokens",
    iRawToken,
    // The broken artefact puts the same token in a PROSE field, to prove the check is still live.
    answer({ sections: [{ kind: "DECOMPOSITION", renderer: "waterfall", payload: { bars: [{ key: "market", label: "Market", note: "unavailable_redistributed" }] } }] }),
    tokenFields,
  );

  // ★ AND THE DIGEST HALF, which was invisible to every invariant in this layer until this batch.
  const digested = (value: string) => answer({
    sections: [{
      kind: "DECOMPOSITION", renderer: "waterfall", payload: {},
      digest: { groups: [{ label: "What is missing", lines: [{ label: "Market", value, state: "absent" }] }] },
    }],
  });
  control(
    "I-RAW-TOKEN · an engine enum in a DIGEST line — the half the model reads",
    iRawToken,
    digested("pillar_unavailable"),
    digested("we could not score this pillar for this period"),
  );

  // ══ I-WALK-CLOSES ══════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ THE DEFECT THIS GUARDS IS NOT HYPOTHETICAL. `pillar-decomposition.ts` shipped a version that
  //   joined pillars on `(stock, as_of, run)` and returned whichever single pillar that run happened
  //   to touch, reporting the other three as unscored. Its own header records that the output "looks
  //   identical to a correct absent state" on a thin stock — so only the arithmetic catches it.
  const closes = (reconciles: boolean, said: boolean) => answer({
    sections: [{
      kind: "DECOMPOSITION", renderer: "waterfall",
      payload: { basis: "shortfall", reconciles, residual: reconciles ? 0 : 7.4, bars: [] },
      digest: said
        ? { groups: [{ label: "Does it add up", lines: [{ label: "Reconciliation", value: "7.40 points are unexplained, so this breakdown is not safe to read", state: "absent" }] }] }
        : { groups: [{ label: "Does it add up", lines: [{ label: "Reconciliation", value: "the bars account for the score", state: "present" }] }] },
    }],
  });
  control(
    "I-WALK-CLOSES · bars that do not account for the total, with nothing saying so",
    iWalkCloses,
    closes(false, false),
    closes(false, true),
  );
  // ★ AND A WALK THAT DOES CLOSE MUST BE SILENT — otherwise the rule punishes the correct case.
  control(
    "I-WALK-CLOSES · silent on a walk that reconciles",
    iWalkCloses,
    closes(false, false),
    closes(true, false),
  );

  // ══ I-DERIVED-METHOD ═══════════════════════════════════════════════════════════════════════════
  //
  // ★ A PHASE IS THE FIRST OBJECT IN THE ANSWER LAYER THAT THE READ PATH COMPUTES AND THEN PRESENTS AS
  //   A FINDING. Nobody filed "INDUSINDBK changed level at FY25Q3"; a method with two constants decided
  //   it, and a different method would draw different lines on the same points.
  const spine = (methodNote: string | null, basisNote: string | null) => answer({
    sections: [{
      kind: "SERIES", renderer: "phase-shaded-spine",
      payload: {
        points: [{ at: "FY26Q1", value: 70 }, { at: "FY26Q2", value: 60 }],
        phases: [{ fromLabel: "FY26Q1", toLabel: "FY26Q2", mean: 65 }],
        methodNote, basisNote,
      },
    }],
  });
  control(
    "I-DERIVED-METHOD · phases drawn with no statement of how they were found",
    iDerivedMethod,
    spine(null, "This is our own score, quarter by quarter — 14 readings from FY23Q4 to FY27Q1."),
    spine(
      "A phase is a run of at least 3 quarters whose average sits at least 6 points away from the run beside it.",
      "This is our own score, quarter by quarter — 14 readings from FY23Q4 to FY27Q1.",
    ),
  );
  // ⚠ AND THE BASIS HALF. Two series exist for every company — our score and its filings — with
  //   different lengths and different meanings. A line with no basis has told the reader something
  //   they cannot check.
  control(
    "I-DERIVED-METHOD · a series drawn without saying WHICH series it is",
    iDerivedMethod,
    spine("A phase is a run of at least 3 quarters whose average sits at least 6 points away from the run beside it.", null),
    spine(
      "A phase is a run of at least 3 quarters whose average sits at least 6 points away from the run beside it.",
      "This is our own score, quarter by quarter — 14 readings from FY23Q4 to FY27Q1.",
    ),
  );
  // ★ AND IT MUST BE SILENT ON A SERIES THAT IS NOT DERIVED. A price line and a filed statement are
  //   things somebody reported; asking them for a method note would be a check firing on every answer.
  control(
    "I-DERIVED-METHOD · silent on a series nobody derived",
    iDerivedMethod,
    spine(null, null),
    answer({ sections: [{ kind: "SERIES", renderer: "composite-spine", payload: { points: [{ at: "2026-08-01", value: 3100 }, { at: "2026-08-02", value: 3120 }] } }] }),
  );
}


function phase2Batch2Controls(): void {
  section("★ PHASE 2 · BATCH 2 — a claim without its limit, and a change that attributes a crossing");

  // ══ I-BOUNDARY ═════════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ THIS ONE GUARDS A DEFECT THAT HAD ALREADY SHIPPED AND SAT THROUGH THREE BATCHES.
  //   `resolvePortfolio` mapped six of a portfolio finding's seven fields and dropped `doesntMean` —
  //   with the note directly above the mapper listing all seven by name. All 58 PHS entries carry a
  //   boundary and none carries a name or description, so the dropped field was their only copy.
  const item = (doesntMean: string | undefined) => answer({
    sections: [{
      kind: "CALLOUT", renderer: "findings",
      payload: { lookedFor: "your holdings", items: [{ label: "Concentration", detail: "one name is 31% of the book", severity: "medium", doesntMean }] },
    }],
  });
  control(
    "I-BOUNDARY · a claim rendered with an EMPTY boundary field",
    iBoundary,
    item(""),
    item("≠ the position is a mistake, ≠ it will fall, ≠ trim it. Concentration is a fact about how much the score depends on one name."),
  );

  // ★ AND IT MUST BE SILENT WHERE NO BOUNDARY IS HELD. A fabricated one reads exactly like an authored
  //   one, so the rule forbids an EMPTY field and never demands a present one — the absence is
  //   visible, which is the point.
  control(
    "I-BOUNDARY · silent where the registry genuinely holds none",
    iBoundary,
    item("  "),
    item(undefined),
  );

  // ★ A `defined-term` MUST HAVE ONE, though — every vocabulary it can read guarantees the field.
  const term = (doesntMean: string) => answer({
    sections: [{
      kind: "ANCHOR", renderer: "defined-term",
      payload: { name: "Foundation", description: "the bedrock", doesntMean, parts: [], seeAlso: [] },
    }],
  });
  control(
    "I-BOUNDARY · a term defined with no statement of its limits",
    iBoundary,
    term(""),
    term("A strong Foundation does not make a company a good investment. It says the business is solidly built."),
  );

  // ══ I-SPLIT-HONEST ═════════════════════════════════════════════════════════════════════════════
  //
  // ⚠ THE ZERO-FOR-UNKNOWN DEFECT IN ITS THIRD LOCATION. `Δ(s·w) = Δs·w₀ + s₁·Δw` stays EXACT across a
  //   crossing while both terms become fiction, because the stored subtotal of an unscorable pillar is
  //   0. "Its own reading moved 0.0" on a pillar that went from unmeasurable to 39.8, and "its own
  //   reading fell 17.3" on one that stopped existing — both would render as findings.
  const bridge = (parts: { label: string; value: number }[]) => answer({
    sections: [{
      kind: "DECOMPOSITION", renderer: "bridge",
      payload: {
        steps: [{
          key: "momentum", label: "Momentum", delta: 10, parts,
          note: "Momentum could not be scored in FY26Q3 and can be in FY26Q4. Its share of the weight came back from the other parts.",
        }],
      },
    }],
  });
  control(
    "I-SPLIT-HONEST · a crossing step split into causes that are arithmetic over a stored zero",
    iSplitHonest,
    bridge([{ label: "its own reading moved", value: 0 }, { label: "its share of the score moved", value: 10 }]),
    bridge([]),
  );

  // ★ AND AN ORDINARY REWEIGHT MUST KEEP ITS SPLIT. The rule is about crossings, not about splits —
  //   suppressing every breakdown would throw away the finding this component was built to show.
  const reweight = (parts: { label: string; value: number }[]) => answer({
    sections: [{
      kind: "DECOMPOSITION", renderer: "bridge",
      payload: {
        steps: [{
          key: "foundation", label: "Foundation", delta: -10.7, parts, note: null,
        }],
      },
    }],
  });
  control(
    "I-SPLIT-HONEST · silent on an ordinary reweight, which keeps its split",
    iSplitHonest,
    bridge([{ label: "its own reading moved", value: 0 }]),
    reweight([{ label: "its own reading moved", value: -4.3 }, { label: "its share of the score moved", value: -6.4 }]),
  );
}

function phase1Batch2Controls(): void {
  section("★ PHASE 1 · BATCH 2 — the denominator, and a substituted criterion stated as one");

  const table = (totals: { label: string; value: string | null }[]) => answer({
    sections: [{ kind: "ANCHOR", renderer: "set-table", payload: { columns: [], rows: [], totals } }],
  });

  control(
    "I-DENOMINATOR · a median with no count of the set it is over",
    iDenominator,
    table([{ label: "Group median", value: "64.2" }]),
    table([{ label: "On the roster", value: "10" }, { label: "Of those, scored", value: "10" }, { label: "Group median", value: "64.2" }]),
  );
  // ⚠ AND THE RELATIVE HALF. "+8% against its peers" is meaningless until you know whether that is six
  //   peers or forty — the kind's own header says so, and nothing asserted it until now.
  const rel = (referenceCount: number | null) => answer({
    sections: [{
      kind: "RELATIVE", renderer: "peer-marker",
      payload: {
        referenceLabel: "its peer group", referenceCount,
        marks: [{ role: "subject", value: 65 }, { role: "reference", value: 64 }],
      },
    }],
  });
  control(
    "I-DENOMINATOR · a reference mark drawn against a set of unstated size",
    iDenominator,
    rel(null),
    rel(6),
  );
  // ★ AND IT MUST BE SILENT WHERE NO AGGREGATE IS CLAIMED. A screen's match list states no median, so
  //   demanding a denominator from it would be a check that fires on correct answers.
  control(
    "I-DENOMINATOR · silent on a table that claims no aggregate",
    iDenominator,
    table([{ label: "Median health", value: "70" }]),
    table([{ label: "Matched", value: "12" }, { label: "Out of", value: "95 with a comparable figure" }]),
  );

  // ── THE FRAME DECLINE ──────────────────────────────────────────────────────────────────────────
  const declined = (opening: string[], totals: { label: string; value: string | null }[]) => ({
    ...answer({
      sections: [{ kind: "ANCHOR", renderer: "set-table", payload: { columns: [], rows: [], totals } }],
      prose: { opening, leads: {}, after: {}, close: "" },
    }),
    compositionId: "market.screen.declined.valuation",
  });
  // ⚠ THE EXACT DEFECT THAT SHIPPED IN THIS BATCH: a ranking whose totals claim a match.
  control(
    "I-FRAME-STATED · a ranking presented as a filter (\"Matched 95\")",
    iFrameStated,
    declined(["We do not publish a view on price.", "So this is ranked on health instead."],
             [{ label: "Matched", value: "95" }, { label: "Out of", value: "95" }]),
    declined(["We do not publish a view on price.", "So this is ranked on health instead."],
             [{ label: "Ranked", value: "95 companies, highest health score first" }, { label: "Filtered out", value: "nothing — no condition was applied" }]),
  );
  // ⚠ AND THE DECLINE MUST CARRY BOTH STATEMENTS. What we will not answer, and what we substituted,
  //   are two different facts; one sentence cannot carry both, and the substituted basis is the half a
  //   reader needs to know the criterion changed.
  control(
    "I-FRAME-STATED · a decline that does not say what it substituted",
    iFrameStated,
    declined(["We do not publish a view on whether a share is cheap."], [{ label: "Ranked", value: "95" }]),
    declined(["We do not publish a view on whether a share is cheap.", "So this is ranked on financial health, which is a different question."],
             [{ label: "Ranked", value: "95" }]),
  );
  // ★ AND SILENT ON EVERY ANSWER THAT DECLARED NO DECLINE — the invariant is scoped by compositionId,
  //   so a normal screen with a "Matched" total must not trip it.
  control(
    "I-FRAME-STATED · silent on an ordinary screen, which may legitimately say Matched",
    iFrameStated,
    declined(["one sentence only"], [{ label: "Matched", value: "12" }]),
    answer({
      sections: [{ kind: "ANCHOR", renderer: "set-table", payload: { totals: [{ label: "Matched", value: "12" }] } }],
      prose: { opening: ["Here is what matched."], leads: {}, after: {}, close: "" },
    }),
  );
}

function main() {
  console.log("★ HARNESS SELF-TEST — the ten stage-9 defects, reintroduced");

  // ── 1 ─────────────────────────────────────────────────────────────────────────────────────────
  section("1 · ₹0 Cr on every row (a lakh-scale book through a whole-crore formatter)");
  control(
    "D1 · I-FALSE-ZERO",
    (a: AnswerUnderTest) => iFalseZero(a),
    heroSet({
      members: [
        { key: "RELIANCE", title: "Reliance", figure: "₹0 Cr", figureLabel: "Value", tag: "below_par", sortValue: 0.0399 },
        { key: "TCS", title: "TCS", figure: "₹0 Cr", figureLabel: "Value", tag: "steady", sortValue: 0.0372 },
      ],
      totals: [{ label: "Book value", value: "₹0 Cr" }], totalAvailable: 2, emptyPhrase: "your book is empty",
    }),
    heroSet({
      members: [
        { key: "RELIANCE", title: "Reliance", figure: "₹3.99 lakh", figureLabel: "Value", tag: "below_par", sortValue: 0.0399 },
        { key: "TCS", title: "TCS", figure: "₹3.72 lakh", figureLabel: "Value", tag: "steady", sortValue: 0.0372 },
      ],
      totals: [{ label: "Book value", value: "₹36.14 lakh" }], totalAvailable: 2, emptyPhrase: "your book is empty",
    }),
  );

  // ── 2 ─────────────────────────────────────────────────────────────────────────────────────────
  section("2 · Finding / Finding / Finding / Finding (a `?? \"Finding\"` fallback over absent fields)");
  const callout = (items: unknown[]) => answer({ sections: [{ kind: "CALLOUT", renderer: "divergence", payload: { items, lookedFor: "your holdings" } }] });
  const brokenFindings = callout([
    { label: "Finding", detail: "", severity: "medium" }, { label: "Finding", detail: "", severity: "medium" },
    { label: "Finding", detail: "", severity: "medium" }, { label: "Finding", detail: "", severity: "medium" },
  ]);
  const fixedFindings = callout([
    { label: "Held by design, not scored", detail: "₹2,93,508 of your book sits outside the Health read.", severity: "high" },
    { label: "Capital under active red flags", detail: "49.0% of your book by value sits in holdings with active red flags.", severity: "high" },
    { label: "Distribution yield", detail: "This REIT has distributed 0.1% of its price over twelve months.", severity: "medium" },
    { label: "Regular plan held", detail: "You hold the Regular plan of this fund.", severity: "medium" },
  ]);
  control("D2a · I-PLACEHOLDER (the word is a known stand-in)", (a: AnswerUnderTest) => iPlaceholder(a), brokenFindings, fixedFindings);
  // ★ THE SECOND NET, DELIBERATELY REDUNDANT: this one does not need the word to be on any list.
  control("D2b · I-REPEATED-LABEL (N rows, one label, nothing to tell them apart)", (a: AnswerUnderTest) => iRepeatedLabel(a), brokenFindings, fixedFindings);

  // ── 3 ─────────────────────────────────────────────────────────────────────────────────────────
  section("3 · \"you have not pinned anything\" directly above PINNED 5");
  control(
    "D3 · I-SET-RECONCILES",
    (a: AnswerUnderTest) => iSetReconciles(a),
    heroSet({ members: [], totals: [{ label: "Pinned", value: "5" }], totalAvailable: 5, emptyPhrase: "you have not pinned anything to your watchlist yet" }),
    heroSet({
      members: [
        { key: "HDFCBANK", title: "HDFC Bank", figure: "64.0", figureLabel: "Health score", tag: "steady", sortValue: 64 },
        { key: "CUMMINSIND", title: "Cummins", figure: "76.0", figureLabel: "Health score", tag: "pristine", sortValue: 76 },
        { key: "360ONE", title: "360 ONE", figure: null, figureLabel: "Health score", tag: null, sortValue: null },
        { key: "3MINDIA", title: "3M India", figure: null, figureLabel: "Health score", tag: null, sortValue: null },
        { key: "RELIANCE", title: "Reliance", figure: "60.0", figureLabel: "Health score", tag: "below_par", sortValue: 60 },
      ],
      totals: [{ label: "Pinned", value: "5" }], totalAvailable: 5, emptyPhrase: "you have not pinned anything to your watchlist yet",
    }),
  );

  // ── 4 ─────────────────────────────────────────────────────────────────────────────────────────
  section("4 · \"nothing filed with us for  yet\" (a stock sentence, an empty symbol, a portfolio)");
  control(
    "D4 · I-INTERPOLATION (the gap where the ticker should be)",
    (a: AnswerUnderTest) => iInterpolation(a),
    answer({ prose: { opening: ["Your holdings — 11 of 21 scored · nothing filed with us for  yet"], leads: {}, after: {}, close: "" } }),
    answer({ prose: { opening: ["Your holdings — 11 of 21 scored · no portfolio snapshot computed yet"], leads: {}, after: {}, close: "" } }),
  );
  // ★ AND THE CLIENT HALF, WHICH IS WHERE THE DEFECT ACTUALLY LIVED. The payload was CORRECT —
  //   `subjectKind: "reader"`, `asOf: null` — and the renderer never read `subjectKind`, so it
  //   printed a stock sentence for a portfolio. No server-side assertion could have seen this;
  //   C3 sees it as an unread field, which is what it is.
  const coveragePayload = {
    subjectKind: "reader", tier: null, tierLabel: "Your holdings — 11 of 21 scored",
    asOf: null, windowLabel: null, quarters: null, snapshots: null, universeSearched: null, dropped: [],
  };
  control(
    "D4b · C3 · the renderer ignores a field the backend computed (`subjectKind`)",
    (src: string) => unreadFields("COVERAGE:coverage-header", "coverage-header.tsx", src, coveragePayload),
    // The shipped version: branches on `asOf` alone and prints a company sentence whatever the subject is.
    `export function CoverageHeader({ payload, symbol }) {
       return <div>{payload.tierLabel}{payload.asOf ? <span>as of {payload.asOf}</span>
         : <span>nothing filed with us for {symbol} yet</span>}
         {payload.quarters}{payload.snapshots}{payload.windowLabel}{payload.tier}{payload.universeSearched}{payload.dropped}</div>;
     }`,
    // The corrected version: the sentence follows the subject kind.
    `export function CoverageHeader({ payload, symbol }) {
       return <div>{payload.tierLabel}{payload.asOf ? <span>as of {payload.asOf}</span>
         : payload.subjectKind === "stock" ? <span>nothing filed with us for {symbol || "this company"} yet</span>
         : payload.subjectKind === "reader" ? <span>no portfolio snapshot computed yet</span> : null}
         {payload.quarters}{payload.snapshots}{payload.windowLabel}{payload.tier}{payload.universeSearched}{payload.dropped}</div>;
     }`,
  );

  // ── 5 ─────────────────────────────────────────────────────────────────────────────────────────
  section("5 · the router was right and the answer lost it");
  const withSlots = (slots: Partial<MatrixAnswer["slots"]>, sections: MatrixAnswer["sections"]): MatrixAnswer => ({
    ...answer({ sections }), kind: "composed",
    slots: { scope: "in_scope", operation: "orient", lens: null, action: null, perspective: "market", timeframe: null, subjects: ["TCS"], corrections: [], ...slots },
  } as MatrixAnswer);
  const priceRule = SLOT_OBLIGATIONS.find((o) => o.id.startsWith("lens=price"))!;
  const historyRule = SLOT_OBLIGATIONS.find((o) => o.id.startsWith("operation=history"))!;
  const genericSections: MatrixAnswer["sections"] = [
    { kind: "COVERAGE", renderer: "coverage-header", payload: {} },
    { kind: "ANCHOR", renderer: "hero-fundamental", payload: {} },
    { kind: "SERIES", renderer: "statement-trend", payload: {} },
    { kind: "DECOMPOSITION", renderer: "ownership-split", payload: {} },
  ];
  const runRule = (rule: typeof priceRule) => (a: MatrixAnswer) => (rule.when(a) && !rule.requires(a) ? [a] : []);
  control(
    "D5a · lens=price answered with the generic orientation",
    runRule(priceRule),
    withSlots({ lens: "price" }, genericSections),
    withSlots({ lens: "price" }, [...genericSections, { kind: "SERIES", renderer: "composite-spine", payload: {} }]),
  );
  control(
    "D5b · operation=history + 10 years answered with the latest quarter",
    runRule(historyRule),
    withSlots({ operation: "history", timeframe: "years:10" }, genericSections),
    withSlots({ operation: "history", timeframe: "years:10" }, [...genericSections, { kind: "SERIES", renderer: "stepped-filing-line", payload: {} }]),
  );

  // ⚠ AND THE NARROWED FORM OF I-PLACEHOLDER MUST STILL CATCH THE THING IT WAS WRITTEN FOR. Lifting
  //   the label rule for NEXT chip labels is one line, and one line is exactly how a check quietly
  //   stops guarding anything. Both directions, on the same word, in the two places it can appear.
  control(
    "D12 · \"Findings\" is a placeholder on an ITEM and a surface name on a CHIP",
    iPlaceholder,
    answer({ sections: [{ kind: "CALLOUT", renderer: "divergence", payload: { items: [{ label: "Findings", detail: "x" }] } }] }),
    answer({ sections: [{ kind: "NEXT", renderer: "chips", payload: { chips: [{ label: "Findings", question: "Why was margin compression flagged on TCS?", surface: "Findings" }] } }] }),
  );

  // ── ★ D13 · TWO SECTIONS OF ONE KIND SHARING ONE SENTENCE ─────────────────────────────────────
  //
  // ⚠ THE SCREENSHOT DEFECT. Two pillar cards, four sentences, two of them attached to the wrong
  //   card — because `executePlan` keyed prose on `KIND:renderer` with no index and the second write
  //   overwrote the first. The broken artefact below is the unindexed map; the fixed one is the
  //   indexed map the renderer prefers. Note the FIXED one keeps the SAME two sections: the defect
  //   is entirely in the keying, which is exactly why nothing downstream could see it.
  const twoPillars = [
      { kind: "DECOMPOSITION", renderer: "pillar-bars", payload: { label: "Foundation" } },
      { kind: "DECOMPOSITION", renderer: "pillar-bars", payload: { label: "Momentum" } },
  ];
  control(
    "D13 · I-PROSE-COLLISION (two pillars, one shared sentence)",
    iProseCollision,
    answer({
      sections: twoPillars,
      prose: {
        opening: [], close: "",
        leads: { "DECOMPOSITION:pillar-bars": "The momentum pillar tracks the trajectory of recent performance." },
        after: { "DECOMPOSITION:pillar-bars": "Recent operational momentum acts as a tailwind or a drag." },
      },
    }),
    answer({
      sections: twoPillars,
      prose: {
        opening: [], close: "",
        leads: {
          "DECOMPOSITION:pillar-bars#0": "The foundation pillar reads the balance sheet and the durability of earnings.",
          "DECOMPOSITION:pillar-bars#1": "The momentum pillar tracks the trajectory of recent performance.",
        },
        after: {
          "DECOMPOSITION:pillar-bars#0": "A strong foundation is what stops one bad quarter moving the score.",
          "DECOMPOSITION:pillar-bars#1": "Recent operational momentum acts as a tailwind or a drag.",
        },
      },
    }),
  );

  // ── 5c · STAGE 12 ─────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ A READER WITH NO ALERTS AND FOUR EVENT REMINDERS WAS TOLD THEY HAD NOTHING SET. Two tables,
  //   one question — see obligations.ts. The broken artefact is exactly what shipped: the alerts
  //   block, correct and empty, with no mention anywhere that a second mechanism exists.
  const notifyRule = SLOT_OBLIGATIONS.find((o) => o.id.startsWith("a notification question"))!;
  const notifyAnswer = (openings: string[], sections: MatrixAnswer["sections"]): MatrixAnswer => ({
    ...answer({ question: "what alerts do I have set", sections, prose: { opening: openings, leads: {}, after: {}, close: "" } }),
    kind: "composed",
    slots: { scope: "in_scope", operation: "lookup", lens: null, action: null, perspective: "reader", timeframe: null, subjects: [], corrections: [] },
  } as MatrixAnswer);
  control(
    "D11 · a notification question answered from the alerts table alone",
    runRule(notifyRule),
    notifyAnswer(["Here are your alerts."], [
      { kind: "COVERAGE", renderer: "coverage-header", payload: {} },
      { kind: "ANCHOR", renderer: "hero-set", payload: { members: [], emptyPhrase: "You have not set any alerts yet." } },
    ]),
    notifyAnswer(["You have no alerts set, but you do have 4 event reminders."], [
      { kind: "COVERAGE", renderer: "coverage-header", payload: {} },
      { kind: "ANCHOR", renderer: "hero-set", payload: { members: [], emptyPhrase: "You have not set any alerts yet." } },
      { kind: "ANCHOR", renderer: "hero-set", payload: { members: [{ key: "r1", title: "TCS — the day before its earnings on 2026-01-12" }] } },
    ]),
  );

  // ── 6 ─────────────────────────────────────────────────────────────────────────────────────────
  section("6 · a fallback that answers a different question (deterministicPlan's single branch)");
  // ⚠ THE QUESTION IS PART OF THE INTENT NOW, SO THE CONTROL CARRIES ONE — and this control is what
  //   caught the change. `I-DISTINCT` was widened at Phase 1 · Batch 2 so that ONE question producing
  //   ONE answer under two different slot rolls is not a defect (§6.5: the router agrees with itself
  //   80–88% of the time, and making the answer independent of that flip is the fix). Both rows here
  //   previously carried the label "synthetic" as their question, so under the new rule they were
  //   correctly exempted and this control reported "THE HARNESS DID NOT CATCH IT" — which is the
  //   control doing its job on a definition change rather than on a regression.
  const shaped = (slotKey: string, question: string, opening: string) =>
    ({
      ...answer({ question, sections: genericSections, prose: { opening: [opening], leads: {}, after: {}, close: "end" } }),
      slotKey,
    }) as AnswerUnderTest & { slotKey: string };
  control(
    "D6 · I-DISTINCT (two DIFFERENT questions, one identical answer)",
    (pair: (AnswerUnderTest & { slotKey: string })[]) => iDistinct(pair),
    [shaped("op=history lens=price tf=years:10", "show me ten years of TCS history", "Here is what we hold on TCS."),
     shaped("op=explain lens=price tf=latest", "why did TCS fall today?", "Here is what we hold on TCS.")],
    [shaped("op=history lens=price tf=years:10", "show me ten years of TCS history", "Here is TCS over the period we hold."),
     shaped("op=explain lens=price tf=latest", "why did TCS fall today?", "Here is how TCS has been priced.")],
  );
  // ★★ AND THE OTHER HALF OF THE WIDENED RULE, WHICH IS THE BEHAVIOUR THE FIX INTRODUCED. One question
  //    classified two ways must produce ONE answer — that is the point of recognising a pond or a
  //    frame from the sentence rather than from the operation slot. Without this row, a later
  //    "tightening" of I-DISTINCT back to slots-only would pass every control while re-breaking the
  //    variance case.
  //    ⚠ `control` asserts the broken side FIRES and the fixed side is SILENT, so the two arms here
  //      are: different questions with one answer (must fire) · same question with one answer (must not).
  control(
    "D6b · I-DISTINCT is SILENT when one question classified two ways gives one answer",
    (pair: (AnswerUnderTest & { slotKey: string })[]) => iDistinct(pair),
    [shaped("op=screen lens=-", "how is the large-cap pharma peer group doing", "Large-Cap Pharma reads weak, varied."),
     shaped("op=orient lens=price", "how is the large-cap NBFCs peer group doing", "Large-Cap Pharma reads weak, varied.")],
    [shaped("op=screen lens=-", "how is the large-cap pharma peer group doing", "Large-Cap Pharma reads weak, varied."),
     shaped("op=orient lens=price", "how is the large-cap pharma peer group doing", "Large-Cap Pharma reads weak, varied.")],
  );

  // ── 7 ─────────────────────────────────────────────────────────────────────────────────────────
  section("7 · the two multi-turn defects");
  // ★ THESE ARE PREDICATES, NOT INVARIANTS, so the control asserts the predicate itself discriminates.
  //   A clarify turn must not seed the next turn: the bare ticker after an ambiguous question must
  //   still land on `clarify_operation` rather than inheriting an operation nobody settled.
  const bareAfterClarify = (kind: string) => (kind === "clarify_operation" ? [] : [kind]);
  control("D7a · a clarify turn seeded the next turn's operation", bareAfterClarify, "composed", "clarify_operation");
  //   An advice question must keep its own unresolved operation rather than inheriting the previous
  //   turn's — the decline is what proves it did.
  const adviceKept = (id: string) => (id.includes("declined-advice") ? [] : [id]);
  control("D7b · an advice question inherited the previous turn's operation", adviceKept, "planned:deterministic", "orientation.company+declined-advice");

  // ── 8 ─────────────────────────────────────────────────────────────────────────────────────────
  section("8 · transport — a relative path, cookies, and a Bearer-token API");
  control(
    "D8 · C1 · no bare fetch to the API",
    (src: string) => scanBareFetch("action-control.tsx", src),
    `const res = await fetch(payload.endpoint.path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload.body) });`,
    `await apiFetch(payload.endpoint.path, { method: "POST", body: JSON.stringify(payload.body) });`,
  );

  // ── 9 ─────────────────────────────────────────────────────────────────────────────────────────
  section("9 · dead controls — every follow-up chip was an inert button");
  control(
    "D9 · C2 · no dead control",
    (src: string) => scanDeadControl("next-chips.tsx", src),
    `<button key={c.label} type="button" className="rounded-xl border px-3.5 py-2"><span>{c.question}</span></button>`,
    `<button key={c.label} type="button" onClick={ask ? () => ask(c.question) : undefined} disabled={!ask} className="rounded-xl border px-3.5 py-2"><span>{c.question}</span></button>`,
  );

  // ── 10 ────────────────────────────────────────────────────────────────────────────────────────
  section("10 · silent set-scope loss (a JOIN dropping 8 of 21 under a total reading 21)");
  control(
    "D10 · I-SET-RECONCILES",
    (a: AnswerUnderTest) => iSetReconciles(a),
    // 12 rows listed, "Positions 21" above them, and NOTHING declaring the list is bounded.
    heroSet({
      members: Array.from({ length: 12 }, (_, i) => ({ key: `S${i}`, title: `Stock ${i}`, figure: "₹1 lakh", figureLabel: "Value", tag: "steady", sortValue: 1 })),
      totals: [{ label: "Positions", value: "21" }], totalAvailable: null, emptyPhrase: "your book is empty",
    }),
    // The honest bounded case: the same truncation, DECLARED. This must stay silent, or the gate
    // would punish "showing 12 of 21" — the very thing that makes truncation honest.
    heroSet({
      members: Array.from({ length: 12 }, (_, i) => ({ key: `S${i}`, title: `Stock ${i}`, figure: "₹1 lakh", figureLabel: "Value", tag: "steady", sortValue: 1 })),
      totals: [{ label: "Positions", value: "21" }], totalAvailable: 21, emptyPhrase: "your book is empty",
    }),
  );

  // ── a control on the controls ─────────────────────────────────────────────────────────────────
  section("11 · the checks are silent on a well-formed answer");
  const good = heroSet({
    members: [{ key: "TCS", title: "TCS", figure: "₹3.72 lakh", figureLabel: "Value", tag: "steady", sortValue: 0.0372 }],
    totals: [{ label: "Positions", value: "1" }], totalAvailable: 1, emptyPhrase: "your book is empty",
  });
  const noise = [iFalseZero, iPlaceholder, iRepeatedLabel, iSetReconciles, iInterpolation, iActionable]
    .flatMap((f) => f(good));
  if (noise.length === 0) { pass++; console.log("  ✅ every invariant is silent on a correct answer — no false-positive floor"); }
  else {
    fail++;
    console.log(`  ❌ ${noise.length} invariant(s) fire on a correct answer:`);
    for (const v of noise) console.log(`       ✗ [${v.invariant}] ${v.detail}`);
  }

  phase1Batch1Controls();

  phase1Batch2Controls();

  phase2Batch1Controls();

  phase2Batch2Controls();

  phase3Controls();

  dealPairControls();

  batchNControls();

  metaBoundaryControls();

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} controls passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ PHASE 3 — THE WINDOW THE READER ASKED FOR.
//
// ⚠ THE HALF THAT WAS MISSING WAS NEVER A WRONG NUMBER. Every series section has always carried a
//   correct `windowLabel`, and nothing has ever been padded or invented. "Show me the last 20 quarters"
//   returned 14 with a correct label and NO SENTENCE SAYING TWENTY WAS ASKED FOR — true, and it leaves
//   the reader to notice the difference by counting. So the broken artefact here is a TRUE one, which
//   is the whole reason the invariant had to be written: nothing else in the harness could see it.
//
// ★ AND THE THIRD CONTROL IS THE ONE THAT MATTERS MOST. An ask that is MET must produce no sentence at
//   all. A check that demanded a window sentence from every answer would fire on the correct case, and
//   `control()` fails it for that — which is how the "resolved window is stated, always" rule stays a
//   statement of fact rather than an apology attached to every answer in the product.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function phase3Controls(): void {
  section("★ PHASE 3 — the resolved window, and the ask it fell short of");

  /** `asked` quarters requested, `drawn` on screen, and whatever the prose actually said. */
  const windowed = (asked: number | null, drawn: number, said: string) => answer({
    askedPeriods: asked,
    sections: [{
      kind: "SERIES", renderer: "phase-shaded-spine",
      payload: { points: Array.from({ length: drawn }, (_, i) => ({ periodKey: `Q${i + 1}`, value: 60 + i })) },
    }],
    prose: { opening: [said], leads: {}, after: {}, close: "" },
  });

  control(
    "I-WINDOW-STATED · 20 quarters asked for, 14 drawn, and only the 14 named",
    iWindowStated,
    windowed(20, 14, "Across the 14 quarters we hold, the composite moved from 61 to 74."),
    windowed(20, 14, "You asked for 20 quarters; there are 14, and they are what is below. Scoring begins in 2023."),
  );
  // ⚠ AND THE ZERO CASE, which is a different sentence and was the one that read worst: an empty chart
  //   under a question that named a window says nothing about the window at all.
  control(
    "I-WINDOW-STATED · a shortfall stated as a bare resolved count, which is the defect in miniature",
    iWindowStated,
    windowed(10, 8, "This covers 8 years."),
    windowed(10, 8, "You asked for 10 years; there are 8, and they are what is below."),
  );
  // ★ THE CONTROL THAT KEEPS THE RULE FROM BECOMING AN APOLOGY. Nothing to say, so nothing is said —
  //   and the "fixed" artefact here is deliberately the SILENT one, because a met ask needs no sentence.
  const met = windowed(4, 4, "The last four quarters are below.");
  if (iWindowStated(met).length === 0) {
    pass++; console.log("  ✅ I-WINDOW-STATED · silent on an ask that is met — no apology on a complete answer");
  } else {
    fail++; console.log("  ❌ I-WINDOW-STATED fires on an ask that IS met — the rule has become an apology");
  }
  // ★ AND ON AN ANSWER THAT NAMED NO WINDOW AT ALL, which is most of them.
  const unasked = windowed(null, 6, "Six filings are on record.");
  if (iWindowStated(unasked).length === 0) {
    pass++; console.log("  ✅ I-WINDOW-STATED · silent where the question named no window — cannot fall short of nothing");
  } else {
    fail++; console.log("  ❌ I-WINDOW-STATED fires where nothing was asked for");
  }
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ DEAL PAIRING — the two legs of one block deal, and the cases that must NOT be paired.
//
// ⚠ THE POINT OF EVERY CONTROL HERE IS THE SECOND HALF. A pairing rule is only worth having if it
//   DECLINES: the reader-facing risk is not a missed pair, it is a fabricated counterparty. So each
//   check has a shape that must pair and a shape that must be left exactly as it arrived.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function dealPairControls(): void {
  section("★ DEAL PAIRING — one deal, two legs (and the pairs that must not be made)");

  // This file's own idiom: `control()` for a broken/fixed pair, and pass/fail directly for a plain
  // assertion. `pairDeals` is a pure function, so each case below IS its own broken-vs-fixed pair.
  const ok = (n: string, c: boolean, d = ""): void => {
    if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); }
    else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); }
  };

  const leg = (o: Partial<DealLeg> & { transactionType: string }): DealLeg => ({
    dealDate: "2026-06-24", dealType: "block", clientName: "ALPHA CAPITAL LTD",
    quantity: "183328", price: 2059.6, valueCr: 37.76, ...o,
  });

  // ── 1 · the TCS shape: same holder, two account codes ──────────────────────────────────────────
  const transfer = pairDeals([
    leg({ transactionType: "buy", clientName: "GPIF FUND MUTB400045794" }),
    leg({ transactionType: "sell", clientName: "GPIF FUND MTBJ400045828" }),
  ]);
  ok("a same-holder pair collapses to ONE row and says ownership did not change",
    transfer.length === 1 && transfer[0]!.legs === 2 && /did not change/.test(transfer[0]!.detail),
    transfer.length === 1 ? transfer[0]!.what : `${transfer.length} rows`);
  ok("...and the account code is stripped from the name it shows",
    transfer[0]?.who === "GPIF FUND", `who="${transfer[0]?.who}"`);

  // ── 2 · a block between two parties NAMES the counterparty ─────────────────────────────────────
  const blockPair = pairDeals([
    leg({ transactionType: "buy", clientName: "BUYER PTE" }),
    leg({ transactionType: "sell", clientName: "SELLER LTD" }),
  ]);
  ok("a two-party BLOCK pair names both sides and asserts the sale",
    blockPair.length === 1 && /SELLER LTD → BUYER PTE/.test(blockPair[0]!.who) && /sold by the first/.test(blockPair[0]!.detail),
    blockPair[0]?.detail.slice(-34) ?? "");

  // ── 3 · ⚠ AND A BULK PAIR MUST NOT SAY "SOLD TO". A bulk row is one client's whole day aggregated,
  //        so an identical aggregate on both sides is strong evidence and not proof of a counterparty.
  const bulkPair = pairDeals([
    leg({ transactionType: "buy", dealType: "bulk", clientName: "BUYER PTE" }),
    leg({ transactionType: "sell", dealType: "bulk", clientName: "SELLER LTD" }),
  ]);
  ok("a two-party BULK pair states the match and claims no counterparty",
    bulkPair.length === 1 && !/sold by/.test(bulkPair[0]!.detail) && /matching sale and purchase/.test(bulkPair[0]!.detail),
    bulkPair[0]?.what ?? "");

  // ── 4 · ⚠⚠ THE CONTROL THAT MATTERS MOST — many-to-many is LEFT ALONE ──────────────────────────
  //        Two buys and two sells at one price is a real shape (AASTHA, ATALREAL) and there is no way
  //        to say which buyer faced which seller. Pairing it would invent a relationship.
  const ambiguous = pairDeals([
    leg({ transactionType: "buy", clientName: "B1" }), leg({ transactionType: "buy", clientName: "B2" }),
    leg({ transactionType: "sell", clientName: "S1" }), leg({ transactionType: "sell", clientName: "S2" }),
  ]);
  ok("a many-to-many group is NOT paired — all four legs survive untouched",
    ambiguous.length === 4 && ambiguous.every((d) => d.legs === 1),
    `${ambiguous.length} rows, legs=${[...new Set(ambiguous.map((d) => d.legs))].join("/")}`);

  // ── 5 · a single-sided disclosure is the common case and must pass straight through ────────────
  const one = pairDeals([leg({ transactionType: "sell", clientName: "ONLY SIDE LTD" })]);
  ok("a single-sided deal is unchanged, tag and all",
    one.length === 1 && one[0]!.legs === 1 && one[0]!.what === "block sell",
    `what="${one[0]?.what}"`);

  // ── 6 · ⚠ AND A PRICE MISMATCH IS NOT A PAIR. Date and quantity alone matched unrelated deals in
  //        the measurement; the price is what makes a coincidence implausible.
  const diffPrice = pairDeals([
    leg({ transactionType: "buy", clientName: "B" }),
    leg({ transactionType: "sell", clientName: "S", price: 2060.1 }),
  ]);
  ok("same day and size but a DIFFERENT price is not paired", diffPrice.length === 2,
    `${diffPrice.length} rows`);

  // ── 7 · and neither is the same day at the same price on a different DATE ──────────────────────
  const diffDate = pairDeals([
    leg({ transactionType: "buy", clientName: "B" }),
    leg({ transactionType: "sell", clientName: "S", dealDate: "2026-06-25" }),
  ]);
  ok("the same size and price on a different DAY is not paired", diffDate.length === 2,
    `${diffDate.length} rows`);
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ BATCH N — the two SENTENCE tests that route N-1 and N-3, and what they must REFUSE.
//
// ⚠ BOTH ANSWERS ARE REACHED ON THE SENTENCE, NOT ON A SLOT, because the slots were measured to be
//   unreliable for them — three live rolls gave `explain·health`, `explain·events` and `compare` with
//   zero subjects for questions that must land in two places. That makes the sentence tests
//   load-bearing, so what they REFUSE matters more than what they accept: a false accept here answers
//   a question about six companies with a different six, or puts one company's evidence under another
//   finding's name.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function batchNControls(): void {
  section("★ BATCH N — the sentence tests behind peers.versus and patterns.finding");
  const ok = (n: string, c: boolean, d = ""): void => {
    if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); }
    else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); }
  };

  // ── N-1 · splitTwoPonds ───────────────────────────────────────────────────────────────────────
  const two: [string, boolean][] = [
    ["compare pharma and FMCG", true],
    ["pharma vs FMCG", true],
    ["large-cap pharma versus large-cap cement", true],
    ["how does pharma compare with NBFCs", true],
    // ⚠ THE REFUSALS. A sentence with no connective is not two ponds, and one pond is not two.
    ["how is the pharma peer group doing", false],
    ["who owns TCS", false],
    ["what has been flagged on TECHM", false],
  ];
  let bad = 0;
  for (const [q, want] of two) if ((splitTwoPonds(q) !== null) !== want) bad++;
  ok("splitTwoPonds accepts the four two-pond shapes and refuses the three others", bad === 0,
    bad === 0 ? `${two.length} cases` : `${bad} wrong`);
  // ★ AND IT MUST NOT SPLIT INTO MORE THAN TWO. "a and b and c" is not a pairwise question, and the
  //   pairwise limit holds until the mechanism supports more.
  ok("three ponds joined by connectives is refused, not truncated to the first two",
    splitTwoPonds("compare pharma and FMCG and cement") === null,
    JSON.stringify(splitTwoPonds("compare pharma and FMCG and cement")));

  // ── N-3 · findingAsked ────────────────────────────────────────────────────────────────────────
  const one: [string, boolean][] = [
    ["why was TCS flagged for Sticky Divergence", true],
    ["what does that flag mean", true],
    ["why is INFY firing Laggard Catching Up", true],
    // ⚠ THE REFUSAL that matters: a sentence with no asking word is not a request to explain one.
    ["TCS Sticky Divergence", false],
    ["show me TCS financials", false],
  ];
  let bad2 = 0;
  for (const [q, want] of one) if (findingAsked(q) !== want) bad2++;
  ok("findingAsked separates an explain-this-one question from a bare mention", bad2 === 0,
    bad2 === 0 ? `${one.length} cases` : `${bad2} wrong`);
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE META BOUNDARY — the guardrail on the one surface where the model writes about real measures.
//
// ⚠ THIS IS THE CHECK THAT MAKES N-1 TRUE OF MODEL PROSE, and it ships in the same change as the
//   surface it guards — not after it. `prosePasses` is `compose/plan.ts`'s, exported and consumed
//   rather than copied (N-5): a second, subtly different copy drifting quietly is the failure it
//   exists to prevent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function metaBoundaryControls(): void {
  section("★ META — the model writes the general half, and nothing else gets through");
  const ok = (n: string, c: boolean, d = ""): void => {
    if (c) { pass++; console.log(`  ✅ ${n}${d ? ` — ${d}` : ""}`); }
    else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ""}`); }
  };

  // ── N-1 · a figure in model prose is refused, however it is written ───────────────────────────
  const figures = [
    "A good ROCE is above 15%.",
    "Typically firms earn 12 to 18 percent.",
    "It is usually around 1.5x for this industry.",
    "Margins of 20 percent are common.",
  ];
  const leaked = figures.filter((t) => prosePasses(t) === null);
  ok("N-1 · no figure survives in model prose", leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.join(" | ")}` : `${figures.length} shapes refused`);

  // ── ★ AND THE OTHER HALF: a clean explanation must be ADMITTED, or the surface never works ────
  const clean = [
    "Return on capital employed shows how much profit a business makes from the money invested in it.",
    "It measures profit against the capital a business uses, which matters because capital is scarce.",
  ];
  const wronglyRefused = clean.filter((t) => prosePasses(t) !== null);
  ok("a clean, figure-free explanation is admitted", wronglyRefused.length === 0,
    wronglyRefused.length ? `refused: ${wronglyRefused[0]}` : "both admitted");

  // ── D-2 · the basis is authored where the reader's prior would be wrong, and NOT everywhere ───
  const withBasis = CANONICAL_METRICS.filter((m) => m.vytalBasis);
  ok("the EBIT/EBITDA split is authored on BOTH sides", 
    Boolean(CANONICAL_METRICS.find((m) => m.key === "F1")?.vytalBasis)
    && Boolean(CANONICAL_METRICS.find((m) => m.key === "F1_OPM")?.vytalBasis),
    "ROCE (post-depreciation) and Operating Margin (EBITDA) both carry a line");
  // ⚠ A BASIS ON EVERY METRIC IS PADDING, and padding is how the one line that matters gets skimmed.
  ok("the basis is NOT authored on metrics whose basis is conventional",
    !CANONICAL_METRICS.find((m) => m.key === "F2")?.vytalBasis
    && !CANONICAL_METRICS.find((m) => m.key === "F4")?.vytalBasis,
    `ROE and D/E carry none; ${withBasis.length} of ${CANONICAL_METRICS.length} metrics carry one`);

  // ⚠ AND NO BASIS STRING MAY CONTAIN A FIGURE — it is prose the reader sees, under the same rule.
  const numeric = withBasis.filter((m) => prosePasses(m.vytalBasis!) !== null);
  ok("no authored basis contains a figure or a threshold", numeric.length === 0,
    numeric.length ? numeric.map((m) => m.key).join(", ") : `${withBasis.length} checked`);
}

main();
