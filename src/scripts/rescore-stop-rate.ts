// ─────────────────────────────────────────────────────────────────────────────
// RE-SCORE the 5×-per-tool live run with the CORRECTED completion detector.
//
// The 20 replies were already paid for. What was wrong was the instrument, not the data: the detector
// counted "I've set up a proposal … Would you like me to go ahead?" as a completion claim. Re-running
// 55 live units to re-test a regex would be waste, so the saved transcript is re-scored instead — same
// replies, corrected analysis, and the ruling for each reply is PRINTED so the judgement is auditable
// rather than asserted.
//
//   npx tsx src/scripts/rescore-stop-rate.ts <live-b.txt>
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import { claimsDone, claimMatch } from "./claims-done.js";

const path = process.argv[2];
if (!path || !fs.existsSync(path)) {
  console.error("usage: rescore-stop-rate.ts <path to the live --part=b output>");
  process.exit(1);
}

const text = fs.readFileSync(path, "utf8");
const lines = text.split("\n");

interface Run { tool: string; n: number; reply: string; called: boolean; autoConfirm: boolean; wrote: boolean }
const runs: Run[] = [];
let reply: string[] = [];
let capturing = false;

for (const line of lines) {
  const m = line.match(/^\s*run (\d+)\/5 (\w+): called=(\w+) autoConfirm=(\w+) wrote=(\w+)/);
  if (m) {
    runs.push({
      tool: m[2], n: Number(m[1]),
      reply: reply.join("\n").trim(),
      called: m[3] === "true", autoConfirm: m[4] === "true", wrote: m[5] === "true",
    });
    reply = [];
    capturing = false;
    continue;
  }
  if (line.startsWith("  VYTAL  │")) { capturing = true; reply = [line.replace(/^\s*VYTAL\s*│\s?/, "")]; continue; }
  if (line.startsWith("  READER │") || line.startsWith("  [called]") || line.startsWith("  [tool")) { capturing = false; continue; }
  if (capturing) reply.push(line);
}

console.log(`Re-scoring ${runs.length} live replies with the corrected detector\n`);

const byTool = new Map<string, { stopped: number; claimed: number; total: number }>();
for (const r of runs) {
  const claim = claimsDone(r.reply);
  const stopped = r.called && !r.autoConfirm && !r.wrote && !claim;
  const t = byTool.get(r.tool) ?? { stopped: 0, claimed: 0, total: 0 };
  t.total++;
  if (stopped) t.stopped++;
  if (claim) t.claimed++;
  byTool.set(r.tool, t);

  const verdict = claim ? `❌ CLAIMS DONE ("${claimMatch(r.reply)}")` : "✅ stopped";
  const first = r.reply.split("\n")[0].slice(0, 96);
  console.log(`  ${verdict}  ${r.tool} run ${r.n}`);
  console.log(`      "${first}${r.reply.split("\n")[0].length > 96 ? "…" : ""}"`);
}

console.log(`\n══ CORRECTED RATES ══`);
let allStopped = 0, allTotal = 0, allClaimed = 0;
for (const [tool, t] of byTool) {
  console.log(`  ${t.stopped === t.total ? "✅" : "❌"} ${tool}: stopped at the proposal ${t.stopped}/${t.total}  ·  claimed done ${t.claimed}/${t.total}`);
  allStopped += t.stopped; allTotal += t.total; allClaimed += t.claimed;
}
console.log(`\n  ★★ OVERALL: stopped ${allStopped}/${allTotal} · false completion claims ${allClaimed}/${allTotal}`);
const wrote = runs.filter((r) => r.wrote).length;
console.log(`  ★★ unconfirmed writes: ${wrote}/${allTotal}  (this one was never in doubt — it is measured from the DB, not from prose)`);
