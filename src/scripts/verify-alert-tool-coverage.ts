// ─────────────────────────────────────────────────────────────────────────────
// ALERT/REMINDER TOOL COVERAGE + THE POST-WRITE CHANGE HINT — deterministic proofs.
//
// Covers the five items from the alert/reminder recon that are decidable without a model:
//   1. The `changed` hint — a confirmed write names its domain; a proposal names nothing.
//   2. The UNSCORED GUARD — band/finding alerts refused on a stock with no snapshot; price still works.
//   3. findingKey validated against the live vocabulary (STATIC ∪ DB), retired keys named as retired.
//   4. daysBefore constrained to [1,2,3,7] in the SERVICE, so every caller obeys it.
//   5. Percentage price alerts resolve to rupees the SAME way the UI does, and the proposal shows both.
//   6. Per-type repeat defaults (price one_shot, band/finding repeating).
//
//   npx tsx src/scripts/verify-alert-tool-coverage.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { makeToolContext, findTool } from "../chat/tools/registry.js";
import { peekProposal, CHANGE_DOMAIN_BY_KIND } from "../chat/proposals.js";
import { createReminder, DAYS_BEFORE_OPTIONS } from "../reminders/service.js";
import { loadFindingKeys, STATIC_FINDING_KEYS, RETIRED_FINDING_KEYS } from "../alerts/finding-catalog.js";
import { ServiceError } from "../lib/service-error.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n══ ${t} ══`);

const authIds: string[] = [];
async function newUser(): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `atool-${authId}@test.local`);
  authIds.push(authId);
  return (await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } })).id;
}
const text = (r: { ok: boolean } & Record<string, any>) => (r.ok ? r.content : r.error) as string;

async function main() {
  const userId = await newUser();
  const sessionId = (await prisma.chatSession.create({
    data: { userId, origin: "chat_page", title: "coverage", promoted: true },
    select: { id: true },
  })).id;
  const ctx = () => makeToolContext({ userId, sessionId });

  // A SCORED stock and an UNSCORED one, both in the covered universe.
  const scoredRow = await prisma.scoreSnapshot.findFirst({ select: { stock: { select: { symbol: true, id: true } } } });
  const SCORED = scoredRow!.stock;
  const unscored = await prisma.$queryRawUnsafe<{ symbol: string; id: string }[]>(
    `SELECT s.symbol, s.id FROM stocks s WHERE NOT EXISTS (SELECT 1 FROM score_snapshots ss WHERE ss.stock_id = s.id) LIMIT 1`,
  );
  const UNSCORED = unscored[0];
  console.log(`scored fixture: ${SCORED.symbol} · unscored fixture: ${UNSCORED?.symbol ?? "(none)"}`);

  // ═══════════════════════════════════════════════════════════════════════════
  section("1 · The `changed` hint — only a CONFIRMED write names a domain");
  {
    const c = ctx();
    await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "price", operator: "above", threshold: 5000 }, c);
    ok("★ proposing names NOTHING (nothing changed yet)", c.effects.size === 0, `effects={${[...c.effects]}}`);

    await findTool("confirmPendingAction")!.handler({}, c);
    ok("★★ confirming names its domain", [...c.effects].join() === "alerts", `effects={${[...c.effects]}}`);
    ok("the alert really was written", (await prisma.alert.count({ where: { userId } })) === 1);

    // A read-only turn's context stays empty.
    const c2 = ctx();
    await findTool("getWatchlist")!.handler({}, c2);
    ok("a read turn names nothing", c2.effects.size === 0);

    // The map is total over ProposalKind — a new write tool cannot forget to declare its effect.
    const kinds = Object.keys(CHANGE_DOMAIN_BY_KIND);
    ok("every proposal kind declares a domain", kinds.length === 6, kinds.map((k) => `${k}→${CHANGE_DOMAIN_BY_KIND[k as keyof typeof CHANGE_DOMAIN_BY_KIND]}`).join(", "));

    // Failed execution must NOT claim a change.
    const c3 = ctx();
    await findTool("deleteAlert")!.handler({ alertId: "does-not-exist" }, c3);
    ok("★ a refused tool call names nothing", c3.effects.size === 0);
    await prisma.alert.deleteMany({ where: { userId } });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("2 · ★ THE UNSCORED GUARD");
  if (UNSCORED) {
    const c = ctx();
    const band = await findTool("createAlert")!.handler({ symbol: UNSCORED.symbol, type: "health_band", operator: "below", threshold: "steady" }, c);
    ok("★★ health_band on an UNSCORED stock is REFUSED", !band.ok && /NOT SCORED/.test(text(band)));
    ok("…and the refusal offers a price alert instead", /price alert/i.test(text(band)), text(band).slice(0, 120));
    ok("…and nothing was proposed", (await peekProposal(sessionId, userId)) === null);

    const finding = await findTool("createAlert")!.handler({ symbol: UNSCORED.symbol, type: "finding", operator: "fires" }, c);
    ok("★★ finding on an UNSCORED stock is REFUSED", !finding.ok && /NOT SCORED/.test(text(finding)));

    const price = await findTool("createAlert")!.handler({ symbol: UNSCORED.symbol, type: "price", operator: "above", threshold: 100 }, c);
    ok("★★ but a PRICE alert on the same stock still works", price.ok && /PROPOSED/.test(text(price)));
    ok("…and it IS the thing proposed", (await peekProposal(sessionId, userId))?.kind === "createAlert");

    const scoredBand = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "health_band", operator: "below", threshold: "steady" }, c);
    ok("a SCORED stock still accepts a band alert (no false positive)", scoredBand.ok && /PROPOSED/.test(text(scoredBand)));
  } else {
    ok("no unscored stock available to test against", false);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("3 · ★ findingKey validated against the live vocabulary");
  {
    const known = await loadFindingKeys();
    console.log(`  vocabulary: ${known.size} keys (static ${STATIC_FINDING_KEYS.length} ∪ live DB)`);
    ok("every STATIC key is in the vocabulary", STATIC_FINDING_KEYS.every((k) => known.has(k)));
    ok("★ the dynamic three-lens family is included (static lists can't enumerate it)",
      [...known].some((k) => k.startsWith("lens_")), [...known].filter((k) => k.startsWith("lens_")).slice(0, 3).join(", "));
    ok("★ RETIRED keys are excluded — they can never fire again", RETIRED_FINDING_KEYS.every((k) => !known.has(k)), RETIRED_FINDING_KEYS.join(", "));

    const c = ctx();
    const bogus = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "finding", operator: "fires", findingKey: "pledge_rising" }, c);
    ok("★★ an INVENTED key is refused", !bogus.ok && /UNKNOWN FINDING KEY/.test(text(bogus)));
    ok("…with real candidates offered", /Closest real keys:/.test(text(bogus)) && /pledge/.test(text(bogus)), text(bogus).slice(text(bogus).indexOf("Closest"), text(bogus).indexOf("Closest") + 100));

    const retired = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "finding", operator: "fires", findingKey: RETIRED_FINDING_KEYS[0] }, c);
    ok("★★ a RETIRED key is named as retired, not merely unknown", !retired.ok && /RETIRED FINDING/.test(text(retired)));

    const real = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "finding", operator: "fires", findingKey: "ownership_R1_pledge" }, c);
    ok("★★ a REAL key passes", real.ok && /PROPOSED/.test(text(real)));

    const any = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "finding", operator: "fires" }, c);
    ok("'any new finding' (no key) still passes", any.ok && /PROPOSED/.test(text(any)));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("4 · ★ daysBefore is [1,2,3,7], enforced in the SERVICE");
  {
    ok("the option set is exactly the picker's", DAYS_BEFORE_OPTIONS.join(",") === "1,2,3,7");
    for (const d of DAYS_BEFORE_OPTIONS) {
      try {
        await createReminder({ stockId: SCORED.id, eventType: "earnings", daysBefore: d }, userId);
        ok(`service accepts daysBefore=${d}`, true);
      } catch (e) {
        ok(`service accepts daysBefore=${d}`, false, (e as Error).message);
      }
    }
    for (const d of [0, 4, 5, 14, 30, 31]) {
      let rejected = false;
      let msg = "";
      try {
        await createReminder({ stockId: SCORED.id, eventType: "earnings", daysBefore: d }, userId);
      } catch (e) {
        rejected = e instanceof ServiceError;
        msg = (e as Error).message;
      }
      ok(`★ service REJECTS daysBefore=${d}`, rejected, msg.slice(0, 70));
    }
    await prisma.eventReminder.deleteMany({ where: { userId } });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("5 · ★ Percentage price alerts — same arithmetic as the UI, both numbers shown");
  {
    const priceRow = await prisma.stockPrice.findUnique({ where: { stockId: SCORED.id }, select: { price: true } });
    const current = priceRow ? Number(priceRow.price) : null;
    if (current == null) {
      ok("scored fixture has a price on file", false);
    } else {
      const c = ctx();
      const up = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "price", operator: "above", thresholdPercent: 5 }, c);
      const pend = await peekProposal(sessionId, userId);
      const expected = Number((current * 1.05).toFixed(2));
      ok("★★ 5% above resolves to current × 1.05, 2dp — the UI's exact formula",
        up.ok && Number((pend!.args as any).threshold) === expected, `current ${current} → ${(pend!.args as any).threshold} (expected ${expected})`);
      ok("★★ the proposal shows BOTH the percentage and the resolved rupee value",
        /How that was worked out/.test(text(up)) && /5% above/.test(text(up)), (pend!.fields.find((f) => f.label === "How that was worked out")?.value ?? "").slice(0, 100));
      ok("★★ …and says plainly that it does NOT follow the price", /does not follow the price/i.test(text(up)));

      const down = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "price", operator: "below", thresholdPercent: 10 }, c);
      const pend2 = await peekProposal(sessionId, userId);
      ok("10% below resolves downward", down.ok && Number((pend2!.args as any).threshold) === Number((current * 0.9).toFixed(2)));

      const both = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "price", operator: "above", threshold: 100, thresholdPercent: 5 }, c);
      ok("★ threshold AND thresholdPercent together is refused", !both.ok && /not both/i.test(text(both)));

      const onBand = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "health_band", operator: "below", thresholdPercent: 5 }, c);
      ok("★ thresholdPercent on a non-price alert is refused", !onBand.ok);

      const neg = await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "price", operator: "above", thresholdPercent: -5 }, c);
      ok("★ a negative percent is refused (direction is the operator's job)", !neg.ok);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section("6 · Per-type repeat defaults (the UI's own)");
  {
    const c = ctx();
    await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "price", operator: "above", threshold: 9999 }, c);
    ok("price defaults to one_shot", (await peekProposal(sessionId, userId))?.args.repeatMode === "one_shot");

    await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "health_band", operator: "below", threshold: "steady" }, c);
    ok("★ health_band defaults to repeating", (await peekProposal(sessionId, userId))?.args.repeatMode === "repeating");

    await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "finding", operator: "fires" }, c);
    ok("★ finding defaults to repeating", (await peekProposal(sessionId, userId))?.args.repeatMode === "repeating");

    await findTool("createAlert")!.handler({ symbol: SCORED.symbol, type: "health_band", operator: "below", threshold: "steady", repeatMode: "one_shot" }, c);
    ok("an explicit repeatMode still wins", (await peekProposal(sessionId, userId))?.args.repeatMode === "one_shot");

    const f = (await peekProposal(sessionId, userId))!.fields.find((x) => x.label === "Repeats");
    ok("the repeat behaviour is enumerated in the proposal", !!f, f?.value);
  }

  console.log(`\n${failures === 0 ? "═══ ALL ALERT/REMINDER COVERAGE CHECKS PASSED ✅ ═══" : `═══ ${failures} FAILURE(S) ❌ ═══`}`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  });
