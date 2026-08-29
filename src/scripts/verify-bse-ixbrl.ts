// ═══════════════════════════════════════════════════════════════════════════════
// GATE — BSE inline-XBRL transform. Offline, instant, no network, no DB.
//   npx tsx src/scripts/verify-bse-ixbrl.ts
//
// The transform sits upstream of every BSE extractor, so a fault here is a fault in
// every number the lane writes. The properties asserted are the ones whose failure
// produces a PLAUSIBLE WRONG NUMBER rather than an error:
//   · scale applied exactly (a float round-trip shifts the last digit)
//   · sign taken from the ATTRIBUTE (missing it flips the number)
//   · DD-MM-YYYY read as day-month (reading it as month-day files the wrong quarter)
//   · a date that disagrees with its own context REFUSES instead of guessing
// ═══════════════════════════════════════════════════════════════════════════════
import { ixbrlToXbrl, applyScale, ddmmyyyyToIso, isInlineXbrl, IxbrlError } from "../ingestions/quaterly-results/bse/bse-ixbrl.js";

let fails = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  if (!ok) fails++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

console.log("\n=== BSE inline-XBRL gate ===\n");

console.log("-- applyScale: exact decimal shift, never floating point --");
for (const [raw, scale, want] of [
  ["1,813.68", 7, "18136800000"],   // the real Abbott India Q1 FY27 revenue
  ["75.37", 7, "753700000"],
  ["31.10", 7, "311000000"],
  ["1234", 0, "1234"],
  ["0.00", 7, "0"],
  ["-5.5", 7, "-55000000"],
  ["(12.5)", 7, "-125000000"],      // bracketed negative
  ["12.3456789", 7, "123456789"],
  ["1.23456789", 7, "12345678.9"],  // more decimals than the scale
  ["500", -2, "5"],                 // negative scale
  ["", 7, null],
  ["-", 7, null],
  ["n/a", 7, null],
] as [string, number, string | null][]) {
  const got = applyScale(raw, scale);
  check(`applyScale("${raw}", ${scale}) = ${want}`, got === want, `got ${got}`);
}
// the property that motivates the string shift
const viaFloat = String(1813.68 * 1e7);
check("string shift beats the float round-trip", applyScale("1813.68", 7) === "18136800000",
  `float gives ${viaFloat}`);

console.log("\n-- dates: DD-MM-YYYY, and nothing else --");
for (const [v, want] of [
  ["30-06-2026", "2026-06-30"],
  ["01-04-2026", "2026-04-01"],
  ["31-03-2027", "2027-03-31"],   // 31 cannot be a month — proves the order
  ["2026-06-30", null],           // already ISO: not our shape, left alone
  ["13-13-2026", null],
  ["", null],
] as [string, string | null][]) check(`ddmmyyyyToIso("${v}") = ${want}`, ddmmyyyyToIso(v) === want, `got ${ddmmyyyyToIso(v)}`);

console.log("\n-- detection --");
check("plain XBRL is not inline", !isInlineXbrl(`<xbrli:xbrl><in-bse-fin:X contextRef="OneD">1</in-bse-fin:X></xbrli:xbrl>`));
check("inline is inline", isInlineXbrl(`<ix:nonFraction name='a:B' contextRef='OneD'>1</ix:nonFraction>`));

// ── a minimal but REAL-SHAPED document ────────────────────────────────────────
const doc = (facts: string, ctxEnd = "2026-06-30"): string => `
<html xmlns:in-capmkt='http://www.sebi.gov.in/xbrl/2026-01-31/in-capmkt'
      xmlns='http://www.w3.org/1999/xhtml' xmlns:xbrli='http://www.xbrl.org/2003/instance'
      xmlns:link='http://www.xbrl.org/2003/linkbase' xmlns:ix='http://www.xbrl.org/2013/inlineXBRL'>
<ix:header><ix:references></ix:references><ix:resources>
<xbrli:context id='OneD' xmlns:xbrli='http://www.xbrl.org/2003/instance'>
  <xbrli:entity><xbrli:identifier scheme='s'>500488</xbrli:identifier></xbrli:entity>
  <xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>${ctxEnd}</xbrli:endDate></xbrli:period>
</xbrli:context>
<xbrli:unit id='INR' xmlns:xbrli='http://www.xbrl.org/2003/instance'><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>
</ix:resources></ix:header>
<body>${facts}</body></html>`;

console.log("\n-- transform --");
const t = ixbrlToXbrl(doc(`
  <ix:nonFraction name='in-capmkt:RevenueFromOperations' contextRef='OneD' unitRef='INR' scale='7' decimals='-5'>1,813.68</ix:nonFraction>
  <ix:nonFraction name='in-capmkt:ChangesInInventories' contextRef='OneD' unitRef='INR' scale='7' decimals='-5' sign='-'>31.10</ix:nonFraction>
  <ix:nonNumeric name='in-capmkt:DateOfStartOfReportingPeriod' contextRef='OneD'>01-04-2026</ix:nonNumeric>
  <ix:nonNumeric name='in-capmkt:DateOfEndOfReportingPeriod' contextRef='OneD'>30-06-2026</ix:nonNumeric>
  <ix:nonNumeric name='in-capmkt:ResultType' contextRef='OneD'>Standalone</ix:nonNumeric>`));

check("declares xmlns:in-capmkt so factNs() finds it", /xmlns:in-capmkt="/.test(t.xml));
check("does NOT carry the xhtml default namespace", !/xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/.test(t.xml));
check("root is xbrli:xbrl", /<xbrli:xbrl\b/.test(t.xml));
check("contexts are carried over", /<xbrli:context[^>]*id="OneD"/.test(t.xml));
check("attributes are DOUBLE quoted (extractNumber requires it)", !/contextRef='/.test(t.xml));
check("scale applied to the fact", /<in-capmkt:RevenueFromOperations[^>]*>18136800000</.test(t.xml),
  t.xml.match(/<in-capmkt:RevenueFromOperations[^>]*>([^<]*)</)?.[1] ?? "absent");
check("sign='-' NEGATES the value", /<in-capmkt:ChangesInInventories[^>]*>-311000000</.test(t.xml),
  t.xml.match(/<in-capmkt:ChangesInInventories[^>]*>([^<]*)</)?.[1] ?? "absent");
check("dates converted to ISO", /<in-capmkt:DateOfEndOfReportingPeriod[^>]*>2026-06-30</.test(t.xml));
check("non-date text survives untouched", /<in-capmkt:ResultType[^>]*>Standalone</.test(t.xml));
check("unitRef preserved", /<in-capmkt:RevenueFromOperations[^>]*unitRef="INR"/.test(t.xml));

console.log("\n-- ⚠ the refusal that stops a wrong period being filed --");
try {
  ixbrlToXbrl(doc(`
    <ix:nonFraction name='in-capmkt:RevenueFromOperations' contextRef='OneD' unitRef='INR' scale='7'>1</ix:nonFraction>
    <ix:nonNumeric name='in-capmkt:DateOfEndOfReportingPeriod' contextRef='OneD'>30-09-2026</ix:nonNumeric>`));
  check("a date disagreeing with its own context is REFUSED", false, "it was accepted");
} catch (e) {
  check("a date disagreeing with its own context is REFUSED", e instanceof IxbrlError,
    String(e).slice(0, 96));
}

console.log("\n-- other refusals --");
for (const [name, bad] of [
  ["a document with no facts", doc("")],
  ["a document with no resources", `<html xmlns:in-capmkt='x' xmlns:xbrli='y'><ix:nonFraction name='a:B' contextRef='C'>1</ix:nonFraction></html>`],
  ["a plain XBRL instance", `<xbrli:xbrl><in-bse-fin:X contextRef="OneD">1</in-bse-fin:X></xbrli:xbrl>`],
] as [string, string][]) {
  try { ixbrlToXbrl(bad); check(`${name} is refused`, false, "it was accepted"); }
  catch (e) { check(`${name} is refused`, e instanceof IxbrlError, String((e as Error).message).slice(0, 70)); }
}

// an empty cell is absence, not zero
const t2 = ixbrlToXbrl(doc(`
  <ix:nonFraction name='in-capmkt:RevenueFromOperations' contextRef='OneD' unitRef='INR' scale='7'>1</ix:nonFraction>
  <ix:nonFraction name='in-capmkt:OtherIncome' contextRef='OneD' unitRef='INR' scale='7'>-</ix:nonFraction>`));
check("an empty cell is OMITTED, never written as 0", !/OtherIncome/.test(t2.xml));


console.log("\n-- the EARLY vintage: no reporting-period facts, period only in the context --");
// MEASURED on ABBOTINDIA MQ2024-2025 and the Jun-2025 filings: the first inline documents BSE
// published carry TypeOfReportingPeriod but no DateOf*ReportingPeriod, so the guard refused them.
const early = ixbrlToXbrl(`
<html xmlns:in-capmkt='http://www.sebi.gov.in/xbrl/2026-01-31/in-capmkt'
      xmlns:xbrli='http://www.xbrl.org/2003/instance' xmlns:ix='http://www.xbrl.org/2013/inlineXBRL'>
<ix:header><ix:resources>
<xbrli:context id='OneD'><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id='FourD'><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>
</ix:resources></ix:header><body>
<ix:nonFraction name='in-capmkt:RevenueFromOperations' contextRef='OneD' unitRef='INR' scale='7'>1,604.59</ix:nonFraction>
<ix:nonNumeric name='in-capmkt:TypeOfReportingPeriod' contextRef='OneD'>Quarterly</ix:nonNumeric>
</body></html>`);
check("synthesises the quarterly period from its context",
  /<in-capmkt:DateOfEndOfReportingPeriod contextRef="OneD">2025-03-31</.test(early.xml));
check("  and the annual one too, separately",
  /<in-capmkt:DateOfStartOfReportingPeriod contextRef="FourD">2024-04-01</.test(early.xml));
check("  and says so in the warnings", early.warnings.some((w) => /synthesised/.test(w)),
  early.warnings.join(" | ").slice(0, 70));

const stated = ixbrlToXbrl(`
<html xmlns:in-capmkt='x' xmlns:xbrli='http://www.xbrl.org/2003/instance' xmlns:ix='i'>
<ix:header><ix:resources>
<xbrli:context id='OneD'><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
</ix:resources></ix:header><body>
<ix:nonFraction name='in-capmkt:RevenueFromOperations' contextRef='OneD' unitRef='INR' scale='7'>1</ix:nonFraction>
<ix:nonNumeric name='in-capmkt:DateOfEndOfReportingPeriod' contextRef='OneD'>30-06-2026</ix:nonNumeric>
</body></html>`);
check("a STATED date is never duplicated by a synthesised one",
  (stated.xml.match(/DateOfEndOfReportingPeriod contextRef="OneD"/g) ?? []).length === 1,
  `${(stated.xml.match(/DateOfEndOfReportingPeriod contextRef="OneD"/g) ?? []).length} occurrence(s)`);

console.log(`\n=== ${fails === 0 ? "GATE PASSED" : `GATE FAILED — ${fails} failure(s)`} ===\n`);
process.exit(fails ? 1 : 0);
