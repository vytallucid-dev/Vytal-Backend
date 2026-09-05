// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TWO LEGS OF ONE DEAL, RENDERED AS ONE DEAL.
//
// ── ⚠ WHAT A READER SAW ───────────────────────────────────────────────────────────────────────────
// TCS's entire "Disclosed transactions" card was two rows:
//
//     THE MTBJ LTD. AS TRST FOR GOVRNMNT PENSION INVSTMNT FUND MTBJ400045828  block sell
//     1,83,328 shares · ₹2059.60 · ₹37.76 Cr
//     THE MTBJ LTD. AS TRST FOR GOVRNMNT PENSION INVSTMNT FUND MUTB400045794  block buy
//     1,83,328 shares · ₹2059.60 · ₹37.76 Cr
//
// Same fund, same day, same size, same price, opposite directions — and a header reading "2". It
// implies ₹75.5 Cr of activity where ₹37.76 Cr moved between one owner's own custodian accounts, and
// it implies a pension fund both bought and sold the same block on the same morning.
//
// NSE publishes block deals ONE ROW PER COUNTERPARTY and the schema stores exactly that: `clientName`
// and `transactionType` are both in `block_deal_unique`, and there is no field linking the two sides.
// Nothing was wrong with the ingestion. The rendering was doing the reader's arithmetic wrongly.
//
// ── ★ WHY PAIRING IS SAFE, MEASURED OVER ALL 1,230 ROWS WE HOLD ───────────────────────────────────
//   · 42 groups are a clean 1:1 (one buy, one sell) on symbol + date + quantity + price
//   ·  2 groups are many-to-many and are DELIBERATELY LEFT ALONE — pairing them would be a guess
//   · 1,087 groups are single-sided; most deals disclose one side only and are untouched here
//   · within one symbol+date, pairs are effectively unique (one case of two, at distinct qty+price)
//   · sampled by hand, every different-name pair is an obvious counterparty: Citigroup Singapore ←
//     Citigroup Mauritius, Goldman ← Morgan Stanley, Bayer AG ← Bayer CropScience, Adani Infra ←
//     Ardour, PI Opportunities ← Prazim
//
// ⚠ AND THE FAILURE MODE IS BENIGN BY CONSTRUCTION. No clean 1:1 ⇒ no pairing ⇒ the legs render
//   exactly as they do today. This function can decline; it can never invent a relationship.
//
// ── ★ THE 6.8%-OF-ROWS FIGURE UNDERSTATES IT, WHICH IS WHY THIS IS WORTH THE FILE ─────────────────
// 31 of the 165 stocks with any deal have NOTHING ELSE on file, so the pair is 100% of their card —
// and they are the front page of the market: HDFCBANK, ICICIBANK, INFY, BHARTIARTL, ASIANPAINT,
// AXISBANK, M&M, BAJFINANCE, HINDUNILVR, TCS.
//
// ── ★★ HOW STRONGLY WE CLAIM DEPENDS ON THE DEAL TYPE, AND THE TWO ARE NOT THE SAME EVIDENCE ──────
// A BLOCK deal is negotiated with a single counterparty, so an exact quantity-and-price match on one
// day is near-certain to be the same trade — naming the counterparty is a fact worth having. A BULK
// deal is an AGGREGATE of one client's whole day, so an identical aggregate on both sides is strong
// evidence and not proof. 24 of the 42 pairs are block, 18 are bulk. Block says "sold to"; bulk says
// a matching buy and sell and names both without asserting they traded with each other.
//
// ── ⚠ SAME OWNER HAS A HARD CEILING AND THIS FILE STOPS AT IT ─────────────────────────────────────
// Stripping the trailing account code takes same-owner detection from 3 pairs to 19, and it is a
// mechanical rule anyone can check. What it CANNOT do is decide that Citigroup Singapore and
// Citigroup Mauritius are one owner — that is entity resolution across corporate groups, string
// matching is not capable of it, and a wrong answer there would be a claim about who owns a company.
// So: identical-after-stripping ⇒ an account transfer, stated. Anything else ⇒ both names, no claim.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The raw disclosure, one row per counterparty leg — `BlockEvent` as the read model serves it. */
export interface DealLeg {
  readonly dealDate: string;
  readonly dealType: string;      // "block" | "bulk"
  readonly clientName: string;
  readonly transactionType: string; // "buy" | "sell"
  readonly quantity: string;
  readonly price: number;
  readonly valueCr: number | null;
}

export interface PairedDeal {
  readonly at: string;
  /** The row's title. One name for a transfer, "X → Y" for a counterparty pair, the name for a single leg. */
  readonly who: string;
  /** The badge. Unchanged for a single leg; a paired row is neither a buy nor a sell. */
  readonly what: string;
  readonly detail: string;
  /** How many source rows this row stands for — so a count can be of DEALS rather than of legs. */
  readonly legs: number;
}

/**
 * ★ THE ACCOUNT CODE IS THE LAST TOKEN WHEN IT MIXES LETTERS AND DIGITS.
 *
 * "…GOVRNMNT PENSION INVSTMNT FUND MUTB400045794" ⇒ "…GOVRNMNT PENSION INVSTMNT FUND". The length
 * floor keeps ordinary name fragments ("A1", "L2") from being eaten, and requiring BOTH a letter and
 * a digit keeps a pure word or a pure number from matching.
 */
export function strippedName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? "";
  const looksLikeCode = last.length >= 6 && /[A-Za-z]/.test(last) && /[0-9]/.test(last);
  return (looksLikeCode ? parts.slice(0, -1) : parts).join(" ").trim();
}

const inr = (n: number): string => n.toLocaleString("en-IN");
const cr = (x: number | null): string | null => (x == null ? null : `₹${x.toFixed(2)} Cr`);

/**
 * Collapse every clean 1:1 buy/sell pair into one row; pass everything else through untouched.
 *
 * ★ ORDER IS THE CALLER'S. This returns rows newest-first by date and nothing else; the rail sorts
 *   again once both channels are merged.
 */
export function pairDeals(legs: readonly DealLeg[]): PairedDeal[] {
  // The pairing key. Price is part of it deliberately: date + quantity alone matched two unrelated
  // deals in the measurement, and the price is what makes a coincidence implausible.
  const groups = new Map<string, DealLeg[]>();
  for (const l of legs) {
    const k = `${l.dealDate}|${l.quantity}|${l.price}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }

  const out: PairedDeal[] = [];
  for (const g of groups.values()) {
    const buys = g.filter((l) => l.transactionType === "buy");
    const sells = g.filter((l) => l.transactionType === "sell");

    // ⚠ EXACTLY ONE OF EACH. Two buys and two sells at one price is a real shape in the data (AASTHA,
    //   ATALREAL) and there is no way to say which buyer faced which seller. Left as separate legs.
    if (g.length !== 2 || buys.length !== 1 || sells.length !== 1) {
      for (const l of g) out.push(single(l));
      continue;
    }

    const buy = buys[0]!, sell = sells[0]!;
    const qty = Number(buy.quantity);
    const figures = [`${inr(qty)} shares`, `₹${buy.price.toFixed(2)} a share`, cr(buy.valueCr)]
      .filter(Boolean).join(" · ");

    // ── the same holder, two of its own accounts ──────────────────────────────────────────────────
    if (strippedName(buy.clientName) === strippedName(sell.clientName)) {
      out.push({
        at: buy.dealDate,
        who: strippedName(buy.clientName),
        what: `${buy.dealType} transfer`,
        // ★ THE POINT OF THE ROW IS THE LAST CLAUSE. Without it a reader still reads two trades.
        detail: `${figures} — moved between two of its own accounts, so who owns it did not change`,
        legs: 2,
      });
      continue;
    }

    // ── two parties. A block names the counterparty; a bulk states the match and stops. ───────────
    const block = buy.dealType === "block" && sell.dealType === "block";
    out.push(block
      ? {
          at: buy.dealDate,
          who: `${sell.clientName} → ${buy.clientName}`,
          what: "block deal",
          detail: `${figures} — sold by the first to the second`,
          legs: 2,
        }
      : {
          at: buy.dealDate,
          who: `${sell.clientName} → ${buy.clientName}`,
          what: `${buy.dealType} deal`,
          // ⚠ NO "SOLD TO". A bulk row is a whole day aggregated, so a matching pair is strong
          //   evidence that these two faced each other and is not proof of it.
          detail: `${figures} — a matching sale and purchase of the same size at the same price on the same day`,
          legs: 2,
        });
  }

  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

function single(l: DealLeg): PairedDeal {
  return {
    at: l.dealDate,
    who: l.clientName,
    what: `${l.dealType} ${l.transactionType}`,
    detail: [`${inr(Number(l.quantity))} shares`, `₹${l.price.toFixed(2)} a share`, cr(l.valueCr)]
      .filter(Boolean).join(" · "),
    legs: 1,
  };
}
