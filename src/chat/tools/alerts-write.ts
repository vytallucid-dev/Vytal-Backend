// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WRITE TOOLS: createAlert / deleteAlert.
//
// ★ THE COHERENCE RULES ARE NOT RESTATED HERE. `CreateAlertInput` — the exact schema POST /me/alerts
// parses with, superRefine and all — is imported from the alerts service and run on the model's
// arguments. So "a finding alert takes findingKey, not threshold" and "a health_band threshold must be
// one of fragile…pristine" reach the model as the SAME sentences a bad HTTP request gets, and a change
// to the rule reaches both callers at once. The tool's own contribution is one thing only: turning a
// ticker into a stockId.
//
// A rejection is handed BACK to the model as an ok:false error, which is the fail-soft contract — the
// model reads it, tells the reader what is missing, and asks. That is why the rule text has to be
// readable prose rather than a zod dump.
//
// ── deleteAlert AND THE ID PROBLEM ─────────────────────────────────────────────────────────────────
// A reader says "drop the price alert on HDFC", not a uuid. So the tool resolves BY SYMBOL (optionally
// narrowed by type), owner-scoped, and:
//     0 matches  → an honest "you have no alert there", no proposal
//     1 match    → propose it, with the resolved id captured in args
//     2+ matches → REFUSE and list them with their ids, so the reader picks
// The 2+ branch is the same discipline recordTransaction applies to a vague quantity: when the input
// admits more than one reading, ask — never delete the first one and hope.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { CreateAlertInput, BANDS } from "../../alerts/service.js";
import { loadFindingKeys, suggestFindingKeys, RETIRED_FINDING_KEYS } from "../../alerts/finding-catalog.js";
import { resolveStock, str, propose, rupees } from "./write-shared.js";
import type { ProposalField } from "./write-shared.js";
import { zodMessage } from "../../lib/service-error.js";
import { BARE_TICKER_DIRECT } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

// ── CREATE ──────────────────────────────────────────────────────────────────────────────────────────
interface CreateArgs {
  symbol?: unknown;
  type?: unknown;
  operator?: unknown;
  threshold?: unknown;
  thresholdPercent?: unknown;
  findingKey?: unknown;
  repeatMode?: unknown;
}

/** The UI's own per-type defaults (lib/alerts.ts DEFAULT_REPEAT) — a price target is a one-time
 *  thing; a health band or a new finding is a standing watch you want told about each time. */
const DEFAULT_REPEAT: Record<string, "one_shot" | "repeating"> = {
  price: "one_shot",
  health_band: "repeating",
  finding: "repeating",
};

const CREATE_DESCRIPTION =
  "Propose creating an alert on one covered stock for the reader. Three kinds, and the fields that go with " +
  "each are not interchangeable: " +
  "(1) type \"price\" — operator \"above\" or \"below\", threshold = a positive rupee number; " +
  "(2) type \"health_band\" — operator \"above\" or \"below\", threshold = one of " + BANDS.join(", ") + "; " +
  "(3) type \"finding\" — operator \"fires\", and either findingKey for one specific finding or no findingKey " +
  "at all to mean any new finding. Never send a threshold with a finding alert or a findingKey with the other " +
  "two. Alerts are checked once a day on end-of-day data, not live. " +
  "★ PRICE AS A PERCENTAGE: if the reader says \"tell me if it rises 5%\" rather than naming a rupee figure, " +
  "send thresholdPercent: 5 (with operator above/below) INSTEAD of threshold, and this works out the rupee " +
  "target from the current price for you — never do that arithmetic yourself. ⚠ The percentage is resolved " +
  "ONCE, at the moment the alert is created: what gets stored is the fixed rupee figure, and it does NOT " +
  "track the price afterwards. Say that plainly when you restate it, because a reader who thinks it trails " +
  "the price will be surprised. " +
  "Health-band and finding alerts need a Vytal health score; on a stock Vytal has not scored yet only price " +
  "alerts are possible, and this tool will tell you so. " +
  "THIS DOES NOT CREATE THE ALERT — it returns a proposal describing exactly what would be created. You MUST " +
  "state every value back to the reader and ask them to confirm; never reply as though the alert is set. " +
  "Only after they say yes do you call confirmPendingAction. Takes a ticker — it always writes to the " +
  "signed-in reader's own alerts and can never touch anyone else's." +
  BARE_TICKER_DIRECT;

const CREATE_PARAMETERS = {
  type: "object",
  properties: {
    symbol: { type: "string", description: 'NSE ticker of a Vytal-covered stock, e.g. "HDFCBANK".' },
    type: { type: "string", enum: ["price", "health_band", "finding"], description: "Which kind of alert." },
    operator: { type: "string", enum: ["above", "below", "fires"], description: "above/below for price and health_band; fires for finding." },
    threshold: {
      type: ["number", "string"],
      description: `For price: a positive rupee number. For health_band: one of ${BANDS.join(", ")}. Omit entirely for a finding alert.`,
    },
    thresholdPercent: {
      type: "number",
      description:
        "Price alerts only, INSTEAD of threshold: a positive percent move from the CURRENT price (5 means 5%). " +
        "Resolved to a fixed rupee target once, at creation — it does not follow the price afterwards.",
    },
    findingKey: {
      type: "string",
      description:
        "Finding alerts only. Omit to mean 'any new finding'. Must be a real finding key Vytal emits — if you are " +
        "not certain of the exact key, omit it and ask the reader, or pass their words and read the suggestions back.",
    },
    repeatMode: {
      type: "string",
      enum: ["one_shot", "repeating"],
      description:
        "Omit to take the sensible default for the type — price is one_shot (a one-time target), health_band and " +
        "finding are repeating (a standing watch). Send it only when the reader asks for the other behaviour.",
    },
  },
  required: ["symbol", "type", "operator"],
  additionalProperties: false,
} as const;

/** Human sentence for the alert's condition — the whole point of the restatement. */
function describeCondition(v: { type: string; operator: string; threshold?: unknown; findingKey?: string | null }): string {
  if (v.type === "price") {
    const n = typeof v.threshold === "string" ? Number(v.threshold) : (v.threshold as number);
    return `price goes ${v.operator} ${rupees(n)}`;
  }
  if (v.type === "health_band") return `Vytal health band moves ${v.operator} ${String(v.threshold)}`;
  return v.findingKey ? `the finding "${v.findingKey}" fires` : "any new finding fires";
}

export const createAlertWriteTool: ChatTool<CreateArgs> = {
  name: "createAlert",
  klass: "write",
  description: CREATE_DESCRIPTION,
  parameters: CREATE_PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const resolved = await resolveStock(str(args.symbol));
    if ("boundary" in resolved) return resolved.boundary;
    const type = str(args.type);

    // ══ THE UNSCORED GUARD ═════════════════════════════════════════════════════════════════════════
    // ★ A band/finding alert on a stock with no snapshot is written successfully and then SKIPPED BY
    //   THE EVALUATOR EVERY DAY, FOREVER (eval-pass.ts → "skipped_unscored"), with no signal to the
    //   reader, who believes they are armed. 409 of 504 covered stocks are in that state. The UI blocks
    //   it at creation; this must too, or the chat becomes the one door that lets a dead alert through.
    //   Price alerts are unaffected — they read StockPrice, not a score.
    if (type === "health_band" || type === "finding") {
      const snap = await prisma.scoreSnapshot.findFirst({ where: { stockId: resolved.id }, select: { id: true } });
      if (!snap) {
        return {
          ok: false,
          error:
            `NOT SCORED — NO ALERT CREATED: ${resolved.symbol} (${resolved.name}) is covered by Vytal but has no ` +
            `health score yet, and ${type === "health_band" ? "health-band" : "finding"} alerts are computed from ` +
            `that score. An alert like this could never fire, so it was not created. Tell the reader plainly that ` +
            `${resolved.symbol} isn't scored yet so health and finding alerts aren't possible on it — and OFFER a ` +
            `price alert instead, which works on any covered stock. Do not claim anything was set.`,
        };
      }
    }

    // ══ PERCENTAGE → RUPEES ════════════════════════════════════════════════════════════════════════
    // The reader may say "5% above" instead of a figure. That IS a product capability — the alert
    // modal offers it — but it is client-side sugar: the UI resolves it against the live price and
    // stores the absolute ₹. We mirror that arithmetic EXACTLY (current × (1 ± p/100), 2dp) off the
    // same StockPrice row the evaluator compares against, so the tool and the modal cannot disagree.
    // ⚠ Nothing persists the percentage — it does not trail the price. The proposal says so out loud.
    let threshold = args.threshold;
    let pctNote: { pct: number; basis: number } | null = null;
    const pct = typeof args.thresholdPercent === "number" ? args.thresholdPercent : undefined;
    if (pct !== undefined) {
      if (type !== "price") {
        return { ok: false, error: `thresholdPercent applies only to price alerts; a ${type || "non-price"} alert takes ${type === "health_band" ? "a band" : "a findingKey"}.` };
      }
      if (args.threshold !== undefined) {
        return { ok: false, error: "Send EITHER threshold (an exact rupee figure) OR thresholdPercent (a percent move from the current price) — not both. Ask the reader which they meant." };
      }
      if (!(pct > 0)) return { ok: false, error: "thresholdPercent must be greater than 0. A direction is set by operator (above / below), not by a negative percent." };
      const priceRow = await prisma.stockPrice.findUnique({ where: { stockId: resolved.id }, select: { price: true } });
      const current = priceRow ? Number(priceRow.price) : null;
      if (current == null || !(current > 0)) {
        return { ok: false, error: `Vytal has no current price on file for ${resolved.symbol}, so a percentage cannot be turned into a rupee target. Ask the reader for the exact price they want to be alerted at.` };
      }
      const op = str(args.operator);
      const target = op === "above" ? current * (1 + pct / 100) : current * (1 - pct / 100);
      if (!(target > 0)) return { ok: false, error: `A ${pct}% fall from ${rupees(current)} is not a positive price. Ask the reader for a smaller percentage or an exact figure.` };
      threshold = Number(target.toFixed(2));
      pctNote = { pct, basis: current };
    }

    // ★ THE SERVICE'S OWN SCHEMA — coherence rules included, not re-declared.
    const parsed = CreateAlertInput.safeParse({
      stockId: resolved.id,
      type: args.type,
      operator: args.operator,
      ...(threshold !== undefined ? { threshold } : {}),
      ...(args.findingKey !== undefined ? { findingKey: args.findingKey } : {}),
      // Per-type default when the reader didn't ask for a specific behaviour (mirrors the UI).
      repeatMode: args.repeatMode ?? DEFAULT_REPEAT[type] ?? "one_shot",
    });
    if (!parsed.success) {
      return {
        ok: false,
        error:
          `That alert is not valid: ${zodMessage(parsed.error)}. Tell the reader what is missing or ` +
          `inconsistent and ask them for it — do not guess a value, and do not claim the alert was set.`,
      };
    }
    const v = parsed.data;

    // ══ THE FINDING KEY MUST BE ONE THAT CAN ACTUALLY FIRE ═════════════════════════════════════════
    // A key nothing emits produces an alert that is evaluated as "no match" forever. Validated against
    // STATIC ∪ LIVE (see alerts/finding-catalog.ts); memoised per turn because two alert calls in one
    // round would otherwise scan twice. null findingKey ("any new finding") needs no check.
    if (v.type === "finding" && v.findingKey) {
      const known = await ctx.once("findingKeys", loadFindingKeys);
      if (!known.has(v.findingKey)) {
        const retired = RETIRED_FINDING_KEYS.includes(v.findingKey);
        const suggestions = suggestFindingKeys(v.findingKey, known);
        return {
          ok: false,
          error:
            (retired
              ? `RETIRED FINDING: "${v.findingKey}" was consolidated into another finding and can no longer fire, so no alert was created.`
              : `UNKNOWN FINDING KEY: "${v.findingKey}" is not a finding Vytal emits, so an alert on it could never fire and none was created.`) +
            (suggestions.length
              ? ` Closest real keys: ${suggestions.join(", ")}. Read the plausible ones back to the reader in plain words and ask which they meant, then call this again with that exact key.`
              : ` Ask the reader which finding they mean, or omit findingKey entirely to alert on ANY new finding.`) +
            ` Do not invent a key and do not claim the alert was set.`,
        };
      }
    }

    const fields: ProposalField[] = [
      { label: "Stock", value: `${resolved.symbol} — ${resolved.name}` },
      { label: "Alert type", value: v.type },
      { label: "Fires when", value: describeCondition(v) },
      { label: "Repeats", value: v.repeatMode === "repeating" ? "yes — re-arms after each firing" : "no — fires once, then stops" },
      { label: "Checked", value: "once a day, on end-of-day data (not live)" },
    ];
    // ★ BOTH NUMBERS, when the reader spoke in percent. They asked for "5%", but what gets STORED is a
    //   fixed rupee figure — so consent has to be to that figure, and to the fact it will not move.
    if (pctNote) {
      fields.splice(3, 0, {
        label: "How that was worked out",
        value:
          `${pctNote.pct}% ${str(args.operator)} the current price of ${rupees(pctNote.basis)} = ${rupees(Number(threshold))} — ` +
          `FIXED at that rupee figure now. It does not follow the price afterwards.`,
      });
    }
    return propose(ctx, {
      kind: "createAlert",
      summary: `Create a ${v.type} alert on ${resolved.symbol}`,
      fields,
      args: v as unknown as Record<string, unknown>,
    });
  },
};

// ── DELETE ──────────────────────────────────────────────────────────────────────────────────────────
interface DeleteArgs {
  symbol?: unknown;
  type?: unknown;
  alertId?: unknown;
}

const DELETE_DESCRIPTION =
  "Propose deleting one of the reader's existing alerts. Name it the way the reader does — by ticker, " +
  "optionally narrowed by type (price, health_band, finding) — or by alertId if a previous result gave you " +
  "one. If the reader has more than one matching alert this tool will refuse and list them; pass the alertId " +
  "of the one they pick rather than choosing for them. " +
  "THIS DOES NOT DELETE ANYTHING — it returns a proposal describing exactly which alert would go. You MUST " +
  "state that back to the reader and ask them to confirm; never reply as though it is already deleted. Only " +
  "after they say yes do you call confirmPendingAction. Owner-scoped: it can only ever see the signed-in " +
  "reader's own alerts." +
  BARE_TICKER_DIRECT;

const DELETE_PARAMETERS = {
  type: "object",
  properties: {
    symbol: { type: "string", description: 'NSE ticker whose alert should go, e.g. "HDFCBANK". Give this or alertId.' },
    type: { type: "string", enum: ["price", "health_band", "finding"], description: "Optional. Narrows to one kind when the reader has several alerts on the stock." },
    alertId: { type: "string", description: "The exact alert id, when a previous tool result listed one." },
  },
  additionalProperties: false,
} as const;

const ALERT_PICK = {
  id: true,
  type: true,
  operator: true,
  thresholdPrice: true,
  thresholdBand: true,
  findingKey: true,
  repeatMode: true,
  active: true,
  stock: { select: { symbol: true, name: true } },
} as const;

type AlertPick = {
  id: string;
  type: string;
  operator: string;
  thresholdPrice: unknown;
  thresholdBand: string | null;
  findingKey: string | null;
  repeatMode: string;
  active: boolean;
  stock: { symbol: string; name: string } | null;
};

function describeAlert(a: AlertPick): string {
  return describeCondition({
    type: a.type,
    operator: a.operator,
    threshold: a.thresholdPrice != null ? Number(a.thresholdPrice) : a.thresholdBand ?? undefined,
    findingKey: a.findingKey,
  });
}

export const deleteAlertWriteTool: ChatTool<DeleteArgs> = {
  name: "deleteAlert",
  klass: "write",
  description: DELETE_DESCRIPTION,
  parameters: DELETE_PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const alertId = str(args.alertId);
    const symbol = str(args.symbol);
    const type = str(args.type);
    if (!alertId && !symbol) {
      return { ok: false, error: "deleteAlert needs either a ticker (symbol) or an exact alertId. Ask the reader which alert they mean." };
    }

    // ★ Owner-scoped in every branch: userId is in the WHERE, so another reader's alert is invisible,
    //   indistinguishable from one that does not exist.
    let candidates: AlertPick[];
    if (alertId) {
      candidates = (await prisma.alert.findMany({ where: { id: alertId, userId: ctx.userId }, select: ALERT_PICK })) as unknown as AlertPick[];
    } else {
      const resolved = await resolveStock(symbol);
      if ("boundary" in resolved) return resolved.boundary;
      // `type` is a native enum column — narrow the model's free string to the three legal values, so an
      // unknown one is an honest "no such alert" rather than a Prisma type error.
      const typeFilter = type === "price" || type === "health_band" || type === "finding" ? type : undefined;
      if (type && !typeFilter) {
        return { ok: false, error: `"${type}" is not an alert type. The three are: price, health_band, finding. Ask the reader which they mean.` };
      }
      candidates = (await prisma.alert.findMany({
        where: { userId: ctx.userId, stockId: resolved.id, ...(typeFilter ? { type: typeFilter } : {}) },
        orderBy: { createdAt: "desc" },
        select: ALERT_PICK,
      })) as unknown as AlertPick[];
    }

    if (candidates.length === 0) {
      const where = alertId ? "that alert id" : `${symbol.toUpperCase()}${type ? ` (${type})` : ""}`;
      return {
        ok: true,
        content:
          `NO SUCH ALERT: the reader has no alert matching ${where}, so there is nothing to delete and no ` +
          `confirmation is needed. Say so plainly; do not claim to have deleted anything.`,
      };
    }

    if (candidates.length > 1) {
      const L = [
        `AMBIGUOUS — the reader has ${candidates.length} alerts matching that, so it is not clear which one they mean.`,
        "Do NOT pick one. List these to the reader and ask which, then call deleteAlert again with that alertId:",
      ];
      for (const a of candidates) L.push(`  - alertId ${a.id} · ${a.stock?.symbol ?? "?"} · ${a.type} · ${describeAlert(a)}${a.active ? "" : " · paused"}`);
      return { ok: false, error: L.join("\n") };
    }

    const a = candidates[0];
    const fields: ProposalField[] = [
      { label: "Stock", value: `${a.stock?.symbol ?? "?"} — ${a.stock?.name ?? "?"}` },
      { label: "Alert type", value: a.type },
      { label: "Fires when", value: describeAlert(a) },
      { label: "Repeats", value: a.repeatMode === "repeating" ? "yes — re-arms after each firing" : "no — fires once, then stops" },
      { label: "Currently", value: a.active ? "active" : "paused" },
    ];
    return propose(ctx, {
      kind: "deleteAlert",
      summary: `Delete the ${a.type} alert on ${a.stock?.symbol ?? "that stock"}`,
      fields,
      // ★ The RESOLVED id is what gets stored and executed — not the symbol the model said.
      args: { id: a.id },
    });
  },
};
