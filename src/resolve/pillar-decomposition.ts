// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — THE FOUR-PILLAR DECOMPOSITION, PER PERIOD.
//
// The read behind §0.1's worked example: a composite is a weighted sum of four pillars, and the whole
// argument of this build is that the sum is better SHOWN than SAID.
//
// ── ⚠ A PILLAR CAN BE UNSCORED, AND ITS WEIGHT GOES SOMEWHERE ─────────────────────────────────────
// `pillar_state` is `scored` or `unavailable_redistributed` — 304 in-force rows carry the latter
// (LT's momentum across four periods, MANKIND's momentum and market, NESTLEIND, POLYCAB). When a
// pillar cannot be scored its weight is REDISTRIBUTED across the others, so the remaining three carry
// more than their nominal share.
//
// A waterfall that draws that pillar as a zero-height bar states "this contributed nothing". It
// contributed nothing BECAUSE IT WAS NOT MEASURED, and the other bars are taller than their nominal
// weights precisely because of it. Both facts have to survive to the renderer, so `contribution` is
// `number | null` here and `null` is the only value an unscored pillar can take.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { absent, resolved, type Resolved, type Source, type StockCoverage } from "./contract.js";
import { LABEL_BAND_MAP } from "../scoring/composite/label.js";

export type PillarKey = "foundation" | "momentum" | "market" | "ownership";

export interface PillarPart {
  readonly pillar: PillarKey;
  /** The pillar's own 0-100 reading. `null` when the pillar was not scored. */
  readonly subtotal: number | null;
  /** The weight actually applied this period — post-redistribution, not the nominal one. */
  readonly weightApplied: number;
  /** subtotal x weightApplied, in composite points. ★ `null`, NEVER 0, for an unscored pillar. */
  readonly contribution: number | null;
  readonly state: "scored" | "unavailable_redistributed";
}

export interface PillarDecomposition {
  readonly symbol: string;
  readonly periodKey: string;
  readonly composite: number;
  /** ★ THE PERSISTED BAND, READ — NEVER RE-DERIVED FROM THE COMPOSITE. `label_band` is written by the
   *  scoring pass against the band-mapping version in force at the time; recomputing it here from
   *  thresholds would put a second classifier in the read layer and let it disagree with the score it
   *  sits beside the moment a mapping version changes. This is the defect §4.4 names in the frontend
   *  (`lib/findings/classify.ts` re-deriving classification client-side), avoided rather than moved. */
  readonly band: string;
  /** Reader-facing label from LABEL_BAND_MAP — authored once, in scoring/composite/label.ts. */
  readonly bandLabel: string;
  readonly parts: readonly PillarPart[];
  /** Why weights moved, when they did. `"none"` is the common case and is still stated. */
  readonly redistributionReason: string;
}

const PILLARS: readonly PillarKey[] = ["foundation", "momentum", "market", "ownership"];

// The in-force reduction, again: MAX(version) per (stock, period), tie-broken on as_of_date. Same
// rule as scoring-read.service.ts#inForceByPeriod and resolve/symbol.ts — three sites, one rule.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ THE IN-FORCE REDUCTION FOR PILLARS IS PER PILLAR, NOT PER RUN. THIS IS NOT THE SNAPSHOT RULE.
//
// `score_pillars` is NOT one row per pillar per snapshot. Each pillar is written independently, on
// its own cadence, when its OWN source moves. Measured on TCS:
//
//   market      run a683a51c  asOf 2026-08-28  source PRICE:2026-08-28   ← rewritten daily
//   ownership   run 8b4fae43  asOf 2026-08-25  source FY27Q1
//   foundation  run d972fe8e  asOf 2026-08-24  source FY26              ← annual
//
// The newest run rewrote MARKET ALONE. So joining pillars to a snapshot on `(stock_id, as_of_date,
// run_id)` — the obvious key, and the one this resolver used first — returns whichever single pillar
// that run happened to touch, and reports the other three as unscored. That shipped a waterfall
// claiming TCS and LT cannot score Foundation. It is a worse lie than the zero-bar this section was
// written to prevent, and only a live check on a HEALTHY subject exposed it: on a thin stock the
// output looks identical to a correct absent state.
//
// The correct reduction is the §3.5 idea at a finer grain — in-force PER PILLAR, bounded at the
// snapshot's as-of so the read stays point-in-time and cannot pick up a pillar written after it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const SQL = `
WITH st AS (SELECT id, symbol FROM stocks WHERE symbol = $1),
inforce AS (
  SELECT DISTINCT ON (period_key) id, period_key, as_of_date, run_id, composite, label_band,
         w_foundation, w_momentum, w_market, w_ownership, weight_redistribution_reason
  FROM score_snapshots
  WHERE snapshot_type = 'quarterly' AND stock_id = (SELECT id FROM st)
  ORDER BY period_key, version DESC, as_of_date DESC
),
latest AS (SELECT * FROM inforce ORDER BY as_of_date DESC, period_key DESC LIMIT 1),
pillars AS (
  SELECT DISTINCT ON (pillar) pillar, subtotal, pillar_state, source_period
  FROM score_pillars
  WHERE stock_id = (SELECT id FROM st)
    AND as_of_date <= (SELECT as_of_date FROM latest)
  ORDER BY pillar, as_of_date DESC, created_at DESC
)
SELECT l.period_key, l.composite, l.label_band, l.as_of_date,
       l.w_foundation, l.w_momentum, l.w_market, l.w_ownership, l.weight_redistribution_reason,
       p.pillar, p.subtotal, p.pillar_state, p.source_period
FROM latest l LEFT JOIN pillars p ON true`;

interface Row {
  period_key: string; composite: string | number; label_band: string; as_of_date: Date;
  w_foundation: string | number; w_momentum: string | number;
  w_market: string | number; w_ownership: string | number;
  weight_redistribution_reason: string | null;
  pillar: PillarKey | null; subtotal: string | number | null; pillar_state: string | null;
  source_period: string | null;
}

const n = (v: string | number | null): number | null => (v === null ? null : Number(v));

export async function resolvePillarDecomposition(
  symbol: string,
): Promise<Resolved<PillarDecomposition>> {
  const sym = (symbol ?? "").trim().toUpperCase();
  if (!sym) return absent("not_in_universe", { subject: null, query: null });

  const rows = (await prisma.$queryRawUnsafe(SQL, sym)) as Row[];
  if (rows.length === 0) {
    // No in-force quarterly snapshot. The stock may be real and unscored — the caller distinguishes
    // by asking resolveStockCoverage; here the honest answer is that there is nothing to decompose.
    const exists = await prisma.stock.findUnique({ where: { symbol: sym }, select: { id: true } });
    return absent(exists ? "no_prior_snapshots" : "not_in_universe", { subject: null, query: null });
  }

  const head = rows[0]!;
  const weights: Record<PillarKey, number> = {
    foundation: Number(head.w_foundation), momentum: Number(head.w_momentum),
    market: Number(head.w_market), ownership: Number(head.w_ownership),
  };
  const byPillar = new Map(rows.filter((r) => r.pillar !== null).map((r) => [r.pillar!, r]));

  const parts: PillarPart[] = PILLARS.map((p) => {
    const r = byPillar.get(p);
    const state = (r?.pillar_state === "scored" ? "scored" : "unavailable_redistributed") as PillarPart["state"];
    const subtotal = r ? n(r.subtotal) : null;
    const weightApplied = weights[p];
    return {
      pillar: p,
      subtotal: state === "scored" ? subtotal : null,
      weightApplied,
      // ★ null, never 0. An unmeasured pillar did not contribute nothing; we do not know what it
      //   would have contributed, and the other three are carrying its weight.
      contribution: state === "scored" && subtotal !== null ? Math.round(subtotal * weightApplied * 100) / 100 : null,
      state,
    };
  });

  const subject: StockCoverage = {
    kind: "stock",
    tier: 2,
    asOf: head.as_of_date.toISOString().slice(0, 10),
    window: { fromPeriod: head.period_key, toPeriod: head.period_key, periods: 1 },
    depth: { quarters: 0, snapshots: 1 },
  };
  const provenance: Source[] = ["stocks", "score_snapshots"];

  return resolved(
    {
      symbol: sym,
      periodKey: head.period_key,
      composite: Number(head.composite),
      band: head.label_band,
      bandLabel: LABEL_BAND_MAP.find((b) => b.band === head.label_band)?.label ?? head.label_band,
      parts,
      redistributionReason: head.weight_redistribution_reason ?? "none",
    },
    { subject, query: null },
    provenance,
  );
}
