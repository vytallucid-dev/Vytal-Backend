// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ANCHOR · hero-set | hero-dual — the two anchors that are not about one company.
//
//   hero-set   a COLLECTION with a headline figure each — a portfolio, a watchlist, a screen result.
//   hero-dual  TWO subjects held side by side — the reader and a stock, or a stock and a stock.
//
// ★ WHY A SET NEEDS ITS OWN ANCHOR RATHER THAN N SMALL ONES. A book of 21 holdings is not 21 answers;
//   it is one answer whose subject happens to be plural. Rendering it as a repeated single-subject
//   hero loses the only thing the reader actually asked about — the shape of the whole.
//
// ⚠ `shownOf` IS REQUIRED AND IS NOT DECORATION. A screen matching 340 companies and showing 20 has
//   answered a different question from one matching 20, and a list that does not say which is the
//   silently-shortened set `DroppedFilter` exists to prevent, one layer up.
//
// ⚠ AN EMPTY SET RENDERS. An empty watchlist, a screen with no matches and a book with no holdings
//   are all real answers, and each has its OWN sentence — "you have not pinned anything yet" is not
//   the same statement as "no company matched that".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import { digest, line, unchanged, withheld, type DigestLine, type Section } from "../contract.js";

/** One member of a set. Figures arrive pre-formatted (N-1); `sortValue` drives ordering only. */
export interface SetMember {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string | null;
  /** The headline figure for this member, already formatted, or null when not held. */
  readonly figure: string | null;
  readonly figureLabel: string;
  /** A categorical chip — a health band, a sector, a status. `null` renders no chip. */
  readonly tag: string | null;
  readonly sortValue: number | null;
  /**
   * ★ THE STOCK THIS ROW IS ABOUT, SO THE READER CAN GO THERE — added at T-1 (finding 8).
   *
   * A screen that returns twelve company names the reader cannot open is a list, not a result. This
   * makes each row a destination.
   *
   * ⚠ A SYMBOL, NEVER A URL. Routing is the frontend's to own — it renders
   *   `/research/stock-screener/<symbol>` — and a backend that emitted paths would be a second place
   *   the route lives, silently wrong the day it moves. `null` on any member that is not a stock
   *   (a remembered fact, a fund, a totals row), which is why it is nullable rather than required.
   */
  readonly symbol: string | null;
}

export interface HeroSetPayload {
  readonly members: readonly SetMember[];
  /** How many the set actually has, when more than are shown. `null` ⇒ all of them are here. */
  readonly totalAvailable: number | null;
  /** Aggregate lines about the whole — "21 holdings", "11 scored", "₹4.2 lakh". Pre-formatted. */
  readonly totals: readonly { readonly label: string; readonly value: string | null }[];
  readonly emptyPhrase: string;
}

export function heroSetSection(
  input: {
    heading: string;
    members: readonly SetMember[];
    totals: readonly { label: string; value: string | null }[];
    totalAvailable?: number | null;
    emptyPhrase: string;
  },
  coverage: Coverage,
): Section<"ANCHOR", HeroSetPayload> {
  const payload: HeroSetPayload = {
    members: input.members,
    totalAvailable: input.totalAvailable ?? null,
    totals: input.totals,
    emptyPhrase: input.emptyPhrase,
  };

  const lines: DigestLine[] = [];
  for (const t of input.totals) {
    lines.push(t.value === null ? withheld(t.label, "not held") : line(t.label, t.value));
  }
  if (input.members.length === 0) {
    lines.push(unchanged("Members", input.emptyPhrase));
  } else {
    for (const m of input.members) {
      lines.push(
        m.figure === null
          ? withheld(m.title, `no ${m.figureLabel.toLowerCase()} held for this one`)
          : line(m.title, `${m.figure}${m.tag ? ` · ${m.tag}` : ""}`),
      );
    }
    if (payload.totalAvailable !== null && payload.totalAvailable > input.members.length) {
      lines.push(line("Bounded", `showing ${input.members.length} of ${payload.totalAvailable}`));
    }
  }

  return {
    kind: "ANCHOR",
    renderer: "hero-set",
    payload,
    digest: digest(input.heading, [{ label: "The set", lines }]),
    coverage,
    interactions: input.members.length > 1 ? [{ id: "sort", kind: "sort", label: "Reorder" }] : [],
  };
}

/** One side of a dual anchor. */
export interface HeroSide {
  readonly title: string;
  readonly subtitle: string | null;
  readonly stats: readonly { readonly label: string; readonly value: string | null; readonly absentPhrase: string }[];
}

export interface HeroDualPayload {
  readonly left: HeroSide;
  readonly right: HeroSide;
  /** What makes these two comparable. Stated, because two panels side by side imply it. */
  readonly basis: string;
}

export function heroDualSection(
  input: { heading: string; left: HeroSide; right: HeroSide; basis: string },
  coverage: Coverage,
): Section<"ANCHOR", HeroDualPayload> {
  const payload: HeroDualPayload = { left: input.left, right: input.right, basis: input.basis };

  // ★ TWO DIGEST GROUPS, ONE PER SIDE, NEVER INTERLEAVED. Flattened, a model cannot tell which side
  //   a figure belongs to — and the entire point of a dual anchor is which side.
  const side = (s: HeroSide) =>
    s.stats.map((x) => (x.value === null ? withheld(x.label, x.absentPhrase) : line(x.label, x.value)));

  return {
    kind: "ANCHOR",
    renderer: "hero-dual",
    payload,
    digest: digest(input.heading, [
      { label: input.left.title, lines: side(input.left) },
      { label: input.right.title, lines: side(input.right) },
      { label: "Basis", lines: [line("Compared on", input.basis)] },
    ]),
    coverage,
    interactions: [],
  };
}
