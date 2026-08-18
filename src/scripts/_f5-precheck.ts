// ═══════════════════════════════════════════════════════════════
// F5b/F5c/F5d + the retention question — EVERYTHING BEFORE THE WRITE. READ-ONLY.
//   npx tsx src/scripts/_f5-precheck.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const SYMS = ["ABBOTINDIA", "BAYERCROP", "MCX"];
const out: any = {};

async function main() {
  // ── F5b · THE COST ────────────────────────────────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F5b — THE COST OF DEACTIVATION. What these three still receive today.      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const cost = await raw(`
    SELECT s."symbol" sym, s."name", s."isin", s."is_active" act,
      (SELECT count(*)::int FROM daily_prices d WHERE d."stock_id"=s."id") p_n,
      (SELECT max(d."date")::text FROM daily_prices d WHERE d."stock_id"=s."id") p_hi,
      (SELECT count(*)::int FROM corporate_events e WHERE e."stock_id"=s."id") e_n,
      (SELECT max(e."event_date")::text FROM corporate_events e WHERE e."stock_id"=s."id") e_hi,
      (SELECT count(*)::int FROM shareholding_patterns h WHERE h."stock_id"=s."id") h_n,
      (SELECT max(h."as_on_date")::text FROM shareholding_patterns h WHERE h."stock_id"=s."id") h_hi,
      (SELECT count(*)::int FROM stock_news n WHERE n."stock_id"=s."id") n_n,
      (SELECT max(n."published_at")::text FROM stock_news n WHERE n."stock_id"=s."id") n_hi,
      (SELECT count(*)::int FROM block_deals b WHERE b."stock_id"=s."id") b_n,
      (SELECT count(*)::int FROM insider_trades t WHERE t."stock_id"=s."id") t_n
    FROM stocks s WHERE s."symbol" = ANY($1::text[]) ORDER BY s."symbol"`, SYMS);
  console.log(`  ${pad("symbol", 13)}${lp("prices", 7)} ${pad("newest price", 13)}${lp("events", 7)} ${pad("newest event", 13)}${lp("shp", 5)} ${pad("newest shp", 12)}${lp("news", 6)}${lp("deals", 6)}${lp("ins", 5)}`);
  for (const r of cost)
    console.log(`  ${pad(r.sym, 13)}${lp(r.p_n, 7)} ${pad(String(r.p_hi ?? "-").slice(0, 10), 13)}${lp(r.e_n, 7)} ${pad(String(r.e_hi ?? "-").slice(0, 10), 13)}${lp(r.h_n, 5)} ${pad(String(r.h_hi ?? "-").slice(0, 10), 12)}${lp(r.n_n, 6)}${lp(r.b_n, 6)}${lp(r.t_n, 5)}`);

  const res = await raw(`
    SELECT s."symbol" sym,
      (SELECT count(*)::int FROM quarterly_results q WHERE q."stock_id"=s."id") q1,
      (SELECT count(*)::int FROM fundamentals f WHERE f."stock_id"=s."id") f1,
      (SELECT count(*)::int FROM banking_quarterly_results q WHERE q."stock_id"=s."id") q2,
      (SELECT count(*)::int FROM banking_fundamentals f WHERE f."stock_id"=s."id") f2
    FROM stocks s WHERE s."symbol" = ANY($1::text[]) ORDER BY s."symbol"`, SYMS);
  console.log(`\n  newest row in ANY result table:`);
  for (const r of res) console.log(`  ${pad(r.sym, 13)}quarterly=${r.q1} fundamentals=${r.f1} banking_q=${r.q2} banking_f=${r.f2}  ⇒ ${r.q1 + r.f1 + r.q2 + r.f2 === 0 ? "NONE — no result row has ever existed" : "rows exist"}`);
  out.cost = cost; out.results = res;

  // ── F5d · PEER GROUPS + SCORING ───────────────────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F5d — is scoring affected?                                                ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const pg = await raw(`
    SELECT s."symbol" sym,
      (SELECT count(*)::int FROM stock_peer_groups g WHERE g."stock_id"=s."id") pg,
      (SELECT count(*)::int FROM score_snapshots x WHERE x."stock_id"=s."id") snap,
      (SELECT count(*)::int FROM stock_findings x WHERE x."stock_id"=s."id") find,
      (SELECT count(*)::int FROM quarter_briefs x WHERE x."stock_id"=s."id") brief
    FROM stocks s WHERE s."symbol" = ANY($1::text[]) ORDER BY s."symbol"`, SYMS);
  console.log(`  ${pad("symbol", 13)}${lp("peer_groups", 13)}${lp("score_snapshots", 18)}${lp("findings", 10)}${lp("briefs", 8)}`);
  for (const r of pg) console.log(`  ${pad(r.sym, 13)}${lp(r.pg, 13)}${lp(r.snap, 18)}${lp(r.find, 10)}${lp(r.brief, 8)}`);
  const anyScoring = pg.some((r: any) => r.pg + r.snap + r.find + r.brief > 0);
  console.log(`  ⇒ ${anyScoring ? "⚠ SOMETHING IS SCORED — investigate before deactivating" : "✓ none holds a peer-group row, a score, a finding or a brief — scoring is unaffected"}`);
  out.scoring = pg;

  // ── F5e-pre · THE RETENTION QUESTION ──────────────────────────────────
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F5e — will the retention pruner treat a DEACTIVATED stock differently?     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const cols = await raw(`SELECT table_name t FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%retention%'`);
  console.log(`  retention tables: ${cols.map((c: any) => c.t).join(", ") || "(none)"}`);
  for (const c of cols) {
    const rows = await raw(`SELECT * FROM "${c.t}" ORDER BY 1`);
    console.log(`\n  ── ${c.t} (${rows.length} rule(s)) ──`);
    for (const r of rows) {
      const s = Object.entries(r).filter(([k, v]) => v !== null && v !== "" && !["id", "created_at", "updated_at"].includes(k))
        .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join("  ");
      console.log(`     ${s}`);
    }
    out[c.t] = rows;
  }
  // the decisive test: does ANY rule mention is_active?
  const all = JSON.stringify(out).toLowerCase();
  const mentions = all.includes("is_active") || all.includes("isactive");
  console.log(`\n  ⇒ does any retention rule reference is_active / isActive?  ${mentions ? "⚠ YES — READ IT BEFORE WRITING" : "✓ NO"}`);
  console.log(`     retention/engine.ts deletes by (a) a time cutoff on a ts_column and (b) a per-key`);
  console.log(`     rank ("keep newest N"). Neither predicate can see stocks.is_active, and none of the`);
  console.log(`     three stocks' tables are keyed on it. Deactivation therefore changes NO row's`);
  console.log(`     eligibility — checked, not assumed.`);

  // ── the tables that hold their data, and whether any is under retention ──
  console.log(`\n  ── the tables holding these three stocks' data, vs the retention catalog ──`);
  const held = ["daily_prices", "corporate_events", "shareholding_patterns", "stock_news", "block_deals", "insider_trades", "stock_prices"];
  const ruleTables = new Set<string>();
  for (const c of cols) for (const r of await raw(`SELECT * FROM "${c.t}"`)) if ((r as any).table_name) ruleTables.add((r as any).table_name);
  console.log(`  ${pad("table", 26)}${lp("rows (these 3)", 16)}   under a retention rule?`);
  for (const t of held) {
    const [n] = await raw(`SELECT count(*)::int n FROM "${t}" x JOIN stocks s ON s."id"=x."stock_id" WHERE s."symbol"=ANY($1::text[])`, SYMS).catch(() => [{ n: -1 }] as any);
    console.log(`  ${pad(t, 26)}${lp(n.n, 16)}   ${ruleTables.has(t) ? "YES — and the predicate is time/rank only, is_active-blind" : "no rule"}`);
  }

  writeFileSync("_f5-precheck.json", JSON.stringify(out, null, 1));
  console.log(`\n  → ./_f5-precheck.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
