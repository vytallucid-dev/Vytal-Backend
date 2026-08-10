// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE FILING CHANNEL — LIVE CONVERSATIONS. The claim no fixture can settle: that the assistant now
// SAYS what the service returned.
//
// ⚠ REAL PAID GEMINI CALLS over real HTTP. Opt-in: FILING_LIVE_CHAT=1.
//
// The defect was found live, not in a test: asked for the findings on 360ONE, the assistant answered
// "tracked rather than scored yet, so there are no findings or red flags to report" — over a standing
// critical flag (90% of the promoter holding pledged, FY27Q1 shareholding). A render gate proves the
// FACTS reach the model; only a conversation proves the model does not talk past them.
//
// FOUR SHAPES, AND THE POINT IS THAT ALL FOUR READ DIFFERENTLY:
//   1. 360ONE     unscored, one critical filing flag → must surface it, and must not say "no findings"
//   2. BEL        scored, 1 score finding + 4 filing → must carry BOTH channels
//   3. KOTAKBANK  scored, 0 fired, 10 clean, 8 capabilities not assessable → must NOT read as an
//                 all-clear; the limitation has to be in the reply
//   4. COLPAL     scored, 0 fired, all 22 checks ran → must read as genuinely clean, and DISTINCTLY
//                 from 3 — this is the only company in the book that earns an unqualified answer
//
//   FILING_LIVE_CHAT=1 npx tsx src/scripts/verify-filing-findings-live-chat.ts
//   …--only=1,3 re-runs a subset, so iterating on one turn does not re-spend on the others.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meChatRouter } from "../routes/me-chat-routes.js";
import { resolveChatModel } from "../chat/config.js";
import { isBlankReply } from "../chat/voice.js";
import type { AiToolCall } from "../ai/types.js";

if (process.env.FILING_LIVE_CHAT !== "1") {
  console.log("SKIPPED — real paid model calls. Run with FILING_LIVE_CHAT=1.");
  process.exit(0);
}

let failures = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) failures++; };
const rule = (t: string) => console.log(`\n${"═".repeat(99)}\n${t}\n${"═".repeat(99)}`);

const authIds: string[] = [];

/** "no findings" in the shapes the model actually produced when the defect was live. */
const DENIES_FINDINGS =
  /(no|not any|aren'?t any|there are no)\s+(\w+\s+){0,3}(findings|red flags|flags)\b|nothing (to report|flagged|firing)|no findings or red flags/i;

async function main() {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `filing-${authId}@test.local`);
  authIds.push(authId);
  const userId = (await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } })).id;

  const app = express();
  app.use(express.json());
  app.use("/api/v1/me", (req, _res, next) => {
    (req as express.Request).authUser = { userId, authUserId: "auth-" + userId, email: "t@test.local", role: "user" };
    next();
  }, meChatRouter);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const call = async (path: string, body?: unknown) =>
    (await fetch(`http://127.0.0.1:${port}/api/v1/me${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })).json() as any;

  /** One fresh session, one message. Returns the tools called, the tool RESULTS (what the model was
   *  handed), and the delivered reply — the whole transcript, printed verbatim. */
  const ask = async (message: string): Promise<{ calls: string[]; results: string[]; reply: string }> => {
    const opened = await call("/chat/sessions", { origin: "chat_page" });
    const sid = opened?.data?.session?.id;
    await call(`/chat/sessions/${sid}/messages`, { message });
    const rows = await prisma.chatMessage.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } });
    const calls: string[] = [];
    const results: string[] = [];
    let reply = "";
    for (const m of rows) {
      if (m.kind === "tool_call") for (const c of ((m.toolPayload as unknown as AiToolCall[]) ?? [])) calls.push(`${c.name}(${JSON.stringify(c.args)})`);
      else if (m.kind === "tool_result") results.push(String((m.toolPayload as any)?.response?.output ?? ""));
      else if (m.role === "assistant") reply = m.content;
    }
    console.log(`\n  READER │ ${message}`);
    for (const c of calls) console.log(`  [called] ${c}`);
    console.log(`  VYTAL  │ ${reply.split("\n").join("\n         │ ")}\n`);
    return { calls, results, reply };
  };

  const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;
  const run = (n: string) => !only || only.has(n);

  console.log(`LIVE — model=${resolveChatModel()}${only ? ` · turns ${[...only].join(",")}` : ""}`);
  try {
    if (run("1")) {
      rule("1 — 360ONE · UNSCORED, ONE CRITICAL FILING FLAG. The turn the defect was found on.");
      const a = await ask("what are the notable findings on 360ONE?");
      ok("the reply is not blank", !isBlankReply(a.reply));
      ok("★ the tool result CARRIED the pledging flag to the model", a.results.some((r) => r.includes("Pledging Crisis")), "Pledging Crisis in the tool payload");
      const saysPledge = /pledg/i.test(a.reply);
      ok("★ the reply SURFACES the pledging red flag", saysPledge, a.reply.slice(0, 140));
      ok("…and states the scale of it (90% of the promoter holding)", /\b90(\.\d)?\s?%|\bninety\b/i.test(a.reply), "the figure from the verdict");
      ok("★ the reply does NOT deny having findings", !DENIES_FINDINGS.test(a.reply), (a.reply.match(DENIES_FINDINGS) ?? []).join(" ") || "no denial");
      ok("the unscored state is still stated honestly (no fabricated score)", /(not|isn'?t|no).{0,30}(scored|health score)|no health score/i.test(a.reply), "the boundary is kept");
      ok("…and the checks that could not RUN are not passed off as clean", !/all (of )?(the )?checks|everything (else )?(is )?clean/i.test(a.reply), "no blanket all-clear");
    }

    if (run("2")) {
      rule("2 — BEL · SCORED. Both channels must be in the answer, and kept apart.");
      const b = await ask("what are the notable findings on BEL?");
      ok("the reply is not blank", !isBlankReply(b.reply));
      const filingHits = ["accrual", "receivab", "margin", "block"].filter((t) => new RegExp(t, "i").test(b.reply));
      ok("★ the FILING channel is in the reply", filingHits.length >= 2, `matched: ${filingHits.join(", ") || "none"}`);
      ok("★ the SCORE channel is in the reply", /diverg|foundation|momentum|sticky/i.test(b.reply), "the sticky divergence / pillar reading");
      ok("the health score is still reported for a scored company", /\b77\b|pristine/i.test(b.reply), "77 / Pristine");
      ok("the two channels are not merged into one count", !/\b5 findings\b|\bfive findings\b/i.test(b.reply), "no 1+4 arithmetic");
    }

    if (run("3")) {
      rule("3 — KOTAKBANK · NOTHING FIRED, BUT EIGHT CAPABILITIES NOT ASSESSABLE. Must not read as an all-clear.");
      const c = await ask("are there any red flags on KOTAKBANK?");
      ok("the reply is not blank", !isBlankReply(c.reply));
      // Both scopes' wordings — the model may reach this company through the lean getStockFacts read
      // or the full batch payload, and the assertion is about the FACT arriving, not about which
      // renderer served it.
      ok(
        "★ the tool result carried the coverage limit",
        c.results.some((r) => /could not be assessed|COULD NOT ASSESS|check-list INCOMPLETE|we could not assess/.test(r)),
        "in the tool payload",
      );
      // ⚠ THIS PATTERN MUST NOT CONTAIN THE COMPANY'S OWN WORDS. The first draft ended in `|bank` and
      //   passed on a reply reading "Kotak Mahindra Bank carries no red flags right now" — the exact
      //   all-clear this turn exists to catch, greenlit by the bank's own name. A gate that matches the
      //   subject rather than the claim proves nothing.
      //
      //   It is deliberately an OR over the ways a reply can scope its own silence, because the model
      //   words it differently each run ("could not be assessed", "do not apply to how banks are
      //   financed", "in the checks that could be run"). All three are the claim this turn requires;
      //   none of them appears in the pre-fix all-clear, which is what the negative control pins.
      const SCOPED =
        /could ?n[o']?t (be )?(fully )?(assess|check|evaluate|run|complete)|(do|does|did) not apply|don'?t apply|doesn'?t apply|not applicable|unable to (assess|check)|not assessable|checks that could be run|in what (we|vytal) could check|what (we|vytal) could (not |n'?t )?(assess|check)/i;
      ok("★ the reply NAMES what could not be checked (it is not a clean bill of health)", SCOPED.test(c.reply), (c.reply.match(SCOPED) ?? [c.reply.slice(0, 160)])[0]);
      ok(
        "NEGATIVE CONTROL — the pattern does NOT pass the bare all-clear that shipped before the fix",
        !SCOPED.test("Kotak Mahindra Bank carries no red flags right now, though Vytal's engine does pick up a few patterns rather than urgent warnings.") &&
          !SCOPED.test("There are no red flags on this company."),
        "both bare all-clears fail this check",
      );
      ok("…and does not claim everything was checked", !/all (22|twenty-two) (filing )?checks/i.test(c.reply), "no false completeness");
      ok("the score-channel findings are still reported", /ownership|composition|diverg/i.test(c.reply), "the three score patterns");
      // ★ THE REASON, NOT A REASON. Seven of the eight declines here are `industry_not_applicable` —
      //   the check does not apply to a lender — and relational/coverage.ts is explicit that this one
      //   must never read as a data gap. A live reply invented "due to incomplete data for this
      //   period", which is a different and wrong claim about the same silence.
      const saysNotApplicable = /not apply|n'?t apply|not applicable|does not fit|isn'?t applicable|how (this kind of |a )?(company|bank|lender) is financed|because it is a bank|for a bank/i.test(c.reply);
      const inventsDataGap = /(incomplete|missing|insufficient|unavailable|no) data|not (yet )?(reported|filed|available)|awaiting/i.test(c.reply);
      ok(
        "★ the reply gives the REAL reason (does not apply to a lender), not an invented data gap",
        saysNotApplicable && !inventsDataGap,
        saysNotApplicable ? (inventsDataGap ? "says both — the invented data-gap claim is still there" : "scope statement, correctly") : "the reason is missing",
      );
    }

    if (run("4")) {
      rule("4 — COLPAL · ALL 22 CHECKS RAN, NOTHING FIRED. The one company that earns an unqualified answer.");
      const d = await ask("are there any red flags on COLPAL?");
      ok("the reply is not blank", !isBlankReply(d.reply));
      ok("★ the tool result carried the complete-and-clean note", d.results.some((r) => r.includes("All 22 filing checks ran")), "in the tool payload");
      // ⚠ WIDENED ONCE, AND ONLY OVER PHRASINGS THAT MEAN THE SAME THING. The first draft required
      //   "no/nothing … flag" within 40 characters and failed a reply reading "All 22 checks … ran
      //   completely clean with zero red flags raised" — which is the cleanest possible answer. The
      //   distinctness from turn 3 is what this pair of turns is for, and it is asserted separately
      //   below (turn 4 claims completeness; turn 3 must not).
      const CLEAN = /\b(zero|no|none|nothing)\b[^.]{0,60}\b(red flags?|flags?|flagged|firing|fired)\b|\bran (completely |perfectly |all )?clean\b|came back clean/i;
      ok("★ the reply reads as genuinely clean", CLEAN.test(d.reply), (d.reply.match(CLEAN) ?? [d.reply.slice(0, 160)])[0]);
      ok(
        "NEGATIVE CONTROL — 'clean' is not matched by a reply that only says a check could not be run",
        !CLEAN.test("Twelve of the checks could not be assessed for this company because it is a bank."),
        "an unrun check is not a clean one",
      );
      ok("…and does NOT hedge with a coverage limit it does not have", !/could ?n[o']?t (be )?(assess|check)|not assessable|not applicable/i.test(d.reply), "no borrowed caveat");
      ok("the completeness is stated, not implied", /\b22\b|all (of )?(the )?(filing )?checks/i.test(d.reply), "22 checks named");
    }

    const units = (await prisma.aiUsageCounter.findMany({ where: { scope: { startsWith: `user:${userId}:` } }, select: { callCount: true } }))
      .reduce((n, r) => n + r.callCount, 0);
    console.log(`\n  GEMINI UNITS SPENT: ${units}`);
  } finally {
    server.close();
  }
  rule(failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILURE(S)`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (authIds.length) await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, authIds);
    await prisma.$disconnect();
  });
