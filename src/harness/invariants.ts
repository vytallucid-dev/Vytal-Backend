// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE INVARIANTS — what must be true of EVERY answer, whatever question produced it.
//
// ── ★ WHY INVARIANTS AND NOT SNAPSHOTS ────────────────────────────────────────────────────────────
// The obvious harness for "the product broke" is a golden snapshot of each answer. It is the wrong
// instrument here, for two independent reasons:
//
//   1. §6.5 — the classification cache is IN-MEMORY, so it re-rolls on every restart. A snapshot of
//      slots or sections would flap between deploys for a reason that is not a regression, and a
//      suite that cries wolf is one people route around within a week.
//   2. A snapshot cannot see any of the four false statements that shipped. "₹0 Cr" is a perfectly
//      stable string; it would have been captured as the expected value on day one and defended
//      thereafter. Snapshots assert that output did not CHANGE. Every defect in stage 9 was output
//      that never changed and was wrong the whole time.
//
// So the assertions here are properties, not values: no figure says zero when its own source does
// not, no two statements in one card contradict, no placeholder reaches a reader. Copy may be
// rewritten freely; these keep biting.
//
// ── ★ ONE MODULE, THREE CONSUMERS, AND THAT IS DELIBERATE (N-3) ───────────────────────────────────
// The payload gate, the browser gate and the self-test all import from here. Three copies of "what
// counts as a placeholder" would drift, and the copy that drifted would be the one that stopped
// catching things — silently, because a weaker check still reports green.
//
// ── ★ EVERY INVARIANT NAMES THE DEFECT IT EXISTS FOR ──────────────────────────────────────────────
// Not decoration. When one of these fires in six months, the first question will be "is this a real
// problem or an over-strict rule?", and the answer is in the comment: it shipped once already.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

// ★ THE ONE IMPORT IN THIS FILE, AND IT IS THE PLEDGE RULING'S OWN SENTENCES. See `iPledgeSilent`:
//   the gate checks MEMBERSHIP in the authored set rather than trying to recognise a forbidden
//   sentence by pattern. One home for the copy (N-5), and the gate reads it rather than restating it.
import { PLEDGE_PHRASE } from "../resolve/pledge.js";

/** One violation. `where` locates it precisely enough to fix without re-deriving the run. */
export interface Violation {
  readonly invariant: string;
  readonly where: string;
  readonly detail: string;
}

/** What an invariant is checked against — a composed answer, flattened. */
export interface AnswerUnderTest {
  readonly label: string;
  readonly question: string;
  readonly compositionId: string;
  readonly sections: readonly {
    kind: string;
    renderer: string;
    payload: unknown;
    /**
     * ★ ADDED AT PHASE 2 · BATCH 1, AND ITS ABSENCE WAS A HOLE IN THIS WHOLE LAYER.
     *
     * ⚠ EVERY INVARIANT HERE COULD SEE ONLY THE HALF THE READER SEES. §5 splits a section into a
     *   payload for the browser and a DIGEST for the model, and N-2 keeps them apart — but that makes
     *   the digest a first-class reader-facing surface with its own copy, and until now not one
     *   property was ever checked against it. A defect that reached only the digest (an engine token
     *   in a `withheld` phrase, say) was invisible to layer 1 and would surface as a strange sentence
     *   the model wrote, three layers away from its cause.
     *
     * Optional, so every existing construction site compiles; the invariants that read it treat a
     * missing digest as nothing to check rather than as a pass.
     */
    digest?: { groups: readonly { label: string; lines: readonly { label: string; value: unknown; state?: string }[] }[] };
  }[];
  readonly prose: {
    readonly opening: readonly string[];
    readonly leads: Record<string, string>;
    readonly after?: Record<string, string>;
    readonly close: string;
  };
  /**
   * ★ HOW MANY PERIODS THE QUESTION ASKED FOR — Phase 3, for `I-WINDOW-STATED`.
   *
   * `null` when the question named no window, which is most of them. Taken from the ROUTER's
   * timeframe slot rather than re-parsed from the sentence: the router already decided it, and a
   * second reading here could disagree with the one the composition was built against.
   */
  readonly askedPeriods?: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SHARED VOCABULARY — used by the payload gate AND the browser gate, so the two cannot disagree.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Strings that are a developer's stand-in, not a reader's answer.
 *
 * ★ "Finding" IS ON THIS LIST BECAUSE IT SHIPPED. `resolvePortfolio` read `o.title ?? o.key ??
 *   "Finding"` while the object carried `label` and `read`, so all four fallbacks missed and the
 *   literal word rendered as the label of every item. The fallback is what made it invisible: it
 *   turned a missing field into something that renders.
 *
 * ⚠ EXACT MATCH ONLY, CASE-INSENSITIVE, AFTER TRIMMING. "Finding" as a whole label is a placeholder;
 *   "this finding" inside a sentence is ordinary English. A substring rule here would fire on real
 *   copy and be switched off within a month.
 */
export const PLACEHOLDER_LABELS: readonly string[] = [
  "finding", "findings", "untitled", "unknown", "unnamed", "n/a", "na", "tbd", "todo", "fixme",
  "placeholder", "-", "--", "—", "?", "...",
  // ⚠ "value", "item" and "label" WERE HERE AND WERE REMOVED, because they are ordinary UI
  //   vocabulary rather than stand-ins: the relationship card's "Value: ₹3.72 lakh" is a correct
  //   stat label and the harness reported it as a defect. A list that flags correct copy is a list
  //   someone deletes an entry from under time pressure, and the entry they delete will be the one
  //   that mattered. Every word left here is one that means "a developer had not decided yet".
];

/**
 * Substrings that are never correct anywhere in reader-facing text — the shapes a missing value takes
 * when it survives into a string: a template that interpolated nothing, an object that met `String()`,
 * a number that was never a number.
 *
 * ⚠ CASE-SENSITIVE, AND WORD-BOUNDED FOR THE ALPHABETIC ONES. THE FIRST DRAFT WAS NEITHER AND FIRED
 *   ON MOST OF THE MATRIX: lowercased, `NaN` is a substring of "fiNANcial", so "companies'
 *   financials" was reported as a corrupted number. A gate that fires on the word "financials" in a
 *   finance product is one that gets switched off within a week — and the version that gets switched
 *   off catches nothing at all. Precision here is not fussiness; it is what keeps the gate alive.
 */
export const NEVER_IN_READER_TEXT: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /\bundefined\b/, name: "undefined" },
  { pattern: /\[object Object\]/, name: "[object Object]" },
  { pattern: /\bNaN\b/, name: "NaN" },
  { pattern: /\bInfinity\b/, name: "Infinity" },
  { pattern: /\bnull\b/, name: "null" },
  { pattern: /\$\{/, name: "${" },
  { pattern: /\{\{|\}\}/, name: "{{ }}" },
  { pattern: /\[missing/i, name: "[missing" },
  { pattern: /\b(TODO|FIXME)\b/, name: "TODO/FIXME" },
];

/**
 * Count-ish total labels — a set's own claim about HOW MANY THINGS IT CONTAINS.
 *
 * ⚠ "Of those, scored" IS DELIBERATELY ABSENT, AND THE FIRST DRAFT INCLUDED IT AND FIRED. That total
 *   counts a SUBSET ("11 of your 21 are scored"); it is smaller than the member list by design, and
 *   reading it as the set's own size turned a correct answer into a reported contradiction. Only a
 *   label naming the set ITSELF belongs here.
 */
const COUNT_LABELS = /^(pinned|positions?|holdings?|members?|matches?|count|companies|results?)$/i;

/** Money/score display strings that read as zero. `₹0 Cr`, `0.0%`, `0`, `₹0`, `0.00×`. */
export function readsAsZero(display: string): boolean {
  const s = display.trim();
  if (!s) return false;
  // The number the reader actually sees. Strip currency, units, separators, signs.
  const m = s.replace(/[,\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return false;
  // ⚠ ONLY THE FIRST NUMBER, AND ONLY WHEN IT IS THE WHOLE FIGURE. "₹0 Cr" is a zero the reader
  //   reads as nothing; "0 of 21 scored" is a sentence containing a zero and is perfectly true.
  if (/\d[^\d]*\d/.test(s.replace(/[,\s]/g, "").replace(/\.\d+/, ""))) return false;
  return Number(m[0]) === 0;
}

/** Every reader-facing string in a payload, with a path to each. Walks arrays and objects. */
export function readerStrings(payload: unknown, base = ""): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > 8 || v === null || v === undefined) return;
    if (typeof v === "string") { out.push({ path, text: v }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1)); return; }
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(payload, base, 0);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE INVARIANTS
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ I-FALSE-ZERO — a figure must not read as zero when its own source value is not zero.
 *
 * ⚠ THE DEFECT: `cr()` rounds to whole crore. Every position in a real 21-holding book is under
 *   0.05 Cr, so `Math.round` produced "₹0 Cr" on ALL TWENTY-ONE ROWS and on the book total. §3.1 —
 *   a zero where the value is known and small is a FALSE STATEMENT, not a rounding choice: the
 *   reader is being told they hold nothing.
 *
 * ★ IT IS CHECKABLE ONLY BECAUSE THE PAYLOAD CARRIES BOTH HALVES. `hero-set` members hold
 *   `sortValue` (the number) beside `figure` (the string), and `RELATIVE` marks hold `value` beside
 *   `display`. Wherever a renderer keeps the source next to the rendering, the rendering can be
 *   audited against it — which is an argument for keeping them together.
 */
export function iFalseZero(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  const pairs: { src: unknown; disp: unknown; at: string }[] = [];
  for (const s of a.sections) {
    const p = (s.payload ?? {}) as Record<string, unknown>;
    const at = `${s.kind}:${s.renderer}`;
    for (const m of (p.members as Record<string, unknown>[] | undefined) ?? []) {
      pairs.push({ src: m.sortValue, disp: m.figure, at: `${at} member "${String(m.title ?? m.key)}"` });
    }
    for (const m of (p.marks as Record<string, unknown>[] | undefined) ?? []) {
      pairs.push({ src: m.value, disp: m.display, at: `${at} mark "${String(m.label)}"` });
    }
  }
  for (const { src, disp, at } of pairs) {
    if (typeof src !== "number" || src === 0) continue;
    if (typeof disp !== "string" || !disp) continue;
    if (readsAsZero(disp)) {
      v.push({
        invariant: "I-FALSE-ZERO", where: `${a.label} · ${at}`,
        detail: `source value is ${src} but the reader sees "${disp}"`,
      });
    }
  }
  return v;
}

/**
 * ★ I-PLACEHOLDER — no developer stand-in reaches a reader.
 *
 * ⚠ THE DEFECT: `Finding / Finding / Finding / Finding` in the portfolio card, from a `?? "Finding"`
 *   fallback over field names the object does not have.
 */
/**
 * ⚠ THE EXACT-MATCH HALF IS SCOPED TO LABEL FIELDS, AND THE FIRST DRAFT SHOWED WHY. Applied to every
 *   string in a payload it flagged `figureLabel: "Value"` (a column heading) and a follow-up chip
 *   whose `surface` is the product's own "Findings" tool. Both are correct copy. The defect was
 *   `items[].label === "Finding"` — AN ITEM'S OWN NAME being a stand-in — so that is what is checked.
 */
const LABEL_FIELD = /(^|[.])(label|title|name|heading|term)$/;

export function iPlaceholder(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  const check = (text: string, where: string, isLabel: boolean) => {
    const t = text.trim();
    if (!t) return;
    if (isLabel && PLACEHOLDER_LABELS.includes(t.toLowerCase())) {
      v.push({ invariant: "I-PLACEHOLDER", where, detail: `an item's own label is the placeholder "${t}"` });
    }
    for (const bad of NEVER_IN_READER_TEXT) {
      if (bad.pattern.test(t)) {
        v.push({ invariant: "I-PLACEHOLDER", where, detail: `contains ${bad.name} — "${t.slice(0, 90)}"` });
        break;
      }
    }
  };
  for (const s of a.sections) {
    for (const { path, text } of readerStrings(s.payload)) {
      // ⚠ A NEXT CHIP'S `label` IS A CATEGORY TAG, NOT AN ITEM'S NAME, AND TREATING IT AS ONE MADE
      //   THIS GATE FLAKY. `execute.ts` sets a model-planned chip's label to its SURFACE, so a
      //   perfectly good follow-up into the findings surface arrives as `label: "Findings"` — which
      //   is on the placeholder list because stage 9 shipped a literal `?? "Finding"` fallback on
      //   findings ITEMS. Two different things wearing one word.
      //
      //   It surfaced as an intermittent failure rather than a steady one: the model planner runs on
      //   the "normal" arm, and the plan cache then serves its follow-ups to the deterministic arm as
      //   well — so whether this fired depended on whether the model had planned that question in
      //   this process. A gate that fails on Tuesdays is worse than one that does not exist.
      //
      // ★ THE CHECK IS NOT WEAKENED. A chip's `question` is what the reader actually sees and reads,
      //   and it is still scanned in full by the NEVER_IN_READER_TEXT pass below; only the treat-as-
      //   an-item's-own-name rule is lifted, and only for this one field.
      const isChipLabel = s.kind === "NEXT" && /^chips\[\d+\]\.label$/.test(path);
      check(text, `${a.label} · ${s.kind}:${s.renderer} · ${path}`, LABEL_FIELD.test(path) && !isChipLabel);
    }
  }
  for (const [i, p] of a.prose.opening.entries()) check(p, `${a.label} · prose.opening[${i}]`, false);
  for (const [k, t] of Object.entries(a.prose.leads)) check(t, `${a.label} · prose.leads[${k}]`, false);
  for (const [k, t] of Object.entries(a.prose.after ?? {})) check(t, `${a.label} · prose.after[${k}]`, false);
  check(a.prose.close, `${a.label} · prose.close`, false);
  return v;
}

/**
 * ★ I-PROSE-COLLISION — two sections of one kind must not share one sentence.
 *
 * ⚠ THE DEFECT THIS IS WRITTEN FOR SHIPPED, AND IT READS AS A MODEL FAULT RATHER THAN A KEYING ONE.
 *   "why is INFY scored the way it is" planned a FOUNDATION pillar and a MOMENTUM pillar; both
 *   render as `DECOMPOSITION:pillar-bars`, and `executePlan` keyed its prose on `KIND:renderer` with
 *   no index — so the second write overwrote the first and BOTH cards were introduced by the
 *   momentum sentence and concluded by the momentum epilogue. On screen: four sentences, two of them
 *   describing the wrong component, every one of them individually well written. A reader's only
 *   possible reading is "the AI repeated itself".
 *
 * ★ IT RESOLVES THE KEY THE WAY THE RENDERER DOES — `KIND:renderer#i`, then `KIND:renderer`, then
 *   `KIND` — because the bug is invisible at the storage layer. The prose map is perfectly
 *   well-formed; it is one entry short, and the second section silently borrows the first's. Only
 *   walking it per-section the way the browser does can see that two components got one sentence.
 *
 * ⚠ ABSENCE IS NOT A COLLISION. Two sections that BOTH have no lead are fine — nothing is being
 *   misattributed. The violation is one non-empty sentence resolving for two different indices.
 */
export function iProseCollision(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  const resolve = (map: Record<string, string> | undefined, kind: string, renderer: string, i: number) => {
    const k = `${kind}:${renderer}`;
    return map?.[`${k}#${i}`] ?? map?.[k] ?? map?.[kind] ?? "";
  };
  for (const field of ["leads", "after"] as const) {
    const seen = new Map<string, number>(); // sentence -> first index that resolved it
    a.sections.forEach((s, i) => {
      const text = resolve(field === "leads" ? a.prose.leads : a.prose.after, s.kind, s.renderer, i).trim();
      if (!text) return;
      const key = `${s.kind}:${s.renderer}::${text}`;
      const first = seen.get(key);
      if (first === undefined) { seen.set(key, i); return; }
      v.push({
        invariant: "I-PROSE-COLLISION",
        where: `${a.label} · ${s.kind}:${s.renderer} · prose.${field}[#${first} and #${i}]`,
        detail:
          `sections ${first} and ${i} are the same kind and share one ${field === "leads" ? "lead" : "epilogue"} — ` +
          `"${text.slice(0, 70)}". One of them is being described by the other's sentence; the composition ` +
          `needs the indexed key \`KIND:renderer#i\`.`,
      });
    });
  }
  return v;
}

/**
 * ★ I-REPEATED-LABEL — the same label three or more times in one section is a defect signature.
 *
 * ★ THE SECOND NET UNDER THE SAME DEFECT, AND IT IS DELIBERATELY REDUNDANT. `I-PLACEHOLDER` catches
 *   `Finding` because that exact word is on a list. This catches it because FOUR ITEMS SHARING ONE
 *   LABEL is wrong whatever the word is — which is the version that still works when the next
 *   fallback string is one nobody thought to list. The first net depends on foresight; this one does
 *   not, and the defect that gets through is always the one nobody predicted.
 */
export function iRepeatedLabel(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  for (const s of a.sections) {
    const p = (s.payload ?? {}) as Record<string, unknown>;
    for (const field of ["items", "members", "marks", "rows", "parts", "chips"]) {
      const arr = p[field] as Record<string, unknown>[] | undefined;
      if (!Array.isArray(arr) || arr.length < 3) continue;
      // ⚠ THE ROWS MUST ALSO BE INDISTINGUISHABLE, AND WITHOUT THAT CLAUSE THIS FIRED ON REAL DATA.
      //   A dividend rail legitimately carries four items labelled "dividend" — the label is the
      //   event TYPE and each row's detail is a different date and amount. What is never legitimate
      //   is N rows sharing a label AND carrying nothing to tell them apart, which is exactly the
      //   shape `Finding / Finding / Finding / Finding` had: one word, four times, empty details.
      const groups = new Map<string, string[]>();
      for (const it of arr) {
        const label = String(it.label ?? it.title ?? it.key ?? "").trim();
        if (!label) continue;
        const detail = String(it.detail ?? it.read ?? it.subtitle ?? it.value ?? it.question ?? "").trim();
        groups.set(label, [...(groups.get(label) ?? []), detail]);
      }
      for (const [label, details] of groups) {
        if (details.length < 3) continue;
        if (details.every((d) => d === "") || new Set(details).size === 1) {
          v.push({
            invariant: "I-REPEATED-LABEL", where: `${a.label} · ${s.kind}:${s.renderer} · ${field}`,
            detail: `"${label}" appears ${details.length} times with nothing to tell the rows apart`,
          });
        }
      }
    }
  }
  return v;
}

/**
 * ★ I-SET-RECONCILES — a set's stated total and its listed members must agree.
 *
 * ⚠ TWO DEFECTS, ONE INVARIANT:
 *
 *   · *"you have not pinned anything to your watchlist yet"* rendered directly above **PINNED 5**.
 *     `enrichWatchlist` returned rows with undefined symbols, the `.filter()` dropped all five, and
 *     the total came from a separate count that was still right. Two contradictory statements in one
 *     card — and both halves were individually true of the variable they read.
 *
 *   · A `JOIN stocks` dropping 8 of 21 positions under a total reading **Positions 21**. Twice now,
 *     in two different queries. A list that silently loses a third of its population presents a
 *     slice as the whole, and nothing in the payload says so.
 *
 * ★ THE RULE IS SYMMETRIC AND THAT MATTERS. A total greater than the member count is only a defect
 *   when nothing declares the truncation — `totalAvailable` is how a set says "showing 12 of 21"
 *   ON PURPOSE, so it is consulted rather than ignored. Without that, the honest bounded case and
 *   the silent-loss case are indistinguishable and the gate would have to be switched off.
 */
export function iSetReconciles(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  for (const s of a.sections) {
    const p = (s.payload ?? {}) as Record<string, unknown>;
    const members = p.members as unknown[] | undefined;
    if (!Array.isArray(members)) continue;
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    const totalAvailable = typeof p.totalAvailable === "number" ? p.totalAvailable : null;

    for (const t of (p.totals as Record<string, unknown>[] | undefined) ?? []) {
      const label = String(t.label ?? "");
      const raw = t.value;
      if (!COUNT_LABELS.test(label.trim()) || typeof raw !== "string") continue;
      const n = Number(raw.replace(/[,\s]/g, ""));
      if (!Number.isFinite(n)) continue;

      // THE CONTRADICTION: the set says N exist and shows none of them, with nothing declaring why.
      if (n > 0 && members.length === 0) {
        v.push({
          invariant: "I-SET-RECONCILES", where: at,
          detail: `total "${label}" says ${n} but the set lists 0 members — the empty-state phrase renders above a non-zero count`,
        });
      }
      // THE SILENT LOSS: more claimed than shown, and no `totalAvailable` to say the list is bounded.
      if (n > members.length && members.length > 0 && totalAvailable === null) {
        v.push({
          invariant: "I-SET-RECONCILES", where: at,
          detail: `total "${label}" says ${n} but ${members.length} are listed, and nothing declares the list is bounded`,
        });
      }
      // A count SMALLER than what is shown cannot be explained by truncation at all.
      if (n < members.length) {
        v.push({
          invariant: "I-SET-RECONCILES", where: at,
          detail: `total "${label}" says ${n} but ${members.length} members are listed`,
        });
      }
    }
    if (totalAvailable !== null && totalAvailable < members.length) {
      v.push({
        invariant: "I-SET-RECONCILES", where: at,
        detail: `totalAvailable is ${totalAvailable} but ${members.length} members are listed`,
      });
    }
  }
  return v;
}

/**
 * ★ I-INTERPOLATION — a template that interpolated nothing must not reach a reader.
 *
 * ⚠ THE DEFECT: *"· nothing filed with us for  yet"* — a coverage line printing a stock sentence for
 *   a portfolio, with an empty symbol leaving a doubled space where the ticker should be. The gap is
 *   the tell, and it is machine-detectable even when the sentence around it reads fine.
 *
 * ⚠ AND IT IS THE ONE INVARIANT WHOSE DEFECT LIVES IN THE BROWSER, NOT THE PAYLOAD. That coverage
 *   payload was correct — `subjectKind: "reader"`, `asOf: null` — and the renderer ignored it. So
 *   this function catches the SERVER-SIDE members of the family; the client-side one is caught by
 *   the render contract (unread payload fields) and by the browser gate running this same function
 *   over DOM text. Stated here so the gap is not mistaken for coverage.
 */
export function iInterpolation(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  const check = (text: string, where: string) => {
    const t = text.trim();
    if (!t) return;
    // ⚠ NOT A BLANKET DOUBLE-SPACE RULE. Prose is allowed to be typed with two spaces after a full
    //   stop; an empty slot is a gap WITHIN a sentence, so the neighbours must both be word
    //   characters. That distinction is what keeps this from firing on ordinary copy.
    const gap = /\w {2,}\w/.exec(t);
    if (gap) v.push({ invariant: "I-INTERPOLATION", where, detail: `empty slot in "${t.slice(Math.max(0, gap.index - 30), gap.index + 40)}"` });
    for (const pat of [" ,", " .", "( )", "()", " —  ", "for  ", " the  "]) {
      if (t.includes(pat)) { v.push({ invariant: "I-INTERPOLATION", where, detail: `"${pat}" in "${t.slice(0, 90)}"` }); break; }
    }
  };
  for (const s of a.sections) {
    for (const { path, text } of readerStrings(s.payload)) {
      if (text.length > 2) check(text, `${a.label} · ${s.kind}:${s.renderer} · ${path}`);
    }
  }
  for (const [i, p] of a.prose.opening.entries()) check(p, `${a.label} · prose.opening[${i}]`);
  for (const [k, t] of Object.entries(a.prose.leads)) check(t, `${a.label} · prose.leads[${k}]`);
  for (const [k, t] of Object.entries(a.prose.after ?? {})) check(t, `${a.label} · prose.after[${k}]`);
  check(a.prose.close, `${a.label} · prose.close`);
  return v;
}

/**
 * ★ I-ACTIONABLE — a control must name something it can actually do.
 *
 * ⚠ THE DEFECT: `NextChips` rendered `<button>` with no `onClick`. Every follow-up in the product
 *   was a dead button — and worse than a missing feature, because an affordance that lies about what
 *   it does teaches the reader the product is broken.
 *
 * ⚠ THIS IS THE PAYLOAD HALF ONLY. It proves the chip CARRIES a question and the control names a
 *   permitted endpoint. Whether the button is wired is a DOM fact and belongs to the browser gate;
 *   the render contract catches the specific shape (a button with no handler) statically.
 */
export function iActionable(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  const ALLOWED_PREFIX = [
    "/api/v1/me/watchlist", "/api/v1/me/transactions", "/api/v1/me/alerts",
    "/api/v1/me/reminders", "/api/v1/me/memories",
  ];
  for (const s of a.sections) {
    const p = (s.payload ?? {}) as Record<string, unknown>;
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    if (s.kind === "NEXT") {
      const chips = (p.chips as Record<string, unknown>[] | undefined) ?? [];
      for (const [i, c] of chips.entries()) {
        const q = String(c.question ?? "").trim();
        if (q.length < 3) v.push({ invariant: "I-ACTIONABLE", where: `${at} chip[${i}]`, detail: "chip carries no question to send" });
      }
    }
    if (s.kind === "ACTION") {
      const ep = (p.endpoint ?? {}) as Record<string, unknown>;
      const path = String(ep.path ?? "");
      const label = String(p.label ?? "").trim();
      if (!ALLOWED_PREFIX.some((x) => path.startsWith(x))) {
        v.push({ invariant: "I-ACTIONABLE", where: at, detail: `endpoint "${path}" is outside the permitted set — the control renders inert` });
      }
      if (!label) v.push({ invariant: "I-ACTIONABLE", where: at, detail: "control has no button label" });
      for (const f of (p.fields as Record<string, unknown>[] | undefined) ?? []) {
        if (f.required === true && (f.value === null || f.value === "")) continue; // legitimately awaiting the reader
        if (!String(f.label ?? "").trim()) v.push({ invariant: "I-ACTIONABLE", where: at, detail: "a form field has no label" });
      }
    }
  }
  return v;
}

/**
 * ★ I-DISTINCT — two answers driven by DIFFERENT SLOTS must not come out identical.
 *
 * ⚠ THE DEFECT: `deterministicPlan` branched on exactly one condition (`lens === "ownership"`), so
 *   every other operation, lens and timeframe produced a byte-identical block list. "show me ten
 *   years of TCS history" and "why did TCS fall today?" both came back as the answer to "how is TCS
 *   doing" — with the router's slots CORRECT in the log and discarded by the plan.
 *
 * ★ THE DISCRIMINATOR IS THE SLOTS, NOT THE QUESTION TEXT, AND THE FIRST DRAFT PROVED WHY. Keyed on
 *   the question, it flagged `"how is HDFCBANK doing"` against `"and HDFCBANK?"` — two different
 *   sentences that mean the same thing, where the second inherits the first's operation ON PURPOSE.
 *   Producing the same answer there is the feature working. What can never be legitimate is
 *   `{operation: history, timeframe: 10y}` and `{operation: explain, lens: price}` yielding one
 *   answer, because those are different questions BY CONSTRUCTION.
 *
 * ★ EXACT DUPLICATION, NEVER A SIMILARITY THRESHOLD. Two slot sets may legitimately share a shape;
 *   what cannot be legitimate is the same section list AND the same opening AND the same close. A
 *   threshold would need tuning, and would be tuned until it stopped firing.
 */
export function iDistinct(
  answers: readonly (AnswerUnderTest & { slotKey?: string })[],
): Violation[] {
  const v: Violation[] = [];
  const seen = new Map<string, AnswerUnderTest & { slotKey?: string }>();
  for (const a of answers) {
    const shape = a.sections.map((s) => `${s.kind}:${s.renderer}`).join("|");
    const key = `${shape}##${a.prose.opening.join(" ")}##${a.prose.close}`;
    const prior = seen.get(key);
    // No slot key on either side ⇒ nothing to compare; an equal slot key ⇒ the same question asked
    // twice, which SHOULD produce the same answer.
    //
    // ⚠ AND SO SHOULD THE SAME QUESTION UNDER DIFFERENT SLOTS, WHICH THIS USED TO REPORT AS A DEFECT.
    //   §6.5 measures the router at 80–88% run-to-run agreement, so one sentence genuinely classifies
    //   two ways — "how is the large-cap pharma peer group doing" came back `screen` on one live run
    //   and `orient · price` on the next. Making the ANSWER independent of that coin flip is the fix
    //   (compose.ts step 3g recognises the question from the sentence rather than the operation), and
    //   under the old rule the fix itself failed this invariant: identical text, different slots,
    //   identical answer — reported as "two questions, one answer" when it is one question, one
    //   answer, which is exactly what was wanted.
    //
    // ★ THE INTENT IS THE QUESTION *AND* THE SLOTS. Two rows differ in intent only when the reader
    //   typed something different.
    const differentIntent =
      prior !== undefined
      && prior.slotKey !== undefined && a.slotKey !== undefined
      && prior.slotKey !== a.slotKey
      && prior.question.trim().toLowerCase() !== a.question.trim().toLowerCase();
    if (differentIntent) {
      v.push({
        invariant: "I-DISTINCT", where: `${prior!.label} vs ${a.label}`,
        detail:
          `different slots produced one identical answer (${a.sections.length} sections, same prose)\n` +
          `        ${prior!.slotKey}\n        ${a.slotKey}`,
      });
    } else if (!prior) seen.set(key, a);
  }
  return v;
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THREE INVARIANTS ADDED AT PHASE 1 · BATCH 1. Each one is a family constraint made universal.
//
// ⚠ THE FAMILIES ALREADY ASSERT THESE IN THEIR OWN FILES (§5.2), AND THAT IS NOT THE SAME COVERAGE.
//   A family assertion runs over the answers THAT FAMILY produced. These run over every answer in the
//   matrix — the planned path, the deterministic fallback, the generic branch and the four market
//   compositions included — because the two constraints below are not F's and OA's private taste.
//   A pledge figure printed by the PLANNER is exactly as false as one printed by OA, and the planner
//   is the path nobody is looking at when it fails (the `plannerless` arm exists for that reason).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ I-BASIS — a filed financial statement must name the basis it was read on.
 *
 * ⚠ THE DEFECT THIS PREVENTS IS NOT A GAP, IT IS AN AMBIGUOUS FIGURE. Measured: 1,492 of 2,175
 *   non-financial stocks file BOTH standalone and consolidated results for the same quarter, across
 *   15,932 stock-periods, and consolidated-only is zero. So a revenue figure with no basis beside it
 *   is one of two real answers and the reader cannot tell which.
 *
 * ⚠ AND THE PRODUCT DOES NOT PICK ONE UNIFORMLY, WHICH IS WHAT MAKES IT UNDETECTABLE BY EYE. Measured
 *   live: TCS resolves consolidated, HDFCBANK resolves standalone — two answers in one session on two
 *   sets of books, both correct, neither labelled. Nothing about either answer looks wrong.
 *
 * ★ IT CHECKS BOTH HALVES, because either alone is insufficient: the PAYLOAD carries it for the
 *   reader and the DIGEST carries it for the model. A basis on the payload only means the model writes
 *   the summary sentence without knowing there was a basis to name.
 */
export function iBasis(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  for (const s of a.sections) {
    if (s.renderer !== "statement-table") continue;
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    const p = (s.payload ?? {}) as { basis?: { read?: unknown; available?: unknown; sentence?: unknown } };
    const read = p.basis?.read;
    if (read !== "consolidated" && read !== "standalone") {
      v.push({ invariant: "I-BASIS", where: at, detail: `basis.read is ${JSON.stringify(read)} — every filed statement is one basis or the other` });
      continue;
    }
    const sentence = typeof p.basis?.sentence === "string" ? p.basis.sentence : "";
    if (!sentence.toLowerCase().includes(String(read))) {
      v.push({ invariant: "I-BASIS", where: at, detail: `the basis sentence does not name the basis it read ("${sentence.slice(0, 70)}")` });
    }
    // ⚠ AND WHERE BOTH BASES EXIST THE SENTENCE MUST SAY SO. "Read on a consolidated basis" alone
    //   leaves the reader assuming that is the only set of books; the other one is equally real.
    const avail = Array.isArray(p.basis?.available) ? (p.basis!.available as unknown[]) : [];
    if (avail.length > 1 && !/also files/i.test(sentence)) {
      v.push({ invariant: "I-BASIS", where: at, detail: "both bases are filed and the sentence does not say the other exists" });
    }
  }
  return v;
}

/**
 * ★ I-PLEDGE-SILENT — no pledge magnitude reaches a reader, anywhere, on any path.
 *
 * ⚠ THE DEFECT SHIPPED IN TWO PLACES AT ONCE AND BOTH READ AS CORRECT. `ownership-split.tsx` printed
 *   "None of the promoter holding is pledged." on a zero, and the digest said the same to the model —
 *   and 87.2% of the 25,168 filings we hold carry `pledged_shares = 0` with **ZERO** NULLs, which is a
 *   column where "not disclosed" was written as a zero. 1,555 of those rows (213 stocks) report a
 *   positive pledge percentage against those same zero shares, so the filing contradicts itself.
 *
 * ⚠ AND WHERE A PLEDGE EXISTS THE TWO COLUMNS DISAGREE ON ITS SIZE: of 3,205 rows where both are
 *   positive, only 891 agree within half a point and 2,007 are more than five points apart (worst gap
 *   183 points; ASHOKLEY 51.37% against 59.03%). Under NEITHER unit reading do 2,089 of the 3,205
 *   reconcile. There is no derivation this data supports, so there is no number to print.
 *
 * ★ THIS IS A PROPERTY, NOT A SNAPSHOT, AND THAT IS WHY IT BELONGS HERE. "None of the promoter
 *   holding is pledged" is a perfectly stable string — a golden snapshot would have captured it as
 *   expected output on day one and defended it thereafter (see this file's own header).
 */
export function iPledgeSilent(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  // A figure in the same clause as a pledge word. Bounded to one clause so ordinary prose that
  // mentions pledging near an unrelated percentage does not fire — precision keeps the gate alive.
  const CLAIM = /pledg\w*[^.;]{0,80}?\d+(?:\.\d+)?\s*(?:%|pp|per\s?cent|percent)|\d+(?:\.\d+)?\s*(?:%|pp|per\s?cent|percent)[^.;]{0,80}?pledg/i;
  // ⚠ THE ZERO CLAIM CARRIES NO DIGITS AT ALL — "None of the promoter holding is pledged." is the
  //   exact sentence that shipped, and it is a false statement with nothing numeric in it.
  const ZERO_CLAIM = /(?:none|nothing|no part|not any|zero)\b[^.;]{0,60}?pledg|pledg\w*[^.;]{0,60}?\b(?:is nil|none|nothing|zero)\b/i;
  /**
   * ⚠ AND THE HEDGE EXEMPTION, WHICH THE FIRST VERSION OF THIS GATE DID NOT HAVE AND WHICH IT NEEDED
   *   WITHIN ONE RUN. It fired 17 times on the ruling's OWN sentences — "We cannot state pledging for
   *   this company. The pledge field is zero-filled…" contains `pledg` near `zero`, and "there is
   *   nothing that could be pledged" contains `nothing` near `pledg`. Both mean the opposite of the
   *   sentence being forbidden.
   *
   * ★ THE LESSON IS THE STRUCTURAL CHECK BELOW, NOT A BETTER REGEX. A gate that tries to tell
   *   "we cannot say" from "there is none" by pattern is parsing English, and it will be wrong in
   *   both directions forever. The pattern stays as a backstop for FREE TEXT — the planner's prose,
   *   which no structural check can reach — and the hedge exemption is what keeps it from firing on
   *   an honest decline.
   */
  const HEDGED = /\b(?:cannot|can not|could not|will not|do not|does not|unproven|not established|zero-?filled|declin\w*|not quoting|not stating|we are not)\b/i;

  /**
   * ⚠ AND THE AUTHORED SENTENCES ARE EXEMPT WHEREVER THEY APPEAR, NOT ONLY IN `pledge.phrase`. The
   *   negative control caught this: `no_promoter` — "There is no promoter holding here, so there is
   *   nothing that could be pledged." — carries `nothing` near `pledg` and no hedge word, and the
   *   ownership family pushes that exact sentence into `opening` on a pledge question about a
   *   widely-held company. So the gate would have fired on a correct answer to a real question.
   *
   * ★ EXACT MATCH ON THE TRIMMED STRING, NOT `includes`. A containment test would be a loophole:
   *   appending a forbidden claim to an authored sentence would exempt the whole thing. A family that
   *   wants to embed one of these mid-sentence has to restructure, which is the right pressure — the
   *   ruling's wording is the ruling, and paraphrasing it is how a decline becomes an assertion.
   */
  const AUTHORED = new Set(Object.values(PLEDGE_PHRASE).map((x) => x.trim()));

  const check = (text: string, where: string) => {
    if (AUTHORED.has(text.trim())) return;
    if (CLAIM.test(text)) {
      v.push({ invariant: "I-PLEDGE-SILENT", where, detail: `a pledge magnitude reached the reader: "${text.slice(0, 110)}"` });
    } else if (ZERO_CLAIM.test(text) && !HEDGED.test(text)) {
      v.push({ invariant: "I-PLEDGE-SILENT", where, detail: `a pledge ABSENCE was asserted, and absence is what this field cannot prove: "${text.slice(0, 110)}"` });
    }
  };

  for (const s of a.sections) {
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    /**
     * ★★ THE STRUCTURAL HALF, AND IT IS THE STRONGER ONE. A `pledge` object on a payload must carry a
     *    known state and a phrase from the authored set — so ANY free text in that field is a
     *    violation whether or not a pattern happens to recognise it, and the check gets stronger as
     *    the copy is edited rather than weaker.
     *
     *    `resolve/pledge.ts` is the only place that can produce one of these, which is what makes
     *    membership in the set a meaningful assertion rather than a tautology.
     */
    const pl = (s.payload as { pledge?: unknown } | null)?.pledge;
    if (pl && typeof pl === "object") {
      const o = pl as { state?: unknown; phrase?: unknown };
      const known = Object.keys(PLEDGE_PHRASE);
      if (typeof o.state !== "string" || !known.includes(o.state)) {
        v.push({ invariant: "I-PLEDGE-SILENT", where: `${at} · pledge.state`, detail: `unknown pledge state ${JSON.stringify(o.state)} — the ruling admits ${known.join(" | ")}` });
      } else if (o.phrase !== PLEDGE_PHRASE[o.state as keyof typeof PLEDGE_PHRASE]) {
        v.push({
          invariant: "I-PLEDGE-SILENT",
          where: `${at} · pledge.phrase`,
          detail: `a pledge sentence that resolve/pledge.ts did not author: "${String(o.phrase).slice(0, 110)}"`,
        });
      }
    }
    for (const { path, text } of readerStrings(s.payload)) {
      // The authored sentences are checked above, exactly. Re-running the pattern over them is what
      // produced the 17 false positives, so the one field with a structural check is exempt here.
      if (path.endsWith("pledge.phrase")) continue;
      check(text, `${at} · ${path}`);
    }
    // ★ A NUMERIC FIELD WHOSE NAME PROMISES A PLEDGE PROPORTION IS A DEFECT EVEN WHEN NOTHING RENDERS
    //   IT TODAY. The payload crosses to the browser, and the next renderer written against it will
    //   print what is there. This is the check that caught the field on its way out.
    const walk = (val: unknown, path: string, depth = 0) => {
      if (depth > 8 || val === null || val === undefined || typeof val !== "object") return;
      if (Array.isArray(val)) { val.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1)); return; }
      for (const [k, x] of Object.entries(val as Record<string, unknown>)) {
        if (/pledg/i.test(k) && typeof x === "number") {
          v.push({
            invariant: "I-PLEDGE-SILENT",
            where: `${at} · ${path ? path + "." : ""}${k}`,
            detail: `a numeric pledge field crossed to the browser (${x})`,
          });
        }
        walk(x, path ? `${path}.${k}` : k, depth + 1);
      }
    };
    walk(s.payload, "");
  }
  for (const [i, p] of a.prose.opening.entries()) check(p, `${a.label} · prose.opening[${i}]`);
  for (const [k, t] of Object.entries(a.prose.leads)) check(t, `${a.label} · prose.leads[${k}]`);
  for (const [k, t] of Object.entries(a.prose.after ?? {})) check(t, `${a.label} · prose.after[${k}]`);
  check(a.prose.close, `${a.label} · prose.close`);
  return v;
}

/**
 * ★ I-STEPPED — a series of FILED observations is drawn stepped, never as a continuous line.
 *
 * ⚠ THE LIE IS SMALL, WHICH IS WHY IT NEEDS A GATE. A shareholding register changes on a filing date;
 *   between two filings nothing is true. A line sloping from 71.8% to 70.1% across a quarter asserts
 *   a path nobody filed — it makes the chart prettier and the data worse, and no reader can tell by
 *   looking that the slope is invented. `stepped-filing-line` steps by construction; `value-line`,
 *   `composite-spine` and `phase-shaded-spine` are continuous by construction, and `statement-table`
 *   draws no line at all.
 *
 * ★ IT KEYS ON THE PAYLOAD'S OWN SHAPE RATHER THAN ON WHICH COMPOSITION RAN, so it covers the planned
 *   path too: a plan that renders a filing series through a continuous renderer fails here.
 */
export function iStepped(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  // ⚠ `phase-shaded-spine` WAS IN THIS SET AND HAS BEEN TAKEN OUT — because the RENDERER changed, not
  //   because the rule was inconvenient. It was listed here as "continuous by construction" before it
  //   existed; when it was built for T · Trajectory this invariant fired on all six of its cases and
  //   was correct to. The composite is a QUARTERLY reading: one point per filed period, nothing true
  //   between two of them, so a smooth interpolation between FY25Q3 and FY25Q4 draws a decline that
  //   never happened on any day. The chart now steps, which is also the better drawing for a family
  //   whose whole subject is the LEVELS a score held.
  //
  // ★ THE NAME IS THE CONTRACT (§5.1 guarantee 3), so leaving the set is the honest way to say "this
  //   renderer steps". Keeping it here and exempting it by hand would have been the rule bending
  //   around one caller.
  const CONTINUOUS = new Set(["value-line", "composite-spine"]);
  // A period key — "FY27Q1", "FY26" — rather than a date. These are FILED observations.
  const PERIOD = /^FY\d{2}(Q[1-4])?$/;
  for (const s of a.sections) {
    if (s.kind !== "SERIES" || !CONTINUOUS.has(s.renderer)) continue;
    const p = (s.payload ?? {}) as { points?: { at?: unknown }[] };
    const pts = p.points ?? [];
    if (pts.length < 2) continue;
    const filed = pts.filter((x) => typeof x.at === "string" && PERIOD.test(x.at)).length;
    // Every point is a filed period ⇒ this is a filing series in a continuous renderer.
    if (filed === pts.length) {
      v.push({
        invariant: "I-STEPPED",
        where: `${a.label} · ${s.kind}:${s.renderer}`,
        detail:
          `${pts.length} points, all filed periods (${String(pts[0]?.at)}…), drawn by a continuous renderer — ` +
          `nothing is true between two filings, so the slope between them is invented`,
      });
    }
  }
  return v;
}


// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ TWO INVARIANTS ADDED AT PHASE 1 · BATCH 2. Both are defects this batch actually shipped and then
//    caught by reading its own live output, which is the argument for making them properties.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ I-DENOMINATOR — an aggregate stated over a set must state the size of that set.
 *
 * ⚠ THE DEFECT: a peer group's median is computed over the members we SCORE, and the roster is a
 *   different and larger number. Large-Cap NBFCs is 8 members and 0 scored; Large-Cap IT Services is
 *   6 and 6; a pond with a member on an older quarter is a third number again. "Median 64.2" with no
 *   count beside it is a figure the reader cannot bound, and the brief names it directly: *"a group's
 *   median over a changing member set misleads unless membership count is on screen."*
 *
 * ★ IT IS CHECKABLE BECAUSE `set-table` CARRIES `totals` AND `RELATIVE` CARRIES `referenceCount`.
 *   Both were built to hold exactly this and neither was previously asserted to use it — a field that
 *   exists and is optional is a field that gets forgotten on the answer where it matters.
 *
 * ⚠ IT ONLY FIRES WHERE AN AGGREGATE IS ACTUALLY CLAIMED. A screen's match list states no median, so
 *   it is not asked for one; a roster that states one is.
 */
export function iDenominator(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  // Labels that name a figure computed ACROSS a set rather than a property of one member.
  const AGGREGATE = /\b(median|mean|average|typical)\b/i;
  const COUNTISH = /\b(scored|members?|roster|companies|matched|ranked|out of|count|shown)\b/i;

  for (const s of a.sections) {
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    const p = (s.payload ?? {}) as Record<string, unknown>;

    if (s.renderer === "set-table") {
      const totals = (p.totals as { label: string; value: string | null }[] | undefined) ?? [];
      const claimsAggregate = totals.some((t) => AGGREGATE.test(t.label));
      if (!claimsAggregate) continue;
      const statesCount = totals.some((t) => COUNTISH.test(t.label) && t.value !== null && /\d/.test(String(t.value)));
      if (!statesCount) {
        v.push({
          invariant: "I-DENOMINATOR", where: at,
          detail: `a total states an aggregate (${totals.filter((t) => AGGREGATE.test(t.label)).map((t) => t.label).join(", ")}) with no count of the set it is over`,
        });
      }
    }

    if (s.kind === "RELATIVE") {
      const marks = (p.marks as { role?: string }[] | undefined) ?? [];
      // A reference mark is an aggregate over the set — a median, a peer average, an index.
      const hasReference = marks.some((m) => m.role === "reference");
      if (!hasReference) continue;
      const n = p.referenceCount;
      if (typeof n !== "number") {
        v.push({
          invariant: "I-DENOMINATOR", where: at,
          detail: `a reference mark is drawn against "${String(p.referenceLabel)}" with no referenceCount — "+8% against its peers" is meaningless until you know whether that is six peers or forty`,
        });
      }
    }
  }
  return v;
}

/**
 * ★ I-FRAME-STATED — an answer that substituted the reader's criterion must say so, and must not
 *   present the substitute as though it were the thing asked for.
 *
 * ⚠ THE DEFECT, CAUGHT IN THIS BATCH'S OWN LIVE OUTPUT: the frame-declined answer to "show me
 *   undervalued stocks" ran a RANKING of the whole scored universe and the table reported
 *   **"Matched 95 · Out of 95"**. Arithmetically true, and it says a filter ran. The prose above it
 *   said "nothing has been filtered out" — so the component and the sentence directly contradicted
 *   each other, and the figure is the half a reader trusts.
 *
 * ★ TWO STRUCTURAL CHECKS RATHER THAN A READING OF THE ENGLISH:
 *     1 · the decline is stated BEFORE any component (opening prose, at least two sentences — the
 *         decline and the substituted basis are two different statements and both are required)
 *     2 · no total anywhere claims a MATCH, because nothing was matched
 *
 * ⚠ KEYED ON `compositionId`, WHICH IS LEGITIMATE HERE AND WOULD NOT BE ELSEWHERE. It is not a
 *   snapshot of behaviour — it is how the answer identifies which contract it is under, the same way
 *   `I-DISTINCT` keys on `slotKey`. Only an answer that declared itself a decline is held to it.
 */
export function iFrameStated(a: AnswerUnderTest): Violation[] {
  if (!/\bdeclined\b/.test(a.compositionId)) return [];
  const v: Violation[] = [];
  const at = `${a.label} · ${a.compositionId}`;

  if (a.prose.opening.filter((x) => x.trim().length > 0).length < 2) {
    v.push({
      invariant: "I-FRAME-STATED", where: at,
      detail: "a declined frame must state BOTH what it will not answer and what it substituted — one sentence cannot carry both",
    });
  }
  for (const s of a.sections) {
    const totals = ((s.payload ?? {}) as Record<string, unknown>).totals as { label: string }[] | undefined;
    for (const t of totals ?? []) {
      if (/\bmatch/i.test(t.label)) {
        v.push({
          invariant: "I-FRAME-STATED", where: `${at} · ${s.kind}:${s.renderer}`,
          detail: `a total labelled "${t.label}" on an answer where no condition was applied — a ranking presented as a filter`,
        });
      }
    }
  }
  return v;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THREE INVARIANTS ADDED AT PHASE 2 · BATCH 1. Every one is a defect this batch shipped and then
//    found by reading its own output — which is the only argument that has ever justified an
//    invariant here.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ I-RAW-TOKEN — no engine enum reaches a reader-facing string.
 *
 * ⚠ THE DEFECT, AND IT HAD SHIPPED: `WaterfallPayload.redistributionReason` (since removed) carried
 *   `missing_pillar` / `market_unavailable`, and the frontend rendered it straight into a paragraph.
 *   A reader on VEDL or LT was shown the literal token in a sentence slot. Neither side was
 *   individually wrong — the backend never said the field was reader-facing and the component assumed
 *   it was — which is exactly the class of defect that needs a property rather than a review.
 *
 * ★ IT SCANS THE SENTENCE-SHAPED FIELDS, NOT EVERY STRING. A payload is full of tokens that are meant
 *   to be tokens: `band`, `state`, `kind`, `renderer`. The rule is about fields whose CONTRACT is
 *   "this is prose" — a note, a phrase, a sentence — plus every digest line's value, which is what
 *   the model reads. A blanket scan would fire on `band: "below_par"` and be turned off within a week.
 *
 * ⚠ THE TEST IS SHAPE, NOT A LIST. `/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/` on a whole trimmed value catches
 *   any snake_case token, including ones nobody has written yet. Matching a hand-kept list of known
 *   enums would only ever catch the enums somebody remembered to add.
 */
const PROSE_FIELDS = [
  "note", "walkNote", "basisNote", "methodNote", "redistributionNote", "emptyPhrase",
  "unavailablePhrase", "stepNote", "sentence", "phrase", "detail", "lookedFor",
];
const SNAKE_TOKEN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

function scanProse(value: unknown, path: string, at: string, v: Violation[]): void {
  if (typeof value === "string") {
    const t = value.trim();
    if (t.length > 0 && SNAKE_TOKEN.test(t)) {
      v.push({ invariant: "I-RAW-TOKEN", where: at, detail: `${path} is the raw token "${t}" — a reader-facing field carrying an engine enum` });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((x, i) => scanProse(x, `${path}[${i}]`, at, v));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, x] of Object.entries(value as Record<string, unknown>)) {
      if (PROSE_FIELDS.includes(k)) scanProse(x, `${path}.${k}`, at, v);
      else if (x && typeof x === "object") scanProse(x, `${path}.${k}`, at, v);
    }
  }
}

export function iRawToken(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  for (const s of a.sections) {
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    scanProse(s.payload, "payload", at, v);
    // ★ AND THE DIGEST, which is what the MODEL reads. A token there does not reach the screen
    //   directly and is worse for it: the model paraphrases around it and produces a sentence nobody
    //   can trace to a field.
    for (const g of s.digest?.groups ?? []) {
      for (const l of g.lines) {
        const t = String(l.value ?? "").trim();
        if (t.length > 0 && SNAKE_TOKEN.test(t)) {
          v.push({ invariant: "I-RAW-TOKEN", where: at, detail: `digest "${l.label}" is the raw token "${t}"` });
        }
      }
    }
  }
  // The prose the reader actually reads.
  for (const [k, t] of Object.entries(a.prose?.leads ?? {})) {
    for (const w of String(t).split(/\s+/)) if (SNAKE_TOKEN.test(w.replace(/[.,;:]$/, ""))) {
      v.push({ invariant: "I-RAW-TOKEN", where: `${a.label} · lead ${k}`, detail: `the lead contains the raw token "${w}"` });
    }
  }
  return v;
}

/**
 * ★ I-WALK-CLOSES — a decomposition either accounts for its own total, or says it does not.
 *
 * ⚠ THIS IS THE ARITHMETIC PROOF THE BRIEF ASKS FOR, MADE A PROPERTY. "The bars must sum to the
 *   composite; that arithmetic is the proof the join is right." The defect it guards is not
 *   hypothetical: `pillar-decomposition.ts` shipped a version that joined pillars on
 *   `(stock, as_of, run)` and therefore returned whichever single pillar that run happened to touch,
 *   reporting the other three as unscored. Its own header records that the output "looks identical to
 *   a correct absent state" on a thin stock — so nothing but the arithmetic can catch it.
 *
 * ★ AND SAYING SO COUNTS AS PASSING. An unreconciled walk is a real state (a pillar we genuinely
 *   cannot decompose), and the rule is N-4's: absence is stated, never silent. What must not happen is
 *   bars that quietly do not add up to the number above them.
 */
export function iWalkCloses(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  for (const s of a.sections) {
    if (s.kind !== "DECOMPOSITION") continue;
    const p = (s.payload ?? null) as { basis?: string; reconciles?: boolean; residual?: number } | null;
    if (!p || p.basis !== "shortfall") continue;
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    if (p.reconciles) continue;
    const said = (s.digest?.groups ?? []).some((g) =>
      g.lines.some((l) => l.state === "absent" && /unexplained|do not account/i.test(String(l.value))));
    if (!said) {
      v.push({ invariant: "I-WALK-CLOSES", where: at,
        detail: `the walk is off by ${p.residual} points and neither the payload nor the digest says so` });
    }
  }
  return v;
}

/**
 * ★ I-DERIVED-METHOD — a derived structure states how it was derived.
 *
 * ⚠ A PHASE IS NOT A FILED FACT. Nobody reported that INDUSINDBK "changed level at FY25Q3"; a
 *   change-point method decided it, with a minimum run length and a minimum step, and a different
 *   method would draw different lines on the same data. Everything else this product renders is
 *   something a company filed or something the scoring engine persisted — this is the first object in
 *   the answer layer that the READ path computes and then presents as a finding.
 *
 * ★ SO THE RULE IS NARROW ON PURPOSE: it binds renderers that carry a derived segmentation, and asks
 *   only that the method travel with it. It does not bind a filed series, a score, or a ranking.
 */
const DERIVED_RENDERERS = new Set(["phase-shaded-spine"]);

export function iDerivedMethod(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  for (const s of a.sections) {
    if (!DERIVED_RENDERERS.has(s.renderer)) continue;
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    const p = (s.payload ?? {}) as { methodNote?: string; basisNote?: string; phases?: unknown[] };
    if (!Array.isArray(p.phases) || p.phases.length === 0) continue;
    if (!p.methodNote || p.methodNote.trim().length < 20) {
      v.push({ invariant: "I-DERIVED-METHOD", where: at,
        detail: `${p.phases.length} phase(s) drawn with no statement of how they were found — a derived object presented as a filed one` });
    }
    if (!p.basisNote || p.basisNote.trim().length < 20) {
      v.push({ invariant: "I-DERIVED-METHOD", where: at,
        detail: `a series is drawn with no statement of WHICH series it is — the score's history and the company's filings are different lengths and different claims` });
    }
  }
  return v;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ TWO INVARIANTS ADDED AT PHASE 2 · BATCH 2. Both guard something this batch could have shipped
//    silently, and one of them is a defect that HAD shipped and sat unnoticed through three batches.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ I-BOUNDARY — a claim is not rendered without its limit.
 *
 * ⚠ THE DEFECT THIS CATCHES HAD ALREADY SHIPPED. `resolvePortfolio` mapped six of a portfolio
 *   finding's seven fields and dropped `doesntMean` — and the note directly above the mapper LISTS
 *   all seven by name. Every one of the 58 PHS registry entries carries a boundary and NONE carries a
 *   name or a description, so the field being dropped was the only authored copy those entries hold:
 *   *"≠ the position is a mistake, ≠ it will fall, ≠ trim it. Concentration is a fact about how much
 *   the score depends on one name, not a judgment on the name."* That sentence is the reason a
 *   concentration finding is safe to put in front of a reader, and it reached nobody.
 *
 * ★ `doesntMean` IS `EntryBase`'s ONE UNIVERSAL REQUIREMENT — 132 of 132 catalogue entries carry it
 *   against 74 that carry a description. The registries already treat the limit of a claim as more
 *   load-bearing than the claim's elaboration; this makes the ANSWER layer treat it the same way.
 *
 * ⚠ IT DOES NOT DEMAND A BOUNDARY WHERE NONE IS HELD, because a fabricated one reads exactly like an
 *   authored one. What it forbids is a boundary that is present-but-empty — a field carrying `""` or
 *   a fragment, which renders as a heading over nothing and reads as "there is no limit on this".
 */
export function iBoundary(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  for (const s of a.sections) {
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    const p = (s.payload ?? null) as
      | { items?: { label: string; doesntMean?: string | null }[]; doesntMean?: string | null; name?: string }
      | null;
    if (!p) continue;

    for (const i of p.items ?? []) {
      if (i.doesntMean === undefined || i.doesntMean === null) continue;
      if (i.doesntMean.trim().length < 15) {
        v.push({ invariant: "I-BOUNDARY", where: at,
          detail: `"${i.label}" carries a boundary field that is not a sentence — an empty limit reads as no limit` });
      }
    }
    // A `defined-term` payload carries the boundary at the top level and MUST have one: every
    // vocabulary it reads guarantees the field.
    if (s.renderer === "defined-term" && p.name) {
      if (!p.doesntMean || p.doesntMean.trim().length < 15) {
        v.push({ invariant: "I-BOUNDARY", where: at,
          detail: `"${p.name}" is defined with no statement of its limits — every registry it can come from guarantees one` });
      }
    }
  }
  return v;
}

/**
 * ★ I-SPLIT-HONEST — a decomposition of a CHANGE does not attribute a crossing.
 *
 * ⚠ THE ZERO-FOR-UNKNOWN DEFECT, THIRD LOCATION. `score_snapshots` stores an unscorable pillar's
 *   subtotal as literal 0. The spine guards against plotting it (`I-STEPPED`'s neighbourhood) and the
 *   waterfall guards against drawing it as a bar. A CHANGE decomposition meets it a third way: the
 *   exact identity `Δ(s·w) = Δs·w₀ + s₁·Δw` stays exact across a crossing while both of its terms
 *   become fiction —
 *
 *     LT · Momentum came back    "its own reading moved 0.0"   (it went from unmeasurable to 39.8)
 *     VEDL · Market went away    "its own reading fell 17.3"   (it did not fall; it stopped existing)
 *
 *   Both would render as findings about the business. The resolver marks those steps and sends no
 *   split; this is what stops a future caller from computing one itself because the arithmetic is
 *   right there and looks safe.
 */
export function iSplitHonest(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  for (const s of a.sections) {
    if (s.renderer !== "bridge") continue;
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    const p = (s.payload ?? null) as
      | { steps?: { key: string; label: string; parts?: { label: string; value: number }[]; note?: string | null }[] }
      | null;
    for (const st of p?.steps ?? []) {
      const crossed = typeof st.note === "string"
        && /(could not be scored|became scorable|coming back into|dropping out of|stopped being)/i.test(st.note);
      if (crossed && (st.parts?.length ?? 0) > 0) {
        v.push({ invariant: "I-SPLIT-HONEST", where: at,
          detail: `${st.label} crossed in or out of being scorable and is still split into causes — both halves are exact arithmetic over a stored zero and neither is true` });
      }
    }
  }
  return v;
}

/**
 * ★ I-WINDOW-STATED — an answer shorter than the window asked for says so.
 *
 * ⚠ THE RESOLVED HALF WAS ALWAYS RIGHT AND THE ACKNOWLEDGED HALF WAS MISSING. Every series section
 *   carries a `windowLabel` and no answer has ever padded or invented a period — but "show me the
 *   last 20 quarters" returned 14 with a correct label and nothing saying the reader had asked for
 *   more, leaving them to notice by counting. DX names it: answering a shorter period than asked
 *   without saying so is the quiet lie.
 *
 * ★ IT ASSERTS ONLY WHERE AN ASK EXISTS. A question with no stated window cannot fall short of one,
 *   and demanding a sentence from every answer would be a check that fires on correct ones.
 */
export function iWindowStated(a: AnswerUnderTest): Violation[] {
  const asked = a.askedPeriods ?? null;
  if (asked === null || asked <= 0) return [];

  // The count actually drawn — the longest period run any section put on screen.
  let drawn = 0;
  for (const s of a.sections) {
    const p = (s.payload ?? {}) as { points?: unknown[]; periods?: unknown[]; columns?: unknown[] };
    for (const arr of [p.points, p.periods]) {
      if (Array.isArray(arr) && arr.length > drawn) drawn = arr.length;
    }
  }
  if (drawn === 0 || drawn >= asked) return [];

  const said = [
    ...a.prose.opening,
    ...Object.values(a.prose.leads ?? {}),
    ...Object.values(a.prose.after ?? {}),
    a.prose.close,
  ].join(" ");
  // The acknowledgement has to name the NUMBER ASKED FOR. "14 quarters" alone is the resolved window
  // stated — true, and not the same as saying the reader asked for twenty.
  const acknowledged = new RegExp(`\\b${asked}\\b`).test(said);
  return acknowledged ? [] : [{
    invariant: "I-WINDOW-STATED",
    where: a.label,
    detail: `${asked} period(s) asked for, ${drawn} drawn, and no sentence names the ${asked}`,
  }];
}

/**
 * ★ I-STATES-SURVIVE — a screen over FINDINGS keeps "ran and did not fire" apart from "could not run".
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ THIS IS THE ONE PROPERTY A FINDINGS SCREEN CAN DESTROY THAT NOTHING ELSE WOULD NOTICE.
 *
 * `FindingEvaluationState` is three-valued and the schema's own note says why the third exists:
 * "inferring that from a missing row conflates 'it was clean' with 'we never ran'". A screen is where
 * that gets destroyed — filter to `fired`, call everything else the denominator, and every company we
 * COULD NOT CHECK has been silently reported as clean.
 *
 * ⚠ AND THE SIZES MAKE IT MATTER. Measured live at each stock's latest period: R3 fires at 42, runs
 * clean at 317, and CANNOT BE RUN at 1,889. A fold would turn "we checked 359 companies" into "we
 * checked 2,248" — and the answer would look more authoritative for it, which is the danger.
 *
 * ★ THE ASSERTION IS ON THE TOTALS, NOT ON THE PROSE, because §4.3's amendment is that the component
 *   is what the reader believes: "a component contradicting the sentence above it is worse than one
 *   that says nothing, because the figure looks like the harder evidence". A sentence can say the two
 *   are different while the card shows one number, and the card wins.
 *
 * ⚠ IT FIRES ONLY ON A FINDINGS SCREEN. A metric screen has no such states — its own
 *   not-evaluable half is `Evaluable.reasons`, which `I-DENOMINATOR` already covers — so the test is
 *   keyed on the counts that identify one rather than on a composition id, which a rename would break.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ RE-ANCHORED WHEN THE COUNTS STOPPED BEING RENDERED TOTALS, AND THAT MOVE IS THE INTERESTING PART.
 *
 * The four states used to be `payload.totals` and this gate read them there. They now travel in the
 * section's DIGEST (model-facing) and in the answer's PROSE (reader-facing), because five figures over
 * two lines restated the paragraph directly above the card.
 *
 * ⚠ A GATE LEFT POINTING AT THE OLD HOME WOULD HAVE GONE GREEN, NOT RED. `payload.totals` is now `[]`,
 *   so the "is there a Fired total?" test simply never matches and every findings screen skips the
 *   whole check — a guard that stops guarding while still reporting success, which this file's own
 *   header calls out as the failure mode invariants exist to avoid. So it follows the property to
 *   wherever the property lives.
 *
 * ★ AND IT NOW CHECKS BOTH AUDIENCES, WHICH IT COULD NOT BEFORE. The rule was never "these must be
 *   rendered as totals" — it is "a company we could not check must not be counted as one that
 *   passed", and that has to hold for the reader AND for the model, which composes over the digest.
 *   Splitting the channels made the two testable separately, so both are tested.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export function iStatesSurvive(a: AnswerUnderTest): Violation[] {
  const v: Violation[] = [];
  for (const s of a.sections) {
    if (s.renderer !== "set-table") continue;
    const at = `${a.label} · ${s.kind}:${s.renderer}`;
    const p = (s.payload ?? {}) as Record<string, unknown>;

    // ★ THE COUNTS ARE READ FROM WHEREVER THEY TRAVEL. Rendered totals for a caller that shows them;
    //   the digest for the findings screen, which tells the model and leaves the card clean. Reading
    //   both is what stops this gate going quiet the next time a caller moves them.
    const shownTotals = (p.totals as { label: string; value: string | null }[] | undefined) ?? [];
    const digestLines: { label: string; value: string | null }[] = [];
    for (const g of (s.digest as { groups?: { lines?: { label?: string; value?: unknown }[] }[] } | undefined)?.groups ?? []) {
      for (const l of g.lines ?? []) {
        digestLines.push({ label: String(l.label ?? ""), value: l.value == null ? null : String(l.value) });
      }
    }
    const totals = [...shownTotals, ...digestLines];

    // A findings screen is the one that reports a FIRED count. Nothing else in the product does.
    const fired = totals.find((t) => /^fired$/i.test(t.label));
    if (!fired) continue;

    const ranClean = totals.find((t) => /did not fire/i.test(t.label));
    const couldNot = totals.find((t) => /could not be checked/i.test(t.label));

    if (!ranClean || !couldNot) {
      v.push({
        invariant: "I-STATES-SURVIVE", where: at,
        detail: "a findings screen reports a fired count without BOTH of the other two states "
          + `(ran-and-did-not-fire: ${ranClean ? "present" : "MISSING"}, `
          + `could-not-be-checked: ${couldNot ? "present" : "MISSING"}) — a company we could not check `
          + "is being counted as one that passed",
      });
      continue;
    }

    // ⚠ AND THEY MUST BE TWO ROWS, NOT ONE LABEL CARRYING A SUM. A single "did not fire" row whose
    //   value happens to include the unevaluable set is the fold wearing the right label.
    if (ranClean.value !== null && couldNot.value !== null && ranClean.value === couldNot.value
        && Number(String(ranClean.value).replace(/[^0-9]/g, "")) > 0) {
      v.push({
        invariant: "I-STATES-SURVIVE", where: at,
        detail: `both states report the identical figure (${ranClean.value}) — either a genuine `
          + "coincidence or one value being written into both rows; the second is the fold",
      });
    }

    // ★ THE ARITHMETIC HAS TO CLOSE, which is the only way to know nothing was quietly dropped. Every
    //   company we hold is in exactly one of the four states.
    const num = (t: { value: string | null } | undefined): number | null => {
      if (!t || t.value === null) return null;
      const m = /-?[\d,]+/.exec(String(t.value));
      return m ? Number(m[0].replace(/,/g, "")) : null;
    };
    const outOf = num(totals.find((t) => /^out of$/i.test(t.label)));
    const parts = [num(fired), num(ranClean), num(couldNot), num(totals.find((t) => /never checked/i.test(t.label))) ?? 0];
    if (outOf !== null && parts.every((x) => x !== null)) {
      const sum = (parts as number[]).reduce((x, y) => x + y, 0);
      // ⚠ A BAND NARROWS THE SHOWN SET WITHOUT CHANGING THE CENSUS, so the four states still sum to
      //   the whole population — the band is reported as its own row, not by shrinking these.
      if (sum !== outOf) {
        v.push({
          invariant: "I-STATES-SURVIVE", where: at,
          detail: `the four states sum to ${sum} against a stated population of ${outOf} — `
            + `${Math.abs(sum - outOf)} companies are in no state at all, or in two`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ AND THE READER'S HALF. The digest above is what the MODEL is told; this is what the person
    //    reading the answer is told, and it is now the ONLY place they are told it.
    //
    // ⚠ THE CARD NO LONGER CARRIES THE COUNTS, so "it is in the payload somewhere" has stopped being
    //   a defence. If the opening does not distinguish a check that ran and found nothing from a
    //   check that could not run, the reader has been handed a list of firing companies and an
    //   unqualified denominator — which reads as "everyone else is clean" and is false on most rules
    //   by a factor of five.
    //
    // ⚠⚠ IT ASSERTS THE PROPERTY, NOT A WORDING, AND THAT DISTINCTION IS THE WHOLE POINT OF THE ARM.
    //
    //    The first version demanded the phrase "could not run" or "not a clean bill of health" — which
    //    is a gate asserting COPY, and it locked in the alarmed register the Operator then (rightly)
    //    asked to remove. An answer can be perfectly honest with no warning word in it.
    //
    // ★ THE PROPERTY IS: THE READER IS GIVEN THE DENOMINATOR THE CHECK ACTUALLY RAN ON. If 2,058 of
    //   2,291 could be checked, "59 of 2,291" is the misleading sentence and "59 out of the 2,058 the
    //   check could be run on" is the honest one — and no adjective is required to tell them apart,
    //   only the number. Where the check ran everywhere there is nothing to distinguish and the arm
    //   does not fire.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const num2 = (t: { value: string | null } | undefined): number | null => {
      if (!t || t.value === null) return null;
      const m = /-?[\d,]+/.exec(String(t.value));
      return m ? Number(m[0].replace(/,/g, "")) : null;
    };
    const nFired = num2(fired);
    const nClean = num2(ranClean);
    const nPop = num2(totals.find((t) => /^out of$/i.test(t.label)));
    if (nFired !== null && nClean !== null && nPop !== null && nFired + nClean < nPop) {
      const said = (a.prose?.opening ?? []).join(" ");
      const checked = nFired + nClean;
      // The checked count, however it is grouped — "2,058" or "2058".
      const shown = said.includes(checked.toLocaleString("en-IN")) || said.includes(String(checked));
      if (!shown) {
        v.push({
          invariant: "I-STATES-SURVIVE", where: `${a.label} · prose.opening`,
          detail: `the check ran on ${checked} of ${nPop} companies and the opening never states that `
            + `denominator — so the reader reads the count against the whole book, and the `
            + `${nPop - checked} it could not run on are silently counted as clean`,
        });
      }
    }
  }
  return v;
}

/** Every per-answer invariant, in one call. `iDistinct` is cross-answer and runs separately. */
export const PER_ANSWER: readonly { id: string; run: (a: AnswerUnderTest) => Violation[] }[] = [
  { id: "I-FALSE-ZERO", run: iFalseZero },
  { id: "I-PLACEHOLDER", run: iPlaceholder },
  { id: "I-PROSE-COLLISION", run: iProseCollision },
  { id: "I-REPEATED-LABEL", run: iRepeatedLabel },
  { id: "I-SET-RECONCILES", run: iSetReconciles },
  { id: "I-INTERPOLATION", run: iInterpolation },
  { id: "I-ACTIONABLE", run: iActionable },
  // ── Phase 1 · Batch 1. Two family constraints made universal, plus the step rule. ──────────────
  { id: "I-BASIS", run: iBasis },
  { id: "I-PLEDGE-SILENT", run: iPledgeSilent },
  { id: "I-STEPPED", run: iStepped },
  // ── Phase 1 · Batch 2. A set's denominator, and a substituted criterion stated as one. ─────────
  { id: "I-DENOMINATOR", run: iDenominator },
  { id: "I-FRAME-STATED", run: iFrameStated },
  // ── Phase 2 · Batch 1. An engine token in prose, a walk that does not close, a derived object with
  //    no stated method. All three shipped in this batch before they were properties.
  { id: "I-RAW-TOKEN", run: iRawToken },
  { id: "I-WALK-CLOSES", run: iWalkCloses },
  { id: "I-DERIVED-METHOD", run: iDerivedMethod },
  // ── Phase 2 · Batch 2. A claim without its limit, and a change decomposition that attributes a
  //    crossing. The first had already shipped.
  { id: "I-BOUNDARY", run: iBoundary },
  { id: "I-SPLIT-HONEST", run: iSplitHonest },
  // ── Phase 3. A shorter answer than the one asked for says so.
  { id: "I-WINDOW-STATED", run: iWindowStated },
  // ── The screens batch. A findings screen keeps its three evaluation states apart — the one thing
  //    a filter over that layer can destroy, and the reason the layer records three rather than two.
  { id: "I-STATES-SURVIVE", run: iStatesSurvive },
];

export function checkAnswer(a: AnswerUnderTest): Violation[] {
  return PER_ANSWER.flatMap((i) => i.run(a));
}
