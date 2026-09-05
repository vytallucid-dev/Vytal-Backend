// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE 2026-09-04 INGESTION-ERROR SWEEP — 105 open rows, adjudicated class by class.
//
// Same discipline as resolve-ingestion-error-backlog-2026-08-29.ts, and the same question asked of
// every class: is this a FAULT, or is it a GUARD THAT IS WRONG ABOUT THE WORLD? The answer differed,
// so this is a script with evidence and citations rather than an UPDATE statement.
//
// ── WHAT THIS CLOSES (65 rows), each with the code change that makes it stay closed ─────────────
//   43  mfapi NAV-series faults    — the fetch never checked its HTTP status, so a rate-limit HTML
//                                    page resolved as a "body", escaped the retry loop and only died
//                                    in JSON.parse. And nothing could EVER close these rows:
//                                    resolveHealedSplitProbe filtered on source='nse' while the
//                                    series fault writes source='amfi'. Both fixed in
//                                    instrument-splits.ts. Re-probed live: all scheme codes answer
//                                    HTTP 200 with valid JSON — the failures were transient.
//   10  pre-2000 event dates       — REAL NSE history, not parse errors. MIN_EVENT_YEAR moved from a
//                                    guessed 2000 to NSE's own first trading year, 1994.
//    4  DailyPrice continuity      — every one exactly ±20.0000% with the close AT the day's high:
//                                    upper-circuit closes. checkContinuity now excuses a move that
//                                    lands on a regulated band edge (prices-guards.ts).
//    4  healed discovery           — LEAPIND, TECHNOCRAF, DHOOTTRANS, MILKYMIST now hold results.
//    2  ISIN security-type "25"    — the taxonomy ALREADY names "25" a REIT unit (isin-class.ts).
//                                    A code we can name is an exclusion, not a question.
//    1  dividend null-rate 26.1%   — not a "subject-format change": the amount regex matched `Rs`
//                                    but not `Re`, the singular. See PART A.
//    1  JKTYRE dividendAmount=0    — " Dividend - Rs 0 .70 Per Share" stored as ₹0.00. The parser
//                                    was fixed; the stored row never was. PART A repairs it.
//
// ── ⚠ WHAT IS DELIBERATELY LEFT OPEN (40 rows), because it is real ──────────────────────────────
//    18  admin_fill revenue rows   — filer SCALE ERRORS, nulled rather than guessed. Only a figure
//                                    sourced from the company's own published result can close one,
//                                    and it must be keyed WITH ITS CITATION. Not a code fix.
//    11  YoY continuity            — genuine filer mis-scales above YOY_BASE_MIN_CR. The 2026-08-29
//                                    backlog made this ruling and it stands: they are bad numbers
//                                    in the database and they belong in front of a human.
//     7  discovery                 — SUNSHINE, SHIPROCKET, SHANKESH, MOLBIO, LALITHAA, HORIZONIND,
//                                    BLEL: every one listed between 2026-08-14 and 2026-08-25 and
//                                    owes no filing yet. The guard is right; the row is the retry
//                                    counter. (LISTING_GRACE_DAYS will retire them automatically.)
//     3  AMFI shape (critical)     — THE CODE IS FIXED AND VERIFIED against the live feed (header
//                                    resolves, 0 missing, 14,341 rows), but the NAVs are still
//                                    frozen. A guard row is closed by a SUCCESSFUL RUN, never by a
//                                    diff that ought to work. Re-run the three jobs, then close.
//     1  results failure-rate      — a cascade of the 7 above. It clears when they do.
//
//   npx tsx src/scripts/resolve-ingestion-errors-2026-09-04.ts [--apply]
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { parseRupeesPerShare } from "../ingestions/corporate-events/events.js";
import { isCircuitLimitMove } from "../ingestions/prices/prices-guards.js";
import { MIN_EVENT_YEAR } from "../ingestions/corporate-events/events-guards.js";

const APPLY = process.argv.includes("--apply");
const BY = "sweep-2026-09-04";

/** Read the year out of an `eventDate=YYYY-MM-DD` evidence line and test it against the CURRENT
 *  floor — so this closes only what the corrected guard would itself now accept, never on trust. */
function MIN_EVENT_YEAR_OK(observed: string): boolean {
  const m = /eventDate=(\d{4})-/.exec(observed);
  if (!m) return false;
  const y = Number(m[1]);
  return y >= MIN_EVENT_YEAR && y <= new Date().getUTCFullYear() + 2;
}

function head(s: string) {
  console.log(`\n${"═".repeat(96)}\n${s}\n${"═".repeat(96)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PART A — REPAIR THE DIVIDEND AMOUNTS THE OLD REGEX COULD NOT READ.
//
// The null_rate guard tripped at 26.1% and blamed "a subject-format change". It was not. NSE writes
// a one-rupee dividend as "Dividend - Re 1 Per Share" — Indian usage puts the SINGULAR rupee as
// "Re" — and the amount regex matched only `Rs`. So the smallest and most common dividends, every
// ₹1 and ₹0.50, parsed as NULL. The split branch in the same file has always handled `Rs/Re`;
// only this branch had not.
//
// The fix is in events.ts (parseRupeesPerShare). This repairs what the old parser already stored,
// re-deriving from the `purpose` text we ALREADY HOLD — no re-fetch, and nothing invented.
//
// ⚠ dividend_amount is numeric(10,2). A parsed 1.425 comes back from Postgres as 1.43, so a stored
//   value equal to the new value ROUNDED TO 2dp is not a disagreement — it is the column. Those
//   rows are left alone; treating them as repairs would rewrite 15 rows to no effect and would
//   hide any real divergence in the noise.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function repairDividendAmounts() {
  head("PART A · dividend_amount — re-derived from the stored subject with the `Re`-aware parser");

  const rows = await prisma.$queryRawUnsafe<{ id: string; symbol: string; purpose: string; amt: string | null }[]>(
    `SELECT id, symbol, purpose, dividend_amount::text AS amt
       FROM corporate_events
      WHERE event_type = 'dividend' AND purpose IS NOT NULL`,
  );

  const fills: { id: string; to: number }[] = [];
  const corrections: { id: string; symbol: string; from: number; to: number; purpose: string }[] = [];
  let precisionOnly = 0;

  for (const r of rows) {
    const next = parseRupeesPerShare(r.purpose);
    if (next === null) continue; // percentage-of-face-value — an honest absence, left NULL
    if (r.amt === null) { fills.push({ id: r.id, to: next }); continue; }

    const stored = Number(r.amt);
    if (Math.abs(stored - next) < 1e-9) continue;              // already correct
    if (Math.abs(stored - Math.round(next * 100) / 100) < 1e-9) { precisionOnly++; continue; } // numeric(10,2)
    corrections.push({ id: r.id, symbol: r.symbol, from: stored, to: next, purpose: r.purpose });
  }

  console.log(`  scanned                 : ${rows.length} dividend rows carrying a subject`);
  console.log(`  NULL → amount           : ${fills.length}`);
  console.log(`  wrong amount → corrected: ${corrections.length}`);
  console.log(`  left alone (2dp column) : ${precisionOnly}`);

  console.log(`\n  ── the corrections, in full ──`);
  for (const c of corrections.slice(0, 12)) {
    console.log(`   ${c.symbol.padEnd(12)} ${String(c.from).padStart(8)} → ${String(c.to).padEnd(8)} ${c.purpose.replace(/\s+/g, " ").slice(0, 88)}`);
  }
  if (corrections.length > 12) console.log(`   … and ${corrections.length - 12} more compound dividends summed the same way`);

  if (!APPLY) return { filled: 0, corrected: 0 };

  let filled = 0;
  for (const f of fills) {
    await prisma.corporateEvent.update({ where: { id: f.id }, data: { dividendAmount: f.to } });
    filled++;
    if (filled % 500 === 0) console.log(`   … filled ${filled}/${fills.length}`);
  }
  let corrected = 0;
  for (const c of corrections) {
    await prisma.corporateEvent.update({ where: { id: c.id }, data: { dividendAmount: c.to } });
    corrected++;
  }
  console.log(`  ✅ filled ${filled}, corrected ${corrected}`);
  return { filled, corrected };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PART B — CLOSE THE CLASSES THE CODE CHANGES ACTUALLY SETTLE.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
let totalClosed = 0;

async function close(label: string, ids: string[], note: string, citation?: string) {
  console.log(`\n── ${label}`);
  console.log(`   rows: ${ids.length}`);
  console.log(`   ${note.replace(/\s+/g, " ").slice(0, 260)}`);
  if (!ids.length || !APPLY) return;
  const { count } = await prisma.ingestionError.updateMany({
    where: { id: { in: ids }, status: "open" },
    data: {
      status: "resolved",
      resolvedBy: BY,
      resolvedAt: new Date(),
      resolutionNote: note,
      ...(citation ? { resolutionCitation: citation } : {}),
    },
  });
  totalClosed += count;
  console.log(`   ✅ closed ${count}`);
}

const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id);

async function main() {
  const before = await prisma.ingestionError.count({ where: { status: "open" } });
  console.log(`OPEN AT START: ${before}${APPLY ? "" : "     (DRY RUN — pass --apply to write)"}`);

  await repairDividendAmounts();

  head("PART B · resolutions");

  // ── 1. mfapi NAV-series faults — transient, and structurally unable to close. ────────────────
  const series = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ingestion_errors
     WHERE status = 'open' AND cron = 'instrument_corporate_actions'
       AND source = 'amfi' AND guard_type = 'shape'`;
  await close(
    "mfapi NAV-series fetch faults (ETF split reconciliation)",
    idsOf(series),
    "Two defects, both fixed in instrument-splits.ts. (1) fetchSchemeSeriesOnce never read the HTTP " +
      "status, so mfapi's rate-limit HTML page resolved as a successful body, satisfied the retry loop " +
      "and only failed later in JSON.parse — which is why these rows say 'after 3 attempts' when there " +
      "was exactly one. The status is now checked and the parse now happens INSIDE the retry. (2) " +
      "resolveHealedSplitProbe filtered on source='nse', so a source='amfi' series fault could never be " +
      "closed by the run that healed it; it now heals both sources. Re-probed live on 2026-09-04: every " +
      "affected scheme code answers HTTP 200 with a valid NAV series, confirming the failures were " +
      "transient rate-limiting during a burst of sequential calls.",
    "live re-probe of api.mfapi.in on 2026-09-04 — all affected scheme codes HTTP 200 with valid JSON",
  );

  // ── 2. Pre-2000 event dates — real NSE history, not a parse error. ──────────────────────────
  const oldDates = await prisma.$queryRaw<{ id: string; observed: string }[]>`
    SELECT id, observed FROM ingestion_errors
     WHERE status = 'open' AND cron = 'events_ingest'
       AND guard_type = 'range' AND target_field = 'eventDate'`;
  const genuinelyOld = oldDates.filter((r) => MIN_EVENT_YEAR_OK(r.observed));
  const stillBad = oldDates.filter((r) => !MIN_EVENT_YEAR_OK(r.observed));
  if (stillBad.length) console.log(`\n   ⚠ ${stillBad.length} eventDate row(s) fall OUTSIDE [1994, now+2] and stay open: ${stillBad.map((r) => r.observed).join(", ")}`);
  await close(
    "pre-2000 corporate-event dates",
    idsOf(genuinelyOld),
    "NOT a date-parse error — real NSE history. Each row was read back against its own stored subject " +
      "and every one is coherent 1990s corporate action text: ELECTHERM 'Dividend -7.5%' (1996-09-11), " +
      "SHREDIGCEM 'Allotment Of Shares Of Gujarat Composite Ltd & Digvijay Finlease Ltd' (1997-10-01), " +
      "KJMCFIN 'Agm/Dividend - 40%' (1997-08-27), HAWKINCOOK 'Agm / Dividend - 30%' (1999-08-18), " +
      "MODTHREAD 'Agm' (1999-08-04) and the rest. A parse fault produces 1970-01-01 or a two-digit-year " +
      "2097, not ten coherent AGMs and dividends. MIN_EVENT_YEAR moved from a guessed 2000 ('real " +
      "earliest 2005') to 1994, the year NSE opened its equity segment — a fact rather than an estimate. " +
      "The guard keeps its teeth: anything below 1994 is still impossible and still fires.",
    "NSE equity (capital market) segment opened 1994-11-03; each event verified against its own stored subject",
  );

  // ── 3. DailyPrice continuity — upper-circuit closes, not data breaks. ───────────────────────
  const cont = await prisma.$queryRaw<{ id: string; observed: string; target_entity: string | null }[]>`
    SELECT id, observed, target_entity FROM ingestion_errors
     WHERE status = 'open' AND cron = 'daily_eod_prices'
       AND guard_type = 'continuity' AND target_table = 'DailyPrice'`;
  const circuit = cont.filter((r) => {
    const m = /\(([\d.]+)\s*→\s*([\d.]+)\)/.exec(r.observed);
    if (!m) return false;
    return isCircuitLimitMove(Math.abs(Number(m[2]) / Number(m[1]) - 1));
  });
  const notCircuit = cont.filter((r) => !circuit.includes(r));
  if (notCircuit.length) console.log(`\n   ⚠ ${notCircuit.length} continuity row(s) are NOT circuit-limit moves and stay open: ${notCircuit.map((r) => `${r.target_entity} ${r.observed}`).join("; ")}`);
  await close(
    "DailyPrice continuity flags",
    idsOf(circuit),
    "Upper-circuit closes, not data breaks. Every one is exactly ±20.0000% with the close sitting AT " +
      "the day's high — NIRAJISPAT 2026-08-31 was locked all session (open=high=low=close=355.08 on a " +
      "295.90 previous close), and SRIKPRIND and NIRAJISPAT each printed a second ~20% day immediately " +
      "before, the classic consecutive-circuit pattern. The guard's own comment placed its band 'above " +
      "circuit-breakers (±10/20%)' but used >= 0.20, which includes the limit itself; 5 of the 5 faults " +
      "it has ever raised are this false positive and none is a true one. checkContinuity now excuses a " +
      "move landing on a regulated band edge within half a basis point, so 20.5% and 25% still fire. A " +
      "mis-scaled price does not arrive at exactly 1.2000.",
    "NSE/BSE 20% price band; OHLC re-read per row — close == day high in every case",
  );

  // ── 4. Discovery faults that have since been answered. ──────────────────────────────────────
  const discovery = await prisma.$queryRaw<{ id: string; symbol: string; held: number }[]>`
    SELECT e.id, e.target_entity AS symbol, (
      SELECT count(*)::int FROM (
        SELECT 1 FROM quarterly_results                    WHERE stock_id = s.id
        UNION ALL SELECT 1 FROM banking_quarterly_results  WHERE stock_id = s.id
        UNION ALL SELECT 1 FROM nbfc_quarterly_results     WHERE stock_id = s.id
        UNION ALL SELECT 1 FROM life_insurance_quarterly_results    WHERE stock_id = s.id
        UNION ALL SELECT 1 FROM general_insurance_quarterly_results WHERE stock_id = s.id
      ) t) AS held
    FROM ingestion_errors e JOIN stocks s ON s.symbol = e.target_entity
    WHERE e.status = 'open' AND e.guard_type = 'count' AND e.target_field = 'discovery'`;
  const healed = discovery.filter((d) => d.held > 0);
  const stillSilent = discovery.filter((d) => d.held === 0);
  console.log(`\n   still genuinely silent (left OPEN): ${stillSilent.map((d) => d.symbol).join(", ") || "none"}`);
  await close(
    `discovery faults that have since been answered (${healed.map((d) => d.symbol).join(", ")})`,
    idsOf(healed),
    "These stocks now hold result rows: the filing arrived on a later run and the condition the guard " +
      "fired on has lifted. The remaining discovery rows are left open deliberately — every one of those " +
      "symbols first traded between 2026-08-14 and 2026-08-25 and does not yet owe a filing, so the guard " +
      "is right and the row is its retry counter.",
  );

  // ── 5. ISIN security-type "25" — a named refusal, not an unknown code. ──────────────────────
  const isin = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ingestion_errors
     WHERE status = 'open' AND cron = 'corporate_bonds_daily'
       AND guard_type = 'validity' AND target_field = 'asset_class'`;
  await close(
    "unrecognised ISIN security-type on the bond lane",
    idsOf(isin),
    "Not unrecognised. Security-type '25' is already a NAMED REFUSAL in shared/isin-class.ts — a REIT " +
      "unit, grounded on the six REITs this catalogue holds (EMBASSY OFFICE PARKS, MINDSPACE, BROOKFIELD, " +
      "NEXUS SELECT, KNOWLEDGE REALTY, BAGMANE PRIME OFFICE), and the two instruments that opened these " +
      "rows are two of them trading on the BL block-deal board. The bond lane already excludes named " +
      "refusals without faulting; this is the same false alarm the InvIT type '23' produced for 13 " +
      "consecutive nights, and it is closed for the same reason: a code we can NAME is an exclusion, not " +
      "a question. Nothing was dropped — both instruments live in the trust lane with asset_class='reit'.",
    "shared/isin-class.ts NAMED_REFUSALS['25'] — REIT unit, grounded on 6 catalogued REITs",
  );

  // ── 6. Dividend null-rate + the JKTYRE zero. ────────────────────────────────────────────────
  const divRate = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ingestion_errors
     WHERE status = 'open' AND cron = 'events_ingest'
       AND guard_type = 'null_rate' AND target_field = 'dividendAmount'`;
  await close(
    "dividend null-amount rate 26.1%",
    idsOf(divRate),
    "The fault text guessed 'a subject-format change'. It was not: the amount regex matched `Rs` but not " +
      "`Re`, the SINGULAR rupee, so every dividend of exactly ₹1 or ₹0.50 — the smallest and most common " +
      "ones — parsed as NULL. 3,477 of the 3,992 unparsed rows, measured across the whole table. The " +
      "split branch of the same file had always handled `Rs/Re`; only this branch had not. Fixed in " +
      "events.ts (parseRupeesPerShare), which also SUMS compound dividends ('Dividend Rs 3/Special " +
      "Dividend Rs 2' is ₹5 to the holder, not ₹3) while cutting the subject at any face-value clause so " +
      "a split's 'From Rs 10 To Rs 2' never joins the sum. PART A of this script re-derived the stored " +
      "rows from their own subjects. The residual null rate is the 515 percentage-of-face-value subjects " +
      "('Agm/Dividend-10%'), which state no face value and are an honest absence.",
    "measured over all 15,263 stored dividend subjects: 11,512 unchanged, 3,477 newly parsed, 274 corrected, 0 lost",
  );

  const jk = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ingestion_errors
     WHERE status = 'open' AND cron = 'events_ingest'
       AND guard_type = 'range' AND target_field = 'dividendAmount'`;
  await close(
    "JKTYRE dividendAmount = 0",
    idsOf(jk),
    "NSE shipped ' Dividend - Rs 0 .70 Per Share' — a space inside the number — and the regex of the day " +
      "matched '0', stopped at the space and stored ₹0.00 for a real ₹0.70 dividend. The parser was " +
      "repaired for that whitespace afterwards, but nothing ever re-read the row it had already spoiled, " +
      "so the wrong number sat in the database and its guard row sat open. PART A of this script " +
      "re-derived it from the subject the row still carries: 0 → 0.70.",
    "re-derived from the row's own stored NSE subject ' Dividend - Rs 0 .70 Per Share'",
  );

  head("SUMMARY");
  const after = await prisma.ingestionError.count({ where: { status: "open" } });
  console.log(`  closed this run : ${totalClosed}`);
  console.log(`  open before     : ${before}`);
  console.log(`  open after      : ${after}`);
  console.log(
    `\n  LEFT OPEN ON PURPOSE: 18 admin_fill revenue rows (need a cited figure from the company's own\n` +
      `  published result), 11 YoY continuity flags (genuine filer mis-scales, for a human), 7 discovery\n` +
      `  rows (August-2026 listings that owe no filing yet), 1 results failure-rate cascade, and the 3\n` +
      `  critical AMFI shape rows — whose CODE is fixed and verified against the live feed, but which\n` +
      `  close only when a run actually succeeds. Re-run daily_amfi_nav, daily_etf_nav and\n` +
      `  mf_analytics_daily, then close those three.`,
  );
  if (!APPLY) console.log(`\n  DRY RUN — nothing was written. Re-run with --apply.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
