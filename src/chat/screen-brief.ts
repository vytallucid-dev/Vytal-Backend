// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SCREEN BRIEF — one screen result → the text the model actually reads.
//
// Same split as universe-brief.ts ↔ universe-projection.service.ts, for the same reason: the service
// decides WHAT is true and bounded, this decides how it arrives in a small model's context. A data
// question moves the service; a measured behaviour moves this file.
//
// ── ★ THREE MEASURED LESSONS ARE BUILT IN, NOT RE-LEARNED ──────────────────────────────────────────
//
// 1. COUNTS LEAD, THEY DO NOT FOLLOW. universe-brief's `capLead` records the live finding: the bound
//    written as a trailing parenthetical was simply skipped — the model relayed twelve findings and
//    never said there were twenty-two. So every count here comes FIRST, as a sentence about the whole
//    set, and it NAMES THE SENTENCE TO SAY rather than merely stating a number.
//
// 2. TWO ADJACENT LISTS GET JOINED, WRONGLY. Handed per-flag counts and a separate company list, the
//    model paired them and got five of six attributions wrong — confidently, from individually-true
//    facts. That is why `ScreenRow` carries its own values and why they are rendered ON the row here.
//    There is no second list to join against.
//
// 3. THE DENOMINATOR IS NOT OPTIONAL. A screen over 82 non-financial companies reported as a bare list
//    is read as a screen over everything Vytal scores. The evaluable block is emitted on EVERY result,
//    including when nothing was excluded, because a rule the model learns only sometimes is a rule it
//    does not have.
//
// ⚠ NO CLOSED_WORLD_HEADER — it leads message[0] and governs everything downstream (compose.ts).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { scoreStr, NA } from "./tools/shared.js";
import type { Capped, CompanyRef, PeriodContract } from "../scoring/read/universe-projection.types.js";
import type {
  AppliedCondition,
  Evaluable,
  FieldSpread,
  MatchesResult,
  ScreenProjection,
  ScreenUnit,
  ScreenValue,
  SpreadResult,
  StructuralFilters,
  UnrecognisedResult,
} from "../scoring/read/screen.types.js";

const SCOPE_TITLE: Record<string, string> = {
  universe: "THE SCORED UNIVERSE",
  portfolio: "THE READER'S OWN HOLDINGS (the scored ones)",
  watchlist: "THE READER'S OWN WATCHLIST (the scored ones)",
};

const SCOPE_NOTE: Record<string, string> = {
  universe: "Scope: every company Vytal scores. Vytal tracks more Indian stocks than it scores; this is the scored set.",
  portfolio: "Scope: ONLY the companies the reader holds that Vytal scores. Every count below is about THEIR book, not the market — never relay these as market-wide numbers.",
  watchlist: "Scope: ONLY the companies on the reader's watchlist that Vytal scores. Every count below is about THEIR list, not the market — never relay these as market-wide numbers.",
};

/** A value with its unit attached. ★ A screen NEVER emits a bare number — "24.3" alone invites the
 *  model to attach whatever unit the reader's question implied, which is how a ratio becomes a percent. */
function sayValue(v: number, unit: ScreenUnit): string {
  switch (unit) {
    case "points": return scoreStr(v);
    case "percent": return `${Number(v.toFixed(2))}%`;
    case "times": return `${Number(v.toFixed(2))}x`;
    case "days": return `${Number(v.toFixed(1))} days`;
    case "ratio": return String(Number(v.toFixed(2)));
  }
}

/** "return on equity at least 20%" / "debt to equity at most 1" / "…between X and Y". */
function sayCondition(c: AppliedCondition): string {
  const lo = c.min != null ? sayValue(c.min, c.unit) : null;
  const hi = c.max != null ? sayValue(c.max, c.unit) : null;
  if (lo && hi) return `${c.label} between ${lo} and ${hi} (both ends included)`;
  if (lo) return `${c.label} of at least ${lo}`;
  return `${c.label} of at most ${hi}`;
}

/** ★ THE PERIOD BLOCK — lifted verbatim in intent from universe-brief.ts. A filtered list is still a
 *  mixed-period cross-section, and this is the only thing standing between the model and
 *  "as of FY27Q1, 12 companies have ROE above 20%" — false for a third of them. */
function periodBlock(p: PeriodContract): string {
  const L: string[] = [];
  L.push(
    "★ HOW TO SAY THE DATE. Each company below is read at ITS OWN most recent reported quarter — the quarters DIFFER across companies. " +
      'Say "each at its most recent reported quarter". NEVER name one quarter as though it covered them all ("as of <a quarter>, N companies …") — that sentence would be false for the rest.',
  );
  if (p.spread.length) {
    const parts = p.spread.map((s) => `${s.count} at ${s.period}`).join(", ");
    L.push(`  Quarters actually represented: ${parts}${p.mixed ? " — more than one, which is why no single label fits." : "."}`);
  }
  L.push(
    `  Most recent rescore across this read: ${p.asOfDate ?? NA}. Companies in this read: ${p.companiesRead} — ★ STATE THIS NUMBER EXACTLY. "${p.companiesRead}", never "about ${Math.round(p.companiesRead / 10) * 10}" or "nearly ${Math.ceil(p.companiesRead / 50) * 50}". It is a count, not an estimate.`,
  );
  if (p.notRescored.total > 0) {
    const names = p.notRescored.shown.map((n) => `${n.symbol} (last ${n.lastQuarter})`).join(", ");
    L.push(`  Held OUT of this read — no longer being rescored: ${p.notRescored.total} (${names}). They are not counted in any number below.`);
  }
  return L.join("\n");
}

function head(title: string, scope: string): string[] {
  return [`=== VYTAL — ${SCOPE_TITLE[scope] ?? SCOPE_TITLE.universe}: ${title} ===`, SCOPE_NOTE[scope] ?? SCOPE_NOTE.universe];
}

function namesOf(c: Capped<CompanyRef>): string {
  const shown = c.shown.map((x) => `${x.symbol} (${x.name})`).join(", ");
  return c.total > c.shown.length ? `${shown}, and ${c.total - c.shown.length} more` : shown;
}

/**
 * ★ THE EVALUABLE BLOCK — emitted on every result, even when nothing was excluded.
 *
 * It leads with the denominator and names the sentence, because the failure mode is not the model
 * getting the number wrong; it is the model never mentioning that there was one.
 */
function evaluableBlock(e: Evaluable, what: string): string {
  const L: string[] = [];
  if (e.notEvaluable === 0) {
    L.push(`EVALUABLE: all ${e.considered} companies in this read could be tested on ${what}. No company was left out.`);
    return L.join("\n");
  }
  L.push(
    `★ THE DENOMINATOR — SAY IT. Of the ${e.considered} companies in this read, ${e.evaluable} could be tested on ${what}; ` +
      `${e.notEvaluable} could NOT and are NOT in the list below. ` +
      `Your answer must be about ${e.evaluable} companies, not ${e.considered} — say "of the ${e.evaluable} companies Vytal measures on ${what}" or your own words for it. ` +
      `A reader shown a list out of ${e.evaluable} who thinks it came out of ${e.considered} has been misled.`,
  );
  for (const r of e.reasons) {
    L.push(`  · ${r.count} not tested — ${r.reason}: ${namesOf(r.companies)}`);
  }
  L.push(
    "  ⚠ THESE ARE NOT COMPANIES THAT FAILED THE TEST, and they are not missing data. They are measured on a different set of metrics. " +
      "Never describe them as scoring badly, and never imply Vytal lacks information about them.",
  );
  return L.join("\n");
}

function structuralBlock(s: StructuralFilters): string | null {
  const parts: string[] = [];
  if (s.band) parts.push(`band is ${s.band}`);
  if (s.sector) parts.push(`sector is ${s.sector}`);
  if (s.redFlags === "none") parts.push("firing NO red flag");
  if (s.redFlags === "any") parts.push("firing at least one red flag");
  return parts.length ? `Also filtered to: ${parts.join(" · ")}.` : null;
}

// ── MATCHES ────────────────────────────────────────────────────────────────────────────────────────

function renderMatches(s: MatchesResult): string {
  const L = head("companies matching the reader's conditions", s.scope);
  L.push(periodBlock(s.period));

  const what = s.conditions.length ? s.conditions.map((c) => c.label).join(" and ") : "these conditions";

  if (s.conditions.length) {
    L.push(`CONDITIONS APPLIED, all at once (a company must meet EVERY one): ${s.conditions.map(sayCondition).join(" · ")}.`);
    L.push("★ Bounds INCLUDE the number given — a company sitting exactly on it is in.");
    // ★ THE ONE FAILURE NO SERVER-SIDE CHECK CAN CATCH, MITIGATED WHERE IT STILL CAN BE.
    //   A reader who says "Foundation above 70" and a model that INVENTED 70 produce byte-identical
    //   calls — the service cannot tell them apart, so it cannot refuse the second. Measured live: on
    //   "which stocks have strong Foundation?" the model supplied 70 on one run and correctly asked for
    //   a figure on the next. What the result CAN do is deny the invented number its authority: state
    //   the figure back as an assumption belonging to whoever chose it, and make it correctable. A
    //   stated, changeable assumption is not a judgement Vytal made.
    L.push(
      `★ WHOSE NUMBER IS THIS? ${s.conditions.map((c) => `${c.min != null ? c.min : ""}${c.min != null && c.max != null ? "/" : ""}${c.max != null ? c.max : ""} for ${c.label}`).join(", ")} — ` +
        "Vytal did not choose it and has no view on whether it is the right one. If the READER named it, use it plainly. " +
        "If YOU supplied it because they described a level in words, you must SAY the figure you used and invite them to change it " +
        "(\"taking 70 as the cut — tell me if you'd set it elsewhere\"). Never present it as Vytal's line, a standard, or what counts as good.",
    );
  }
  const st = structuralBlock(s.structural);
  if (st) L.push(st);

  L.push(evaluableBlock(s.evaluable, what));

  // ★ THE COUNT LEADS. See capLead's measured lesson in universe-brief.ts.
  const m = s.matches;
  if (m.total === 0) {
    L.push(
      `MATCHES: none. Not one of the ${s.evaluable.evaluable} companies Vytal could test meets ${s.conditions.length > 1 ? "all of these conditions together" : "this condition"}. ` +
        "That is a real, honest result — say so plainly. Do NOT loosen the reader's numbers to produce a list, and do NOT offer companies that came close unless the reader asks.",
    );
    return L.join("\n");
  }
  L.push(
    m.total > m.shown.length
      ? `MATCHES: ${m.total} of the ${s.evaluable.evaluable} testable companies meet ${s.conditions.length > 1 ? "all of these" : "this"}. The ${m.shown.length} listed below are the first by ${s.sortedBy} — SAY "${m.shown.length} of ${m.total}"; do not imply this is all of them.`
      : `MATCHES: ${m.total} of the ${s.evaluable.evaluable} testable companies meet ${s.conditions.length > 1 ? "all of these" : "this"}, all listed below, ordered by ${s.sortedBy}.`,
  );
  for (const row of m.shown) {
    // ★ THE VALUES ARE ON THE ROW. No second list to mis-join. See the header, lesson 2.
    const vals = row.values.map((v: ScreenValue) => `${v.label} ${sayValue(v.value, v.unit)}`).join(" · ");
    L.push(`  · ${row.symbol} — ${row.name} · health ${scoreStr(row.score)}, ${row.band}${vals ? ` · ${vals}` : ""}`);
  }
  L.push(
    "★ EACH COMPANY'S OWN FIGURES ARE ON ITS OWN LINE ABOVE. Quote them from that line and nowhere else — do not carry a number across rows, " +
      "do not average them, and do not state a figure for a company whose line does not show one.",
  );
  L.push(
    "(This is a filter result, not a recommendation. Meeting a number the reader chose is not Vytal saying a company is a good investment — " +
      "report who cleared the bar, never who is worth buying.)",
  );
  return L.join("\n");
}

// ── SPREAD ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * ★ THE ANSWER TO A THRESHOLD THAT WAS NEVER NAMED.
 *
 * This is the whole non-advisory position in one payload: it contains the distribution and NO
 * threshold, so there is nothing here for the model to relay as Vytal's view of what "good" is. The
 * instruction is explicit because the model's instinct is to be helpful by picking one.
 */
function renderSpread(s: SpreadResult): string {
  const L = head("what the numbers actually look like", s.scope);
  L.push(periodBlock(s.period));
  L.push(
    "★ THE READER DESCRIBED A LEVEL IN WORDS AND NAMED NO NUMBER — \"good\", \"strong\", \"high\", \"low\", \"solid\". " +
      "VYTAL HAS NO SUCH LINE. There is no figure at which Vytal calls a number good; that judgement is the reader's and Vytal does not make it. " +
      "So: DO NOT PICK A THRESHOLD. Do not say \"typically above X is considered good\", do not take one from your own knowledge, and do not " +
      "treat the median below as a pass mark. Hand back the spread, say plainly that the level is theirs to set, and ask which figure they want. " +
      "This result contains NO list of companies, because no threshold was given to make one from.",
  );
  const st = structuralBlock(s.structural);
  if (st) L.push(st);

  for (const f of s.spreads) {
    L.push("");
    L.push(`${f.label.toUpperCase()} — across the companies Vytal measures on it:`);
    L.push(evaluableBlock(f.evaluable, f.label));
    if (f.evaluable.evaluable === 0) {
      L.push(`  No company in this read is measured on ${f.label}, so there is no spread to give. Say that plainly.`);
      continue;
    }
    L.push(
      `  Lowest ${sayValue(f.min, f.unit)} · a quarter are below ${sayValue(f.p25, f.unit)} · the middle is ${sayValue(f.median, f.unit)} · ` +
        `a quarter are above ${sayValue(f.p75, f.unit)} · highest ${sayValue(f.max, f.unit)}.`,
    );
    L.push(
      `  ★ These are five DESCRIPTIONS of where the ${f.evaluable.evaluable} companies actually sit — they are not grades, and none of them is a recommended cut-off.`,
    );
  }
  L.push("");
  L.push(
    "★ WHAT TO DO NOW: give the reader the spread in a sentence, say the level is theirs to choose, and ask for a figure. " +
      "Once they name one, call this tool again with that number as min or max.",
  );
  return L.join("\n");
}

// ── UNRECOGNISED / EMPTY ───────────────────────────────────────────────────────────────────────────

function renderUnrecognised(s: UnrecognisedResult): string {
  const L = head(`an unrecognised ${s.what}`, s.scope);
  if (s.what === "band") {
    L.push(
      `⚠ "${s.given}" is not one of Vytal's five bands. The five are ${s.available.join(", ")}. ` +
        "Say that plainly — do NOT map it onto whichever band seems closest, and do not run the screen without it.",
    );
  } else {
    L.push(
      `⚠ "${s.given}" is not a sector Vytal groups companies into. The sectors it does are: ${s.available.join(", ")}. ` +
        "Say that plainly and offer the closest REAL one by name for the reader to confirm — do not silently substitute it yourself.",
    );
  }
  return L.join("\n");
}

function renderEmpty(scope: string, reason: string): string {
  if (reason === "universe-unscored") {
    return "=== VYTAL — THE SCORED UNIVERSE ===\nVytal has no in-force scores right now, so there is nothing to screen. This is a real state, not an error.";
  }
  const what = scope === "portfolio" ? "holds" : "is watching";
  return (
    `=== VYTAL — ${SCOPE_TITLE[scope] ?? SCOPE_TITLE.universe} ===\n` +
    `The reader ${what} nothing that Vytal scores, so there is nothing to screen. This is a real, honest state — not an error and not a gap in Vytal. ` +
    "Say so plainly and offer the same screen across the whole scored universe instead."
  );
}

// ── THE ASSERTION ──────────────────────────────────────────────────────────────────────────────────

/**
 * ★ NO ENGINE METRIC CODE MAY REACH THE MODEL. `assertNoInternalIdentifiers` (the shared one, run on
 * the projection object) does not know about F1/M2/Tier1 — those are this module's own vocabulary risk,
 * and they are short enough that adding them to the shared list would risk false positives on copy that
 * legitimately contains them. So the check lives here, on the FINISHED STRING, where it is exact.
 *
 * Throwing rather than stripping, for the same reason the shared assertion throws: a code here is a
 * programming error, not a data condition, and the tool layer is fail-soft so it becomes an honest
 * error handed to the model rather than an exception in front of a reader.
 */
const METRIC_CODE = /(?<![A-Za-z0-9])(?:F(?:10|[1-9])(?:_[A-Z_]+)?|M(?:[1-5])(?:_[A-Z_]+)?|Tier1|GNPAttm|GNPA|NNPA|PCR|CASA|NPyoy|PPOP)(?![A-Za-z0-9])/;

export function assertNoMetricCodes(text: string): void {
  const hit = METRIC_CODE.exec(text);
  if (hit) throw new Error(`screen brief leaked an engine metric code: "${hit[0]}"`);
}

/** One screen result → the tool result text. */
export function renderScreen(p: ScreenProjection): string {
  const text =
    p.kind === "matches" ? renderMatches(p)
    : p.kind === "spread" ? renderSpread(p)
    : p.kind === "unrecognised" ? renderUnrecognised(p)
    : renderEmpty(p.scope, p.reason);
  assertNoMetricCodes(text);
  return text;
}
