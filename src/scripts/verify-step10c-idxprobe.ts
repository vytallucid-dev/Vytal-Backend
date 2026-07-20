// STEP 10c — THE DECIDING QUESTION before firing the backfill.
//
// index_prices spans 5 y overall, but the RISK-FREE series (Nifty 1D Rate / 10y G-Sec) hold only
// ~250 points (~1 y). A 1,825-day INDEX_PRICES_BACKFILL only helps if NSE's OLD archive files
// actually CONTAIN those index rows. If they do not, firing it is hope, not engineering.
//
// The provider's real URL (from nse-index-bhavcopy.ts):
//   https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv   (numeric month)
// npx tsx src/scripts/verify-step10c-idxprobe.ts
import { prisma } from "../db/prisma.js";
import https from "https";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/csv,application/octet-stream,*/*",
        },
      },
      (res) => {
        const c: Buffer[] = [];
        res.on("data", (x: Buffer) => c.push(x));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(c).toString("utf-8") }),
        );
      },
    );
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.setTimeout(30_000, () => req.destroy());
  });
}

// ── 1. Depth + provenance: who is deep, who is shallow, and who wrote them ──
hdr("1. WHY is the risk-free series shallow when index_prices spans 5 y?");
const prov = await prisma.$queryRawUnsafe<any[]>(`
  SELECT provider, count(*) n, count(DISTINCT index_name) names, min(date) mn, max(date) mx
  FROM index_prices GROUP BY 1 ORDER BY 2 DESC`);
for (const p of prov) {
  console.log(
    `  ${String(p.provider).padEnd(18)} ${String(p.n).padStart(6)} rows  ${String(p.names).padStart(3)} indices  ` +
      `${String(p.mn).slice(4, 15)} → ${String(p.mx).slice(4, 15)}`,
  );
}
console.log(`\n  ⇒ the 5-year depth belongs to yahoo-finance (9 equity indices only).`);
console.log(`    Everything from nse-index-csv — INCLUDING both risk-free series — is ~1 y deep.`);
console.log(`    So the depth is bounded by how far the NSE archive has been WALKED, not by Yahoo.`);

// ── 2. Do the OLD NSE archive files carry the risk-free rows at all? ──
hdr("2. Is the risk-free index PRESENT in the old NSE archive files?");
const probes: [string, Date][] = [
  ["~2 weeks", new Date(Date.now() - 14 * 86400000)],
  ["~1 year", new Date(Date.now() - 400 * 86400000)],
  ["~2 years", new Date(Date.now() - 2 * 365 * 86400000)],
  ["~3 years", new Date(Date.now() - 3 * 365 * 86400000)],
  ["~4 years", new Date(Date.now() - 4 * 365 * 86400000)],
  ["~5 years", new Date(Date.now() - 5 * 365 * 86400000)],
];

for (const [label, d] of probes) {
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  const r = await get(
    `https://nsearchives.nseindia.com/content/indices/ind_close_all_${dd}${mm}${yy}.csv`,
  );
  const lines = r.body.split(/\r?\n/).filter((l) => l.trim());
  const isCsv = r.status === 200 && /Index Name/i.test(lines[0] ?? "");
  const rf1 = lines.find((l) => /Nifty 1D Rate/i.test(l));
  const rf2 = lines.find((l) => /10 yr Benchmark G-Sec/i.test(l));
  console.log(
    `  ${label.padEnd(9)} ${dd}-${mm}-${yy}: HTTP ${String(r.status).padEnd(3)} ` +
      (isCsv ? `${String(lines.length - 1).padStart(3)} index rows` : "NOT A CSV   ") +
      `   1D-Rate ${rf1 ? "✅" : "❌"}   10y-G-Sec ${rf2 ? "✅" : "❌"}`,
  );
  if (rf1) console.log(`      ${rf1.slice(0, 88)}`);
}

console.log(`\n  ⇒ If the risk-free rows are PRESENT in old files, the 1,825-day backfill will`);
console.log(`    deepen them and 3Y/5Y Sharpe lights up. If ABSENT, no backfill can conjure them`);
console.log(`    and ruling ③ needs a different source — that would be a finding, not a failure.`);

await prisma.$disconnect();
