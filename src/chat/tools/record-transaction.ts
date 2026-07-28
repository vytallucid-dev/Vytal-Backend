// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WRITE TOOL: recordTransaction — the one that writes the FIFO lot register.
//
// ⚠ THIS IS THE EXPENSIVE ONE. Every cost basis, realized P&L and tax figure in the app is derived by
// replaying this ledger. A wrong quantity here is not a cosmetic error the reader can shrug off — it
// silently poisons an average cost they will read for years, and unpicking it means finding the bad row
// among trades they have since forgotten. So this tool is the strictest of the six, in three specific ways:
//
// 1. IT REFUSES TO GUESS. "I bought some TCS last week" contains no quantity, no price and no date. The
//    tool does not infer any of them — not "some" → 1, not "last week" → a Monday. It fails with a list of
//    exactly what is missing and the model asks. `requireIsoDate` is why "last week" cannot become a date
//    by accident, and it is deliberately stricter than the HTTP route's `Date.parse` (see write-shared.ts).
//
// 2. IT ENUMERATES EVERY FIELD — type, symbol, quantity, price, date, fees, account, and the resulting
//    total. "Yes" then means consent to those specific numbers rather than to a vague intent. The total
//    is computed and shown because a reader catches a wrong price far faster in the total than in the
//    per-share figure.
//
// 3. IT RESOLVES THE ACCOUNT AT PROPOSE TIME. The service would refuse ambiguity at execute time anyway
//    (0 accounts / 2+ accounts), but discovering that AFTER the reader has said yes is a bad conversation.
//    Resolving first also means the proposal can name the account in words the reader recognises, which
//    is the thing they most need to check — the right trade in the wrong book is still wrong.
//
// ★ THE PARSING IS THE SERVICE'S. `Base` and `typeError` are imported from the transactions service —
// the same schema and the same per-type guards POST /me/transactions runs. This tool adds resolution and
// the date tightening; it re-implements no rule. The oversell check and the replay are NOT run here:
// they belong inside the write transaction and happen on confirm.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { Base, typeError } from "../../portfolio/transactions-service.js";
import { resolveInstrument, InstrumentResolveError } from "../../portfolio/resolve-instrument.js";
import { str, requireIsoDate, propose, rupees, howLongAgo, attestTradeDate } from "./write-shared.js";
import type { ProposalField } from "./write-shared.js";
import { zodMessage } from "../../lib/service-error.js";
import { BARE_TICKER_DIRECT } from "./shared.js";
import type { ChatTool, ToolContext, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
  type?: unknown;
  quantity?: unknown;
  price?: unknown;
  tradeDate?: unknown;
  fees?: unknown;
  ratio?: unknown;
  notes?: unknown;
  accountName?: unknown;
}

const DESCRIPTION =
  "Propose recording one transaction in the reader's portfolio ledger: a buy, a sell, a dividend received, " +
  "or a split/bonus. buy and sell REQUIRE quantity and price; split and bonus REQUIRE a ratio like \"1:2\"; " +
  "dividend needs only the date (price is the per-share amount, if they said one). tradeDate must be an " +
  "exact date in YYYY-MM-DD form. " +
  "⚠ NEVER INVENT OR ESTIMATE A NUMBER HERE. This writes the ledger every cost-basis and profit figure is " +
  "computed from, and a wrong value is expensive to unpick. If the reader has not stated the quantity or " +
  "the price — \"I bought some TCS last week\" — do NOT convert that into values. Call the " +
  "tool with only what they actually said and it will tell you what is missing, or simply ask them first. " +
  "Do not round and do not assume today's price. " +
  "★ THE DATE: NEVER WORK IT OUT YOURSELF — CALL resolveDate. You do not reliably know today's date, so " +
  "any date you compute is a guess, and a guessed trade date silently corrupts the reader's cost basis. " +
  "Whenever they describe the date in words rather than giving an exact one — \"last Tuesday\", \"20 July\", " +
  "\"3 days ago\", \"yesterday\" — pass their own words to resolveDate first and use exactly what it " +
  "returns. If they were vague (\"last week\", \"a few days back\"), resolveDate will refuse and tell you " +
  "what to ask them; ask it rather than picking a day. This tool REFUSES any tradeDate that neither " +
  "appears in the reader's own message nor came from resolveDate, so working one out yourself simply " +
  "fails — and costs a round trip. " +
  "THIS DOES NOT RECORD ANYTHING — it returns a proposal listing every value. You MUST state all of them " +
  "back to the reader and ask them to confirm; never reply as though the trade is recorded. Only after they " +
  "say yes do you call confirmPendingAction. Owner-scoped to the signed-in reader's own books." +
  BARE_TICKER_DIRECT;

const PARAMETERS = {
  type: "object",
  properties: {
    symbol: { type: "string", description: 'Ticker or ISIN of the instrument, e.g. "HDFCBANK".' },
    type: { type: "string", enum: ["buy", "sell", "dividend", "split", "bonus"], description: "What kind of transaction." },
    quantity: { type: "number", description: "Number of shares. REQUIRED for buy and sell. Only what the reader actually stated." },
    price: { type: "number", description: "Price per share in rupees. REQUIRED for buy and sell; for dividend it is the per-share amount." },
    tradeDate: { type: "string", description: "The exact date, YYYY-MM-DD — as returned by resolveDate, or exactly as the reader wrote it. Never a date you worked out yourself; it will be refused." },
    fees: { type: "number", description: "Optional. Total brokerage and charges in rupees for this transaction." },
    ratio: { type: "string", description: 'REQUIRED for split and bonus. Form "a:b" — a additional shares per b held.' },
    notes: { type: "string", description: "Optional short note the reader wants attached." },
    accountName: { type: "string", description: "Which of the reader's accounts. Omit if they have only one." },
  },
  required: ["symbol", "type", "tradeDate"],
  additionalProperties: false,
} as const;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Resolve which book this lands in, BEFORE asking for consent. Mirrors resolveWritableAccount's rules
 *  (0 → none, 1 → that one, 2+ → ask) but reports them conversationally and by NAME. */
async function resolveAccount(ctx: ToolContext, accountName: string): Promise<{ id: string; name: string } | { error: string }> {
  const owned = await prisma.portfolioAccount.findMany({
    where: { userId: ctx.userId },
    select: { id: true, name: true, state: true },
    orderBy: { createdAt: "asc" },
  });
  if (owned.length === 0) {
    return { error: "The reader has no portfolio account yet, so there is nowhere to file this trade. They need to create an account (and pick its broker) first — tell them that; do not create one for them." };
  }

  let picked;
  if (accountName) {
    const needle = accountName.trim().toLowerCase();
    const matches = owned.filter((a) => a.name.toLowerCase() === needle);
    if (matches.length !== 1) {
      return { error: `No account of the reader's is named "${accountName}". Their accounts are: ${owned.map((a) => `"${a.name}"`).join(", ")}. Ask which one they mean.` };
    }
    picked = matches[0];
  } else if (owned.length === 1) {
    picked = owned[0];
  } else {
    return { error: `The reader has more than one account (${owned.map((a) => `"${a.name}"`).join(", ")}), so it is not clear which book this trade belongs in. Ask them which — do not choose one, because filing a trade in the wrong book is invisible once it is done.` };
  }

  if (picked.state !== "manual") {
    return { error: `"${picked.name}" is a broker-linked account — its holdings mirror the broker's own data, so trades cannot be entered into it by hand. Say so; do not file the trade somewhere else instead.` };
  }
  return { id: picked.id, name: picked.name };
}

export const recordTransactionTool: ChatTool<Args> = {
  name: "recordTransaction",
  klass: "write",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const symbol = str(args.symbol);
    const type = str(args.type);
    if (!symbol) return { ok: false, error: "recordTransaction needs the instrument's ticker or ISIN. Ask the reader which stock they mean." };
    if (!type) return { ok: false, error: "recordTransaction needs the transaction type: buy, sell, dividend, split, or bonus." };

    // ── THE DATE, BEFORE ANYTHING ELSE. Two gates, and the second is the one that matters. ──
    // Shape first: YYYY-MM-DD, a real calendar day, not in the future.
    const date = requireIsoDate(args.tradeDate, "tradeDate");
    if (typeof date !== "string") {
      return { ok: false, error: `${date.error} Ask the reader for the exact date; do not record a trade on a date they did not give you.` };
    }
    // ★ Then PROVENANCE: a well-formed date proves nothing — an invented one is well-formed too. This
    //   accepts only a date the reader actually named or that resolveDate computed. See attestTradeDate.
    const attested = await attestTradeDate(date, ctx);
    if (!attested.ok) return { ok: false, error: attested.error };

    // ── THE INSTRUMENT. A symbol is a convenience; an ambiguous one is refused with its candidates. ──
    let instrument;
    try {
      instrument = await resolveInstrument(prisma, symbol.toUpperCase());
    } catch (e) {
      if (e instanceof InstrumentResolveError) {
        const extra = e.candidates?.length
          ? ` Candidates: ${e.candidates.map((c) => `${c.isin} (${c.name}, ${c.assetClass})`).join("; ")}. Ask the reader which one, and pass its ISIN as the symbol.`
          : "";
        return { ok: false, error: `${e.message}${extra} Do not pick one yourself.` };
      }
      throw e;
    }

    // ── THE SERVICE'S OWN SCHEMA + PER-TYPE GUARDS. Not re-declared here. ──
    const candidate = {
      symbol: instrument.symbol ?? instrument.isin,
      type,
      tradeDate: date,
      ...(num(args.quantity) !== undefined ? { quantity: num(args.quantity) } : {}),
      ...(num(args.price) !== undefined ? { price: num(args.price) } : {}),
      ...(num(args.fees) !== undefined ? { fees: num(args.fees) } : {}),
      ...(str(args.ratio) ? { ratio: str(args.ratio) } : {}),
      ...(str(args.notes) ? { notes: str(args.notes) } : {}),
    };
    const parsed = Base.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, error: `That transaction is not valid: ${zodMessage(parsed.error)}. Ask the reader for the missing or corrected values — do not supply them yourself.` };
    }
    // ★ The per-type required-field guard — the SAME function the HTTP route calls. This is what turns
    //   "I bought some TCS" into a request for specifics instead of a proposal built on invented numbers.
    const te = typeError(parsed.data);
    if (te) {
      return {
        ok: false,
        error:
          `Not enough detail to record this: ${te}. Ask the reader for exactly those values and nothing more. ` +
          `Do NOT estimate a quantity, look up a price, or assume a date — record only what they tell you.`,
      };
    }

    // ── THE ACCOUNT, resolved now so the reader consents to a specific book. ──
    const account = await resolveAccount(ctx, str(args.accountName));
    if ("error" in account) return { ok: false, error: account.error };

    const v = parsed.data;
    const isTrade = v.type === "buy" || v.type === "sell";

    // EVERY parsed field, labeled. Absent ones are stated as absent — never omitted, or the reader reads
    // the omission as "unchanged" and consents to something they did not see.
    const fields: ProposalField[] = [
      { label: "Transaction", value: v.type.toUpperCase() },
      { label: "Instrument", value: `${instrument.symbol ?? instrument.isin} — ${instrument.name} (${instrument.assetClass})` },
      { label: "Quantity", value: v.quantity != null ? String(v.quantity) : "not applicable to this transaction type" },
      { label: "Price per share", value: v.price != null ? rupees(v.price) : isTrade ? "not given" : "not applicable to this transaction type" },
      // ★ The age is not decoration — it is the only thing that makes an invented date visible to the
      //   reader. See howLongAgo() for the live run that put it here.
      { label: "Trade date", value: `${v.tradeDate} — ${howLongAgo(v.tradeDate)}` },
      { label: "Fees and charges", value: v.fees != null ? rupees(v.fees) : "none recorded (₹0)" },
      { label: "Ratio", value: v.ratio ?? "not applicable to this transaction type" },
      { label: "Note attached", value: v.notes ?? "none" },
      { label: "Account", value: account.name },
    ];
    if (isTrade && v.quantity != null && v.price != null) {
      const gross = v.quantity * v.price;
      const fees = v.fees ?? 0;
      const net = v.type === "buy" ? gross + fees : gross - fees;
      fields.push({
        label: v.type === "buy" ? "Total cost including fees" : "Net proceeds after fees",
        value: `${rupees(net)}  (${v.quantity} × ${rupees(v.price)} ${v.type === "buy" ? "+" : "−"} ${rupees(fees)} fees)`,
      });
    }
    fields.push({ label: "Effect", value: "recorded in the FIFO lot ledger, and the reader's cost basis and portfolio health are recomputed" });

    return propose(ctx, {
      kind: "recordTransaction",
      summary: `Record a ${v.type.toUpperCase()} of ${instrument.symbol ?? instrument.isin} in "${account.name}"`,
      fields,
      // ★ THE EXECUTABLE PAYLOAD — the parsed values plus the RESOLVED account id. Execution reads this
      //   and only this; nothing the model says between now and the confirm can change a single number.
      args: { ...v, accountId: account.id },
    });
  },
};
