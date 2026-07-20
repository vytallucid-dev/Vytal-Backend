// TEMP verification for the disclosure {code, cls, sentence} payload. Pure composer checks + findings
// byte-identical proof + live multi-asset book read.   npx tsx src/scripts/verify-disclosure-notes.ts
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  describeUnpriced, describeHeldNotScored, describeDisclosure, holdingDisclosureNotes,
  explainDisclosure, HoldingDisclosure, REASON_CLAUSE, UNPRICED_CLASS, DISCLOSURE_CLASS,
  HELD_NOT_SCORED_CODE, type DisclosureNote,
} from "../portfolio/disclosures.js";
import { fireReadTimeFindings } from "../portfolio/phs/read-time-findings.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";
import { getPortfolioSnapshot } from "../controllers/me/portfolio-snapshot-controller.js";
import type { UnpricedReason } from "../portfolio/price-resolver.js";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`, extra ?? ""); }
};
// OUR-DATA absence vocabulary — the phrasing the not_a_gap rule forbids (about US, not the instrument).
const ABSENCE = /not tracked|unavailable|we (do not|don'?t) have|we can'?t source|no source|is missing|are missing/i;

console.log("── A · composers: sentence byte-identical to the composer, correct class ──");
// coupon/discount = explainDisclosure verbatim
for (const code of [HoldingDisclosure.COUPON_INCOME_NOT_TRACKED, HoldingDisclosure.DISCOUNT_INSTRUMENT_PAYS_AT_PAR]) {
  const note = describeDisclosure(code);
  check(`describeDisclosure(${code}).sentence === explainDisclosure(${code})`, note.sentence === explainDisclosure(code));
  check(`  ${code} cls = ${DISCLOSURE_CLASS[code]}`, note.cls === DISCLOSURE_CLASS[code]);
}
check("coupon_income_not_tracked → our_gap", describeDisclosure(HoldingDisclosure.COUPON_INCOME_NOT_TRACKED).cls === "our_gap");
// ── THE T-BILL: not_a_gap, names what it does, NO absence vocabulary ──
const tbill = describeDisclosure(HoldingDisclosure.DISCOUNT_INSTRUMENT_PAYS_AT_PAR);
check("T-bill cls = not_a_gap", tbill.cls === "not_a_gap");
check("T-bill sentence has NO absence-vocabulary", !ABSENCE.test(tbill.sentence), tbill.sentence);
check("T-bill sentence names what it does (discount / redeems at par)", /discount/i.test(tbill.sentence) && /par/i.test(tbill.sentence));

console.log("\n── B · unpriced reasons: all 4, each with class + sentence from REASON_CLAUSE ──");
const REASONS: UnpricedReason[] = ["no_instrument", "no_price_yet", "not_exchange_traded", "dormant"];
for (const r of REASONS) {
  const n = describeUnpriced(r)!;
  check(`describeUnpriced(${r}) → "${n.sentence}"`, n.sentence === `We can't price this holding — ${REASON_CLAUSE[r]}.` && n.cls === UNPRICED_CLASS[r]);
}
check("dormant → refused (a withheld number, not a gap)", describeUnpriced("dormant")!.cls === "refused");
check("no_instrument/no_price_yet/not_exchange_traded → our_gap",
  ["no_instrument", "no_price_yet", "not_exchange_traded"].every((r) => describeUnpriced(r as UnpricedReason)!.cls === "our_gap"));
check("describeUnpriced(null) → null (priced holding never composes)", describeUnpriced(null) === null);
check("describeUnpriced(unknown) → null (omit, never mislabel)", describeUnpriced("something_new" as UnpricedReason) === null);

console.log("\n── C · heldNotScored: by-design, not_a_gap, not framed as a gap ──");
const hns = describeHeldNotScored();
check("heldNotScored cls = not_a_gap", hns.cls === "not_a_gap");
check("heldNotScored code = held_not_scored", hns.code === HELD_NOT_SCORED_CODE);
check("heldNotScored says 'by design'", /by design/i.test(hns.sentence));
check("heldNotScored has NO our-data absence vocabulary", !ABSENCE.test(hns.sentence), hns.sentence);

console.log("\n── D · holdingDisclosureNotes assembly (order + emptiness) ──");
check("scored priced non-coupon holding → [] (nothing to disclose)",
  holdingDisclosureNotes({ heldNotScored: false, heldNotValued: false, unpricedReason: null, disclosures: [] }).length === 0);
const bondNotes = holdingDisclosureNotes({ heldNotScored: true, heldNotValued: true, unpricedReason: "not_exchange_traded", disclosures: [HoldingDisclosure.COUPON_INCOME_NOT_TRACKED] });
check("unpriceable coupon bond → [notScored, unpriced, coupon] in order",
  bondNotes.map((n) => n.code).join(",") === `${HELD_NOT_SCORED_CODE},not_exchange_traded,${HoldingDisclosure.COUPON_INCOME_NOT_TRACKED}`, bondNotes.map((n) => n.code));

console.log("\n── E · findings BYTE-IDENTICAL after the REASON_CLAUSE move ──");
// pin the exact clause values (the move must not have changed them)
check("REASON_CLAUSE values unchanged", JSON.stringify(REASON_CLAUSE) === JSON.stringify({
  no_instrument: "outside the universe we catalogue",
  no_price_yet: "no price has landed for it yet",
  not_exchange_traded: "not exchange-traded on a market we read",
  dormant: "no longer priced by AMFI",
}));
// PE6 read must be exactly the pre-move string, built from the (now shared) REASON_CLAUSE
const hnv = [{ symbol: "XYZ", accountId: "a", accountName: "A", source: "broker" as const, quantity: "10", brokerCurrentValue: "270", stale: false, lastSyncedAt: null, unpricedReason: "no_instrument" as UnpricedReason }];
const pe6 = fireReadTimeFindings({ unvaluedValue: "270", unvaluedShare: 0.004, heldNotValued: hnv })[0];
const expected = `₹270 of your book (1 holding) has no price we can source — outside the universe we catalogue. It is not reflected in Construction.`;
check("PE6 read byte-identical to pre-move text", pe6?.read === expected, pe6?.read);

console.log("\n── F · LIVE multi-asset book (__multiasset_book@test.invalid) ──");
async function live() {
  const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
  const mockReq = (userId: string) => ({ authUser: { userId }, body: {}, params: {}, query: {} } as any);
  const user = await prisma.user.findFirst({ where: { email: "__multiasset_book@test.invalid" }, select: { id: true } });
  if (!user) { console.log("  (book not found — run seed-multiasset-book.ts; pure checks above still stand)"); return; }

  const holdRes = mockRes(); await listHoldings(mockReq(user.id), holdRes);
  const rows = (holdRes.body?.data?.holdings ?? []) as any[];
  const classesSeen = new Set<string>();
  let notesTotal = 0, mismatches = 0;
  console.log(`  ${rows.length} holdings · HTTP ${holdRes.statusCode}`);
  for (const h of rows) {
    const notes: DisclosureNote[] = h.disclosureNotes ?? [];
    notesTotal += notes.length;
    for (const n of notes) {
      classesSeen.add(n.cls);
      // prove each served sentence is byte-identical to the composer for its code
      let composed: string | null = null;
      if (n.code === HELD_NOT_SCORED_CODE) composed = describeHeldNotScored().sentence;
      else if (REASONS.includes(n.code as UnpricedReason)) composed = describeUnpriced(n.code as UnpricedReason)!.sentence;
      else composed = describeDisclosure(n.code as any).sentence;
      if (composed !== n.sentence) mismatches++;
    }
    if (notes.length) console.log(`    ${String(h.symbol).padEnd(14)} ${String(h.assetClass).padEnd(12)} ${notes.map((n) => `${n.code}(${n.cls})`).join(", ")}`);
  }
  check("every served sentence byte-identical to its composer", mismatches === 0, `${mismatches} mismatches`);
  check("live book produced disclosure notes", notesTotal > 0, notesTotal);
  console.log(`  class values on the live book: [${[...classesSeen].sort().join(", ")}]`);

  // aggregate disclosure.heldNotValued[].note
  const snapRes = mockRes(); await getPortfolioSnapshot(mockReq(user.id), snapRes);
  const hnvAgg = (snapRes.body?.data?.disclosure?.heldNotValued ?? []) as any[];
  console.log(`  disclosure.heldNotValued: ${hnvAgg.length} item(s)`);
  for (const item of hnvAgg) console.log(`    ${item.symbol}: unpricedReason=${item.unpricedReason} note=${item.note ? `${item.note.code}(${item.note.cls})` : "null"}`);
  if (hnvAgg.length) check("aggregate heldNotValued items carry a note matching their reason",
    hnvAgg.every((i) => i.unpricedReason == null || (i.note && i.note.code === i.unpricedReason)));
}

live()
  .catch((e) => { console.log("  (live read skipped:", (e as Error).message.split("\n")[0], "— pure checks above still stand)"); })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
