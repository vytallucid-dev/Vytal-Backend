// TWR correctness: cash-flow-neutrality (a deposit/sell does NOT move return), geometric
// chaining, indexed to 100 at start; then arman's real book (honest, not the raw-rebase ~613%).
import { prisma } from "../db/prisma.js";
import { walkNav, type NavLedgerTxn, type NavPricePoint } from "../portfolio/nav/engine.js";
import { computeTwr } from "../portfolio/nav/twr.js";
import { computePortfolioTwr } from "../portfolio/nav/assemble.js";

let fail = 0;
const assert = (name: string, cond: boolean, detail: string) => { console.log(`  ${cond?"✅":"❌"} ${name} — ${detail}`); if(!cond) fail++; };
const near = (a: number|null|undefined, b: number, eps=1e-6) => a!=null && Math.abs(a-b)<eps;
const buy = (symbol:string, quantity:number, tradeDate:string):NavLedgerTxn => ({symbol,type:"buy",quantity,ratio:null,tradeDate});
const sell = (symbol:string, quantity:number, tradeDate:string):NavLedgerTxn => ({symbol,type:"sell",quantity,ratio:null,tradeDate});
const pm = (o:Record<string,[string,number][]>) => { const m=new Map<string,NavPricePoint[]>(); for(const[s,pts]of Object.entries(o)) m.set(s,pts.map(([date,close])=>({date,close}))); return m; };
const twr = (l:NavLedgerTxn[], p:Map<string,NavPricePoint[]>) => computeTwr(walkNav(l,p));
const at = (r:any,date:string)=>r.series.find((x:any)=>x.date===date)?.twrIndex;

console.log("═══ TWR ENGINE ═══");

// A — indexed to 100 at start
const A = twr([buy("A",10,"2024-01-01")], pm({A:[["2024-01-01",100],["2024-01-02",110],["2024-01-03",121]]}));
console.log("\nA — buy, price +10%/day:");
assert("index starts at 100", near(A.series[0].twrIndex,100), `${A.series[0].twrIndex}`);
assert("chains geometrically 110 then 121", near(at(A,"2024-01-02"),110) && near(at(A,"2024-01-03"),121), `${at(A,"2024-01-02")}/${at(A,"2024-01-03")}`);
assert("totalTwrPct = 21", near(A.totalTwrPct,21), `${A.totalTwrPct}`);

// B — THE CRITICAL TEST: a pure deposit on flat prices does NOT move TWR
const B = twr([buy("A",10,"2024-01-01"), buy("A",10,"2024-01-03")], pm({A:[["2024-01-01",100],["2024-01-02",100],["2024-01-03",100],["2024-01-04",100]]}));
console.log("\nB — deposit (2nd buy) on FLAT prices (value 1000→2000):");
assert("value doubled but TWR stays 100 (deposit ≠ return)", near(at(B,"2024-01-03"),100) && near(at(B,"2024-01-04"),100), `${at(B,"2024-01-03")}/${at(B,"2024-01-04")}`);
assert("totalTwrPct = 0", near(B.totalTwrPct,0), `${B.totalTwrPct}`);

// C — deposit does NOT dilute real return: 10% then deposit then 10% → 21% (not the raw 142%)
const C = twr([buy("A",10,"2024-01-01"), buy("A",10,"2024-01-02")], pm({A:[["2024-01-01",100],["2024-01-02",110],["2024-01-03",121]]}));
console.log("\nC — +10%, deposit at close, +10% (raw value 1000→2420 = +142%):");
assert("TWR = 21% (true perf, deposit stripped)", near(C.totalTwrPct,21,1e-4), `${C.totalTwrPct}`);

// D — a sell (withdrawal) is also neutral on flat prices
const D = twr([buy("A",20,"2024-01-01"), sell("A",10,"2024-01-02")], pm({A:[["2024-01-01",100],["2024-01-02",100],["2024-01-03",100]]}));
console.log("\nD — sell 10 of 20 on flat prices:");
assert("withdrawal ≠ return (TWR stays 100)", near(at(D,"2024-01-02"),100) && near(at(D,"2024-01-03"),100), `${at(D,"2024-01-02")}/${at(D,"2024-01-03")}`);

// ═══ arman's real book ═══
console.log("\n═══ REAL BOOK (arman) ═══");
const user = await prisma.user.findFirst({ where:{email:"arman.shaikh01082003@gmail.com"}, select:{id:true} });
if (!user) { console.log("  (no arman user — skipping)"); }
else {
  const r = await computePortfolioTwr(user.id);
  console.log(`  TWR span ${r.firstDate} → ${r.lastDate} (${r.series.length} pts, ${Math.round(r.days)} days)`);
  console.log(`  total TWR ${r.totalTwrPct}%  ·  annualized ${r.annualizedPct}%`);
  console.log(`  index: start ${r.series[0]?.twrIndex}  last ${r.series[r.series.length-1]?.twrIndex}`);
  assert("indexed to 100 at start", near(r.series[0]?.twrIndex,100), `${r.series[0]?.twrIndex}`);
  assert("HONEST: total TWR far below the raw-rebase +613%", (r.totalTwrPct ?? 0) < 200, `${r.totalTwrPct}% (raw-rebase falsely showed ~+613%)`);
}

console.log(`\n═══ ${fail===0?"ALL PASS ✅":fail+" FAIL ❌"} ═══`);
await prisma.$disconnect();
process.exit(fail===0?0:1);
