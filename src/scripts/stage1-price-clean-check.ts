// STAGE 1 — SPLIT/BONUS PRE-CLEAN verification (read-only; commits nothing).
//   npx tsx src/scripts/stage1-price-clean-check.ts
//
// Proves the §7.2 gating clean-pass against the real roster price feed:
//   • runs the clean over all 11 non-fin rosters → classifies every >25% move;
//   • shows the real cases: VEDL demerger (quarantine), HINDZINC rally (kept),
//     NESTLEIND 1:10 split (Yahoo already adjusted → clean pass-through);
//   • SYNTHETIC correction proof: inject an unadjusted 1:2 split into a clean
//     series → detect + correct + before/after (the correction code path, since
//     the real feed has no uncorrected split to exercise it on);
//   • confirms the >25% flag fires and the cleaned series is the gated input.

import { prisma } from "../db/prisma.js";
import { PEER_GROUPS } from "./peer-groups.seed.js";
import { cleanPriceSeries, type RawDay } from "../scoring/price/clean.js";
import { getCleanedCloses } from "../scoring/price/load.js";

const NONFIN = ["pg1_it_services","pg2_fmcg","pg3_pharma","pg4_auto_oem","pg8_power","pg9_metals","pg10_oil_gas","pg11_capital_goods","pg12_cement","pg13_consumer_durables","pg14_defense"];
const f = (x: number, d = 2) => x.toFixed(d);

async function loadRaw(symbol: string): Promise<{ id: string; raw: RawDay[] } | null> {
  const s = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } });
  if (!s) return null;
  const rows = await prisma.dailyPrice.findMany({ where: { stockId: s.id }, orderBy: { date: "asc" }, select: { date: true, close: true } });
  return { id: s.id, raw: rows.map((r) => ({ date: r.date, close: Number(r.close) })) };
}

async function main() {
  console.log("STAGE 1 — SPLIT/BONUS PRE-CLEAN (§7.2 gating guard) — verification\n");
  const syms = [...new Set(NONFIN.flatMap((k) => PEER_GROUPS.find((p) => p.key === k)!.stocks))].sort();

  // ── 1. Run the clean over the whole roster ──
  let clean = 0, corrected = 0, quarantined = 0, noPrice = 0;
  const corr: string[] = []; const quar: string[] = [];
  for (const sym of syms) {
    const d = await loadRaw(sym);
    if (!d || d.raw.length === 0) { noPrice++; continue; }
    const r = cleanPriceSeries(sym, d.raw);
    if (r.corrections > 0) { corrected++; corr.push(`${sym}(${r.events.filter(e=>e.ratioApplied).map(e=>e.matchedAction).join(",")})`); }
    if (r.quarantined) { quarantined++; quar.push(`${sym}@${r.quarantineFrom}`); }
    if (r.clean && r.corrections === 0) clean++;
  }
  console.log(`ROSTER CLEAN PASS (${syms.length} stocks, ${noPrice} w/o price):`);
  console.log(`  clean (no action)   : ${clean}`);
  console.log(`  split/bonus corrected: ${corrected}  ${corr.join(", ") || "—"}`);
  console.log(`  quarantined (break) : ${quarantined}  ${quar.join(", ") || "—"}`);

  // ── 2. Real cases ──
  console.log(`\nREAL CASES:`);
  for (const sym of ["VEDL", "HINDZINC", "NESTLEIND"]) {
    const d = await loadRaw(sym);
    if (!d) { console.log(`  ${sym}: not in DB`); continue; }
    const r = cleanPriceSeries(sym, d.raw);
    const flagged = r.events.filter((e) => e.flagged25);
    console.log(`  ${sym.padEnd(10)} flagged>25%=${flagged.length}  corrections=${r.corrections}  quarantined=${r.quarantined}${r.quarantineFrom ? `@${r.quarantineFrom}` : ""}`);
    for (const e of flagged) console.log(`     ${e.date} ${f(e.rawMovePct,1)}% ${f(e.from,1)}→${f(e.to,1)} → ${e.classification}  ${e.note}`);
  }

  // ── 3. SYNTHETIC correction proof — inject an unadjusted 1:2 split into TCS ──
  console.log(`\nSYNTHETIC CORRECTION PROOF (inject an unadjusted 1:2 split into a clean series):`);
  const base = await loadRaw("TCS");
  if (base && base.raw.length > 250) {
    const T = base.raw.length - 200; // split day = 200 days before end
    const splitDate = base.raw[T].date.toISOString().slice(0, 10);
    // un-adjust: double every close BEFORE T → a fake +2x level then a −50% gap at T.
    const injected: RawDay[] = base.raw.map((r, i) => ({ date: r.date, close: i < T ? r.close * 2 : r.close }));
    const rawGap = (injected[T].close - injected[T - 1].close) / injected[T - 1].close * 100;
    console.log(`  injected split on ${splitDate}: raw close ${f(injected[T-1].close,1)} → ${f(injected[T].close,1)}  (${f(rawGap,1)}% gap — the fake crash)`);
    const r = cleanPriceSeries("TCS-SYNTH", injected);
    const ev = r.events.find((e) => e.date === splitDate);
    console.log(`  DETECTED: ${ev ? `${ev.date} ${f(ev.rawMovePct,1)}% → ${ev.classification} [${ev.matchedAction}] flag>25%=${ev.flagged25}` : "MISS ✗"}`);
    // before/after at the split boundary + a max-residual check vs the original clean series
    let maxResid = 0;
    for (let i = 0; i < base.raw.length; i++) maxResid = Math.max(maxResid, Math.abs(r.cleaned[i].close - base.raw[i].close));
    const cleanedGap = (r.cleaned[T].close - r.cleaned[T - 1].close) / r.cleaned[T - 1].close * 100;
    console.log(`  BEFORE (raw injected): ${f(injected[T-1].close,1)} → ${f(injected[T].close,1)}  gap ${f(rawGap,1)}%`);
    console.log(`  AFTER  (cleaned)     : ${f(r.cleaned[T-1].close,1)} → ${f(r.cleaned[T].close,1)}  gap ${f(cleanedGap,1)}%  (fake crash removed)`);
    console.log(`  cleaned ≡ original adjusted series? max abs diff over ${base.raw.length} days = ${f(maxResid,4)} ${maxResid < 0.01 ? "✓ (exact)" : "✗"}`);
  } else {
    console.log("  TCS series unavailable for the synthetic proof");
  }

  // ── 4. Gating confirmation ──
  console.log(`\nGATING: getCleanedCloses() is the single price chokepoint for Market.`);
  const probe = await prisma.stock.findUnique({ where: { symbol: "PETRONET" }, select: { id: true } });
  if (probe) {
    const cs = await getCleanedCloses(probe.id, "PETRONET");
    console.log(`  getCleanedCloses("PETRONET") → ${cs.closes.length} cleaned closes, clean=${cs.report.clean}, corrections=${cs.report.corrections}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
