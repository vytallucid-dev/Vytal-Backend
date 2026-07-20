// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// T-5 — `rank_y5` + THE KEY-SIDE GATE. PROVEN, NOT REVIEWED.
//
// THE DEFECT: the fold wrote `rank_${h}` with the internal horizon token `h='y5'` → `rank_y5`, a key
// matching NO mf_analytics column. `omissionFor(row, "rank_5y")` looked up `rank_5y`, found nothing, and
// returned null — so 20 funds carried a null `rank_5y` with NO reachable reason, in a design whose whole
// claim is "a NULL metric with no entry here is an unexplained gap." A ledger entry explaining a null in
// a column that does not exist is the omissions-layer version of a phantom citation.
//
// THE RENAME IS TRIVIAL. THE GATE IS THE REAL FIX: the honest-null gate validated omission VALUES against
// `OmissionCode` but NEVER the KEYS against the columns they claim to explain — so a misspelled key and a
// missing key were the same observation. This gate validates the KEY SIDE (cv2-t5-key-side-gate), the twin
// of the value-side taxonomy gate: a check that looks at one side of a mapping cannot tell "correct" from
// "unexamined."
//
//   npx tsx src/scripts/verify-t5-omission-keys.ts   (reads mf_analytics columns + omissions; no writes)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));

/**
 * ★ THE GROUP KEYS — omission keys that DELIBERATELY cover a SET of columns, not one. Each is declared
 * here WITH the column prefix it covers, so a typo'd group key (`benchmrk`) is not silently whitelisted:
 * the gate asserts every group key actually covers ≥1 real column. This is the manual half of the gate,
 * and an UNDECLARED group key the fold adds later is flagged as an orphan — forcing it to be declared
 * here, exactly as the taxonomy gate forces a "deliberately unclassified" code to be named.
 */
const GROUP_KEYS: Record<string, string> = {
  _all: "", // row-level: every metric on the row at once. Covers everything; no single prefix.
  rank: "rank_", // the whole rank block (rank_1y/3y/5y, pct_*, rank_pool_*) when the BUCKET is too small.
  roll_1y: "roll_1y_", // the rolling-1y block (roll_1y_n/min/max/avg/pct_positive).
  benchmark: "benchmark", // the Step-18 block (benchmark_index/via, beta_*, alpha_*, tracking_error_*).
};

/** The pre-T-5 residual is now CLEARED — emptied 2026-07-17 after the full re-fold. The fold writes the
 *  corrected `rank_5y`, and the upsert refreshes the WHOLE omissions column, so every `rank_y5` orphan was
 *  overwritten. The live scan below now finds ZERO orphans against an EMPTY set — the real proof, not a
 *  whitelisted "green". A NEW orphan the fold introduces later will now fail the gate, as it must. */
const KNOWN_PRE_BACKFILL_RESIDUAL = new Set<string>();

async function main() {
  const columns = new Set(
    (await prisma.$queryRawUnsafe<any[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'mf_analytics'`)).map((r) => String(r.column_name)),
  );
  const isValidKey = (k: string) => columns.has(k) || k in GROUP_KEYS;
  console.log(`mf_analytics has ${columns.size} columns (the authoritative valid-key set)`);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · ★ THE VALIDATOR — a real column or a declared group key is valid; anything else is an ORPHAN");
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    ok("★ 'rank_5y' (the CORRECT key) is valid — it is a real column", isValidKey("rank_5y"));
    ok("★★ 'rank_y5' (the BUG) is an ORPHAN — it matches no column", !isValidKey("rank_y5"));
    ok("★ the group keys are valid", ["_all", "rank", "roll_1y", "benchmark"].every(isValidKey));
    ok("★ a real metric column is valid", isValidKey("max_drawdown_5y") && isValidKey("tracking_error_1y"));
    // ★ NEGATIVE CONTROL — the gate MUST catch a key that matches no column.
    ok("★★ negative control: the validator CATCHES a bogus key", !isValidKey("rank_y5") && !isValidKey("totally_made_up_col"));

    // ★ every declared GROUP key must cover ≥1 real column — a typo'd group key is not whitelisted.
    const typo = Object.entries(GROUP_KEYS).filter(([k, prefix]) => k !== "_all" && ![...columns].some((c) => c.startsWith(prefix)));
    ok("★ every declared group key covers ≥1 real column (no typo'd group key gets a free pass)",
      typo.length === 0, typo.length ? `UNCOVERED: ${typo.map(([k]) => k).join(", ")}` : "all group keys cover real columns");
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ★★ THE LIVE SCAN — every omission key in the DB must be a column or a declared group key");
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const keys = (await prisma.$queryRawUnsafe<any[]>(`
      SELECT k AS key, count(*) AS n FROM mf_analytics, LATERAL jsonb_object_keys(omissions::jsonb) k
      WHERE omissions IS NOT NULL GROUP BY 1 ORDER BY 1`)).map((r) => ({ key: String(r.key), n: Number(r.n) }));
    console.log(`       ${keys.length} distinct omission keys in live data`);
    const orphans = keys.filter((r) => !isValidKey(r.key));
    for (const o of orphans) console.log(`       ${KNOWN_PRE_BACKFILL_RESIDUAL.has(o.key) ? "· residual" : "⚠ ORPHAN"} ${o.key}  ×${o.n}`);

    const unexpected = orphans.filter((o) => !KNOWN_PRE_BACKFILL_RESIDUAL.has(o.key));
    ok("★★ NO unexpected orphan keys — every omission key is a column, a group key, or the known residual",
      unexpected.length === 0, unexpected.length ? `NEW ORPHANS: ${unexpected.map((o) => o.key).join(", ")}` : "clean");
    ok("★ the known pre-fix residual is present and bounded (Aman's backfill clears it)",
      orphans.every((o) => KNOWN_PRE_BACKFILL_RESIDUAL.has(o.key)),
      `orphans: ${orphans.map((o) => `${o.key}×${o.n}`).join(", ") || "none"}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · ★ THE FIX — the fold writes the COLUMN key (`rank_5y`), never the raw horizon token");
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    const { readFileSync } = await import("fs");
    const src = readFileSync("src/ingestions/amfi/mf-analytics.ts", "utf8");
    // The rank-too-small omission must be written from a COLUMN key. The bug was `m.omissions[`rank_${h}`]`
    // with h ∈ {y1,y3,y5}; the fix uses an explicit `omitKey` = "rank_1y"/"rank_3y"/"rank_5y".
    ok("★★ the fold NO LONGER writes `rank_${h}` (the raw-horizon key that produced rank_y5)",
      !/omissions\[`rank_\$\{h\}`\]/.test(src), "the template-literal key with a raw horizon token is gone");
    ok("★ …it writes an explicit column `omitKey` (rank_1y/rank_3y/rank_5y)",
      /"rank_1y".*"rank_3y".*"rank_5y"/s.test(src) && /m\.omissions\[omitKey\]/.test(src));
  }

  console.log("\n" + "═".repeat(96));
  console.log(fail === 0 ? "  ✅ T-5 — ALL PASS" : `  ❌ ${fail} FAILURE(S)`);
  console.log("═".repeat(96));
  await prisma.$disconnect();
  process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
