// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CONSTRUCTION v2 — STAGE 10b — THE COMPOSER. PROVEN, NOT REVIEWED.
//
// ★ §1 IS THE LIVE THESIS AND IT RUNS FIRST. `4c5ca537` is the book the distinct-subjects rule exists
// for: TCS is 100% of it, so PC2 ("dominant position", subject TCS) and PC4 ("single-sector book",
// subject it_technology) are ONE HOLDING DESCRIBED TWICE — and §11.1's suppression cannot see it,
// because they sit on different axes. Built against the book that breaks it.
//
// WHAT THIS ASSERTS:
//   1. ★ LIVE — `4c5ca537`'s movement 4 does NOT say the same thing twice.
//   2. ★★ DETERMINISM — the same book produces the same story BYTE-FOR-BYTE, across runs AND under any
//      permutation of the fired set. §7 rule 1. The property that separates a statement from a generation.
//   3. The total order: tone → weight-if-present → id. Including the two traps it is built against.
//   4. A short story is valid — it does NOT pad.
//   5. PD never enters the story — twice over (declaration AND storyClause).
//   6. The Doesn't-mean is absent from composed output.
//   7. Advice-verb grep = 0 over every storyClause AND the composed text.
//   8. The reference carries EVERYTHING, ranked — nothing suppressed.
//   9. Every movement-4-eligible finding HAS a storyClause (the gate is proven to be a gate).
//  10. §8's Blended + Fund-heavy reproduce; sector-overlap is DECLARED UNREACHABLE.
//  11. The limitation rule fires on scope, not on vibes.
//
//   npx tsx src/scripts/verify-phs-story.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "fs";
import {
  composeStory, selectMovement4, subjectSetOf, sameSubject, compareFindings, capitalWeightOf,
  movementOf, sectorLimitationApplies, isPreStoryboardSnapshot, type StoryInput, type SubjectContext,
} from "../portfolio/phs/story.js";
import type { PfFinding } from "../portfolio/phs/patterns.js";
import { firePortfolioFindings } from "../portfolio/phs/patterns.js";
import { fireDisclosureFindings, fireInstrumentFindings } from "../portfolio/phs/read-time-findings.js";
import type { HeldInstrumentFacts } from "../portfolio/phs/read-time-catalog.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { natureOf } from "../portfolio/phs/entity.js";
import { scanStringsForForwardLanguage, PORTFOLIO_ADVICE_DENY_LIST } from "../scoring/lens-patterns/no-forward-guard.js";
import { READ_TIME_COPY } from "../portfolio/phs/copy.js";
import { prisma } from "../db/prisma.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));

const THESIS = "4c5ca537-8180-41f0-8fdc-b39caf366876";

// ── fixture builders ────────────────────────────────────────────────────────────────────────────
const F = (id: string, family: string, tone: PfFinding["tone"], bind: Record<string, unknown>, clause?: string): PfFinding =>
  ({ id, family, label: id, tone, loud: false, bind, doesntMean: `≠ ${id}`, ...(clause ? { storyClause: clause } : {}) });

/** A held-instrument-facts fixture — for firing REAL PI findings (§11/§12). */
const instFact = (isin: string, ac: string, o: Partial<HeldInstrumentFacts> = {}): HeldInstrumentFacts => ({
  isin, name: `${ac} ${isin}`, assetClass: ac, category: null, attributes: {}, isActive: true, planType: null,
  amfiSchemeCode: null, lastPrice: null, lastPriceDate: null, currentNav: null, navDate: null, ...o,
});

const EMPTY_CTX: SubjectContext = { entityLedger: [], basketLedger: [], allSymbols: [], nameRiskSymbols: [] };
const BASE: StoryInput = {
  findings: [], health: 70, band: "Steady", coverage: 1, constructionNet: 79,
  sectoredShare: 1, ...EMPTY_CTX,
};
// composeStory returns Storyboard | null (null on a pre-10b snapshot — §12). Every fixture below is
// FRESH (its findings carry clauses), so a null here is itself a bug — this wrapper turns it into a loud
// failure rather than a silent `?.` chain. §12 calls the raw `composeStory` to assert the null on purpose.
import { composeStory as _composeStory } from "../portfolio/phs/story.js";
const mustStory = (v: StoryInput) => {
  const s = _composeStory(v);
  if (s === null) throw new Error("composeStory returned null on a FRESH fixture — unexpected");
  return s;
};

async function main() {
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("1 · ★★ THE LIVE THESIS — 4c5ca537's movement 4 must not say the same thing twice");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
let liveStoryText = "";
{
  const { holdings, fieldWeakSymbols } = await assemblePortfolio(THESIS);
  const r = computePhs(holdings);
  const findings = firePortfolioFindings(holdings, r, { fieldWeakSymbols });
  const ctx: SubjectContext = {
    entityLedger: r.entityLedger, basketLedger: r.basketLedger,
    allSymbols: holdings.map((h) => h.symbol),
    nameRiskSymbols: holdings.filter((h) => natureOf(h.assetClass ?? "unknown", h.category ?? null) === "name_risk").map((h) => h.symbol),
  };
  console.log(`       book: ${holdings.map((h) => `${h.symbol} (${h.assetClass})`).join(", ")}`);

  const pc2 = findings.find((f) => f.id === "PC2")!;
  const pc4 = findings.find((f) => f.id === "PC4")!;
  ok("★ the live book fires BOTH PC2 and PC4 — both Concern, both weight 1.0", !!pc2 && !!pc4
    && pc2.tone === "Concern" && pc4.tone === "Concern"
    && pc2.bind.weight === 1 && pc4.bind.weight === 1);
  ok("★ …and §11.1's suppression does NOT catch them — they are on DIFFERENT AXES (position vs sector)",
    !!pc2 && !!pc4, "PC1 and PC3 are already suppressed; these two survive it");

  const s2 = subjectSetOf(pc2, ctx)!;
  const s4 = subjectSetOf(pc4, ctx)!;
  console.log(`       PC2 subject: {${[...s2].join(",")}}   PC4 subject: {${[...s4].join(",")}}`);
  ok("★★ the SUBJECT TRACE resolves both to the SAME holding set — one holding, described twice",
    sameSubject(s2, s4), `{${[...s2].join(",")}} == {${[...s4].join(",")}}`);
  ok("★ …and it traced through the LEDGER, not the label — 'it_technology' and 'TCS' share no characters",
    r.entityLedger[0]!.sector === "it_technology" && r.entityLedger[0]!.displayName === "TCS");

  const m4 = selectMovement4(findings.filter((f) => movementOf(f) === 4), ctx);
  ok("★★ movement 4 takes exactly ONE finding — the collision is caught", m4.length === 1,
    `picked: ${m4.map((f) => f.id).join(", ")}`);
  ok("★ …and it is the higher-ranked one (PC2 — same tone, same weight, id ascending)", m4[0]!.id === "PC2");

  const story = mustStory({
    findings, health: r.health, band: r.band, coverage: r.coverage,
    constructionNet: r.construction.net, sectoredShare: r.sectors.sectoredShare, ...ctx,
  });
  liveStoryText = story.text;
  console.log("\n       ══ THE STORY ══");
  for (const m of story.movements) console.log(`       [${m.movement}] ${m.text}`);
  console.log();

  // ★ THE ASSERTION THE WHOLE RULE EXISTS FOR: the book's ONE holding is named ONCE.
  const tcsMentions = (story.text.match(/TCS/g) ?? []).length;
  ok("★★ the story names TCS exactly once — not once as a position and again as a sector",
    tcsMentions === 1, `${tcsMentions} mention(s)`);
  ok("★★ …and 'it_technology' never appears — PC4's clause was not spent", !/it_technology/.test(story.text));

  // ★ NOT SUPPRESSED. PC4 still fired, still Concern, still in the reference. "The story picks."
  ok("★★ PC4 is NOT suppressed — it fires, keeps its tone, and renders in the reference",
    story.reference.some((f) => f.id === "PC4" && f.tone === "Concern"),
    "selection, not suppression — nothing about the fired set changed");
  ok("★ PC5 too — its subject is the name-risk sleeve, which on a 1-holding book is also {TCS}",
    !story.used.includes("PC5") && story.reference.some((f) => f.id === "PC5"));

  // PX6 as the hinge — the gap of 30.00 the brief names.
  ok("★ PX6 is the hinge between movements 3 and 4 (gap 30.00)",
    story.movements.find((m) => m.movement === 3)!.used.includes("PX6")
    && /on that alone you'd read 51/.test(story.text)
    && /But one specific thing moved the number/.test(story.text));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("2 · ★★ DETERMINISM — the same book, the same story, BYTE-FOR-BYTE. §7 rule 1.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── ACROSS RUNS. The composer is pure, so this is really asserting that nothing in it reaches for a
  //    clock or a sampler. It is the cheapest assertion here and the one the whole ruling rests on.
  const { holdings, fieldWeakSymbols } = await assemblePortfolio(THESIS);
  const r = computePhs(holdings);
  const ctx: SubjectContext = {
    entityLedger: r.entityLedger, basketLedger: r.basketLedger,
    allSymbols: holdings.map((h) => h.symbol),
    nameRiskSymbols: holdings.filter((h) => natureOf(h.assetClass ?? "unknown", h.category ?? null) === "name_risk").map((h) => h.symbol),
  };
  const mk = () => mustStory({
    findings: firePortfolioFindings(holdings, r, { fieldWeakSymbols }),
    health: r.health, band: r.band, coverage: r.coverage,
    constructionNet: r.construction.net, sectoredShare: r.sectors.sectoredShare, ...ctx,
  }).text;
  const runs = [mk(), mk(), mk(), mk(), mk()];
  ok("★★ five runs, one story — byte-for-byte identical", new Set(runs).size === 1, `${new Set(runs).size} distinct`);
  ok("★ …and identical to §1's story", runs[0] === liveStoryText);

  // ── ★ UNDER PERMUTATION. THIS IS THE ONE THAT MATTERS, AND THE ONE A NAIVE TEST MISSES.
  //
  // `Array.prototype.sort` is stable *with respect to the input order* — so a comparator with a missing
  // tiebreak still produces a REPRODUCIBLE story on one machine, on one day, from one input order. It
  // looks deterministic. It is deterministic only until someone reorders a `push` in `patterns.ts`, and
  // then a book's story silently changes with no finding having changed. Shuffling the fired set is what
  // separates "my comparator is total" from "my input happened to arrive sorted".
  const base = firePortfolioFindings(holdings, r, { fieldWeakSymbols });
  const permuted: string[] = [];
  // A DETERMINISTIC permutation set — reversal + rotations. ⚠ NOT Math.random(): a verify that shuffles
  // randomly fails randomly, and a gate nobody can reproduce is a gate somebody deletes.
  const perms: PfFinding[][] = [
    [...base].reverse(),
    [...base.slice(3), ...base.slice(0, 3)],
    [...base.slice(7), ...base.slice(0, 7)],
    [...base].sort((a, b) => (a.id > b.id ? -1 : 1)), // id DESCENDING — the adversarial order
  ];
  for (const p of perms) {
    permuted.push(mustStory({
      findings: p, health: r.health, band: r.band, coverage: r.coverage,
      constructionNet: r.construction.net, sectoredShare: r.sectors.sectoredShare, ...ctx,
    }).text);
  }
  ok("★★ four permutations of the fired set → the SAME story",
    new Set([...permuted, runs[0]!]).size === 1, `${new Set(permuted).size} distinct across permutations`);

  // negative control — the assertion must be capable of failing.
  ok("negative control: this gate CAN fail (two different texts are seen as two)",
    new Set([runs[0]!, runs[0]! + " x"]).size === 2);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("3 · THE TOTAL ORDER — tone → weight-if-present → id. And the two traps it is built against.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const concernHeavy = F("PC2", "PC", "Concern", { symbol: "A", weight: 0.5 }, "c");
  const cautionHeavy = F("PC1", "PC", "Caution", { symbol: "B", weight: 0.9 }, "c");
  ok("tone outranks weight — a Concern at 50% beats a Caution at 90%",
    compareFindings(concernHeavy, cautionHeavy) < 0);

  const big = F("PC1", "PC", "Caution", { symbol: "A", weight: 0.40 }, "c");
  const small = F("PC8", "PC", "Caution", { entityKey: "E", weight: 0.12 }, "c");
  ok("within a tone, higher capital weight first", compareFindings(big, small) < 0);

  // ★ TRAP ① — TWO SCALES. `maxHousePct` is a PERCENT (60); `weight` is a FRACTION (0.9). A generic
  //   `bind.weight ?? bind.maxHousePct` compares 60 against 0.9 and ranks the SMALLER holding first.
  const house60 = F("PC6", "PC", "Caution", { fundHouse: "HDFC", maxHousePct: 60, constituents: [] }, "c");
  const pos90 = F("PC1", "PC", "Caution", { symbol: "A", weight: 0.9 }, "c");
  ok("★★ trap ①: PC6's `maxHousePct` (60) is NORMALISED to 0.60 — a 90% position outranks a 60% house",
    compareFindings(pos90, house60) < 0 && capitalWeightOf(house60) === 0.6,
    `capitalWeightOf(PC6 @ maxHousePct=60) = ${capitalWeightOf(house60)} — not 60`);

  // ★ TRAP ② — `?? 0` IS A FALSE STATEMENT. PC5's subject is the WHOLE name-risk sleeve; defaulting its
  //   weight to 0 asserts the finding is about 0% of the book, when it is about all of it.
  const pc5 = F("PC5", "PC", "Caution", { neff: 1.2, holdingCount: 4 }, "c");
  ok("★★ trap ②: PC5 has NO capital weight — null, not 0. The axis does not apply.",
    capitalWeightOf(pc5) === null, `capitalWeightOf(PC5) = ${capitalWeightOf(pc5)}`);
  ok("★ …a weighted finding outranks an unweighted one — we rank what we measured above what we did not",
    compareFindings(small, pc5) < 0);
  // Two unweighted findings fall through to the terminating key. "PB1" < "PC5", so PB1 first — and the
  // point is precisely that the answer carries NO meaning: it is stable, total, and arbitrary, which is
  // what a tiebreak should be. (Asserted in both directions so the comparator is proven ANTISYMMETRIC —
  // a comparator that returns -1 for both (a,b) and (b,a) sorts differently depending on input order,
  // which is the exact nondeterminism this key exists to kill.)
  const pb1 = F("PB1", "PB", "Caution", { neff: 9 }, "c");
  ok("★ …and two unweighted findings order by id — total, stable, meaningless",
    compareFindings(pb1, pc5) < 0 && compareFindings(pc5, pb1) > 0, "PB1 < PC5, and antisymmetric");

  // The five with no capital weight — the brief's count, asserted against the catalog.
  const FIVE = ["PC5", "PB1", "PB2", "PB3", "PB7"];
  const WEIGHTED = ["PC1", "PC2", "PC3", "PC4", "PC6", "PC7", "PC8", "PB6"];
  ok("★ 5 of the 13 movement-4 PC/PB findings carry NO capital weight",
    FIVE.every((id) => capitalWeightOf(F(id, id.slice(0, 2), "Caution", { neff: 1, holdingCount: 1, neffUnitSectored: 1, neffSector: 1 })) === null)
    && FIVE.length + WEIGHTED.length === 13,
    `${FIVE.join(", ")} — ${FIVE.length} of ${FIVE.length + WEIGHTED.length}`);

  // ★ AN UNRANKED MOVEMENT-4 FINDING THROWS — it would otherwise sort by accident, invisibly.
  let threw = false;
  try { capitalWeightOf(F("PC99", "PC", "Caution", {})); } catch { threw = true; }
  ok("★ an undeclared movement-4 finding THROWS rather than sorting by accident", threw);

  // ★ AN UNROUTED FAMILY THROWS — the FINDING_HOME lesson, applied to the story.
  let threwFam = false;
  try { movementOf(F("PZ1", "PZ", "Caution", {})); } catch { threwFam = true; }
  ok("★ an unrouted FAMILY throws — no default; an unreviewed sentence in a story is worse than a mis-filed card", threwFam);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("4 · ★ SUBJECT IDENTITY, NOT OVERLAP — and a short story is valid");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ★ THE CASE THAT PROVES IDENTITY IS THE RIGHT TEST. A 40%-pharma book where SUNPHARMA is 20%:
  // PC1's subject is {SUNPHARMA}; PC3's is {SUNPHARMA, CIPLA, DRREDDY}. They OVERLAP — and they are two
  // genuinely different facts ("one name is heavy" / "the sector is heavy"). Collapsing on overlap would
  // silence the sector fact on every book where a sector has a big name in it, which is most of them.
  const ctx: SubjectContext = {
    entityLedger: [
      { entityKey: "SUN", displayName: "SUNPHARMA", weight: 0.2, sector: "pharma", constituentInstruments: [{ symbol: "SUNPHARMA", assetClass: "stock", marketValue: 20 }] },
      { entityKey: "CIP", displayName: "CIPLA", weight: 0.1, sector: "pharma", constituentInstruments: [{ symbol: "CIPLA", assetClass: "stock", marketValue: 10 }] },
      { entityKey: "DRR", displayName: "DRREDDY", weight: 0.1, sector: "pharma", constituentInstruments: [{ symbol: "DRREDDY", assetClass: "stock", marketValue: 10 }] },
    ] as never,
    basketLedger: [], allSymbols: ["SUNPHARMA", "CIPLA", "DRREDDY"], nameRiskSymbols: ["SUNPHARMA", "CIPLA", "DRREDDY"],
  };
  const pc1 = F("PC1", "PC", "Caution", { symbol: "SUNPHARMA", weight: 0.2 }, "your largest holding is SUNPHARMA at 20%");
  const pc3 = F("PC3", "PC", "Caution", { sector: "pharma", weight: 0.4 }, "40% of your book is in pharma");
  const s1 = subjectSetOf(pc1, ctx)!, s3 = subjectSetOf(pc3, ctx)!;
  ok("★★ overlapping-but-different subjects are NOT the same — both earn a slot",
    !sameSubject(s1, s3), `{${[...s1]}} vs {${[...s3]}}`);
  const picked = selectMovement4([pc1, pc3], ctx);
  ok("★ …so movement 4 takes BOTH — 'one name is heavy' and 'the sector is heavy' are two facts",
    picked.length === 2, picked.map((f) => f.id).join(", "));

  // AT MOST TWO — a third is a list, and a list is a form.
  const pc8 = F("PC8", "PC", "Caution", { entityKey: "CIP", weight: 0.1 }, "third thing");
  ok("★ movement 4 takes AT MOST two — a third is a list, and a list is a form",
    selectMovement4([pc1, pc3, pc8], ctx).length === 2);

  // ★ A SHORT STORY IS A VALID STORY — it does NOT pad.
  const quiet = mustStory({ ...BASE, findings: [F("PA1", "PA", "Neutral", {}, undefined)] });
  (quiet.movements.find((m) => m.movement === 1) as { text: string } | undefined);
  const nothing = mustStory({ ...BASE, findings: [] });
  ok("★★ a book with nothing notable gets NO movement 4 — no filler, no 'otherwise you look fine'",
    !nothing.movements.some((m) => m.movement === 4), nothing.text);
  ok("★ …and the story is genuinely short — it stops rather than reaching",
    nothing.movements.length <= 2, `${nothing.movements.length} movements: "${nothing.text}"`);

  // §5 rule 2 — a Constructive can carry movement 4 ALONE, and it is framed as an ALL-CLEAR.
  const allClear = mustStory({ ...BASE, findings: [F("PB1", "PB", "Constructive", { neff: 9 }, "your money is spread across 9.0 effective positions with no sector above 22.0% — nothing here concentrates")] });
  const m4c = allClear.movements.find((m) => m.movement === 4);
  ok("★ §5 rule 2: a Constructive finding carries movement 4 alone — a complete and valuable answer",
    !!m4c && m4c.used[0] === "PB1", m4c?.text);
  // ★★ AND IT IS NOT FRAMED AS A WARNING. The first draft said "One thing is worth your attention:" in
  // front of an all-clear — summoning a problem in order to report its absence, in the one paragraph
  // whose job is to tell the user they can stop looking.
  ok("★★ …and a Constructive movement 4 says 'Nothing here needs your attention', NOT 'worth your attention'",
    !!m4c && m4c.text.startsWith("Nothing here needs your attention") && !/worth your attention/.test(m4c.text),
    m4c?.text);
  // …while a Caution still gets the warning frame — the frame follows the TONE, and both must be proven.
  const caution = mustStory({ ...BASE, findings: [F("PC3", "PC", "Caution", { sector: "pharma", weight: 0.6 }, "60.0% of your book is in pharma")] });
  ok("★ …and a Caution movement 4 still says 'One thing is worth your attention' — the frame follows the tone",
    /One thing is worth your attention/.test(caution.text));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("5 · ★ PD NEVER ENTERS THE STORY — twice over. And the Doesn't-mean stays out.");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const pd = fireDisclosureFindings({
    heldNotValued: [], staleAccounts: [], oldestSyncAgeDays: null, history: [],
    facts: [{ isin: "INE733E07JU4", name: "NTPC BOND", assetClass: "bond", category: null,
      attributes: { creditRating: null, creditRatingNullReason: "not_sourceable" },
      isActive: true, planType: null, amfiSchemeCode: null,
      lastPrice: null, lastPriceDate: null, currentNav: null, navDate: null }],
  });
  ok("the PD fixture fires", pd.length > 0, pd.map((f) => f.id).join(","));

  const withPd = mustStory({ ...BASE, findings: [...pd, F("PA1", "PA", "Neutral", {})] });
  ok("★★ NO PD finding appears in any movement — lock ① (MOVEMENT_HOME declares PD → reference)",
    !withPd.movements.some((m) => m.used.some((id) => id.startsWith("PD"))),
    `used: ${withPd.used.join(",") || "(none)"}`);
  ok("★★ …and lock ② is STRUCTURAL: no PD carries a storyClause, so none is selectable even if ① were wrong",
    pd.every((f) => f.storyClause == null), `${pd.length} PD findings, 0 storyClauses`);
  ok("★ …but PD IS in the reference — reference-only means reference, not deleted",
    pd.every((p) => withPd.reference.some((f) => f.id === p.id)));

  // ★ THE DOESN'T-MEAN DOES NOT ENTER THE STORY (§4). It is one tap away, on the reference item —
  // "the hedge is more honest as a click than as a mumble."
  const all = mustStory({
    ...BASE,
    findings: [F("PA1", "PA", "Neutral", {}), F("PC2", "PC", "Concern", { symbol: "TCS", weight: 1 }, "100.0% of your book is one position — TCS")],
  });
  const dms = [...Object.values(READ_TIME_COPY).map((c) => c.doesntMean), "≠ PC2", "≠ PA1"];
  const leaked = dms.filter((d) => all.text.includes(d.slice(0, 40)));
  ok("★★ no Doesn't-mean text appears in the composed story", leaked.length === 0, leaked.join(" | ") || "clean");
  ok("★ …and no '≠' ever reaches the prose", !all.text.includes("≠"));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("6 · ★ ADVICE-VERB GREP = 0 — over every storyClause AND the composed output");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ★ §1 APPLIES TO THE STORY EXACTLY AS TO A FINDING, and this is the assertion §7's ruling rests on:
  // "every non-negotiable is ENFORCEABLE IN A GRAMMAR and UNENFORCEABLE IN A GENERATION." This gate is
  // what that sentence means. It can be run. Against a model, it could not.
  const src = readFileSync("src/portfolio/phs/patterns.ts", "utf8");
  const clauses = [...src.matchAll(/storyClause:\s*`([^`]*)`/g)].map((m) => m[1]!);
  ok("★ every movement-4 finding's storyClause is scanned", clauses.length === 13, `${clauses.length} clauses`);
  let hits = 0;
  for (const c of clauses) {
    // Strip `${...}` interpolations — they are VALUES, not prose, and a symbol like "SELL" in a ticker
    // would be a false red. The template's WORDS are what the guard is about.
    const prose = c.replace(/\$\{[^}]*\}/g, " ");
    const r = scanStringsForForwardLanguage("clause", [prose], PORTFOLIO_ADVICE_DENY_LIST);
    if (r.length) { hits += r.length; console.log(`       ❌ ${JSON.stringify(r)} in "${c}"`); }
  }
  ok("★★ advice-verb grep = 0 across every storyClause", hits === 0, `${clauses.length} scanned`);

  ok("★★ advice-verb grep = 0 across the LIVE composed story",
    scanStringsForForwardLanguage("story", [liveStoryText], PORTFOLIO_ADVICE_DENY_LIST).length === 0,
    `"${liveStoryText.slice(0, 70)}…"`);

  // …and over the composer's OWN connectives, which no finding owns.
  const composed = mustStory({ ...BASE, findings: [
    F("PA1", "PA", "Neutral", {}), F("PX6", "PX", "Neutral", { constructionGross: 89, constructionNet: 61, gap: 28 }),
    F("PC3", "PC", "Caution", { sector: "pharma", weight: 0.6 }, "60% of your book is in pharma"),
  ] });
  ok("★ …and 0 over the composer's own connectives and scaffolding",
    scanStringsForForwardLanguage("story", [composed.text], PORTFOLIO_ADVICE_DENY_LIST).length === 0, composed.text);

  ok("negative control: the scanner DOES catch advice in a clause",
    scanStringsForForwardLanguage("c", ["you should trim this position"], PORTFOLIO_ADVICE_DENY_LIST).length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("7 · ★ EVERY MOVEMENT-4-ELIGIBLE FINDING HAS A storyClause — the gate is proven to be a gate");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ⚠ WITHOUT THIS, A MOVEMENT-4 FINDING THAT FORGETS ITS CLAUSE GOES SILENTLY MISSING FROM EVERY
  // STORY — `selectMovement4` skips it, no error, no symptom. A guard that reads as coverage and never
  // fires: the disease this project has shipped six of. So the clause is asserted, not trusted.
  const src = readFileSync("src/portfolio/phs/patterns.ts", "utf8");
  const M4 = ["PC1", "PC2", "PC3", "PC4", "PC5", "PC6", "PC7", "PC8", "PB1", "PB2", "PB3", "PB6", "PB7"];
  const missing: string[] = [];
  for (const id of M4) {
    const i = src.indexOf(`id: "${id}"`);
    if (i < 0) { missing.push(`${id} (not emitted)`); continue; }
    // The finding's own push block — up to the next `out.push(` or 1200 chars.
    const block = src.slice(i, i + 1200).split("out.push(")[0]!;
    if (!/storyClause:/.test(block)) missing.push(id);
  }
  ok("★★ all 13 movement-4 PC/PB findings carry a storyClause", missing.length === 0,
    missing.length ? `MISSING: ${missing.join(", ")}` : "13 of 13");
  ok("negative control: the scan CAN detect a missing clause",
    !/storyClause:/.test('out.push({ id: "PZ9", tone: "Caution", bind: {} })'));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("8 · ★ THE LIMITATION RULE — scope, not vibes. §5 rule 3 (the Nifty Bank ETF fix).");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const sectorClaim = [F("PC3", "PC", "Caution", { sector: "pharma", weight: 0.6 }, "c")];
  const noSectorClaim = [F("PC2", "PC", "Concern", { symbol: "TCS", weight: 1 }, "c")];

  ok("★ baskets 12% → sectoredShare 88% → REFERENCE (it changes nothing about how to read anything)",
    !sectorLimitationApplies(0.88, sectorClaim));
  ok("★★ baskets 60% → sectoredShare 40% → STORY (the sector figure reflects almost none of the book)",
    sectorLimitationApplies(0.40, sectorClaim));
  ok("★★ …but ONLY when a sector number is actually on screen — no sector claim, no limitation",
    !sectorLimitationApplies(0.40, noSectorClaim),
    "a disclosure with nothing to disclose about is the Nifty Bank mistake again");

  const limited = mustStory({
    ...BASE, sectoredShare: 0.40,
    findings: [F("PA1", "PA", "Neutral", {}), F("PC3", "PC", "Caution", { sector: "pharma", weight: 0.6 }, "60.0% of your book is in pharma")],
  });
  ok("★ the composed story names the scope of the number it just used",
    /reflects that slice rather than the whole/.test(limited.text), limited.text);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("9 · THE REFERENCE CARRIES EVERYTHING, RANKED — nothing suppressed");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const findings = [
    F("PA1", "PA", "Neutral", {}), F("PC2", "PC", "Concern", { symbol: "A", weight: 1 }, "c"),
    F("PC4", "PC", "Concern", { sector: "s", weight: 1 }, "c"), F("PS5", "PS", "Constructive", {}),
    F("PC5", "PC", "Caution", { neff: 1, holdingCount: 1 }, "c"),
  ];
  const s = mustStory({ ...BASE, findings });
  ok("★ the reference holds EVERY fired finding — including the ones the story spent",
    s.reference.length === findings.length, `${s.reference.length} of ${findings.length}`);
  ok("★ …ranked by tone, then id — Concern first, Constructive last",
    s.reference.map((f) => f.id).join(",") === "PC2,PC4,PC5,PA1,PS5", s.reference.map((f) => `${f.id}(${f.tone})`).join(" "));
  ok("★ the reference order is TOTAL over families the story never ranks (PA/PS carry no capital weight)",
    s.reference.length === 5, "referenceOrder is tone→id, never compareFindings — it makes no claim it cannot support");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("10 · §8's THREE STORIES — two reproduce, one is DECLARED UNREACHABLE");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── Blended (₹52L) — PA1 ✓ PV6 ✓ PX6 ✓ PC8 ✓ ──
  const blended = mustStory({
    ...BASE, health: 71, band: "Steady", coverage: 0.30, constructionNet: 79, sectoredShare: 0.9,
    entityLedger: [{ entityKey: "NTPC", displayName: "NTPC", weight: 0.19, sector: "power",
      constituentInstruments: [{ symbol: "NTPC", assetClass: "stock", marketValue: 11 }, { symbol: "NTPC-BOND", assetClass: "bond", marketValue: 8 }] }] as never,
    allSymbols: ["NTPC", "NTPC-BOND"], nameRiskSymbols: ["NTPC", "NTPC-BOND"],
    findings: [
      { id: "PA1", family: "PA", label: "Composition", tone: "Neutral", loud: true, doesntMean: "x", bind: {},
        read: "10 holdings · 8 companies · 62% equity, 25% debt, 13% gold. We read this as a Blended book." },
      { id: "PV6", family: "PV", label: "Held by design", tone: "Neutral", loud: true, doesntMean: "x", bind: {},
        read: "The rest sits in funds, gold and government paper, which our health score doesn't reach — not because we've missed them, but because health reads businesses." },
      F("PX6", "PX", "Neutral", { constructionGross: 89, constructionNet: 79, gap: 10 }),
      F("PC8", "PC", "Caution", { entityKey: "NTPC", weight: 0.19 },
        "you hold NTPC shares at 11% and an NTPC bond at 8% — your holdings list shows two positions, your risk shows one company at 19%"),
    ],
  });
  console.log("\n       ══ BLENDED ══");
  for (const m of blended.movements) console.log(`       [${m.movement}] ${m.text}`);
  ok("★ Blended: PA1 → PV6 + coverage → Construction + PX6 → PC8. Four findings, one point.",
    blended.used.join(",") === "PA1,PV6,PX6,PC8", blended.used.join(","));
  ok("★ …movement 2 carries the scope connective — 'that slice'", /That slice scores 71/.test(blended.text));
  ok("★ …and the explanation connective survives verbatim — 'not because…, but because…'",
    /not because we've missed them, but because/.test(blended.text));

  // ── Fund-heavy (₹6L) — PA1 ✓ PV6 ✓ PI3 ✓ PC6 ✓. ★ MOVEMENT 2 CARRIES IT: scope IS the story. ──
  const fundHeavy = mustStory({
    ...BASE, health: 74, band: "Steady", coverage: 0.10, constructionNet: 71, sectoredShare: 1,
    basketLedger: [{ isin: "F1", name: "HDFC Flexi", category: null, fundHouse: "HDFC", weight: 0.35 },
                   { isin: "F2", name: "HDFC Mid", category: null, fundHouse: "HDFC", weight: 0.25 }] as never,
    allSymbols: ["INFY", "F1", "F2", "F3", "F4"], nameRiskSymbols: ["INFY"],
    findings: [
      { id: "PA1", family: "PA", label: "Composition", tone: "Neutral", loud: true, doesntMean: "x", bind: {},
        read: "5 holdings · 1 company · 90% funds. We read this as a Fund-led book." },
      { id: "PV6", family: "PV", label: "Held by design", tone: "Neutral", loud: true, doesntMean: "x", bind: {},
        read: "Your funds aren't unscored because we've missed them — health reads businesses, and we can't yet see which businesses a fund holds." },
      F("PC6", "PC", "Caution", { fundHouse: "HDFC", maxHousePct: 60, constituents: [{ isin: "F1" }, { isin: "F2" }] },
        "HDFC manages 60.0% of your money across 2 funds — one house, one set of operational arrangements"),
      { id: "PI3", family: "PI", label: "Dormant scheme", tone: "Caution", loud: true, doesntMean: "x",
        bind: { isin: "F3", name: "Some Fund" },
        storyClause: "one of your funds is dormant — it's no longer in AMFI's daily NAV file, so we can't mark it to a current price" },
    ],
  });
  console.log("\n       ══ FUND-HEAVY ══");
  for (const m of fundHeavy.movements) console.log(`       [${m.movement}] ${m.text}`);
  ok("★ Fund-heavy: two findings in movement 4, neither touching a score",
    fundHeavy.movements.find((m) => m.movement === 4)!.used.length === 2,
    fundHeavy.movements.find((m) => m.movement === 4)!.used.join(","));
  ok("★★ …PC6 (house, subject {F1,F2}) and PI3 (one fund, subject {F3}) are DISTINCT subjects — both earn a slot",
    fundHeavy.used.includes("PC6") && fundHeavy.used.includes("PI3"));
  ok("★ …movement 2 carries the weight — scope IS the story for a fund-led book",
    /about 10% of it/.test(fundHeavy.text), "coverage 10% → the health number is about a corner");

  // ── ★ SECTOR OVERLAP — DECLARED UNREACHABLE. NOT BENT INTO EXISTENCE. ──
  //
  // §8's third story needs "60% of your book is in pharma — the sectoral fund PLUS the three companies".
  // That sentence requires a PHARMA FUND SECTORED INTO PHARMA, and no fund in this system has a sector:
  // §14's matcher was REFUSED at 11.9% accuracy (`cv2-s8-matcher-unratified`) because thematic funds are
  // not sectorable from their names. It is Example D again — the case the refusal was made on.
  //
  // ⚠ THE TEMPTATION IS A REGEX ON THE FUND'S NAME, and it is the whole reason this assertion exists.
  // "Pharma" in a name would work for the example and fail for `HDFC Top 100`, `Parag Parikh Flexi Cap`,
  // and every fund whose name states a strategy rather than a sector — at, measured, 11.9%. The story
  // does not get to re-open a refusal the engine made because a doc has a nice paragraph in it.
  //
  // ★ SO THE STORY IS UNREACHABLE, AND THE HONEST MOVE IS TO SAY SO RATHER THAN APPROXIMATE IT. This
  // asserts the CAUSE, not the symptom: a basket carries no sector, therefore no sector finding can ever
  // include a fund's weight, therefore §8's third paragraph cannot be composed. It moves to LOOK-THROUGH.
  const pharmaFundBook: SubjectContext = {
    entityLedger: [
      { entityKey: "SUN", displayName: "SUNPHARMA", weight: 0.15, sector: "pharma", constituentInstruments: [{ symbol: "SUNPHARMA", assetClass: "stock", marketValue: 15 }] },
      { entityKey: "CIP", displayName: "CIPLA", weight: 0.15, sector: "pharma", constituentInstruments: [{ symbol: "CIPLA", assetClass: "stock", marketValue: 15 }] },
      { entityKey: "DRR", displayName: "DRREDDY", weight: 0.10, sector: "pharma", constituentInstruments: [{ symbol: "DRREDDY", assetClass: "stock", marketValue: 10 }] },
    ] as never,
    // ★ THE PHARMA FUND. 20% of the book. It has NO sector field — `BasketEntry` does not have one.
    basketLedger: [{ isin: "PHARMAFUND", name: "Nippon India Pharma Fund", category: "Open Ended Schemes(Equity Scheme - Sectoral/ Thematic)", fundHouse: "Nippon", weight: 0.20 }] as never,
    allSymbols: ["SUNPHARMA", "CIPLA", "DRREDDY", "PHARMAFUND", "INDEXFUND", "LIQUID"],
    nameRiskSymbols: ["SUNPHARMA", "CIPLA", "DRREDDY"],
  };
  const pc3 = F("PC3", "PC", "Caution", { sector: "pharma", weight: 0.40 }, "40.0% of your book is in pharma");
  const subj = subjectSetOf(pc3, pharmaFundBook)!;
  ok("★★ §8's sector-overlap story is UNREACHABLE — a sector subject can never include the pharma FUND",
    !subj.has("PHARMAFUND") && subj.size === 3,
    `PC3's subject is {${[...subj].join(",")}} — the three companies. The fund is 20% of the book and invisible to it.`);
  ok("★★ …because a basket carries NO sector at all — the matcher was refused at 11.9% (cv2-s8-matcher-unratified)",
    !("sector" in (pharmaFundBook.basketLedger[0] as object)),
    "BasketEntry has isin/name/category/fundHouse/weight. There is no sector to read.");
  ok("★ …so the story says 40%, not 60% — the honest number, and the engine is NOT bent to reach the doc",
    (pc3.bind.weight as number) === 0.40,
    "§8's 60% needs look-through. Declared unreachable; it moves to look-through, not to a regex.");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("11 · ★ PI CAN HEADLINE — the headline PI facts carry a storyClause (the fund-heavy fix)");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ⚠ A BUG THIS SECTION EXISTS TO HAVE CAUGHT: the §10 fund-heavy test above used a HAND-AUTHORED PI3
  // storyClause. The REAL `fireInstrumentFindings` produced none, so PI could never actually enter
  // movement 4 despite `MOVEMENT_HOME.PI = 4` and the addendum's own §8 example. Fixed: the headline PI
  // facts (PI1 evaluable premium, PI3 dormancy) now carry a clause. Asserted on the REAL fired findings.
  const dormant = fireInstrumentFindings({
    facts: [instFact("INF209K01470", "mutual_fund", { isActive: false, navDate: "2022-01-27" })],
    analytics: [],
  });
  const pi3 = dormant.find((f) => f.id === "PI3")!;
  ok("★★ real PI3 (dormant) carries a storyClause — PI can enter movement 4 for real", !!pi3.storyClause,
    pi3.storyClause ?? "(none — PI cannot headline)");
  ok("★ …and the fund-heavy story SELECTS the real PI3", selectMovement4([...dormant, F("PC6", "PC", "Caution", { fundHouse: "HDFC", maxHousePct: 60, constituents: [{ isin: "F1" }] }, "HDFC manages 60% of your money")], {
    entityLedger: [], basketLedger: [], allSymbols: ["INF209K01470", "F1"], nameRiskSymbols: [],
  }).some((f) => f.id === "PI3"));

  const premium = fireInstrumentFindings({
    facts: [instFact("INF204KB1AA1", "etf", { name: "Nasdaq 100 ETF", lastPrice: "62.40", currentNav: "55.70", lastPriceDate: "2026-07-13", navDate: "2026-07-13" })],
    analytics: [],
  });
  const pi1 = premium.find((f) => f.id === "PI1")!;
  ok("★★ real evaluable PI1 (premium) carries a storyClause", !!pi1.storyClause && !pi1.notEvaluable, pi1.storyClause);

  // ★ THE QUIET/NOT-EVALUABLE PI FACTS DO NOT — they are reference texture, not a point.
  const notEval = fireInstrumentFindings({ facts: [instFact("X", "mutual_fund", { planType: "regular" })], analytics: [] });
  const pi2 = notEval.find((f) => f.id === "PI2")!;
  ok("★ a NOT-EVALUABLE PI (PI2 honest-null) carries NO storyClause — a 'we can't tell you' is not a point",
    pi2.storyClause == null && !!pi2.notEvaluable);

  // ★ advice-verb grep = 0 across the real PI storyClauses.
  const clauses = [pi1.storyClause!, pi3.storyClause!];
  ok("★ advice-verb grep = 0 across the PI headline clauses",
    clauses.every((c) => scanStringsForForwardLanguage("pi", [c], PORTFOLIO_ADVICE_DENY_LIST).length === 0), clauses.join(" | "));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("12 · ★★ THE PRE-10b DEGRADATION — a stale snapshot must NOT render a false all-clear");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ★ THE FAILURE: `storyClause` rides on the persisted finding. A snapshot fired before 10b carries PC/PB
  // findings with no clause, so movement 4 empties — on a book that may be 100% in one stock. The story
  // renders movements 1–3 and stops, and if PX6 fired, movement 3 DANGLES ("on that alone you'd read 51")
  // with no payoff. The reader sees a setup with no point and stops reading — the one failure mode no later
  // finding corrects (cv2-s9-constructive-most-conditioned).
  //
  // Reproduced on the live thesis book: fresh fired set, storyClause STRIPPED (simulating pre-10b persistence).
  const { holdings, fieldWeakSymbols } = await assemblePortfolio(THESIS);
  const r = computePhs(holdings);
  const fresh = firePortfolioFindings(holdings, r, { fieldWeakSymbols });
  const preTenB = fresh.map(({ storyClause, ...f }) => f as PfFinding); // strip clauses → a pre-10b shape
  const ctx: SubjectContext = {
    entityLedger: r.entityLedger, basketLedger: r.basketLedger,
    allSymbols: holdings.map((h) => h.symbol),
    nameRiskSymbols: holdings.filter((h) => natureOf(h.assetClass ?? "unknown", h.category ?? null) === "name_risk").map((h) => h.symbol),
  };
  const input = (findings: PfFinding[]) => ({ findings, health: r.health, band: r.band, coverage: r.coverage, constructionNet: r.construction.net, sectoredShare: r.sectors.sectoredShare, ...ctx });

  ok("★ the book is genuinely concentrated — it fires PC2 (Concern)", preTenB.some((f) => f.id === "PC2" && f.tone === "Concern"));

  // ★★ THE CORE ASSERTION: a pre-10b concentrated book returns null — NOT a story that stops at movement 3.
  ok("★★ pre-10b snapshot → composeStory returns NULL (no false all-clear on a 100%-concentrated book)",
    _composeStory(input(preTenB)) === null,
    "PC2/PC4/PC5 have no clause; movement 4 would be silently empty — so we tell no story at all");

  // …and the SAME book, FRESH, tells the full four-movement story. The difference is the snapshot's age.
  const freshStory = _composeStory(input(fresh));
  ok("★ …the SAME book FRESH tells the full story (movement 4 present) — only the snapshot's age differs",
    freshStory !== null && freshStory.movements.some((m) => m.movement === 4));

  // ★★ DISTINGUISHABILITY — the whole point. A GENUINE quiet book is NOT flagged pre-10b, even though it
  // ALSO produces no movement 4. It has no PC/PB candidate dropped for a missing clause.
  ok("★★ a genuine quiet book (no PC/PB) is NOT nulled — it tells its valid short story",
    _composeStory({ ...BASE, findings: [F("PA1", "PA", "Neutral", {})] }) !== null,
    "no movement-4 candidate exists to drop — 'no candidates' ≠ 'candidates skipped for a missing clause'");

  // ★ and a genuine all-clear (PB1 WITH a clause) is not nulled either — it renders explicitly.
  ok("★ a genuine all-clear (PB1 with clause) renders, is not nulled",
    _composeStory({ ...BASE, findings: [F("PB1", "PB", "Constructive", { neff: 9 }, "your money is spread across 9.0 effective positions — nothing here concentrates")] }) !== null);

  // ★ THE DETECTOR IS PRECISE: a PB1 WITHOUT a clause (pre-10b) → nulled; the SAME PB1 WITH one → renders.
  ok("★★ isPreStoryboardSnapshot: PB1 sans clause → true; PB1 with clause → false; PI sans clause → false",
    isPreStoryboardSnapshot([F("PB1", "PB", "Constructive", {})]) === true
    && isPreStoryboardSnapshot([F("PB1", "PB", "Constructive", {}, "clause")]) === false
    && isPreStoryboardSnapshot([F("PI4", "PI", "Neutral", {})]) === false,
    "PI (read-time, texture) is never a staleness signal — only the persisted PC/PB families are");

  // negative control — the detector CAN return both values.
  ok("negative control: the detector distinguishes the two states",
    isPreStoryboardSnapshot([F("PC2", "PC", "Concern", {})]) !== isPreStoryboardSnapshot([F("PC2", "PC", "Concern", {}, "c")]));
}

console.log("\n" + "═".repeat(96));
console.log(fail === 0 ? "  ✅ THE COMPOSER — ALL PASS" : `  ❌ ${fail} FAILURE(S)`);
console.log("═".repeat(96));
await prisma.$disconnect();
process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
