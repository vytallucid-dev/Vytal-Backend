import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchFilingsList, fetchXbrlFile, groupFilingsByQuarter, pickFilingsPerBasisV2 } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
const t = async <T>(f: () => Promise<T>): Promise<[T, number]> => { const a = Date.now(); const r = await f(); return [r, Date.now() - a]; };
const stats = (x: number[]) => { const s = [...x].sort((a,b)=>a-b); return { n:x.length, mean: Math.round(x.reduce((a,b)=>a+b,0)/x.length), p50: s[Math.floor(s.length/2)], min: s[0], max: s[s.length-1] }; };

const listingMs: number[] = [], xbrlMs: number[] = [];
for (const sym of ["BHARATFORG", "HAVELLS", "TITAN"]) {
  const [filings, ms] = await t(() => fetchFilingsList(sym, "Annual"));
  listingMs.push(ms);
  const groups = [...groupFilingsByQuarter(filings).values()].slice(0, 4);
  for (const g of groups) {
    for (const { filing } of pickFilingsPerBasisV2(g, g[0].fromDate, g[0].toDate)) {
      try { const [, xms] = await t(() => fetchXbrlFile(filing.xbrl)); xbrlMs.push(xms); }
      catch { /* skip */ }
    }
  }
}
console.log("listing call ms:", JSON.stringify(stats(listingMs)));
console.log("XBRL fetch ms:  ", JSON.stringify(stats(xbrlMs)));
await prisma.$disconnect();
