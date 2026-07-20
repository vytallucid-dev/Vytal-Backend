// (Stage 9) PE6 — THE READ-TIME PROOF. The finding fires from a LIVE fact, and its ABSENCE from the
// persisted set is the guard holding (ODL cv2-s7-refuse-live-facts).
//   npx tsx src/scripts/verify-s9-pe6-readtime.ts
import { prisma } from "../db/prisma.js";
import { listPortfolioDisclosure, constructionValuation } from "../portfolio/phs/assemble.js";
import { fireReadTimeFindings } from "../portfolio/phs/read-time-findings.js";
import { FINDING_COPY, READ_TIME_COPY } from "../portfolio/phs/copy.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };

async function main() {
  console.log("═══ PE6 — read-time, visibly ═══\n");
  const users = (await prisma.$queryRawUnsafe<{ user_id: string }[]>(`SELECT DISTINCT user_id FROM transactions`)).map((u) => u.user_id).sort();

  let firedAnywhere = 0;
  for (const uid of users) {
    const disclosure = await listPortfolioDisclosure(uid);
    const snap = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: uid }, orderBy: { createdAt: "desc" }, select: { totalValue: true, firedFindings: true } });
    const valuedBook = snap ? Number(snap.totalValue) : Number(disclosure.heldNotScoredValue);
    const v = constructionValuation(valuedBook, disclosure.heldNotValued);
    const rt = fireReadTimeFindings({ unvaluedValue: v.unvaluedValue, unvaluedShare: v.unvaluedShare, heldNotValued: disclosure.heldNotValued });

    // ★ THE GUARD: PE6 must be ABSENT from the PERSISTED set on EVERY book — that is the whole point.
    const persisted = ((snap?.firedFindings ?? []) as { id: string }[]).map((f) => f.id);
    ok(`${uid.slice(0, 8)} · PE6 is NOT in the persisted fired_findings (the live fact was never frozen)`,
      !persisted.includes("PE6"), `persisted [${persisted.join(",")}]`);

    if (rt.length === 0) continue;
    firedAnywhere++;
    const pe6 = rt.find((f) => f.id === "PE6")!;
    const b = pe6.bind as any;
    console.log(`\n  ▸ ${uid.slice(0, 8)} FIRES PE6 at read:`);
    console.log(`      ${pe6.read}`);
    console.log(`      doesnt-mean: ${pe6.doesntMean}`);
    console.log(`      bind: ₹${b.unvaluedValue} · ${(b.unvaluedShare * 100).toFixed(2)}% · ${b.holdings.map((h: any) => `${h.symbol}(${h.unpricedReason})`).join(", ")}`);
    ok(`${uid.slice(0, 8)} · PE6 tone=Caution loud=true`, pe6.tone === "Caution" && pe6.loud, `${pe6.tone}/${pe6.loud}`);
    ok(`${uid.slice(0, 8)} · bind carries unvaluedValue + unvaluedShare + per-holding unpricedReason`,
      b.unvaluedValue != null && typeof b.unvaluedShare === "number" && b.holdings.every((h: any) => "unpricedReason" in h), `${b.holdings.length} holding(s)`);
    ok(`${uid.slice(0, 8)} · fires BELOW the provisional threshold (${(b.unvaluedShare * 100).toFixed(2)}% < 25%) — the honest sentence does not wait for a threshold`,
      b.unvaluedShare < 0.25 && !v.constructionProvisional, `provisional=${v.constructionProvisional}`);
  }
  console.log("");
  ok("PE6 fires on the live cohort (e3c6bd3c's FAKESTOCK) — reachable, not theoretical", firedAnywhere > 0, `${firedAnywhere} book(s)`);

  // ── THE SHAPE IS THE GUARD (cv2-s7-refuse-live-facts). Assert the separation structurally, so nobody
  //    "tidies" PE6 into firePortfolioFindings and re-freezes it. ──
  console.log("");
  ok("PE6 is NOT in FINDING_COPY (the persisted library) — it lives in READ_TIME_COPY", !("PE6" in FINDING_COPY) && "PE6" in READ_TIME_COPY, "two maps, two lifetimes");
  const patternsSrc = (await import("fs")).readFileSync("src/portfolio/phs/patterns.ts", "utf8");
  ok("patterns.ts never mentions PE6 (it cannot: persist does not take heldNotValued)", !/PE6/.test(patternsSrc), "absent from the engine");
  const persistSrc = (await import("fs")).readFileSync("src/portfolio/phs/persist.ts", "utf8");
  ok("persist.ts still does not take heldNotValued (the refusal that makes PE6 read-time)", !/heldNotValued/.test(persistSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")), "refusal intact");
  ok("PE6 carries a doesntMean (required, like every finding)", READ_TIME_COPY.PE6.doesntMean.length > 0 && READ_TIME_COPY.PE6.job.length > 0, READ_TIME_COPY.PE6.job.join("+"));

  console.log(`\n${fail === 0 ? "✅ PE6 VERIFIED — fires at read, absent from every persisted row" : `❌ ${fail} FAILURE(S)`}`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
