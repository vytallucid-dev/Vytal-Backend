// ─────────────────────────────────────────────────────────────
// STEP 19 — ETF CORPORATE ACTIONS (unit splits) from NSE.
//
// THE DURABILITY HALF OF THE FIX. The backfill repaired the 22 ETFs that were already corrupted;
// this job is what stops the bug ever coming back. A split announced tomorrow is ingested as a real
// DATED EVENT before its ex-date lands, so the next fold rescales that ETF's series and its returns
// never go wrong in the first place — the bug is caught as DATA, not discovered later as a symptom.
//
// Splits are rare and announced WELL AHEAD of the ex-date, so most nights this finds nothing and
// that is not a fault — it is the honest-empty case, and it is the common one.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { InstrumentCorporateActionsPayload } from "../types.js";
import { ingestInstrumentSplits } from "../../ingestions/corporate-events/instrument-splits.js";

export async function handleInstrumentCorporateActions(
  ctx: JobContext<InstrumentCorporateActionsPayload>,
) {
  const { symbols } = ctx.payload ?? {};

  await ctx.reportProgress(
    5,
    symbols?.length
      ? `Reading NSE corporate actions for ${symbols.length} named ETF(s)`
      : "Reading NSE corporate actions across the NSE-listed ETF universe",
  );

  const r = await ingestInstrumentSplits({
    symbols,
    onProgress: async (done, total, label) => {
      // 5 → 95. The tail is the summary.
      if (done % 25 === 0 || done === total) {
        await ctx.reportProgress(5 + Math.floor((done / total) * 90), `${label} (${done}/${total})`);
      }
    },
  });

  await ctx.reportProgress(
    100,
    `${r.splitsFound} real split event(s) across ${r.symbolsWithSplit} ETF(s) of ${r.symbolsProbed} probed` +
      (r.fetchFailures ? ` — ${r.fetchFailures} FETCH FAILURE(S), those ETFs are NOT split-adjusted this run` : ""),
  );

  // A fetch failure is a FAULT, and it is already an IngestionError. It is surfaced here too rather
  // than swallowed: an ETF we could not ask about is one whose series the fold will leave unadjusted,
  // and "we could not ask" must never be quietly filed as "there is no split".
  return {
    symbolsProbed: r.symbolsProbed,
    symbolsWithSplit: r.symbolsWithSplit,
    splitsFound: r.splitsFound,
    splitsWritten: r.splitsWritten,
    fetchFailures: r.fetchFailures,
    faults: r.faults,
    durationMs: r.durationMs,
  };
}
