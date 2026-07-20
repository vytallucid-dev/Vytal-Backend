// ═══════════════════════════════════════════════════════════════════════════
// STEP 19 — ETF UNIT SPLITS, FROM REAL NSE CORPORATE ACTIONS.
//
// THE BUG THIS EXISTS TO KILL: AMFI's NAV history is RAW. When an ETF sub-divides its units 1:10,
// AMFI's published NAV simply steps down 90% overnight, and every metric folded from that series
// believes the fund lost 90% in a day. Measured live before this module existed:
//
//     HDFCPVTBAN   ret_1y +0.4%   but   ret_3y -50.1%
//                  vol_1y  16.1%   but   vol_3y  134%      ← impossible for an index ETF
//                  max_drawdown_3y -91.0%                   ← that IS the split day
//                  alpha_3y -57.2%
//
// The 1Y figures are clean because the split falls outside that window. That is the proof.
//
// ⚠️  REAL EVENTS ONLY — NEVER INFERRED. It is tempting to spot the -90% step in the NAV series and
//     "detect" a split from its shape. That is FORBIDDEN, and not as a style rule: a step-detector
//     infers a CORPORATE FACT from a DATA SHAPE, so it cannot distinguish a 1:10 sub-division from a
//     credit fund writing off a defaulted bond — and it would silently "adjust away" the second,
//     erasing a real 90% loss. This module reads NSE's published corporate action or it does nothing.
//     An ETF with no NSE split event is NOT adjusted; its metrics go honest-NULL with a reason.
//     BANKIETF is exactly that case: every one of its peers split 1:10, and we still do not touch it.
//
// SOURCE: /api/corporates-corporateActions?index=equities&symbol=… — the SAME endpoint and the SAME
// NseClient session the equity corporate-actions ingest already uses. ETFs come back under series
// "EQ", so they travel the existing path; nothing about the equity flow changes.
// ═══════════════════════════════════════════════════════════════════════════
import https from "https";
import { nseClient } from "../../lib/client.js";
import { prisma } from "../../db/prisma.js";
import { reportIngestionError } from "../shared/ingestion-error.js";

const CRON = "instrument_corporate_actions";
const TARGET_TABLE = "InstrumentCorporateEvent";

/** Raw NSE corporate-action record — the same shape events.ts already consumes. */
interface NseCorporateActionRaw {
  symbol: string;
  series: string;
  faceVal: string | null;
  subject: string;
  exDate: string | null;
  recDate: string | null;
}

export interface InstrumentSplit {
  symbol: string;
  /** The ex-date: the first session on which the NAV is quoted on the NEW unit basis. */
  exDate: Date;
  /** The SNAPPED adjustment factor (10, 50, 100…). This is what the fold divides by. */
  factor: number;
  /** oldFaceValue / newFaceValue exactly as NSE published it — the audit trail for the snap. */
  rawFactor: number;
  /** NSE's subject line, verbatim. The evidence. */
  subject: string;
}

/**
 * A sub-division ratio is an INTEGER by definition — you cannot issue 10.0043 units for one.
 *
 * NSE publishes the ratio only as a face-value transition, and it ROUNDS the new face value:
 * HDFCMID150's "From Rs 115.91 To Rs 11.586" yields 10.004314, and HDFCNEXT50's yields 10.001913.
 * Those are NSE's rounding, not real ratios. We snap to the nearest integer.
 *
 * WHY THIS IS NOT THE FORBIDDEN HEURISTIC: it reads a REAL, DATED corporate action and normalises a
 * rounding artefact IN THAT EVENT'S OWN PUBLISHED FIELDS. It never looks at the NAV series. If the
 * published quotient is not within TOLERANCE of an integer we do not guess — we return null, the ETF
 * is left unadjusted, and its metrics go honest-NULL. Declining is always available.
 */
const SNAP_TOLERANCE = 0.01; // 1% — NSE's worst observed rounding is 0.043%

export function parseSplitFactor(
  subject: string,
): { factor: number; rawFactor: number } | null {
  if (!/split|sub-?division/i.test(subject)) return null;

  // "From Rs 10/- To Re 1/-" · "From Rs 299.92/- Per Share To Rs 29.992/- Per Share"
  // Handles Rs/Re, dotted (Rs./Re.), optional "/-", optional "Per Share"/"Per Unit".
  const m = subject.match(
    /R[se]\.?\s*(\d+(?:\.\d+)?)\s*\/?-?\s*(?:Per\s+(?:Share|Unit)\s+)?To\s+R[se]\.?\s*(\d+(?:\.\d+)?)/i,
  );
  if (!m) return null;

  const oldFv = parseFloat(m[1]!);
  const newFv = parseFloat(m[2]!);
  if (!(oldFv > 0) || !(newFv > 0)) return null;

  const rawFactor = oldFv / newFv;

  // A SUB-DIVISION (the only kind we have ever observed for an ETF): face value falls, unit count
  // rises, NAV per unit falls. rawFactor > 1.
  //
  // A CONSOLIDATION (rawFactor < 1) is the same class of unit-basis change and would need the same
  // rescale — but we have never seen one, so rather than ship an untested inverse path we DECLINE
  // it. The ETF goes honest-NULL, which is the correct answer for a corporate action we have not
  // proven we handle. It will surface loudly the first time one occurs.
  if (rawFactor <= 1) return null;

  const snapped = Math.round(rawFactor);
  if (snapped < 2) return null;
  if (Math.abs(rawFactor - snapped) / snapped > SNAP_TOLERANCE) return null; // cannot resolve → decline

  return { factor: snapped, rawFactor };
}

/** NSE ships "19-Dec-2019". */
function parseNseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s.trim()} UTC`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILING THE APPLICATION DAY — the one thing the ex-date does not tell us.
//
// NSE's ex-date is when the UNIT starts trading on the new basis. AMFI's NAV is struck by the AMC, and
// the AMC does not always apply the split on that day. There is no fixed rule, and the lag is NOT a
// guess — it was MEASURED across all 63 real splits in the universe. Counting in PUBLISHED NAVs (not
// calendar days: weekends and holidays print nothing), the first NAV quoted on the new basis lands at:
//
//     offset 0 (the ex-date's own print)    11 splits
//     offset 1 (one print later)            24 splits     ← e.g. HDFCPVTBAN
//     offset 2 (two prints later)           23 splits     ← e.g. NIFTYBEES
//     offset 3 (three prints later)          5 splits
//     beyond offset 3                        0 splits
//
// So the candidate set is the FIRST FOUR PUBLISHED PRINTS ON/AFTER THE EX-DATE. Four is not a hedge —
// it is the measured range. (An earlier cut of this used {D, D+1}, which was a GUESS at the lag; it
// covered only 35 of 63 and left the rest unadjusted.)
//
// And a wrong boundary is not harmlessly wrong. Rescale on the wrong side and a NAV is left on the OLD
// basis with adjusted NAVs either side of it — turning a single honest step into a +900% spike followed
// by a -90% crash. The first cut of this feature did exactly that to 22 ETFs.
//
// ⚠️  WHAT THIS IS, AND WHAT IT IS NOT.
//
//     IT IS: taking an event we ALREADY HAVE from a real source (a ×10 split with ex-date D) and asking
//     which of four days our OTHER source applied it on. Every candidate is anchored to the event's own
//     date. The event's own published ratio is applied at each. The one that yields a CONTINUOUS series
//     — old-basis prints continuous with each other, the ratio across the boundary equal to the
//     PUBLISHED factor, new-basis prints continuous with each other — is the answer.
//
//     IT IS NOT: scanning the NAV series for a step and concluding a split happened there. Nothing here
//     searches for a discontinuity, ranks step-days by size, or picks "the least bad" fit. It reads a
//     handful of NAVs because the EVENT told it where to look, and it tests them against a ratio the
//     EVENT published. Take the event away and this function has nothing to say — it cannot manufacture
//     a split, only locate one it was already told about.
//
//     WHY FOUR CANDIDATES ARE AS SAFE AS TWO: a split factor is 5, 10, 50 or 100. No market print moves
//     5×. The magnitude regimes do not overlap, so widening the window cannot turn a real market move
//     into a false split — it can only find the real step later than we first assumed it could be.
//     At most one candidate can ever reconcile: a candidate's chain requires ratio≈1 at every boundary
//     before its own and ratio≈factor at its own, and those two predicates are disjoint for factor ≥ 2.
//
// NO CANDIDATE RECONCILES ⇒ null ⇒ no adjustment ⇒ the guard withholds. Continuity is never forced.
// ═══════════════════════════════════════════════════════════════════════════

/** A day-to-day NAV move is a few percent. A split factor is 5, 10, 50 or 100. The gap is enormous,
 *  so a 25% tolerance both confirms a ratio unambiguously and can never mistake a market move for one. */
const RECONCILE_TOL = 1.25;
const near = (ratio: number, target: number) =>
  ratio > target / RECONCILE_TOL && ratio < target * RECONCILE_TOL;

/** The MEASURED range of AMFI's application lag, in published NAVs after the ex-date (see census above).
 *  Candidates are prints 0..3 on/after the ex-date, so we need print 4 as well to confirm continuity on
 *  the far side of the last candidate. */
const MAX_LAG_PRINTS = 3;
const CANDIDATES = MAX_LAG_PRINTS + 1; // prints 0,1,2,3 — the candidate application days
const LOOKAHEAD_DAYS = 30; // enough calendar days to contain 5 prints across any Indian holiday cluster

/** mfapi.in serves ONE scheme's full NAV series in a single ~130 KB call — and it is AMFI's own data
 *  re-served (verified: it reproduces AMFI's earliest NAV for a scheme to the 4th decimal). It is the
 *  right tool for a per-scheme question, exactly as AMFI's date-ranged endpoint is for the fold's.
 *
 *  RETRIED, because a transient blip here is NOT harmless. It was measured: on the first full sweep,
 *  NIF100IETF's fetch dropped, the reconciliation had no series to work against, and the split came back
 *  "unreconciled" — indistinguishable, in the result, from a split that genuinely does not reconcile.
 *  Its five siblings from the very same corporate action all reconciled. The series was fine; the
 *  network was not. THROWS if every attempt fails — the caller must treat that as a FAULT, never as an
 *  answer. */
async function fetchSchemeSeriesOnce(schemeCode: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const req = https.get(`https://api.mfapi.in/mf/${schemeCode}`, (r) => {
      const c: Buffer[] = [];
      r.on("data", (x: Buffer) => c.push(x));
      r.on("end", () => resolve(Buffer.concat(c).toString()));
      r.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(20_000, () => req.destroy(new Error("mfapi timeout")));
  });
}

async function fetchSchemeSeries(schemeCode: string): Promise<Map<number, number>> {
  let body: string | null = null;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3 && body === null; attempt++) {
    try {
      body = await fetchSchemeSeriesOnce(schemeCode);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }
  if (body === null) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

  const out = new Map<number, number>();
  const parsed = JSON.parse(body);
  for (const row of parsed?.data ?? []) {
    const [dd, mm, yy] = String(row.date).split("-");
    const day = Date.UTC(Number(yy), Number(mm) - 1, Number(dd)) / 86_400_000;
    const nav = Number(row.nav);
    if (Number.isFinite(day) && nav > 0) out.set(day, nav);
  }
  return out;
}

/**
 * Which day did AMFI apply this split on? Returns the day of the FIRST NAV quoted on the NEW basis —
 * one of the first four prints on/after the ex-date — or null if none of the four reconciles.
 *
 * `series` is a day → NAV map. Every NAV we read is located by the EVENT's ex-date; the ratio we test
 * against is the EVENT's published factor. Nothing here is derived from the shape of the series.
 */
export function reconcileAppliedDay(
  series: Map<number, number>,
  exDay: number,
  factor: number,
): number | null {
  // The last NAV strictly BEFORE the ex-date. This one is certainly on the OLD basis — whatever the AMC
  // did, it did not do it before the ex-date. It is the reference the whole chain is tested against.
  let prev: number | undefined;
  for (let d = exDay - 1; d >= exDay - LOOKAHEAD_DAYS && prev === undefined; d--) prev = series.get(d);
  if (prev === undefined) return null; // no NAV before the event — nothing to reconcile against

  // The first CANDIDATES+1 prints on/after the ex-date. A calendar day with no NAV is not a candidate —
  // it is simply a day the fund did not print — so we step over it. This locates PRINTS; it does not
  // look at their values, and it stops after a fixed count. It is not a search for a step.
  const prints: { day: number; nav: number }[] = [];
  for (let d = exDay; d <= exDay + LOOKAHEAD_DAYS && prints.length < CANDIDATES + 1; d++) {
    const nav = series.get(d);
    if (nav !== undefined) prints.push({ day: d, nav });
  }
  // We need a print AFTER the last candidate we intend to test, to confirm the new basis holds.
  if (prints.length < 2) return null;

  // ── THE CANDIDATES: print k is the first one on the NEW basis, for k = 0..3. ──
  // Under that hypothesis:
  //    · prev and prints[0 .. k-1] are all still on the OLD basis  → each consecutive ratio ≈ 1
  //    · the boundary crossing lands between print k-1 (or prev, if k = 0) and print k → ratio ≈ factor
  //    · print k and print k+1 are both on the NEW basis            → their ratio ≈ 1
  // Only one k can satisfy all three (the ≈1 and ≈factor predicates are disjoint for factor ≥ 2).
  for (let k = 0; k + 1 < prints.length && k < CANDIDATES; k++) {
    const chain = [prev, ...prints.slice(0, k + 1).map((p) => p.nav)];

    // Everything before the boundary must be continuous — no unexplained step hiding in the run-up.
    let oldSideContinuous = true;
    for (let j = 0; j + 2 < chain.length; j++) {
      if (!near(chain[j]! / chain[j + 1]!, 1)) { oldSideContinuous = false; break; }
    }
    if (!oldSideContinuous) continue;

    const lastOld = chain[chain.length - 2]!; // prints[k-1], or prev when k = 0
    const firstNew = prints[k]!.nav;
    const afterNew = prints[k + 1]!.nav;

    if (near(lastOld / firstNew, factor) && near(firstNew / afterNew, 1)) return prints[k]!.day;
  }

  // NO candidate reconciles. We will NOT force it, and we will NOT pick the least-discontinuous one.
  return null;
}

/**
 * Every REAL split NSE holds for one symbol. Throws on transport failure — the caller turns that
 * into an IngestionError. A symbol with no split returns [] and that is HONEST-EMPTY, not a fault.
 */
export async function fetchInstrumentSplits(symbol: string): Promise<InstrumentSplit[]> {
  const path = `/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(symbol)}`;
  const data = await nseClient.get<NseCorporateActionRaw[]>(path);
  if (!Array.isArray(data)) return [];

  const out: InstrumentSplit[] = [];
  for (const raw of data) {
    if (raw?.series !== "EQ") continue; // ETFs DO come back as EQ — verified against 23 of them
    const parsed = parseSplitFactor(raw.subject ?? "");
    if (!parsed) continue;

    // The EX-DATE is the whole point: it is the first session quoted on the new basis, and it is
    // what partitions the NAV series. A split with no ex-date cannot be applied, so it is skipped
    // rather than applied at a guessed date.
    const exDate = parseNseDate(raw.exDate);
    if (!exDate) continue;

    out.push({
      symbol: raw.symbol.trim().toUpperCase(),
      exDate,
      factor: parsed.factor,
      rawFactor: parsed.rawFactor,
      subject: raw.subject,
    });
  }
  return out;
}

export interface SplitIngestResult {
  ok: boolean;
  symbolsProbed: number;
  symbolsWithSplit: number;
  splitsFound: number;
  splitsWritten: number;
  /** Splits whose APPLICATION DAY reconciled to one of the first four prints on/after the ex-date →
   *  the fold will rescale them. */
  reconciled: number;
  /** Splits where we HAD the series and NO candidate reconciled → an HONEST REFUSAL. Not adjusted,
   *  windows withheld. We do not force continuity, and we do not pick the least-discontinuous candidate. */
  unreconciled: number;
  /** Splits left unresolved because the NAV SERIES could not be fetched — a FAULT, not a refusal. The
   *  distinction matters: this one is retryable, and a prior good reconciliation is preserved. */
  unresolvedByFault: number;
  /** ETFs whose NAV series could not be read (after 3 attempts) → their splits cannot be reconciled. */
  seriesFetchFailures: number;
  fetchFailures: number;
  faults: number;
  durationMs: number;
}

/**
 * Sweep the NSE-listed fund universe for real split events and store them.
 *
 * IDEMPOTENT, and structurally so: `instrument_corporate_events` has a NOT-NULL instrument_id and a
 * UNIQUE (instrument_id, event_type, event_date), so a re-run collides and updates in place. (This
 * is exactly why the events did NOT go on `corporate_events` with a nullable stock_id: Postgres
 * treats NULLs as DISTINCT, so that unique index would have enforced nothing and every run would
 * have inserted a fresh duplicate of every split.)
 */
export async function ingestInstrumentSplits(
  opts: { symbols?: string[]; onProgress?: (done: number, total: number, label: string) => Promise<void> } = {},
): Promise<SplitIngestResult> {
  const t0 = Date.now();
  const runRef = new Date().toISOString().slice(0, 10) + `:${CRON}`;
  const res: SplitIngestResult = {
    ok: false, symbolsProbed: 0, symbolsWithSplit: 0, splitsFound: 0,
    splitsWritten: 0, reconciled: 0, unreconciled: 0, unresolvedByFault: 0,
    seriesFetchFailures: 0, fetchFailures: 0, faults: 0, durationMs: 0,
  };

  // The probeable universe: a fund that TRADES has a ticker; one that does not cannot be looked up
  // on an exchange at all. The 10 ETFs with no symbol (BSE-listed / matured) are not a gap we can
  // close from NSE, and they are not pretended to be.
  //
  // `amfi_scheme_code` comes along because reconciling the application day needs the scheme's NAV
  // series, and mfapi is keyed on the scheme code (not the ticker).
  const universe = await prisma.$queryRawUnsafe<{ id: string; symbol: string; code: string | null }[]>(`
    SELECT DISTINCT ON (symbol) id, symbol, amfi_scheme_code AS code
    FROM instruments
    WHERE asset_class = 'etf' AND symbol IS NOT NULL
      ${opts.symbols?.length ? `AND symbol = ANY($1::text[])` : ""}
    ORDER BY symbol, id`,
    ...(opts.symbols?.length ? [opts.symbols] : []),
  );

  for (let i = 0; i < universe.length; i++) {
    const inst = universe[i]!;
    res.symbolsProbed++;

    let splits: InstrumentSplit[];
    try {
      splits = await fetchInstrumentSplits(inst.symbol);
    } catch (err) {
      // A FETCH FAILURE IS A FAULT — never "this ETF has no split". Conflating the two is how a
      // corrupted return survives: we would quietly leave the series unadjusted and call it clean.
      res.fetchFailures++;
      res.faults++;
      await reportIngestionError({
        source: "nse", cron: CRON, guardType: "shape",
        targetTable: TARGET_TABLE, targetEntity: inst.symbol,
        severity: "medium", resolutionPath: "source_code",
        expected: `NSE corporate actions for ${inst.symbol}`,
        observed: `fetch threw: ${(err as Error).message}`,
        detail:
          "Could not read this ETF's corporate actions. Its NAV series is therefore NOT split-" +
          "adjusted this run. That is a FAULT, not an honest-empty: 'we could not ask' and 'there " +
          "is no split' demand opposite responses, and only the first one is a bug.",
        runRef, recurring: true,
      });
      continue;
    }

    if (splits.length === 0) continue; // HONEST-EMPTY. Most ETFs never split. Not a fault.
    res.symbolsWithSplit++;
    res.splitsFound += splits.length;

    // ── RECONCILE THE APPLICATION DAY (see reconcileAppliedDay). ──
    // The ex-date tells us WHEN THE UNIT changed basis on the exchange, not when AMFI's NAV did, and
    // those differ for some funds. Fetched ONCE per ETF that actually has a split — so this costs a
    // handful of calls, not one per fund in the universe.
    //
    // ⚠️  "WE COULD NOT ASK" IS NOT "IT DOES NOT RECONCILE." A dropped fetch and a genuinely
    //     irreconcilable series both end with applied_date NULL — which is SAFE, because NULL means
    //     "do not adjust". But they are not the same event and they must not be reported as the same:
    //     one is a network fault to retry, the other is an honest refusal. On the first full sweep this
    //     conflation hid a real fault (NIF100IETF), so the fetch failure is now raised as a FAULT and
    //     counted apart from the refusals.
    let series: Map<number, number> | null = null;
    let seriesFailed = false;
    if (inst.code) {
      try {
        series = await fetchSchemeSeries(inst.code);
      } catch (err) {
        series = null;
        seriesFailed = true;
        res.seriesFetchFailures++;
        res.faults++;
        await reportIngestionError({
          source: "amfi", cron: CRON, guardType: "shape",
          targetTable: TARGET_TABLE, targetEntity: inst.symbol,
          severity: "medium", resolutionPath: "source_code",
          expected: `NAV series for scheme ${inst.code} (${inst.symbol}), to reconcile its split's application day`,
          observed: `series fetch threw after 3 attempts: ${(err as Error).message}`,
          detail:
            "This ETF HAS a real, sourced NSE split, but we could not read its NAV series to find the " +
            "day AMFI applied it. It is therefore NOT split-adjusted this run and its affected windows " +
            "are withheld. That is SAFE but it is not CORRECT — this is a fault to retry, not an " +
            "honest refusal, and any prior reconciliation is preserved rather than overwritten with NULL.",
          runRef, recurring: true,
        });
      }
    }

    for (const s of splits) {
      const exDay = Math.floor(s.exDate.getTime() / 86_400_000);
      const appliedDay = series ? reconcileAppliedDay(series, exDay, s.factor) : null;
      if (appliedDay !== null) res.reconciled++;
      else if (seriesFailed) res.unresolvedByFault++; // we could not ASK — not a refusal
      else res.unreconciled++;                        // we asked, and no candidate reconciled — an honest refusal

      // ⚠️  A FAILED RUN MUST NEVER UNDO A GOOD ONE.
      //     `applied_date` is a fact about a HISTORICAL event — the day AMFI applied a 2024 split does
      //     not change. This job re-runs nightly, and a plain `applied_date = EXCLUDED.applied_date`
      //     would let one dropped fetch overwrite a correct reconciliation with NULL — silently
      //     un-adjusting a fund that was right yesterday and withholding windows that were fine.
      //     So: a FRESH reconciliation always wins; a failed one KEEPS the stored value — but only if
      //     the factor is unchanged. If NSE has revised the ratio, the old day was reconciled against a
      //     ratio that no longer holds, so it is dropped to NULL and the fund goes unadjusted until it
      //     re-reconciles. We keep a SOURCED value; we never keep a STALE one.
      const written = await prisma.$queryRawUnsafe<{ ok: number }[]>(
        `INSERT INTO instrument_corporate_events
           (id, instrument_id, symbol, event_type, event_date, ex_date, split_factor, applied_date,
            description, source, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'split', $3::date, $3::date, $4::decimal, $5::date, $6, 'nse', now())
         ON CONFLICT (instrument_id, event_type, event_date) DO UPDATE SET
           split_factor = EXCLUDED.split_factor,
           applied_date = CASE
             WHEN EXCLUDED.applied_date IS NOT NULL THEN EXCLUDED.applied_date
             WHEN instrument_corporate_events.split_factor = EXCLUDED.split_factor
               THEN instrument_corporate_events.applied_date
             ELSE NULL
           END,
           description  = EXCLUDED.description,
           ex_date      = EXCLUDED.ex_date,
           updated_at   = now()
         RETURNING 1 AS ok`,
        inst.id, s.symbol, s.exDate, s.factor.toFixed(6),
        appliedDay === null ? null : new Date(appliedDay * 86_400_000),
        s.subject,
      );
      res.splitsWritten += written.length;
    }

    if (opts.onProgress) await opts.onProgress(i + 1, universe.length, inst.symbol);
  }

  res.ok = true;
  res.durationMs = Date.now() - t0;
  return res;
}
