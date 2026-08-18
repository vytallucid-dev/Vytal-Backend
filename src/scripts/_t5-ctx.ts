// ═══════════════════════════════════════════════════════════════
// T5.1a — WHAT DO OneD AND FourD ACTUALLY DENOTE IN AN ANNUAL FILING?
// READ-ONLY. Dumps every xbrli:context definition (period start/end, duration)
// from real documents across vintages, then shows which context each relevant
// fact is tagged under, with its value.
//   npx tsx src/scripts/_t5-ctx.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const RUPEES_PER_CRORE = 1e7;
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every xbrli:context: id → {start, end, instant, days}. */
function contexts(xml: string) {
  const out = new Map<string, { start?: string; end?: string; instant?: string; days?: number }>();
  const re = /<xbrli:context\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = m[1], body = m[2];
    const start = /<xbrli:startDate>([^<]+)<\/xbrli:startDate>/i.exec(body)?.[1];
    const end = /<xbrli:endDate>([^<]+)<\/xbrli:endDate>/i.exec(body)?.[1];
    const instant = /<xbrli:instant>([^<]+)<\/xbrli:instant>/i.exec(body)?.[1];
    let days: number | undefined;
    if (start && end) days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    out.set(id, { start, end, instant, days });
  }
  return out;
}

/** Every occurrence of a tag: context, unit, decimals, raw value. */
function occ(xml: string, tag: string) {
  const out: { ctx: string; unit: string; dec: string; val: string }[] = [];
  const re = new RegExp(`<in-bse-fin:${tag}\\b([^>]*)>([^<]*)</in-bse-fin:${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({
      ctx: /contextRef="([^"]+)"/.exec(m[1])?.[1] ?? "-",
      unit: /unitRef="([^"]+)"/.exec(m[1])?.[1] ?? "-",
      dec: /decimals="([^"]+)"/.exec(m[1])?.[1] ?? "-",
      val: m[2].trim(),
    });
  }
  return out;
}

const PROBE_TAGS = [
  "RevenueFromOperations",
  "ProfitLossForPeriod",
  "CashFlowsFromUsedInOperatingActivities",
  "CashFlowsFromUsedInFinancingActivities",
  "Assets",
  "EquityShareCapital",
];

async function main() {
  // Documents chosen to span the vintages that matter.
  const picks = await raw<any>(
    `SELECT st."symbol", st."fiscalYearEnd" fye, f."fiscal_year", f."result_type",
            f."xbrl_url", f."filing_date"::text fd, f."cash_from_operating"::float8 cfo,
            f."revenue"::float8 rev
       FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
      WHERE (st."symbol"='ABB'        AND f."fiscal_year"='FY20' AND f."result_type"='standalone')
         OR (st."symbol"='ULTRACEMCO' AND f."fiscal_year"='FY21' AND f."result_type"='standalone')
         OR (st."symbol"='BHARTIARTL' AND f."fiscal_year"='FY21' AND f."result_type"='standalone')
         OR (st."symbol"='ULTRACEMCO' AND f."fiscal_year"='FY19' AND f."result_type"='standalone')
         OR (st."symbol"='ULTRACEMCO' AND f."fiscal_year"='FY23' AND f."result_type"='standalone')
         OR (st."symbol"='TITAN'      AND f."fiscal_year"='FY20' AND f."result_type"='standalone')
      ORDER BY f."fiscal_year", st."symbol"`);

  for (const p of picks) {
    console.log(`\n╔══════════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║ ${pad(`${p.symbol} ${p.fiscal_year} ${p.result_type} · FYE ${p.fye} · broadcast ${String(p.fd).slice(0, 10)}`, 76)} ║`);
    console.log(`╚══════════════════════════════════════════════════════════════════════════════╝`);
    console.log(`  DB today: revenue=${p.rev} Cr · cash_from_operating=${p.cfo === null ? "NULL" : p.cfo + " Cr"}`);
    let xml: string;
    try { xml = await fetchXbrlFile(p.xbrl_url); } catch (e) { console.log(`  unreachable: ${(e as Error).message}`); continue; }

    const ctx = contexts(xml);
    console.log(`\n  ── CONTEXT DEFINITIONS (${ctx.size} total; duration contexts first) ──`);
    const durs = [...ctx.entries()].filter(([, v]) => v.days !== undefined).sort((a, b) => (a[1].days! - b[1].days!));
    for (const [id, v] of durs) {
      console.log(`     ${pad(id, 12)} ${v.start} → ${v.end}   ${String(v.days).padStart(4)} days  ≈ ${(v.days! / 30.44).toFixed(1)} months`);
    }
    const insts = [...ctx.entries()].filter(([, v]) => v.instant !== undefined);
    for (const [id, v] of insts.slice(0, 6)) console.log(`     ${pad(id, 12)} instant ${v.instant}`);

    console.log(`\n  ── WHERE EACH FACT IS TAGGED ──`);
    for (const tag of PROBE_TAGS) {
      const os = occ(xml, tag);
      if (os.length === 0) { console.log(`     ${pad(tag, 46)} (absent)`); continue; }
      for (const o of os) {
        const c = ctx.get(o.ctx);
        const period = c?.days !== undefined ? `${c.start}→${c.end} (${c.days}d)` : c?.instant ? `instant ${c.instant}` : "(context undefined)";
        const cr = o.unit === "INR" ? (parseFloat(o.val) / RUPEES_PER_CRORE).toFixed(2) + " Cr" : `${o.val} [unit ${o.unit}]`;
        console.log(`     ${pad(tag, 46)} ctx=${pad(o.ctx, 10)} ${pad(period, 34)} dec=${pad(o.dec, 5)} → ${cr}`);
      }
    }
    await sleep(400);
  }
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
