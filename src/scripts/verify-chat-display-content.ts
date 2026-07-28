// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PROOF — the opening user message's two texts.
//
// This exists because the failure it guards against is SILENT and one-directional: if `display_content`
// ever leaked into the model's history, or `content` ever leaked into the client's transcript, nothing
// would throw — the reader would just start seeing 3KB of prompt engineering in a chat bubble, or the
// model would start answering a one-line question with no facts attached. So both directions are
// asserted against REAL rows through the REAL functions, not against the source.
//
// It writes a synthetic session, reads it back through serializeVisibleMessages / loadHistoryForModel,
// and deletes it. No model call, no quota, no network beyond the DB.
//
//   npx tsx src/scripts/verify-chat-display-content.ts        (run from the backend root — needs .env)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { serializeVisibleMessages, loadHistoryForModel, countVisibleUserMessages } from "../chat/sessions.js";
import { resolveOpening, KNOWN_SURFACES } from "../chat/openings.js";
import type { DiscussContext } from "../chat/discuss-context.js";

let failures = 0;
const ok = (label: string, pass: boolean, detail?: string) => {
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};

// A stand-in for the real thing: long, grounded, unmistakably NOT something a person typed.
const GROUNDED_ASK = [
  "=== FACTS: TCS ===",
  "You may use ONLY facts available in this message.",
  "composite: 66 · band: Steady · pillars: foundation 71, momentum 48…",
  "[ABOUT THE READER] holds 12 positions; coverage 84%.",
  "The reader just opened TCS's health read and asked you to explain what's behind it.",
].join("\n\n");
const DISPLAY_LINE = "Explain TCS's health read — what's driving it, and where the pillars are strong or weak";

// ⚠ chat_sessions.user_id is FK-constrained to public.users, so the fixtures must hang off a REAL user.
//   Two consequences, both handled: the sessions are created promoted:false so they can never surface in
//   anyone's conversation list even for the second they exist, and cleanup deletes BY THE IDS THIS SCRIPT
//   CREATED — never by userId, which would take that user's real conversations with it.
const created: string[] = [];
const cleanup = async () => {
  if (created.length) await prisma.chatSession.deleteMany({ where: { id: { in: created } } });
};

async function main() {
  const owner = await prisma.userLedger.findFirst({ select: { userId: true } });
  if (!owner) throw new Error("no user in user_ledger to hang the fixtures off");
  const userId = owner.userId;

  // ── 1. THE COLUMN EXISTS ─────────────────────────────────────────────────────────────────────────
  const col = await prisma.$queryRaw<{ column_name: string; data_type: string; is_nullable: string }[]>`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'chat_messages' AND column_name = 'display_content'
  `;
  ok("chat_messages.display_content exists, TEXT, nullable", col.length === 1 && col[0].data_type === "text" && col[0].is_nullable === "YES", JSON.stringify(col[0] ?? null));

  // ── 2. THE FIVE DISPLAY STRINGS, VERBATIM ────────────────────────────────────────────────────────
  const CASES: { surface: string; ctx: DiscussContext }[] = [
    { surface: "stock_health", ctx: { surface: "stock_health", subject: { kind: "stock", symbol: "TCS" }, label: "Discuss this read", detail: { band: "Steady" } } },
    { surface: "finding", ctx: { surface: "finding", subject: { kind: "finding", symbol: "TCS" }, label: "Ask about this finding", detail: { name: "Promoter pledging" } } },
    { surface: "metric_verdict", ctx: { surface: "metric_verdict", subject: { kind: "stock", symbol: "TCS" }, label: "Explain this metric", detail: { metric: "ROCE" } } },
    { surface: "portfolio_health", ctx: { surface: "portfolio_health", subject: { kind: "portfolio" }, label: "Discuss my portfolio" } },
    { surface: "concept", ctx: { surface: "concept", subject: { kind: "stock", name: "free cash flow" }, label: "What is this?" } },
  ];
  console.log("\n── the five display strings ──");
  for (const c of CASES) {
    const r = resolveOpening(c.ctx);
    const line = r.spec.buildDisplay(c.ctx, r.subjectLabel);
    console.log(`  ${c.surface.padEnd(17)} ${line}`);
    ok(`  ${c.surface}: one sentence, no newline, no bullet`, !line.includes("\n") && !line.includes("- ") && !line.includes("•"));
  }
  ok("every registered surface has a buildDisplay", KNOWN_SURFACES.every((k) => CASES.some((c) => c.surface === k)), `registry: ${KNOWN_SURFACES.join(", ")}`);

  // ── 3. A REAL ROW, BOTH DIRECTIONS ───────────────────────────────────────────────────────────────
  const session = await prisma.chatSession.create({
    data: { userId, origin: "discuss", surface: "stock_health", subjectKind: "stock", subjectSymbol: "__VERIFY__", title: "verify-display-content (temp)", promoted: false },
  });
  created.push(session.id);
  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "user", content: GROUNDED_ASK, displayContent: DISPLAY_LINE, isOpening: true },
  });
  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "assistant", content: "What holds this business up is…", isOpening: true },
  });

  const rows = await prisma.chatMessage.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "asc" } });
  const visible = serializeVisibleMessages(rows);
  const history = await loadHistoryForModel(session.id);

  // → THE CLIENT
  ok("the opening user row is now VISIBLE", visible.some((m) => m.role === "user" && m.isOpening));
  ok("★ the client receives the DISPLAY line", visible.find((m) => m.role === "user")?.content === DISPLAY_LINE);
  ok("★ the grounded ask NEVER reaches the client", !JSON.stringify(visible).includes("ONLY facts available"));

  // → THE MODEL
  ok("★ the model receives the FULL grounded ask (content, not display_content)", history[0]?.content === GROUNDED_ASK);
  ok("★ the display line NEVER reaches the model", !history.some((m) => (m.content ?? "").includes(DISPLAY_LINE)));

  // → THE TITLE TRIGGER, unmoved
  ok("countVisibleUserMessages still ignores openings (title logic unaffected)", (await countVisibleUserMessages(session.id)) === 0);

  // ── 4. NO TWIN ⇒ STILL HIDDEN (the chat_page opening, and every pre-migration discuss opening) ────
  const legacy = await prisma.chatSession.create({
    data: { userId, origin: "chat_page", title: "verify-display-content (temp)", promoted: false },
  });
  created.push(legacy.id);
  await prisma.chatMessage.create({
    data: { sessionId: legacy.id, role: "user", content: "[ABOUT THE READER] holds 12 positions.", isOpening: true },
  });
  const legacyRows = await prisma.chatMessage.findMany({ where: { sessionId: legacy.id } });
  ok("★ an opening with NO display twin is still dropped", serializeVisibleMessages(legacyRows).length === 0);

  await cleanup();
  ok("cleanup: both fixtures removed", (await prisma.chatSession.count({ where: { id: { in: created } } })) === 0);
}

main()
  .catch((e) => {
    console.error("💥", e);
    failures++;
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
    console.log(`\n${failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  });
