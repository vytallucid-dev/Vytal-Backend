// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BULLETS THAT OPEN WITH THE COMPANY'S NAME — MEASURED BEFORE AND AFTER, ON THE SAME STOCKS.
//
// ⚠ IT MEASURES TWO THINGS AT ONCE, AND THE SECOND ONE IS THE POINT. Prompt changes have backfired
// twice in this feature and both times the damage showed up in a DIFFERENT number than the one being
// fixed: the bullet-count rule fixed a 9-bullet overrun and compressed TCS's five facts into one
// sentence, and permitting several short sentences pushed over-thirty-word bullets from 9.3% to
// 11.7%. So LENGTH is measured on the same run as the defect. A fix that moves length has failed,
// whatever it did to the opening.
//
//   --set=<symbols>   comma-separated; defaults to the twenty-stock measurement set below
//   --generate        write any brief the set is missing (costs AI calls; otherwise reads only)
//   --force           regenerate every stock in the set (the AFTER pass)
//   --label=<name>    tag for the printed report
//
//   npx tsx src/scripts/brief-name-opening-census.ts --label=BEFORE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { writeQuarterBrief } from "../insight/quarter-brief/write.js";
import { shortenCompanyName } from "../chat/web/news-filter.js";
import { QUARTER_BRIEF_MODEL } from "../insight/quarter-brief/generate.js";
import { peekAiCallQuota } from "../ai/core/quota.js";
import type { BriefPayload } from "../insight/quarter-brief/schema.js";

/** Twenty stocks: all five families, both scored states, and — deliberately over-weighted — the thin
 *  cards, because the defect is reported worst there and a set that under-samples them would measure
 *  the fix on the cards that never had the problem. */
const SET = [
  // the three with no comparison period at all — every bullet has the fewest subjects available
  "MMTC", "ATHERENERG", "SBFC",
  // the four named in the report
  "COCHINSHIP", "HDFCLIFE",
  // families
  "AXISBANK", "BAJAJFINSV", "ICICIGI", "SBILIFE", "CANBK",
  // Q4 + annual, suppressed metrics, loss verdicts
  "IDEA", "ABREL", "GICRE",
  // ordinary rich cards, scored and unscored
  "GLENMARK", "AMBUJACEM", "AUROPHARMA", "BLUESTARCO", "ACC", "APTUS", "NIACL",
];

const arg = (k: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const flag = (k: string): boolean => process.argv.includes(`--${k}`);

/**
 * ★★ THE METRIC THAT MATTERS IS REPETITION, NOT FORM — AND THE FIRST VERSION OF THIS FILE MEASURED
 * THE WRONG ONE.
 *
 * It led on "opens with the REGISTERED name", which went 39.3% → 2.5% and read as a fix. It was not:
 * the model had simply swapped to the SHORT name and still opened every bullet with the company.
 * Cochin Shipyard, after that "fix": 6 of 7 bullets opening "Cochin Shipyard". The defect was
 * unchanged; it merely read more fluently, which is exactly why it passed.
 *
 * ── THE THREE NUMBERS THIS NOW REPORTS, IN ORDER OF WHAT THEY ARE FOR ─────────────────────────────
 *   ANY-FORM SHARE      every bullet opening with the company in any form — registered, short, or
 *                       ticker. The honest headline.
 *   ★ AFTER-FIRST SHARE the number the rule is actually written against. A card MAY open by naming
 *                       the company once; the defect is the SECOND, THIRD and SEVENTH bullet doing
 *                       it. So bullet 1 is excluded and everything after it is counted. Target is
 *                       near zero, and zero is NOT the target for the any-form share.
 *   CARDS ALL-OPENING   how many cards do it in every single bullet.
 */
function opensWithName(text: string, registered: string, short: string): "registered" | "short" | null {
  const t = text.trim().toLowerCase();
  // Longest first, so "SBFC Finance Ltd." is not credited to the short form "SBFC Finance".
  const reg = registered.trim().toLowerCase();
  const sh = short.trim().toLowerCase();
  const startsWith = (p: string): boolean => {
    if (!p) return false;
    if (!t.startsWith(p)) return false;
    // The next character must be a boundary — otherwise "MMTC" matches "MMTCX".
    const next = t.slice(p.length, p.length + 1);
    return next === "" || /[\s.,'’]/.test(next);
  };
  if (reg.length >= sh.length && startsWith(reg)) return "registered";
  if (startsWith(sh)) return reg.length < sh.length && startsWith(reg) ? "registered" : "short";
  if (startsWith(reg)) return "registered";
  return null;
}

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

async function main(): Promise<void> {
  const set = (arg("set")?.split(",").map((s) => s.trim()).filter(Boolean)) ?? SET;
  const label = arg("label") ?? "CENSUS";
  const generate = flag("generate");
  const force = flag("force");

  const q0 = await peekAiCallQuota(QUARTER_BRIEF_MODEL, { kind: "system", job: "quarter_brief" });

  if (generate || force) {
    console.log(`${force ? "REGENERATING" : "GENERATING MISSING"} — ${set.length} stocks\n`);
    for (const symbol of set) {
      const existing = await prisma.quarterBrief.findFirst({ where: { stock: { symbol } }, select: { id: true } });
      if (existing && !force) continue;
      const out = await writeQuarterBrief(symbol, undefined, force ? { force: true } : {});
      console.log(`  ${symbol.padEnd(13)} ${out.kind}${out.kind === "refused" ? ` — ${out.reason}: ${out.detail}` : ""}`);
    }
    console.log("");
  }

  // ── MEASURE ─────────────────────────────────────────────────────────────────────────────────────
  interface Row {
    symbol: string; registered: string; short: string; bullets: number;
    opensRegistered: number; opensShort: number; opensTicker: number;
    /** Bullets AFTER the first that open with the company — the defect, isolated. */
    opensAfterFirst: number; afterFirstTotal: number;
    lens: number[]; allOpen: boolean; texts: string[];
  }
  const rows: Row[] = [];

  for (const symbol of set) {
    const r = await prisma.quarterBrief.findFirst({
      where: { stock: { symbol } },
      select: { content: true, stock: { select: { name: true } } },
    });
    if (!r) { console.log(`  ${symbol}: NO STORED BRIEF — excluded from the measurement`); continue; }
    const p = JSON.parse(r.content) as BriefPayload;
    const registered = r.stock.name;
    const short = shortenCompanyName(registered) || registered;
    let oR = 0, oS = 0, oT = 0, afterFirst = 0;
    const lens: number[] = [];
    p.takeaway.bullets.forEach((b, i) => {
      const kind = opensWithName(b, registered, short);
      // ★ THE TICKER COUNTS TOO. "MMTC reported…" is the company opening the sentence whether or not
      // that string happens to also be the registered name — a metric that missed it would have the
      // same blind spot the form-based one did, one substitution later.
      const ticker = new RegExp(`^${symbol}\\b`, "i").test(b.trim());
      if (kind === "registered") oR++;
      else if (kind === "short") oS++;
      else if (ticker) oT++;
      if (i > 0 && (kind !== null || ticker)) afterFirst++;
      // A bullet may hold two sentences (the length rule allows it) — measure per SENTENCE, which is
      // the unit the thirty-word history was measured in.
      for (const s of b.split(/(?<=[.!?])\s+/)) if (s.trim()) lens.push(words(s));
    });
    rows.push({
      symbol, registered, short, bullets: p.takeaway.bullets.length,
      opensRegistered: oR, opensShort: oS, opensTicker: oT,
      opensAfterFirst: afterFirst, afterFirstTotal: Math.max(0, p.takeaway.bullets.length - 1),
      lens,
      allOpen: p.takeaway.bullets.length > 0 && oR + oS + oT === p.takeaway.bullets.length,
      texts: p.takeaway.bullets,
    });
  }

  const rule = (s: string) => console.log("\n" + "═".repeat(104) + "\n" + s + "\n" + "═".repeat(104));

  const pct = (n: number, d: number) => (d === 0 ? "0.0" : ((n / d) * 100).toFixed(1));

  rule(`${label} — bullets opening with the company (ANY form: registered · short · ticker)`);
  console.log(
    `  ${"symbol".padEnd(13)} ${"bullets".padStart(7)} ${"anyform".padStart(8)} ${"after 1st".padStart(10)}  all?  name given to the model`,
  );
  for (const r of rows) {
    const any = r.opensRegistered + r.opensShort + r.opensTicker;
    console.log(
      `  ${r.symbol.padEnd(13)} ${String(r.bullets).padStart(7)} ${`${any}/${r.bullets}`.padStart(8)} ` +
        `${`${r.opensAfterFirst}/${r.afterFirstTotal}`.padStart(10)}  ${r.allOpen ? " ★  " : "    "}  "${r.short}"`,
    );
  }

  const totalBullets = rows.reduce((a, r) => a + r.bullets, 0);
  const totalReg = rows.reduce((a, r) => a + r.opensRegistered, 0);
  const totalShort = rows.reduce((a, r) => a + r.opensShort, 0);
  const totalTicker = rows.reduce((a, r) => a + r.opensTicker, 0);
  const totalAny = totalReg + totalShort + totalTicker;
  const afterFirst = rows.reduce((a, r) => a + r.opensAfterFirst, 0);
  const afterFirstTotal = rows.reduce((a, r) => a + r.afterFirstTotal, 0);
  const allCards = rows.filter((r) => r.allOpen).length;

  console.log(`\n  cards measured                        : ${rows.length}`);
  console.log(`  bullets                               : ${totalBullets}`);
  console.log(`  ★★ OPENING WITH THE COMPANY, ANY FORM : ${totalAny}  (${pct(totalAny, totalBullets)}%)`);
  console.log(`       …registered ${totalReg} · short ${totalShort} · ticker ${totalTicker}`);
  console.log(`  ★★ AFTER THE FIRST BULLET (the defect): ${afterFirst} / ${afterFirstTotal}  (${pct(afterFirst, afterFirstTotal)}%)`);
  console.log(`  ★ CARDS WHERE *EVERY* BULLET DOES     : ${allCards} / ${rows.length}  (${pct(allCards, rows.length)}%)`);

  // ── LENGTH — the number a prompt change has twice broken while fixing something else ────────────
  const lens = rows.flatMap((r) => r.lens).sort((a, b) => a - b);
  const mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const over = (n: number) => lens.filter((x) => x > n).length;
  rule(`${label} — sentence length (the regression channel, measured on the same run)`);
  console.log(`  sentences                             : ${lens.length}`);
  console.log(`  mean words                            : ${mean.toFixed(1)}`);
  console.log(`  median                                : ${lens[Math.floor(lens.length / 2)]}`);
  console.log(`  ★ over 25 words (the prompt's own cut): ${over(25)}  (${pct(over(25), lens.length)}%)`);
  console.log(`  ★ over 30 words (the historic metric) : ${over(30)}  (${pct(over(30), lens.length)}%)`);
  console.log(`  max                                   : ${lens[lens.length - 1]}`);

  rule(`${label} — the thin cards, verbatim (every bullet)`);
  for (const r of rows.filter((x) => ["MMTC", "ATHERENERG", "SBFC", "HDFCLIFE", "COCHINSHIP"].includes(x.symbol))) {
    console.log(`\n  ${r.symbol} — registered "${r.registered}"`);
    for (const t of r.texts) console.log(`    • ${t}`);
  }

  const q1 = await peekAiCallQuota(QUARTER_BRIEF_MODEL, { kind: "system", job: "quarter_brief" });
  console.log(`\n  AI calls spent by this run: ${q0.remaining - q1.remaining}   remaining: ${q1.remaining}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
