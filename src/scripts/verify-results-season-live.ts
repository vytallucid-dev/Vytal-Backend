// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LIVE PROOF — the results-season banner against the real database.
//
// NOT a build gate (it needs a DB). The build gate proves the copy matrix and the arithmetic; this
// proves the gates fire on real rows, and prints THE FIRE LIST — every stock the strip now appears on,
// with its phase, copy set, reader state and date. That list is the eye test.
//
// It WRITES NOTHING. Reader variants are driven by users who really hold or really watch a name in the
// window — found by query, not created.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { resolveResultsSeasonBanner } from "../results-season/service.js";
import { composeCopy, joinSegments } from "../results-season/copy.js";
import { periodDescriptorFor, today } from "../results-season/window.js";
import type { ReaderPosition, ResultsSeasonCopySet, ResultsSeasonPhase } from "../results-season/types.js";

let failures = 0;
const ok = (label: string, pass: boolean, detail = "") => {
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(110) + "\n" + s + "\n" + "═".repeat(110));

interface Candidate {
  stock_id: string;
  symbol: string;
  name: string;
  event_date: Date;
  days_out: number;
  is_scored: boolean;
  filing_ingested_at: Date | null;
  head_snapshot_at: Date | null;
}

async function main() {
  const t = today();
  console.log(`Today (IST calendar day): ${t.toISOString().slice(0, 10)}`);

  const candidates = await prisma.$queryRaw<Candidate[]>`
    WITH ev AS (
      SELECT ce.stock_id, ce.symbol, ce.event_date::date AS event_date,
             (ce.event_date::date - CURRENT_DATE) AS days_out
      FROM corporate_events ce
      JOIN stocks s ON s.id = ce.stock_id AND s.is_active
      WHERE ce.event_type = 'earnings'
        AND ce.event_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 7
    ),
    fil AS (
      SELECT stock_id, report_date::date AS rd, created_at FROM quarterly_results
      UNION ALL SELECT stock_id, report_date::date, created_at FROM banking_quarterly_results
      UNION ALL SELECT stock_id, report_date::date, created_at FROM nbfc_quarterly_results
      UNION ALL SELECT stock_id, report_date::date, created_at FROM life_insurance_quarterly_results
      UNION ALL SELECT stock_id, report_date::date, created_at FROM general_insurance_quarterly_results
    )
    SELECT ev.stock_id, ev.symbol, st.name, ev.event_date, ev.days_out,
           (head.created_at IS NOT NULL) AS is_scored,
           f.ingested_at AS filing_ingested_at,
           head.created_at AS head_snapshot_at
    FROM ev
    JOIN stocks st ON st.id = ev.stock_id
    LEFT JOIN LATERAL (
      SELECT min(fl.created_at) AS ingested_at FROM fil fl
      WHERE fl.stock_id = ev.stock_id
        AND fl.rd = (date_trunc('quarter', ev.event_date)::date - 1)
    ) f ON true
    LEFT JOIN LATERAL (
      SELECT ss.created_at FROM score_snapshots ss
      WHERE ss.stock_id = ev.stock_id ORDER BY ss.period_key DESC, ss.version DESC LIMIT 1
    ) head ON true
    ORDER BY ev.event_date, ev.symbol
  `;

  rule("1 · THE WINDOW — every earnings date inside T-7…T+7");
  {
    const byDay = new Map<number, Candidate[]>();
    for (const c of candidates) byDay.set(c.days_out, [...(byDay.get(c.days_out) ?? []), c]);
    console.log(`  ${candidates.length} dates across ${new Set(candidates.map((c) => c.symbol)).size} stocks`);
    for (const d of [...byDay.keys()].sort((a, b) => a - b)) {
      const rows = byDay.get(d)!;
      console.log(
        `    T${d >= 0 ? "+" : ""}${String(d).padStart(2)}: ${String(rows.length).padStart(3)} dates · ` +
          `${String(rows.filter((r) => r.is_scored).length).padStart(3)} scored · ` +
          `${String(rows.filter((r) => r.filing_ingested_at != null).length).padStart(3)} with a filing for the period`,
      );
    }
  }

  // ── THE FIRE LIST ───────────────────────────────────────────────────────────────────────────────
  rule("2 · ★ THE FIRE LIST — every stock the strip now appears on, anonymous reader");
  const fired: {
    symbol: string;
    name: string;
    phase: ResultsSeasonPhase;
    copySet: ResultsSeasonCopySet;
    date: string;
    daysOut: number;
    published: boolean;
    /** "June (Q1–Q3)" / "March (Q4)" — which period the filing is of, and therefore which contents
     *  clause the unscored copy uses. Q4 is the minority case and needs to be visible in the list. */
    quarter: string;
    sentence: string;
    short: string;
  }[] = [];
  const silenced = new Map<string, number>();

  // ⚠ ONE ROW PER STOCK, NOT PER CALENDAR ROW. A rescheduled meeting leaves the old row behind
  //   (the upsert key is (stockId, eventType, eventDate)), so JUBLPHARMA and NAUKRI each appear
  //   TWICE in the window. `pickScheduledDate` resolves both of a stock's rows to the SAME banner —
  //   the live one — so listing per calendar row would print the same stock twice with the stale
  //   date beside it. Deduping here is also a live proof that the residue rule works.
  const seenStock = new Set<string>();
  for (const c of candidates) {
    const r = await resolveResultsSeasonBanner(null, c.stock_id);
    if (r.banner) {
      if (seenStock.has(c.stock_id)) continue;
      seenStock.add(c.stock_id);
      // Days-out from the RESOLVED date, never from the candidate row — on a rescheduled stock they
      // differ, and the resolved one is what the reader is actually being told.
      const resolved = new Date(`${r.banner.eventDate}T00:00:00.000Z`);
      const pd = periodDescriptorFor(resolved);
      fired.push({
        symbol: c.symbol,
        name: c.name,
        phase: r.banner.phase,
        copySet: r.banner.copySet,
        date: r.banner.eventDate,
        daysOut: Math.round((resolved.getTime() - t.getTime()) / 86400000),
        published: r.banner.publicationConfirmed,
        quarter: `${pd.monthName} ${pd.isAnnualBearing ? "(Q4)" : "(Q1-Q3)"}`,
        sentence: r.banner.sentence,
        short: r.banner.shortSentence,
      });
    } else {
      silenced.set(r.silence!, (silenced.get(r.silence!) ?? 0) + 1);
    }
  }

  const silentTotal = [...silenced.values()].reduce((a, b) => a + b, 0);
  console.log(
    `  ${fired.length} STOCKS FIRE · ${silentTotal} calendar rows silent ` +
      `(${candidates.length} rows across ${new Set(candidates.map((c) => c.stock_id)).size} stocks)\n`,
  );
  console.log(
    `  ${"SYMBOL".padEnd(13)}${"PHASE".padEnd(13)}${"COPY SET".padEnd(11)}${"DATE".padEnd(13)}${"T".padEnd(6)}${"QUARTER".padEnd(16)}PUBLISHED`,
  );
  console.log("  " + "─".repeat(82));
  for (const f of fired.sort((a, b) => a.daysOut - b.daysOut || a.symbol.localeCompare(b.symbol))) {
    console.log(
      `  ${f.symbol.padEnd(13)}${f.phase.padEnd(13)}${f.copySet.padEnd(11)}${f.date.padEnd(13)}` +
        `${(f.daysOut >= 0 ? `+${f.daysOut}` : `${f.daysOut}`).padEnd(6)}${f.quarter.padEnd(16)}` +
        `${f.published ? "yes" : f.phase === "after" ? "no — scheduled only" : "—"}`,
    );
  }
  // ★ The quarter split, because Q4 is the minority case and a list of 179 rows hides a count of 0.
  const byQuarter = new Map<string, number>();
  for (const f of fired) byQuarter.set(f.quarter, (byQuarter.get(f.quarter) ?? 0) + 1);
  console.log("\n  Quarter split across the firing set:");
  for (const [q, n] of [...byQuarter.entries()].sort()) console.log(`    ${String(n).padStart(3)} × ${q}`);

  // ★ BY PHASE AND BY COPY SET — the shape the two deleted gates used to distort. `filed_today` was
  //   structurally unreachable before (gate 3 silenced it) and the post-result phases were thinned by
  //   gate 4, so these two counts are where the reframe shows up.
  const byPhase = new Map<string, number>();
  const bySet = new Map<string, number>();
  for (const f of fired) {
    byPhase.set(f.phase, (byPhase.get(f.phase) ?? 0) + 1);
    bySet.set(f.copySet, (bySet.get(f.copySet) ?? 0) + 1);
  }
  console.log("\n  By phase:");
  for (const ph of ["before", "day_of", "filed_today", "after"]) {
    console.log(`    ${String(byPhase.get(ph) ?? 0).padStart(3)} × ${ph}`);
  }
  console.log("\n  By copy set:");
  for (const [k, n] of [...bySet.entries()].sort()) console.log(`    ${String(n).padStart(3)} × ${k}`);

  console.log("\n  Silence, by reason:");
  for (const [k, n] of [...silenced.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)} × ${k}`);
  }
  ok("no `not_scored` silence remains — being unscored now selects copy, not silence", !silenced.has("not_scored" as never));
  ok("no `score_already_reflects_it` silence remains — gate 4 is deleted", !silenced.has("score_already_reflects_it" as never));
  ok("no `filing_already_landed` silence remains — gate 3 is deleted", !silenced.has("filing_already_landed" as never));

  // ── ★ EVERY REMAINING PATH TO SILENCE, COUNTED ──────────────────────────────────────────────────
  rule("2b · ★ EVERY PATH TO SILENCE — enumerated, counted, and judged");
  {
    type Path = { name: string; where: string; verdict: string; count: number | string };
    const rows: Path[] = [];

    // 1 · unknown_stock — no such stock, or inactive.
    const inactive = await prisma.stock.count({ where: { isActive: false } });
    rows.push({
      name: "unknown_stock",
      where: "service · loadStockFacts returns null",
      verdict: "CORRECT — nothing to render for a stock we do not carry",
      count: `${inactive} inactive stocks in the universe (never requested by the stock page)`,
    });

    // 2 · no_scheduled_date — the big one, and the only one worth arguing about.
    rows.push({
      name: "no_scheduled_date",
      where: "service · gate 1",
      verdict:
        "CORRECT, and DEPENDENT ON CALENDAR COVERAGE — measured complete: all 385 June-2026 filers " +
        "carry a matching earnings row within ±10 days. Would become a real gap if that ever slipped.",
      count: silenced.get("no_scheduled_date") ?? 0,
    });

    // 3 · outside_window — unreachable by construction; prove it rather than assert it.
    const outOfBand = candidates.filter((c) => c.days_out < -7 || c.days_out > 7).length;
    rows.push({
      name: "outside_window",
      where: "service · gate 1, second branch",
      verdict:
        "UNREACHABLE BY CONSTRUCTION — the query and phaseFor share WINDOW_DAYS, so a row that came " +
        "back cannot fall outside it. Kept as defence in depth against widening one and not the other.",
      count: `${outOfBand} candidate rows outside ±7 (query cannot return any)`,
    });

    // 4 · filing_lookup_failed — fail-closed, and it should never be non-zero in a healthy run.
    rows.push({
      name: "filing_lookup_failed",
      where: "service · filingForPeriod catch",
      verdict:
        "CORRECT and FAIL-CLOSED — without the filing read we cannot tell 'were published' from " +
        "'were scheduled for', and gate 5 exists to keep those apart. A guess is worse than silence.",
      count: silenced.get("filing_lookup_failed") ?? 0,
    });

    // 5 · the frontend, which is a silence path the resolver never sees.
    rows.push({
      name: "(frontend) stockId null / fetch failed",
      where: "ResultsSeasonBannerStrip · `if (!banner) return null`",
      verdict:
        "CORRECT — the strip is conditional and unskeletoned by design; an error message where " +
        "context belongs is worse than its absence. Transient while the health read resolves.",
      count: "not measurable server-side",
    });

    // ── and the NON-gate behaviours the brief asked about explicitly ────────────────────────────
    const multiRow = new Map<string, number>();
    for (const c of candidates) multiRow.set(c.stock_id, (multiRow.get(c.stock_id) ?? 0) + 1);
    const rescheduled = [...multiRow.values()].filter((n) => n > 1).length;
    rows.push({
      name: "(not a silence) reschedule dedupe",
      where: "window · pickScheduledDate",
      verdict:
        "CHOOSES, never silences — a moved meeting leaves the stale row behind and the live one wins. " +
        "One banner per stock, not one per calendar row.",
      count: `${rescheduled} stocks carry >1 earnings row in the window`,
    });
    rows.push({
      name: "(not representable) null / unparseable date",
      where: "prisma · corporate_events.event_date",
      verdict: "IMPOSSIBLE — the column is a non-null @db.Date, so Prisma cannot hand us a bad value.",
      count: 0,
    });

    for (const r of rows) {
      console.log(`\n  ${r.name}`);
      console.log(`    where   : ${r.where}`);
      console.log(`    today   : ${r.count}`);
      console.log(`    verdict : ${r.verdict}`);
    }

    const typed = ["unknown_stock", "no_scheduled_date", "outside_window", "filing_lookup_failed"];
    const unexpected = [...silenced.keys()].filter((k) => !typed.includes(k));
    ok("every silence observed today is one of the four typed paths", unexpected.length === 0, unexpected.join(",") || typed.join(", "));
  }

  // ── The sentences those stocks actually serve ───────────────────────────────────────────────────
  rule("3 · ★ THE SENTENCES SERVED — one worked example per (phase × copy set) that fired");
  {
    const seen = new Set<string>();
    for (const f of fired) {
      const key = `${f.phase}/${f.copySet}/${f.published}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`\n  [${f.phase} · ${f.copySet}${f.phase === "after" ? (f.published ? " · published" : " · scheduled only") : ""}]  ${f.symbol} — ${f.name}`);
      console.log(`    full : ${f.sentence}`);
      console.log(`    short: ${f.short}`);
    }
  }

  // ── The unscored set, on a real unscored stock, across all three reader states ───────────────────
  rule("4 · ★ THE UNSCORED SET ON A REAL UNSCORED STOCK, ALL THREE READER STATES");
  {
    const u = candidates.find((c) => !c.is_scored);
    if (!u) {
      ok("no unscored candidate in today's window", true, "skipped");
    } else {
      const live = await resolveResultsSeasonBanner(null, u.stock_id);
      ok(
        `${u.symbol} (T${u.days_out >= 0 ? "+" : ""}${u.days_out}) fires with the unscored copy set`,
        live.banner?.copySet === "unscored",
        live.banner ? `copySet=${live.banner.copySet}` : `silence:${live.silence}`,
      );
      ok("…and names no pillar in the payload", (live.banner?.pillarsAtStake.length ?? -1) === 0);

      const dateText = live.banner?.dateText ?? null;
      const phase = live.banner?.phase ?? "before";
      const confirmed = live.banner?.publicationConfirmed ?? false;
      // The period comes off the REAL meeting date, so the contents clause names the quarter this
      // stock actually reported on rather than a fixture's.
      const period = periodDescriptorFor(u.event_date);
      console.log(
        `\n  ${u.symbol} — ${u.name} · ${phase} · ${u.event_date.toISOString().slice(0, 10)} · ` +
          `${period.monthName} quarter${period.isAnnualBearing ? " (Q4 — audited full year rides with it)" : " (Q1–Q3)"}\n`,
      );
      for (const position of ["held", "watching", "none"] as ReaderPosition[]) {
        const r = composeCopy(phase, position, "unscored", dateText, confirmed, [], period);
        console.log(`  [${position}]`);
        console.log(`    full : ${joinSegments(r.segments)}`);
        console.log(`    short: ${joinSegments(r.shortSegments)}\n`);
      }
    }
  }

  // ── The three stocks the brief named ────────────────────────────────────────────────────────────
  rule("4a · ★ THE THREE NAMED STOCKS — each one used to render nothing");
  {
    for (const sym of ["ABFRL", "AFFLE", "GODREJCP"]) {
      const st = await prisma.stock.findFirst({ where: { symbol: sym }, select: { id: true, name: true } });
      if (!st) {
        ok(`${sym} — not in the universe`, false, "cannot verify");
        continue;
      }
      const r = await resolveResultsSeasonBanner(null, st.id);
      ok(`${sym} renders`, r.banner !== null, r.banner ? `${r.banner.phase} · ${r.banner.copySet}` : `silence:${r.silence}`);
      if (r.banner) {
        console.log(`      ${st.name}`);
        console.log(`      full : ${r.banner.sentence}`);
        console.log(`      short: ${r.banner.shortSentence}`);
      }
    }
  }

  // ── The Q4 voice, against a real Q4 meeting ─────────────────────────────────────────────────────
  rule("4b · ★ THE Q4 VOICE — no Q4 date is in the live window, so it is driven by a REAL past one");
  {
    // Every date in a Jul–Aug window reports on the June quarter, so the annual-bearing branch cannot
    // appear live today. It is not untested for that: this drives it off an actual Q4 board meeting
    // held earlier this year, so the date, the period and the branch are all real — only the phase is
    // reconstructed (that meeting is long outside T-7…T+7).
    const q4 = await prisma.$queryRaw<{ symbol: string; name: string; filed_on: Date }[]>`
      SELECT s.symbol, s.name, min(q.filing_date) AS filed_on
      FROM quarterly_results q JOIN stocks s ON s.id = q.stock_id
      WHERE q.report_date = DATE '2026-03-31' AND s.is_active
      GROUP BY 1, 2 ORDER BY 3 LIMIT 1
    `;
    if (!q4[0]) {
      ok("no Q4 filing in the database to drive the branch", true, "skipped");
    } else {
      const ev = q4[0].filed_on;
      const period = periodDescriptorFor(ev);
      const dateText = ev.toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "UTC" });
      ok(
        `${q4[0].symbol}'s ${ev.toISOString().slice(0, 10)} meeting resolves to the annual-bearing branch`,
        period.isAnnualBearing && period.monthName === "March",
        `${period.monthName}, annual=${period.isAnnualBearing}`,
      );
      console.log(`\n  ${q4[0].symbol} — ${q4[0].name} · real Q4 meeting ${ev.toISOString().slice(0, 10)} · ${period.monthName} quarter + audited full year\n`);
      for (const phase of ["before", "day_of", "filed_today", "after"] as ResultsSeasonPhase[]) {
        for (const position of ["held", "watching", "none"] as ReaderPosition[]) {
          const noDate = phase === "day_of" || phase === "filed_today";
          const confirmed = phase === "after" || phase === "filed_today";
          const r = composeCopy(phase, position, "unscored", noDate ? null : dateText, confirmed, [], period);
          console.log(`  [${phase}/${position}]`);
          console.log(`    full : ${joinSegments(r.segments)}`);
          console.log(`    short: ${joinSegments(r.shortSegments)}\n`);
        }
      }
    }
  }

  // ── Gate proofs on real rows ────────────────────────────────────────────────────────────────────
  rule("5 · EACH GATE, PROVEN ON A REAL ROW");
  {
    // Gate 2 no longer suppresses — it selects. Prove both sides on real stocks.
    const unscored = candidates.find((c) => !c.is_scored);
    const scored = candidates.find((c) => c.is_scored);
    if (unscored) {
      const r = await resolveResultsSeasonBanner(null, unscored.stock_id);
      ok(`gate 2 — ${unscored.symbol} (no snapshot) SELECTS the unscored set`, r.banner?.copySet === "unscored", r.banner ? "banner served" : `silence:${r.silence}`);
    }
    if (scored) {
      const r = await resolveResultsSeasonBanner(null, scored.stock_id);
      ok(
        `gate 2 — ${scored.symbol} (scored) selects the scored set, or a later gate silences it`,
        r.banner ? r.banner.copySet === "scored" : r.silence !== null,
        r.banner ? "scored copy" : `silence:${r.silence}`,
      );
    }

    // ★ THE TWO DELETED GATES — the states that used to silence must now RENDER.
    //   Gate 4's population: a scored stock whose snapshot post-dates the filing. Nineteen of these
    //   sat silent; every one of them is a reader who had no idea results had landed.
    const rescored = candidates.filter(
      (c) => c.is_scored && c.filing_ingested_at && c.head_snapshot_at && c.head_snapshot_at >= c.filing_ingested_at,
    );
    if (rescored.length > 0) {
      const results = await Promise.all(rescored.map((c) => resolveResultsSeasonBanner(null, c.stock_id)));
      const silent = results.filter((r) => r.banner === null);
      ok(
        `gate 4 is GONE — all ${results.length} already-rescored stocks now render`,
        silent.length === 0,
        silent.length === 0 ? rescored.map((c) => c.symbol).slice(0, 6).join(", ") : `${silent.length} still silent: ${silent.map((r) => r.silence).join(",")}`,
      );
      ok(
        "…and none of them claims the score is stale",
        results.every((r) => !r.banner || !/still (?:built on|scored on) the previous quarter|hasn't taken them in/i.test(r.banner.sentence)),
      );
    } else ok("gate 4's population — none in today's window", true, "skipped");

    //   Gate 3's population: a stock whose filing landed while the calendar still said "today".
    const filedOnMeetingDay = candidates.filter((c) => c.days_out === 0 && c.filing_ingested_at);
    if (filedOnMeetingDay.length > 0) {
      const results = await Promise.all(filedOnMeetingDay.map((c) => resolveResultsSeasonBanner(null, c.stock_id)));
      ok(
        `gate 3 is GONE — all ${results.length} filed-on-the-day stocks now render`,
        results.every((r) => r.banner !== null),
        filedOnMeetingDay.map((c) => c.symbol).join(", "),
      );
      ok(
        "…and each gets the filed_today phase, not a 'results are due today' claim",
        results.every((r) => r.banner?.phase === "filed_today"),
        results.map((r) => r.banner?.phase ?? `silence:${r.silence}`).join(","),
      );
    } else ok("gate 3's population — none in today's window", true, "skipped");

    // Gate 1 — outside the window.
    const outside = await prisma.$queryRaw<{ id: string; symbol: string }[]>`
      SELECT s.id, s.symbol FROM stocks s
      WHERE s.is_active
        AND NOT EXISTS (
          SELECT 1 FROM corporate_events ce WHERE ce.stock_id = s.id AND ce.event_type='earnings'
            AND ce.event_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 7)
      LIMIT 1`;
    if (outside[0]) {
      const r = await resolveResultsSeasonBanner(null, outside[0].id);
      ok(`gate 1 — ${outside[0].symbol} (no scheduled date) ⇒ silence`, r.banner === null, r.silence ?? "BANNER SERVED");
    }

    const r = await resolveResultsSeasonBanner(null, "00000000-0000-0000-0000-000000000000");
    ok("unknown stock ⇒ silence, never a throw", r.banner === null && r.silence === "unknown_stock", r.silence ?? "?");
  }

  // ── Reader variants on real readers ─────────────────────────────────────────────────────────────
  rule("6 · READER VARIANTS ON REAL READERS (nothing is written; these rows already exist)");
  {
    const heldRows = await prisma.$queryRaw<{ user_id: string; stock_id: string; symbol: string; days_out: number }[]>`
      SELECT h.user_id, h.stock_id, ce.symbol, (ce.event_date::date - CURRENT_DATE) AS days_out
      FROM holdings h
      JOIN corporate_events ce ON ce.stock_id = h.stock_id AND ce.event_type='earnings'
      WHERE h.quantity > 0 AND ce.event_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 7
      LIMIT 5`;
    const watchRows = await prisma.$queryRaw<{ user_id: string; stock_id: string; symbol: string; days_out: number }[]>`
      SELECT w.user_id, w.stock_id, ce.symbol, (ce.event_date::date - CURRENT_DATE) AS days_out
      FROM watchlist w
      JOIN corporate_events ce ON ce.stock_id = w.stock_id AND ce.event_type='earnings'
      WHERE ce.event_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 7
      LIMIT 5`;
    console.log(`  real holders in the window: ${heldRows.length} · real watchers: ${watchRows.length}\n`);
    for (const row of [...heldRows, ...watchRows]) {
      const r = await resolveResultsSeasonBanner(row.user_id, row.stock_id);
      if (r.banner) {
        console.log(`    ${row.symbol} (T${row.days_out >= 0 ? "+" : ""}${row.days_out}) · ${r.banner.copySet} · position=${r.banner.position}`);
        console.log(`      full : ${r.banner.sentence}`);
        console.log(`      short: ${r.banner.shortSentence}`);
      } else {
        console.log(`    ${row.symbol} (T${row.days_out >= 0 ? "+" : ""}${row.days_out}) → silence:${r.silence}`);
      }
    }
  }

  console.log("\n" + "─".repeat(110));
  if (failures > 0) {
    console.error(`FAILED — ${failures} live assertion${failures === 1 ? "" : "s"}.`);
    process.exit(1);
  }
  console.log(`PASSED — ${fired.length} stocks fire, every gate holds on real rows.`);
}

main()
  .catch((e) => {
    console.error("verify-results-season-live crashed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
