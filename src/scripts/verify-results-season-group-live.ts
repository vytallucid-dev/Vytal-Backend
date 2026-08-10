// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LIVE RENDER — the peer-group results-season section on every scored pond, for every reader.
//
// Reads the DATABASE, so it is NOT a build gate (verify-build-gate-hygiene.ts would fail it into
// `build`). It is the evidence run: every state on a real pond, with and without reader exposure, at
// today's clock and at time-shifted clocks that walk one pond through all four states.
//
//   npx tsx src/scripts/verify-results-season-group-live.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { resolvePeerGroupResultsSeason } from "../results-season/group-service.js";
import { scanForwardLanguage } from "../scoring/findings/trajectory/regime-tier.js";
import { scanCopyConstraints } from "./lib/results-season-scans.js";

const line = (s = "") => console.log(s);
const rule = (s: string) => line("\n" + "═".repeat(112) + "\n" + s + "\n" + "═".repeat(112));

let violations = 0;

/** How a capsule's exposure marker renders in a terminal — ● held, ○ watchlist, ●○ both. */
const MARK = { none: "  ", held: " ●", watching: " ○", both: " ●○" } as const;

function show(label: string, b: NonNullable<Awaited<ReturnType<typeof resolvePeerGroupResultsSeason>>["banner"]>) {
  line(`\n  ── ${label} ──`);
  line(`     state ${b.state.padEnd(14)} season ${b.seasonKey}  window ${b.windowFrom}→${b.windowTo}  activeToday=${b.activeToday}`);
  line(`     counts due=${b.counts.due} reported=${b.counts.reported} remaining=${b.counts.remaining} scored=${b.counts.scored}  ·  exposure held=${b.exposure.held} watching=${b.exposure.watching}`);
  line(`     FULL  (${b.sentence.length}) ${b.sentence}`);
  line(`     SHORT (${b.shortSentence.length}) ${b.shortSentence}`);
  line(`     reported ▸ ${b.reported.map((c) => `${c.symbol}${MARK[c.exposure]}(${c.dateText}${c.href ? "→link" : ""})`).join("  ") || "—"}`);
  line(`     pending  ▸ ${b.pending.map((c) => `${c.symbol}${MARK[c.exposure]}(${c.dateText}${c.href ? "→link" : " · no link"})`).join("  ") || "—"}`);

  // ★ THE AGREEMENT, ON LIVE DATA. The sentence's counts and the marks the row will draw are two
  //   renderings of one fact; this checks them against each other on every real pond, every reader.
  const all = [...b.reported, ...b.pending];
  const drawnHeld = all.filter((c) => c.exposure === "held" || c.exposure === "both").length;
  const drawnWatch = all.filter((c) => c.exposure === "watching" || c.exposure === "both").length;
  if (drawnHeld !== b.exposure.held || drawnWatch !== b.exposure.watching) {
    line(`     ✗ SENTENCE / MARKER DISAGREEMENT: counts ${b.exposure.held}/${b.exposure.watching} vs marks ${drawnHeld}/${drawnWatch}`);
    violations++;
  }
  // The legend appears exactly when a mark does.
  const anyMark = all.some((c) => c.exposure !== "none");
  if (anyMark !== (b.exposure.held > 0 || b.exposure.watching > 0)) {
    line(`     ✗ LEGEND CONDITION MISMATCH: marks=${anyMark} counts=${b.exposure.held}/${b.exposure.watching}`);
    violations++;
  }
  // Every state names its subject — the prompt-30 rewording, checked on live strings too.
  for (const [form, text] of [["full", b.sentence], ["short", b.shortSentence]] as const) {
    if (!/posted results|Results season for this group opens|Nothing has been posted|Season opens|Nothing posted yet/.test(text)) {
      line(`     ✗ ${form}: no subject named — "${text}"`);
      violations++;
    }
    if (/\bhave reported\b|\bhas reported\b|\bof \w+ in[,—]/.test(text)) {
      line(`     ✗ ${form}: retired subject-less wording survives — "${text}"`);
      violations++;
    }
  }

  for (const text of [b.sentence, b.shortSentence]) {
    for (const v of scanForwardLanguage(text)) {
      line(`     ✗ FORWARD-LANGUAGE ${v.rule}: "${v.matched}"`);
      violations++;
    }
    for (const v of scanCopyConstraints(text)) {
      line(`     ✗ ${v.scan}: "${v.matched}"`);
      violations++;
    }
  }
  // Every mono segment must be a date, and no date may be duplicated into a plain segment.
  for (const [form, segs] of [["full", b.segments], ["short", b.shortSegments]] as const) {
    for (const s of segs) {
      if (s.mono && !/^\d{1,2} [A-Z][a-z]+$/.test(s.text)) {
        line(`     ✗ ${form}: mono segment is not a date — "${s.text}"`);
        violations++;
      }
    }
    const dates = segs.filter((s) => s.mono).map((s) => s.text);
    for (const plain of segs.filter((s) => !s.mono && !s.stock)) {
      for (const d of dates) {
        if (plain.text.includes(d)) {
          line(`     ✗ ${form}: date "${d}" duplicated into a plain segment`);
          violations++;
        }
      }
    }

    // ★ A NAMED MEMBER IS A CAPSULE, ON LIVE DATA. `text` must be the ticker, the segment must not
    //   also be mono, the company NAME must not be in the rendered sentence, and the marker on the
    //   sentence's capsule must match the marker on that member's capsule in the row below — the two
    //   are one fact and this is where they would be caught disagreeing on real rows.
    const byMember = new Map([...b.reported, ...b.pending].map((c) => [c.symbol, c]));
    for (const s of segs.filter((x) => x.stock)) {
      const st = s.stock as NonNullable<typeof s.stock>;
      const shown = `${MARK[st.exposure].trim()}${st.symbol}`;
      line(`     ${form} names a member ▸ ${shown || st.symbol}  "${st.name}"  ${st.href ?? "no link"}`);
      if (s.text !== st.symbol) {
        line(`     ✗ ${form}: stock segment text "${s.text}" is not the ticker "${st.symbol}"`);
        violations++;
      }
      if (s.mono) {
        line(`     ✗ ${form}: a stock segment must not also be mono`);
        violations++;
      }
      const rendered = form === "full" ? b.sentence : b.shortSentence;
      if (st.name !== st.symbol && rendered.includes(st.name)) {
        line(`     ✗ ${form}: the company NAME is in the rendered sentence — "${st.name}"`);
        violations++;
      }
      const row = byMember.get(st.symbol);
      if (!row) {
        line(`     ✗ ${form}: the sentence names ${st.symbol}, which is in neither capsule row`);
        violations++;
      } else if (row.exposure !== st.exposure || row.href !== st.href) {
        line(
          `     ✗ ${form}: the sentence's capsule and the row's disagree — ` +
            `sentence ${st.exposure}/${st.href} vs row ${row.exposure}/${row.href}`,
        );
        violations++;
      }
    }
  }
}

async function main() {
  const ponds = await prisma.$queryRaw<{ id: string; display_name: string }[]>`
    SELECT DISTINCT pg.id, pg.display_name
    FROM peer_groups pg
    JOIN stock_peer_groups spg ON spg.peer_group_id = pg.id
    WHERE EXISTS (SELECT 1 FROM score_snapshots ss JOIN stock_peer_groups s2 ON s2.stock_id = ss.stock_id
                  WHERE s2.peer_group_id = pg.id)
    ORDER BY pg.display_name
  `;
  const readers = await prisma.user.findMany({ select: { id: true, email: true }, orderBy: { email: "asc" } });

  rule("EVERY SCORED POND, ANONYMOUS READER, AT TODAY'S CLOCK");
  for (const p of ponds) {
    const r = await resolvePeerGroupResultsSeason(null, p.id);
    if (!r.banner) {
      line(`\n  ── ${p.display_name} ── SILENT: ${r.silence}`);
      continue;
    }
    show(`${p.display_name} · anonymous`, r.banner);
  }

  rule("READER EXPOSURE — the same ponds, signed in");
  for (const u of readers) {
    for (const p of ponds) {
      const r = await resolvePeerGroupResultsSeason(u.id, p.id);
      if (!r.banner || (r.banner.exposure.held === 0 && r.banner.exposure.watching === 0)) continue;
      show(`${p.display_name} · ${u.email}`, r.banner);
    }
  }

  // ── WALK ONE POND THROUGH ALL FOUR STATES BY MOVING THE CLOCK ──────────────────────────────────
  // ★ CEMENT IS THE ONE POND THAT REACHES EVERY STATE with today's data: its window is 11 Jul → 14
  //   Aug, its first meeting is 18 Jul (so 11–17 Jul is `none_reported`), and its last member filed
  //   on 7 Aug (so 7–14 Aug is `all_reported`). No pond is in `none_reported` at today's clock —
  //   every season opened weeks ago — so the only honest way to show that state is to read the
  //   resolver at a date inside the window and before the first filing, which is what this does.
  const aman = readers.find((u) => u.email === "amankamaljain@gmail.com");
  rule("ALL FOUR STATES ON ONE REAL POND — Large-Cap Cement, the clock walked across its season");
  const cement = ponds.find((p) => p.display_name === "Large-Cap Cement");
  if (cement) {
    for (const at of ["2026-07-10", "2026-07-12", "2026-07-25", "2026-08-01", "2026-08-09", "2026-08-15"]) {
      const r = await resolvePeerGroupResultsSeason(null, cement.id, new Date(`${at}T06:00:00.000Z`));
      if (r.banner) show(`Large-Cap Cement @ ${at} · anonymous`, r.banner);
      else line(`\n  ── Large-Cap Cement @ ${at} ── SILENT: ${r.silence}`);
    }
  }

  // Capital Goods carries BOTH exposure kinds for one reader (CUMMINSIND held, LT watchlisted), so it
  // is where the state × exposure product is visible on real rows.
  rule("EVERY STATE WITH READER EXPOSURE — Large-Cap Capital Goods & Industrial, held + watchlisted");
  const cg = ponds.find((p) => p.display_name === "Large-Cap Capital Goods & Industrial");
  if (cg && aman) {
    for (const at of ["2026-07-12", "2026-07-20", "2026-07-30", "2026-08-09"]) {
      const r = await resolvePeerGroupResultsSeason(aman.id, cg.id, new Date(`${at}T06:00:00.000Z`));
      if (r.banner) show(`Capital Goods @ ${at} · ${aman.email}`, r.banner);
      else line(`\n  ── Capital Goods @ ${at} ── SILENT: ${r.silence}`);
    }
  }

  // ★ THE "TODAY" PRESENCE FLAG, on a real row: 7 Aug is the day RAMCOCEM filed and Cement's season
  //   closed, and 11 Aug is the day SIEMENS is scheduled. Both must set `activeToday`.
  rule("activeToday — a member filed today (Cement, 7 Aug) / is scheduled today (Capital Goods, 11 Aug)");
  if (cement) {
    const r = await resolvePeerGroupResultsSeason(null, cement.id, new Date("2026-08-07T06:00:00.000Z"));
    if (r.banner) show("Large-Cap Cement @ 2026-08-07 · RAMCOCEM filed that day", r.banner);
  }
  if (cg) {
    const r = await resolvePeerGroupResultsSeason(null, cg.id, new Date("2026-08-11T06:00:00.000Z"));
    if (r.banner) show("Capital Goods @ 2026-08-11 · SIEMENS scheduled that day", r.banner);
  }

  // ★ THE "BOTH" MARKER, ON A REAL ROW. Both readers hold AND watchlist HDFCBANK, which sits in
  //   Large-Cap Private Banks — a pond whose window closed on 29 July, so the clock is walked back
  //   into it. This is the case the held-beats-watching precedence used to hide: the sentence must
  //   count the member twice (once per mark) and the capsule must wear both.
  rule("★ THE BOTH-MARKER ON REAL DATA — Large-Cap Private Banks (HDFCBANK held AND watchlisted)");
  const pb = ponds.find((p) => p.display_name === "Large-Cap Private Banks");
  if (pb) {
    for (const u of readers) {
      const r = await resolvePeerGroupResultsSeason(u.id, pb.id, new Date("2026-07-25T06:00:00.000Z"));
      if (r.banner) show(`Private Banks @ 2026-07-25 · ${u.email}`, r.banner);
    }
    const anon = await resolvePeerGroupResultsSeason(null, pb.id, new Date("2026-07-25T06:00:00.000Z"));
    if (anon.banner) show("Private Banks @ 2026-07-25 · anonymous (no marks, no legend)", anon.banner);
  }

  rule("OUT-OF-SEASON AND ERROR PATHS");
  const pharma = ponds.find((p) => p.display_name === "Large-Cap Pharma");
  for (const at of ["2026-06-01", "2026-09-15"]) {
    const r = pharma ? await resolvePeerGroupResultsSeason(null, pharma.id, new Date(`${at}T06:00:00.000Z`)) : null;
    line(`  Pharma @ ${at} → ${r?.banner ? "banner" : r?.silence}`);
  }
  const bogus = await resolvePeerGroupResultsSeason(null, "00000000-0000-0000-0000-000000000000");
  line(`  unknown peer group → ${bogus.banner ? "banner" : bogus.silence}`);

  line("\n" + "─".repeat(112));
  if (violations > 0) {
    console.error(`FAILED — ${violations} copy-scan violation${violations === 1 ? "" : "s"} on live output.`);
    process.exitCode = 1;
  } else {
    console.log("PASSED — every rendered string on every live pond is clean.");
  }
}

main()
  .catch((e) => {
    console.error("live render crashed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
