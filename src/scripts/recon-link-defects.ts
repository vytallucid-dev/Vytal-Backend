// ─────────────────────────────────────────────────────────────────────────────────────────────────
// RECON — every malformed / misplaced link shape in the FULL live corpus. Read-only.
//
// ★ THE BRIEF'S OWN WARNING IS THE DESIGN NOTE: this is the third link-defect class found in this
// codebase, so the scan assumes there are more shapes than the two that were reported. It looks for
// malformation (brace arity, spacing, a missing colon, a marker nested in a label) AND for placement
// (a resolved anchor standing in the slot where a name or ticker belongs, an article or noun doubled
// around a label that already carries one) — because the two reported defects are one of each, and a
// scan that only knew the reported shapes would report exactly the frequency it was told to expect.
//
// CORPUS = persisted assistant turns + the depth A/B arm files. The arm files matter: every live
// harness deletes its synthetic users on exit, so the turns that produced the reported defect are NOT
// in chat_messages. A DB-only scan would find the defect at frequency zero and call it fixed.
//
//   npx tsx src/scripts/recon-link-defects.ts
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../db/prisma.js";

interface Row { src: string; when: string; text: string }

/** The shapes. Each is named for what the READER would see, not for the regex. */
export const LINK_DEFECTS: { id: string; what: string; re: RegExp }[] = [
  // ── MALFORMATION — the marker never became a link and the reader sees the syntax. ──
  { id: "single-brace", what: "a {link:…} marker with ONE brace pair — never matched, never swept, shipped verbatim", re: /(?<!\{)\{\s*link\b[^{}\n]{0,80}\}(?!\})/g },
  { id: "raw-double-brace", what: "a {{link…}} that survived resolution AND the debris sweep", re: /\{\{\s*link\b[^{}\n]{0,80}\}{0,2}/g },
  { id: "no-colon", what: "a marker with no kind separator ({{link stock TCS}})", re: /\{\{\s*link[^:{}\n]{1,40}\}\}/g },
  { id: "orphan-braces", what: "stray {{ or }} anywhere in delivered prose", re: /\{\{|\}\}/g },
  // ── PLACEMENT — the link resolved correctly and landed in the wrong slot. ──
  //    The resolved stock label is either a bare ticker (no tab) or "the <Tab> tab for <TICKER>" (with
  //    a tab). Every shape below is that phrase used as if it were a noun or a name.
  { id: "link-as-ticker", what: "an anchor standing in the (TICKER) slot, right after the company name", re: /[A-Z][\w.&'() -]{4,44}\s\[(?:the )?[^\]\n]{2,60}\]\((\/[^)\s]*)\)\s+(?:has|is|are|was|sits?|posted|reported|distributes?|shares?|maintains?|holds?|pays?|carries|generated?)\b/g },
  { id: "article-doubled", what: "the model's own article in front of a label that already has one", re: /\b(?:its|their|the|a|an|this)\s+\[the\s[^\]\n]{2,60}\]\(\/[^)\s]*\)/gi },
  { id: "noun-doubled", what: "the model's own noun after a label that already ends in one", re: /\[the\s[^\]\n]{2,60}\]\(\/[^)\s]*\)\s+(?:page|tab|section|view|screen)\b/gi },
  { id: "nested-anchor", what: "an anchor inside another anchor's label — a marker written in a label slot", re: /\[[^\]\n]*\[[^\]\n]*\]\([^)\s]*\)[^\]\n]*\]\(/g },
  { id: "empty-label", what: "an anchor whose label is empty or whitespace", re: /\[\s*\]\(\/[^)\s]*\)/g },
];

async function corpus(): Promise<Row[]> {
  const out: Row[] = [];
  for (const m of await prisma.chatMessage.findMany({
    where: { role: "assistant", kind: "text", undelivered: false },
    select: { content: true, createdAt: true, sessionId: true },
    orderBy: { createdAt: "asc" },
  })) out.push({ src: `chat_messages/${m.sessionId.slice(0, 8)}`, when: m.createdAt.toISOString().slice(0, 16), text: m.content });
  const T = (process.env.TEMP ?? ".").split("\\").join("/");
  for (const a of ["depth-before", "depth-after"]) {
    try {
      for (const r of JSON.parse(readFileSync(`${T}/${a}.json`, "utf8")) as { id: string; reply: string }[])
        out.push({ src: `${a}/${r.id}`, when: a, text: r.reply });
    } catch { console.log(`  ⚠ arm file absent: ${T}/${a}.json — those turns are NOT in this count`); }
  }
  return out;
}

async function main() {
  const rows = await corpus();
  console.log("═".repeat(112));
  console.log(`LINK DEFECT RECON — ${rows.length} delivered assistant turns\n`);
  let total = 0;
  const perTurn = new Set<string>();
  for (const d of LINK_DEFECTS) {
    const fires: { row: Row; m: string }[] = [];
    for (const row of rows)
      for (const m of row.text.match(new RegExp(d.re.source, d.re.flags)) ?? []) fires.push({ row, m });
    total += fires.length;
    fires.forEach((f) => perTurn.add(f.row.src));
    console.log(`  ${fires.length === 0 ? "·" : "★"} ${d.id.padEnd(18)}${String(fires.length).padStart(4)}   ${d.what}`);
    for (const f of fires.slice(0, 6)) {
      const i = f.row.text.indexOf(f.m);
      console.log(`        [${f.row.src}] …${f.row.text.slice(Math.max(0, i - 46), i + f.m.length + 26).replace(/\s+/g, " ")}…`);
    }
    if (fires.length > 6) console.log(`        … and ${fires.length - 6} more`);
  }
  // How many anchors are there in total? A rate needs a denominator.
  const anchors = rows.reduce((n, r) => n + (r.text.match(/\]\(\/[^)\s]*\)/g) ?? []).length, 0);
  const withAnchor = rows.filter((r) => /\]\(\/[^)\s]*\)/.test(r.text)).length;
  console.log(`\n  denominator: ${anchors} resolved in-app anchors across ${withAnchor} of ${rows.length} turns`);
  console.log(`  TOTAL defect occurrences: ${total} · turns affected: ${perTurn.size}/${rows.length} (${Math.round((perTurn.size / rows.length) * 100)}%)`);
  console.log("═".repeat(112));
  await prisma.$disconnect();
}
// ⚠ RUN ONLY WHEN INVOKED DIRECTLY. `LINK_DEFECTS` is imported by verify-link-placement.ts for its
// placement baseline, and an unguarded main() would print this whole report in the middle of that
// script's output — a recon dump wearing a proof's exit code.
const invokedDirectly = (process.argv[1] ?? "").split("\\").join("/").endsWith("recon-link-defects.ts");
if (invokedDirectly) main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
