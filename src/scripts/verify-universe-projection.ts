// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 GATE — THE PROJECTION LAYER. No tool, no chat turn, no provider.
//
// Proves, against the LIVE view (not a fixture):
//   1a · all seven slices project and render
//   1b · every list carries totalCount beside a capped array, and the render states the cut
//   1c · every finding is CATALOGUE-NAMED; no internal identifier survives (asserted two ways)
//   1d · lensPathology is excluded entirely
//   1e · the §5C divergence consolidation is applied — one row, distinct-union count
//   1f · the period contract: no periodKey field anywhere, the spread is carried, the framing is stated
//   +  · measured token size per slice
//
//   npx tsx src/scripts/verify-universe-projection.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { buildUniverseHealthView } from "../scoring/read/universe-view.service.js";
import {
  projectUniverse,
  assertNoInternalIdentifiers,
  LIST_CAP,
  MOVER_CAP,
} from "../scoring/read/universe-projection.service.js";
import { UNIVERSE_SLICES, type UniverseProjection } from "../scoring/read/universe-projection.types.js";
import { renderUniverseSlice } from "../chat/universe-brief.js";
import { STOCK_FINDING_KEYS, DIVERGENCE_SUB_TYPE_KEYS } from "../catalogue/index.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);
const tok = (s: string) => Math.ceil(s.length / 4);

const view = await buildUniverseHealthView();

// ══════════════════════════════════════════════════════════════════════════════
section("1a · all seven slices project and render");
const rendered = new Map<string, string>();
const projected = new Map<string, UniverseProjection>();
for (const slice of UNIVERSE_SLICES) {
  const args =
    slice === "band" ? { slice, band: "pristine" } : slice === "finding" ? { slice, finding: "divergence" } : { slice };
  const p = projectUniverse(view, null, args as never);
  const text = renderUniverseSlice(p);
  projected.set(slice, p);
  rendered.set(slice, text);
  ok(`${slice} → ${p.slice}`, p.slice === slice, `${text.split("\n").length} lines`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("MEASURED TOKEN SIZE (chars/4)");
console.log(`  full UniverseHealthView   ${String(tok(JSON.stringify(view))).padStart(6)} tok   ← never reaches the model`);
console.log(`  ├─ members[] alone        ${String(tok(JSON.stringify(view.members))).padStart(6)} tok`);
console.log("  ─────────────────────────────────────");
let sum = 0;
for (const slice of UNIVERSE_SLICES) {
  const text = rendered.get(slice)!;
  const json = tok(JSON.stringify(projected.get(slice)));
  sum += tok(text);
  console.log(`  ${slice.padEnd(12)} rendered ${String(tok(text)).padStart(5)} tok   (structured ${String(json).padStart(5)} tok)`);
}
console.log(`  ${"".padEnd(12)} largest slice ${Math.max(...[...rendered.values()].map(tok))} tok · mean ${Math.round(sum / UNIVERSE_SLICES.length)} tok`);

// ══════════════════════════════════════════════════════════════════════════════
section("1b · totalCount beside every capped array, and the render states the cut");
{
  const census = projected.get("census") as Extract<UniverseProjection, { slice: "census" }>;
  ok("census rows carry total + shown", census.rows.total >= census.rows.shown.length && census.rows.shown.length <= LIST_CAP,
    `${census.rows.shown.length} of ${census.rows.total}`);
  // The bound LEADS the list (it was a trailing parenthetical until the live run showed the model
  // skipping it) — so assert the leading form: "22 findings are firing in total. The 12 most severe…".
  ok("census truncation is STATED in the render, ahead of the rows",
    census.rows.total <= census.rows.shown.length ||
      /★ SCOPE OF THIS LIST: \d+ different findings are firing[\s\S]{0,200}OPEN YOUR ANSWER WITH THE TOTAL/.test(rendered.get("census")!));
  const movers = projected.get("movers") as Extract<UniverseProjection, { slice: "movers" }>;
  ok("movers capped at 10 with real totals", movers.risers.shown.length <= MOVER_CAP && movers.slippers.shown.length <= MOVER_CAP,
    `risers ${movers.risers.shown.length}/${movers.risers.total} · slippers ${movers.slippers.shown.length}/${movers.slippers.total}`);
  ok("movers truncation is STATED, ahead of the rows",
    /\d+ companies improved in total\. The \d+ biggest gains are listed below — SAY "\d+ of \d+"/.test(rendered.get("movers")!) &&
      /\d+ companies slipped in total\. The \d+ biggest falls are listed below/.test(rendered.get("movers")!));
  const bandS = projected.get("band") as Extract<UniverseProjection, { slice: "band" }>;
  ok("band focus carries total + shown", !!bandS.focus && bandS.focus.members.total >= bandS.focus.members.shown.length,
    bandS.focus ? `${bandS.focus.band} ${bandS.focus.members.shown.length} of ${bandS.focus.members.total}` : "no focus");
  // every Capped<T> in every slice: shown.length ≤ total, and ≤ its cap
  let bad = 0;
  const walkCapped = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walkCapped);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.shown) && typeof o.total === "number") {
        if (o.shown.length > o.total || o.shown.length > LIST_CAP) bad++;
      }
      Object.values(o).forEach(walkCapped);
    }
  };
  for (const p of projected.values()) walkCapped(p);
  ok("no Capped<T> anywhere shows more than it counts, or more than the cap", bad === 0, `${bad} bad`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("1c · catalogue naming — no internal identifier reaches the model");
{
  // (i) the structural assertion, on every slice, already ran inside projectUniverse. Re-run it here
  //     over the RENDERED TEXT too — that is what the model literally reads.
  let leaks = 0;
  for (const [slice, text] of rendered) {
    try {
      assertNoInternalIdentifiers(text, slice);
    } catch (e) {
      leaks++;
      console.log(`     ↳ ${(e as Error).message}`);
    }
  }
  ok("no internal identifier in any RENDERED slice", leaks === 0);

  // (ii) adversarial: force EVERY catalogue key through the projection's naming path and confirm none
  //      of them survives as itself.
  const namedBad = STOCK_FINDING_KEYS.filter((k) => rendered.get("census")!.includes(k) || rendered.get("finding")!.includes(k));
  ok("no catalogue key string appears verbatim in a slice", namedBad.length === 0, namedBad.join(", "));

  // (iii) the census actually NAMES things — a census of unnamed rows would pass (i) and (ii) trivially.
  const census = projected.get("census") as Extract<UniverseProjection, { slice: "census" }>;
  ok("every census row has a name and a description",
    census.rows.shown.every((r) => r.name.length > 2 && r.description.length > 20 && !/_/.test(r.name)),
    `${census.rows.shown.length} rows`);
  console.log(`     rows: ${census.rows.shown.map((r) => `${r.name} (${r.firingCount})`).join(" · ")}`);

  // (iv) the raw band enum never escapes.
  ok("the raw band enum never appears", ![...rendered.values()].some((t) => /below_par/.test(t)));
  ok("band words are the published five",
    /Pristine/.test(rendered.get("band")!) && /Below Par/.test(rendered.get("band")!));

  // (v) the assertion is REAL — it must actually fire on a planted key.
  let fired = false;
  try {
    assertNoInternalIdentifiers({ name: "ownership_R6_distribution" });
  } catch {
    fired = true;
  }
  ok("★ the leak assertion fires on a planted key (it is not a no-op)", fired);
}

// ══════════════════════════════════════════════════════════════════════════════
section("1d · lensPathology excluded entirely");
{
  ok("the view HAS lens rows to exclude (otherwise this proves nothing)", view.lensPathology.length > 0,
    `${view.lensPathology.length} lens rows in the view`);
  const anyLens = [...rendered.values()].some((t) => /lens_/.test(t));
  ok("no lens key in any slice", !anyLens);
  const census = projected.get("census") as Extract<UniverseProjection, { slice: "census" }>;
  const lensKeys = new Set(view.lensPathology.map((l) => l.key));
  ok("census row count excludes the lens family",
    census.rows.total === new Set(view.pathology.filter((p) => !lensKeys.has(p.key)).map((p) => p.key)).size - DIVERGENCE_SUB_TYPE_KEYS.filter((k) => view.pathology.some((p) => p.key === k)).length + (view.pathology.some((p) => DIVERGENCE_SUB_TYPE_KEYS.includes(p.key as never)) ? 1 : 0),
    `census ${census.rows.total} vs view pathology ${view.pathology.length}`);
}

// ══════════════════════════════════════════════════════════════════════════════
section("1e · §5C divergence consolidation");
{
  const inView = view.pathology.filter((p) => DIVERGENCE_SUB_TYPE_KEYS.includes(p.key as never));
  console.log(`     backend census has ${inView.length} C-family rows: ${inView.map((p) => `${p.key}=${p.memberCount}`).join(", ")}`);
  const div = projected.get("divergence") as Extract<UniverseProjection, { slice: "divergence" }>;
  ok("the projection has exactly ONE divergence row", !!div.detail);
  const union = new Set(inView.flatMap((p) => p.members));
  ok("its count is the DISTINCT UNION of the sub-types, not their sum",
    div.detail?.firingCount === union.size,
    `projection ${div.detail?.firingCount} · union ${union.size} · sum ${inView.reduce((n, p) => n + p.memberCount, 0)}`);
  ok("it names at most TWO sub-forms and COUNTS the rest (§5C)",
    (div.detail?.subTypesShown?.length ?? 0) <= 2 && (div.detail?.subTypesTotal ?? 0) === inView.length,
    `${div.detail?.subTypesShown?.map((s) => s.name).join(", ")} · total ${div.detail?.subTypesTotal}`);
  const census = projected.get("census") as Extract<UniverseProjection, { slice: "census" }>;
  // ⚠ EXACT name, not /divergence/i — "Accruals Divergence" (a Family-E pattern) legitimately carries
  //   the word and is NOT part of the C family. A substring test here would report a false failure.
  const divRows = census.rows.shown.filter((r) => r.name === "Divergence");
  ok("the census shows ONE divergence row, matching the Flags board", divRows.length === 1,
    census.rows.shown.filter((r) => /divergence/i.test(r.name)).map((r) => r.name).join(", "));
  ok("no C sub-type name leaks as its own census row",
    !census.rows.shown.some((r) => /Ownership Against Fundamentals|Floor–Trajectory Split|Divergence Widening/.test(r.name)));
}

// ══════════════════════════════════════════════════════════════════════════════
section("1f · THE PERIOD CONTRACT");
{
  const p = (projected.get("overview") as Extract<UniverseProjection, { slice: "overview" }>).period;
  console.log(`     asOfDate=${p.asOfDate} companiesRead=${p.companiesRead} mixed=${p.mixed}`);
  console.log(`     spread=${JSON.stringify(p.spread)}`);
  console.log(`     notRescored=${p.notRescored.total} ${JSON.stringify(p.notRescored.shown)}`);
  ok("the period object has NO periodKey field (there is no shape to pass one through)",
    !("periodKey" in (p as unknown as Record<string, unknown>)));
  ok("the spread sums to the companies read", p.spread.reduce((n, s) => n + s.count, 0) === p.companiesRead);
  ok("★ the universe is genuinely mixed, so a single label would be false", p.mixed,
    p.spread.map((s) => `${s.period}:${s.count}`).join(" "));
  ok("notRescored is a STALENESS list, not the period-mismatch list",
    p.notRescored.total === view.notAtCurrentPeriod.length && p.notRescored.total < p.spread[1].count,
    `${p.notRescored.total} stale vs ${p.spread[1].count} at the older quarter`);
  ok("every slice carries the period block", [...rendered.values()].every((t) => /HOW TO SAY THE DATE/.test(t)));
  ok("every slice states the legal phrasing", [...rendered.values()].every((t) => /each at its most recent reported quarter/.test(t)));
  ok("every slice states the forbidden sentence form", [...rendered.values()].every((t) => /NEVER name one quarter/.test(t)));
  ok("the view's plurality label never appears as a scope claim",
    ![...rendered.values()].some((t) => new RegExp(`as of ${view.periodKey}`, "i").test(t)));
}

// ══════════════════════════════════════════════════════════════════════════════
section("VERBATIM — every slice as the model receives it");
for (const slice of UNIVERSE_SLICES) {
  console.log(`\n┌── ${slice} (${tok(rendered.get(slice)!)} tok) ${"─".repeat(60)}`);
  for (const line of rendered.get(slice)!.split("\n")) console.log("│ " + line);
  console.log("└" + "─".repeat(80));
}

// ══════════════════════════════════════════════════════════════════════════════
section("EXTRA · the honest misses");
{
  const miss = projectUniverse(view, null, { slice: "finding", finding: "return on equity above 20%" });
  console.log(renderUniverseSlice(miss).split("\n").slice(0, 12).map((l) => "  │ " + l).join("\n"));
  ok("an unknown finding resolves to null, not to the nearest row",
    (miss as Extract<UniverseProjection, { slice: "finding" }>).finding === null);
  const badBand = projectUniverse(view, null, { slice: "band", band: "excellent" });
  ok("an unknown band is reported as unrecognised, never mapped to the closest",
    (badBand as Extract<UniverseProjection, { slice: "band" }>).unrecognisedBand === "excellent" &&
      (badBand as Extract<UniverseProjection, { slice: "band" }>).focus === null);
  const empty = projectUniverse(view, new Set<string>(), { slice: "overview", scope: "portfolio" });
  ok("an empty scope returns the honest empty slice", empty.slice === "empty");
  console.log(`     ↳ ${renderUniverseSlice(empty).split("\n").slice(1).join(" ").slice(0, 150)}…`);
}

console.log(`\n${failures === 0 ? "✅ STAGE 1 GATE PASSED" : `❌ ${failures} FAILURE(S)`}\n`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
