// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RAIL · event-rail | filing-rail | news-list — dated things, newest or soonest first.
//
// ★ ONE BUILDER, THREE RENDERERS, BECAUSE THE THREE DIFFER IN WHAT A ROW MEANS AND NOT IN LAYOUT.
//   An EVENT is scheduled and may not have happened. A FILING is a disclosure that definitely did.
//   NEWS is somebody else's word. A reader who cannot tell those apart at a glance will read a
//   forecast as a fact, so the renderer carries the distinction rather than a caption.
//
// ⚠ AN EMPTY RAIL RENDERS (N-4). "No insider transactions are on file for the last two years" is a
//   real, informative answer — the old chat tool said exactly that, in those words, and the sentence
//   is preserved. A rail that vanishes when empty teaches the reader that its absence means "not
//   checked", which is the collision §4.2 exists to stop.
//
// ⚠ EVERY ROW IS BOUNDED AND SAYS SO. The read services cap at 25 in-window; a rail showing 10 of 25
//   without saying so presents a slice as the whole.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import { digest, line, unchanged, type DigestLine, type Section } from "../contract.js";

export type RailRenderer = "event-rail" | "filing-rail" | "news-list";

/** One dated row. Every field is display-ready — the renderer formats nothing numeric. */
export interface RailItem {
  readonly at: string | null;
  /** The headline. For an event, what it is; for a filing, who did what; for news, the title. */
  readonly title: string;
  /** The supporting line. Amounts, quantities and counterparties arrive pre-formatted. */
  readonly detail: string;
  /** A short categorical tag — "dividend", "insider sell", "bulk deal", the news source. */
  readonly tag: string;
  /** `future` marks something SCHEDULED. A reader must never read a diary entry as a filed fact. */
  readonly when: "past" | "future" | "undated";
  /** Where it came from, when that is not us. `null` for our own data. */
  readonly source: string | null;
  readonly url: string | null;
}

export interface RailPayload {
  readonly items: readonly RailItem[];
  /** What this rail looked for. Present on the empty case too — "none found" only means something
   *  beside a statement of what was searched. */
  readonly lookedFor: string;
  /** How many the source holds in-window, when more than are shown. `null` ⇒ everything is shown. */
  readonly totalAvailable: number | null;
  /** Set on `news-list` only: this is not Vytal's own word and the reader is told so structurally. */
  readonly external: boolean;
}

export function railSection(
  input: {
    renderer: RailRenderer;
    heading: string;
    lookedFor: string;
    items: readonly RailItem[];
    totalAvailable?: number | null;
    /** The sentence shown when there is nothing. Registry copy, not a literal at the call site. */
    emptyPhrase: string;
  },
  coverage: Coverage,
): Section<"RAIL", RailPayload> {
  const external = input.renderer === "news-list";
  const payload: RailPayload = {
    items: input.items,
    lookedFor: input.lookedFor,
    totalAvailable: input.totalAvailable ?? null,
    external,
  };

  const lines: DigestLine[] = [];
  if (input.items.length === 0) {
    lines.push(unchanged("Result", input.emptyPhrase));
  } else {
    for (const i of input.items) {
      // ★ THE DATE AND THE TENSE RIDE IN THE VALUE. A digest line reading "Dividend — ₹12.00" with a
      //   future ex-date elsewhere is how a scheduled payout becomes a paid one in a sentence.
      const when = i.when === "future" ? "scheduled" : i.when === "undated" ? "date not disclosed" : "filed";
      lines.push(line(`${i.at ?? "undated"} · ${i.tag}`, `${i.title} — ${i.detail} (${when})`));
    }
    if (payload.totalAvailable !== null && payload.totalAvailable > input.items.length) {
      lines.push(line("Bounded", `showing the ${input.items.length} most recent of ${payload.totalAvailable} on file`));
    }
  }
  if (external) {
    lines.push(line("Source", "the public web, not Vytal's own data — headlines are other people's words"));
  }

  return {
    kind: "RAIL",
    renderer: input.renderer,
    payload,
    digest: digest(input.heading, [{ label: input.lookedFor, lines }]),
    coverage,
    interactions: [],
  };
}
