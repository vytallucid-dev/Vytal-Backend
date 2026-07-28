// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SHARED TOOL HELPERS — the render discipline every tool obeys, in one place.
//
// CLOSED-WORLD DISCIPLINE, MECHANISED. The rule is that every value is LABELED and a missing one reads
// "not available" rather than being omitted (an omission is read as license to guess). `kvLine` is the
// one primitive that enforces it: pass a null and you get the honest label, never a dropped line.
//
// ONE NUMBER CONVENTION. scoreStr / pctStr / pctPointStr / moneyStr are RE-EXPORTED from ai/grounding.ts
// rather than reimplemented, so a tool result and the page can never state one number two ways. Do not
// add a local formatter here for something grounding already speaks.
//
// ⚠ NO CLOSED_WORLD_HEADER. It already leads message[0] and governs everything downstream in history;
// re-embedding it per tool result is the double-header bug compose.ts warns about.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { NA, isNum, scoreStr, pctStr, pctPointStr, moneyStr } from "../../ai/grounding.js";

export { NA, isNum, scoreStr, pctStr, pctPointStr, moneyStr };

/** `label: value` — the closed-world primitive. A null/undefined/empty renders "not available",
 *  NEVER an omitted line. `unit` is appended only to a present value. */
export const kvLine = (label: string, value: unknown, unit = ""): string =>
  value === null || value === undefined || value === "" ? `${label}: ${NA}` : `${label}: ${value}${unit}`;

/** A plain number → fixed-decimal string, or "not available". For raw financial figures that are not
 *  scores/percents/money (counts, ratios, multiples). */
export const numStr = (x: unknown, decimals = 2): string => (isNum(x) ? String(Number(x.toFixed(decimals))) : NA);

/** A ₹ crore figure (the app stores many statement values in ₹ Cr) spoken in the app's own convention.
 *  Converts Cr → rupees so moneyStr's lakh/crore rule applies to the same underlying quantity. */
export const croreStr = (x: unknown): string => (isNum(x) ? moneyStr(x * 1e7) : NA);

/** An already-percent value (e.g. a margin of 18.4). Uses grounding's own already-percent rule. */
export const pctPoint = (x: unknown): string => (isNum(x) ? pctPointStr(x) : NA);

/** A signed already-percent value, sign preserved for direction (returns, deltas). */
export const signedPct = (x: unknown): string => (isNum(x) ? `${x >= 0 ? "+" : ""}${Number(x.toFixed(1))}%` : NA);

/** Join non-empty blocks with blank lines. */
export const joinBlocks = (blocks: (string | null | undefined)[]): string =>
  blocks.filter((b) => b && b.trim()).join("\n");

/** The last `n` items of a series — the bound every unbounded read service result passes through.
 *  Returns the tail (newest) because that is what a conversation asks about. */
export const lastN = <T>(xs: readonly T[] | null | undefined, n: number): T[] =>
  !xs || !xs.length ? [] : xs.slice(Math.max(0, xs.length - n));

/** A trailing note stating a series was bounded — so the model never implies it saw everything. */
export const boundedNote = (shown: number, total: number, unit: string): string =>
  total > shown ? `(showing the ${shown} most recent of ${total} ${unit} on file)` : `(${total} ${unit} on file)`;

/**
 * ★ THE BARE-TICKER SENTENCE — appended to every tool that takes a `symbol`.
 *
 * Stage 2 measured the model calling `searchStocks` on inputs that were ALREADY exact tickers, costing a
 * whole extra generation per turn. The fix attempted then was a NEGATIVE instruction on searchStocks
 * itself ("if the reader already gave an exact ticker, skip this") — and it did not work: the model kept
 * calling it. We accepted the cost, because on a read turn it buys one extra generation.
 *
 * ⚠ THE CALCULUS CHANGED WHEN WRITES ARRIVED. On a write turn a needless searchStocks costs a ROUND, not
 * just a unit, and rounds are contended: searchStocks → resolveDate → recordTransaction → recovery is
 * already at the old cap of 4. A live write turn died mid-recovery for exactly this reason.
 *
 * So the instruction moves and flips: instead of telling searchStocks not to fire (a negative, on the
 * tool we do NOT want called), each receiving tool says what to do with a ticker it can already use (a
 * positive, on the tool we DO want called). The model reads it while deciding to call THIS tool, which is
 * the moment the decision is actually made.
 */
export const BARE_TICKER_DIRECT =
  " If the reader already gave an exact NSE ticker — all-caps, no spaces, like ACC, TCS or HDFCBANK — that " +
  "IS the exact symbol: pass it straight to this tool. It needs no lookup first, and searching for it " +
  "wastes a step.";
