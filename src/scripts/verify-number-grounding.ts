// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PROOF — the free-text arithmetic fixes. Offline, deterministic: no AI call, no network, DB read-only.
//
//   §1  the event-description parser        (the ₹57 defect, at the source)
//   §2  the ₹57 REGRESSION, end to end      (the exact live row that produced it)
//   §3  the whole corpus, re-classified     (every one of 7,741 rows lands somewhere safe)
//   §4  the ungrounded-number detector      (POSITIVE + ★ NEGATIVE controls)
//   §5  instrument attributes               (allow-list, units, precision)
//
// ★ §4's NEGATIVE CONTROLS ARE THE LOAD-BEARING HALF. A detector that fires on correct text is worse
// than no detector — it trains people to ignore the log. Four sentences that MUST stay silent are pinned
// here: spoken rounding ("about 80%"), comma formatting, a lakh-crore unit shift, and the product's own
// vocabulary ("0 to 100"). If a future tolerance change breaks one of them, this fails loudly.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { parseEventDescription, renderComponents, SUPPRESSED_TAIL_NOTE } from "../chat/tools/event-description.js";
import { scanUngroundedNumbers, buildNumberHaystack } from "../ai/number-grounding.js";
import { buildSystemPrompt } from "../chat/voice.js";
import { resolveTone } from "../ai/tone.js";
import { toolSpecs, makeToolContext } from "../chat/tools/registry.js";
import { getCorporateEventsTool } from "../chat/tools/get-corporate-events.js";
import { getInstrumentDetailsTool } from "../chat/tools/get-instrument-details.js";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const section = (s: string) => console.log(`\n══ ${s} ══`);

async function main() {
  // ── §1 · THE PARSER ────────────────────────────────────────────────────────────────────────────
  section("1 · event-description parser — the three outcomes");
  {
    const clean = parseEventDescription("To consider and approve the financial results for the period ended Jun 30, 2026", null);
    ok("no currency amount ⇒ clean, text passes through", clean.kind === "clean");

    // ★ THE LIVE ROW. dividendAmount=11 in the column, ₹46 special only in the tail.
    const tcs = parseEventDescription("Interim Dividend Rs 11 Per Share/ Special Dividend Rs 46 Per Share", 11);
    ok("the ₹57 row parses as structured", tcs.kind === "structured");
    if (tcs.kind === "structured") {
      ok("both components recovered", tcs.components.length === 2, JSON.stringify(tcs.components));
      ok("★ the special is attributed, not lost", tcs.components.some((c) => c.label === "special" && c.amount === 46));
      ok("★ the TOTAL is computed in code, not left to the model", tcs.total === 57, `total=${tcs.total}`);
    }

    // FY25's row — the second named regression.
    const fy25 = parseEventDescription("Interim Dividend - Rs 10 Per Share Special Dividend - Rs 66 Per Share", 10);
    ok("★ the ₹66 case parses", fy25.kind === "structured" && fy25.total === 76, fy25.kind === "structured" ? `total=${fy25.total}` : fy25.kind);

    // Special FIRST — the 3 measured rows where order is reversed.
    const rev = parseEventDescription("Special Dividend - Rs 525 Per Share/ Dividend - Rs 160 Per Share", 160);
    ok("special-first order parses (two-sided matcher)", rev.kind === "structured" && rev.total === 685);

    // Abbreviations with no "Dividend" word — TATAINVEST 2012 / GLAXO 2009.
    const spl1 = parseEventDescription("Annual General Meeting/Dividend Final Rs 16 + Special Rs 5 Per Share", 16);
    ok('"Special Rs 5" (no "Dividend" word) parses', spl1.kind === "structured" && spl1.total === 21, spl1.kind);
    const spl2 = parseEventDescription("Div Fin-Rs.22 + Spl-Rs.18", 22);
    ok('"Spl-Rs.18" abbreviation parses', spl2.kind === "structured" && spl2.total === 40, spl2.kind);

    // ── FAIL-CLOSED ──
    const split = parseEventDescription("Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share", null);
    ok("★ a face-value split SUPPRESSES (D7 — splitRatio already carries it)", split.kind === "suppress" && split.reason === "unattributed_amount");

    const rights = parseEventDescription("Rights 3:25 @ Premium Rs 1799/-", null);
    ok("★ a rights premium SUPPRESSES", rights.kind === "suppress");

    const mixed = parseEventDescription("Interim Div - Rs 6/- Per Share + Face Value Split (Sub-Division) - From Rs 10/- Per Share To Re 1/- Per Share", 6);
    ok("★ dividend+split mixed row SUPPRESSES (one attributable component cannot certify the row)", mixed.kind === "suppress");

    const revised = parseEventDescription("Annual General Meeting / Final Dividend - Rs 1.80/- Per Share / Interim Dividend - Rs 1.63/- Per Share (Purpose Revised)", 1.8);
    ok("★ a MULTI-amount REVISED row suppresses (figures may replace, not add)", revised.kind === "suppress" && revised.reason === "revision");
    const revised1 = parseEventDescription("Dividend - Rs 3.50/- Per Share (Purpose Revised)", 3.5);
    ok("★ a SINGLE-amount revised row is KEPT and flagged, not suppressed", revised1.kind === "structured" && revised1.revised === true, revised1.kind);
    ok("   …and the revision reaches the model", renderComponents(revised1, 3.5) === "this announcement was revised by the exchange");

    // A lone component restating the column adds nothing → no extra rendered line.
    const lone = parseEventDescription("Interim Dividend - Rs 12 Per Share", 12);
    ok("a lone component matching the column renders no duplicate line", renderComponents(lone, 12) === null);
  }

  // ── §2 · THE ₹57 REGRESSION, THROUGH THE REAL TOOL ─────────────────────────────────────────────
  section("2 · the ₹57 regression — end to end through getCorporateEvents");
  {
    const ctx = makeToolContext({ userId: "verify", sessionId: "verify", userMessage: "" } as never);
    const r = await getCorporateEventsTool.handler({ symbol: "TCS", upcoming: false, days: 400 }, ctx);
    const out = r.ok ? r.content : "";
    console.log(out.split("\n").map((l) => `     ${l}`).join("\n"));
    ok("★ the ₹46 special now reaches the model IN STRUCTURE", out.includes("special ₹46/share"));
    ok("★ the total ₹57 is STATED, so the model quotes rather than computes", out.includes("total ₹57/share"));
    ok("★ the raw prose tail is gone", !out.includes("Interim Dividend Rs 11 Per Share/"));
  }

  // ── §3 · THE WHOLE CORPUS — every row must land somewhere safe ─────────────────────────────────
  section("3 · all corporate_events rows re-classified");
  {
    const rows = await prisma.corporateEvent.findMany({ select: { description: true, dividendAmount: true } });
    const tally = { clean: 0, structured: 0, suppress: 0 };
    let leaked = 0;
    const AMOUNT = /(?:rs|inr|re|₹)\.?\s*([0-9]+(?:\.[0-9]+)?)/gi;
    for (const e of rows) {
      const amt = e.dividendAmount == null ? null : Number(e.dividendAmount);
      const v = parseEventDescription(e.description, amt);
      tally[v.kind]++;
      // THE SAFETY PROPERTY: no text passed through verbatim may contain a currency amount.
      if (v.kind === "clean" && v.text && [...v.text.matchAll(AMOUNT)].length > 0) leaked++;
    }
    console.log(`     clean(verbatim) ${tally.clean} · structured ${tally.structured} · suppressed ${tally.suppress} · total ${rows.length}`);
    ok("★ ZERO rows pass a currency amount through as free text", leaked === 0, `leaked=${leaked}`);
    ok("every row is classified", tally.clean + tally.structured + tally.suppress === rows.length);
    ok("the suppression marker vocabulary is complete", !!SUPPRESSED_TAIL_NOTE.unattributed_amount && !!SUPPRESSED_TAIL_NOTE.revision);
  }

  // ── §4 · THE DETECTOR — positive AND negative controls ─────────────────────────────────────────
  section("4 · ungrounded-number detector");
  {
    const FIXED = buildNumberHaystack({
      system: buildSystemPrompt(resolveTone(null, null).systemDirective),
      toolSpecsJson: JSON.stringify(toolSpecs()),
      messages: [
        { content: "" , toolResult: { response: { output:
          "Dividend payout: ~80% (raw 80.02)\nRevenue: ₹267021.00 crore (raw 2670210000000)\n" +
          "Net profit: ₹49454.00 crore\nDividend yield: ~5% (raw 4.62)\n" +
          "  2026-01-16 · dividend ₹11/share (interim), interim ₹11/share + special ₹46/share, total ₹57/share declared in this announcement" } } },
      ],
    });

    // ★★★ THE FOUR SENTENCES BELOW ARE VERBATIM FROM A LIVE RUN, AND THE DETECTOR FIRED ON THEM. ★★★
    // The model spoke Indian numbering — obeying CONVERSATIONAL_PRECISION — and "95 thousand 750" was
    // read as a claim about 95. Pinned here so the composite reader can never silently regress.
    const IND = buildNumberHaystack({
      system: buildSystemPrompt(resolveTone(null, null).systemDirective),
      messages: [{ content: "", toolResult: { response: { output:
        // The real RELIANCE fundamentals block, trimmed to the lines these four sentences draw on.
        // ⚠ The growth lines are here because the live reply said "growing roughly 18%" — omit them and
        //   the control fails on 18 for a reason that has nothing to do with Indian numbering.
        "Revenue: ₹1075675.00 crore\nNet profit: ₹95754.00 crore\nCash from operations: ₹192113.00 crore\n" +
        "Capital expenditure: ₹122916.00 crore\nFree cash flow: ₹69197.00 crore\n" +
        "Revenue growth YoY: +9.8%\nProfit growth YoY: +17.8%" } } }],
    });
    const LIVE_FP: [string, string][] = [
      ["\"About 95 thousand 750 crore rupees\" (live, ← 95754)", "Net Profit: About 95 thousand 750 crore rupees, growing roughly 18% year-on-year."],
      ["\"roughly 1 lakh 92 thousand crore\" (live, ← 192113)", "Generated roughly 1 lakh 92 thousand crore rupees from operations."],
      ["\"Roughly 10 lakh 75 thousand crore\" (live, ← 1075675)", "Revenue: Roughly 10 lakh 75 thousand crore rupees, up about 10%."],
      ["\"about 1 lakh 23 thousand crore\" (live, ← 122916)", "Capital expenditure stood at about 1 lakh 23 thousand crore rupees."],
    ];
    for (const [label, text] of LIVE_FP) {
      const v = scanUngroundedNumbers(text, IND);
      ok(`★ LIVE FALSE POSITIVE, now silent · ${label}`, v.clean, v.clean ? "" : `STILL FIRES on ${v.hits.map((h) => h.raw).join(", ")}`);
    }
    // …and the composite reader must not blind the detector: a WRONG composite still has to fire.
    const wrongComposite = scanUngroundedNumbers("Net profit was about 7 lakh 40 thousand crore rupees.", IND);
    ok("★ …but a WRONG Indian-numbering composite still fires", !wrongComposite.clean, wrongComposite.hits.map((h) => h.raw).join(", "));

    // ★★ NEGATIVE CONTROLS — correct answers. Any fire here is a false positive and fails the build. ★★
    const NEG: [string, string][] = [
      ["spoken rounding (CONVERSATIONAL_PRECISION orders it)", "TCS paid out about 80% of its profit, on revenue of ₹267,021 crore and net profit of ₹49,454 crore."],
      ["comma formatting", "Revenue was ₹267,021 crore."],
      ["unit shift to lakh crore", "Revenue was ₹2.67 lakh crore last year."],
      ["the product's own vocabulary from the system prompt", "The health score runs from 0 to 100 and the Market pillar reads the 52-week range."],
      ["quoting the now-structured total", "January's payment was ₹57 a share in total — ₹11 interim and ₹46 special."],
    ];
    for (const [label, text] of NEG) {
      const v = scanUngroundedNumbers(text, FIXED);
      ok(`NEGATIVE · stays silent on ${label}`, v.clean, v.clean ? "" : `fired on ${v.hits.map((h) => h.raw).join(", ")}`);
    }

    // POSITIVE CONTROLS — the defect, and a plain fabrication.
    const P1 = scanUngroundedNumbers("The January payment totalled 73 rupees per share.", FIXED);
    ok("POSITIVE · fires on a computed total that is in no field", !P1.clean, P1.hits.map((h) => h.raw).join(","));
    const P2 = scanUngroundedNumbers("Its return on equity was 33.4% last year.", FIXED);
    ok("POSITIVE · fires on an invented figure", !P2.clean, P2.hits.map((h) => h.raw).join(","));

    // ⚠ THE DOCUMENTED BLIND SPOT — pinned so nobody reads a clean log as proof.
    const blind = scanUngroundedNumbers("There were 4 block deals this window.", FIXED);
    ok("⚠ BLIND SPOT pinned · an invented COUNT (≤12) is NOT caught, by design", blind.clean && blind.skipped > 0,
      `checked=${blind.checked} skipped=${blind.skipped} — see number-grounding.ts header`);

    ok("a blank reply is trivially clean", scanUngroundedNumbers("", FIXED).clean);
  }

  // ── §5 · INSTRUMENT ATTRIBUTES ─────────────────────────────────────────────────────────────────
  section("5 · instrument attributes — allow-list, unit, precision");
  {
    const inst = await prisma.instrument.findFirst({
      where: { assetClass: { in: ["reit", "invit"] as never }, attributes: { not: undefined } },
      select: { isin: true, attributes: true },
    });
    if (!inst) { console.log("     (no REIT/InvIT with attributes on file — skipped)"); }
    else {
      const ctx = makeToolContext({ userId: "verify", sessionId: "verify", userMessage: "" } as never);
      const r = await getInstrumentDetailsTool.handler({ identifier: inst.isin }, ctx);
      const out = r.ok ? r.content : "";
      console.log(out.split("\n").map((l) => `     ${l}`).join("\n"));
      ok("★ no raw JSON blob reaches the model", !out.includes('{"') && !out.includes('":'));
      const raw = JSON.stringify(inst.attributes);
      const dy = (inst.attributes as Record<string, unknown> | null)?.distributionYield;
      if (typeof dy === "number") {
        ok("★ the yield is rendered as a PERCENT (×100), not a bare fraction", out.includes(`${(dy * 100).toFixed(2)}%`), `stored ${dy}`);
        ok("★ 17-digit precision does not survive", !out.includes(String(dy)));
      }
      ok("the raw blob is not echoed anywhere", !out.includes(raw));
    }
  }

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
