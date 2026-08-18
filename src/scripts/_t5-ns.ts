// T5.1a support — which namespace prefix carries the facts, and under which context.
// READ-ONLY.
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const TAGS = ["RevenueFromOperations", "ProfitLossForPeriod", "CashFlowsFromUsedInOperatingActivities"];
const PAIRS: [string, string][] = [
  ["ULTRACEMCO", "FY19"], ["ULTRACEMCO", "FY21"], ["ULTRACEMCO", "FY22"], ["ULTRACEMCO", "FY23"],
  ["ABB", "FY20"], ["BHARTIARTL", "FY21"], ["PIDILITIND", "FY21"],
];

async function main() {
  for (const [sym, fy] of PAIRS) {
    const [p] = await raw<any>(
      `SELECT f."xbrl_url" u, f."revenue"::float8 rev, f."cash_from_operating"::float8 cfo
         FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
        WHERE st."symbol"=$1 AND f."fiscal_year"=$2 AND f."result_type"='standalone'`, sym, fy);
    if (!p) { console.log(`${sym} ${fy}: no row`); continue; }
    let xml: string;
    try { xml = await fetchXbrlFile(p.u); } catch (e) { console.log(`${sym} ${fy}: unreachable`); continue; }

    const prefixes = new Map<string, number>();
    for (const m of xml.matchAll(/<([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)[\s>/]/g)) {
      prefixes.set(m[1], (prefixes.get(m[1]) ?? 0) + 1);
    }
    console.log(`\n── ${sym} ${fy}  DB revenue=${p.rev} cfo=${p.cfo === null ? "NULL" : p.cfo}`);
    console.log(`   prefixes: ${[...prefixes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(" ")}`);
    for (const tag of TAGS) {
      let found = false;
      for (const pre of prefixes.keys()) {
        const re = new RegExp("<" + escapeRe(pre) + ":" + tag + "\\b([^>]*)>([^<]*)<", "g");
        const hits = [...xml.matchAll(re)];
        if (!hits.length) continue;
        found = true;
        for (const h of hits) {
          const ctx = /contextRef="([^"]+)"/.exec(h[1])?.[1] ?? "-";
          const unit = /unitRef="([^"]+)"/.exec(h[1])?.[1] ?? "-";
          const dec = /decimals="([^"]+)"/.exec(h[1])?.[1] ?? "-";
          const v = parseFloat(h[2]);
          const cr = unit === "INR" ? (v / 1e7).toFixed(2) + " Cr" : `${v} [${unit}]`;
          console.log(`     ${pre}:${tag.padEnd(42)} ctx=${ctx.padEnd(8)} dec=${dec.padEnd(4)} ${cr}`);
        }
      }
      if (!found) console.log(`     ${tag.padEnd(50)} (absent under every prefix)`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
