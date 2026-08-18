import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const CR=1e7; const pad=(s:unknown,n:number)=>String(s).padEnd(n);
function occ(xml:string,tag:string){const o:{ctx:string;val:number;unit:string;dec:string}[]=[];
  const re=new RegExp(`<in-bse-fin:${tag}\b([^>]*)>([^<]*)</in-bse-fin:${tag}>`,"gi");let m;
  while((m=re.exec(xml))!==null){const u=/unitRef="([^"]+)"/.exec(m[1])?.[1]??"-";
    o.push({ctx:/contextRef="([^"]+)"/.exec(m[1])?.[1]??"-",val:parseFloat(m[2]),unit:u,dec:/decimals="([^"]+)"/.exec(m[1])?.[1]??"-"});}
  return o;}
const TAGS=["RevenueFromOperations","ProfitLossForPeriod","CashFlowsFromUsedInOperatingActivities"];
// FY21 (CF under OneD) vs FY23 (CF under FourD) for the SAME company — magnitude decides the semantics.
for (const [sym,fys] of [["ULTRACEMCO",["FY21","FY22","FY23"]],["BHARTIARTL",["FY21","FY23"]],["PIDILITIND",["FY21","FY23"]]] as const) {
  for (const fy of fys) {
    const [p]=await raw<any>(`SELECT f."xbrl_url", f."revenue"::float8 rev, f."cash_from_operating"::float8 cfo
      FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
      WHERE st."symbol"=$1 AND f."fiscal_year"=$2 AND f."result_type"='standalone'`,sym,fy);
    if(!p){console.log(`${sym} ${fy}: no row`);continue;}
    let xml:string; try{xml=await fetchXbrlFile(p.xbrl_url);}catch(e){console.log(`${sym} ${fy}: unreachable`);continue;}
    console.log(`\n── ${sym} ${fy}   DB revenue=${p.rev} Cr  cfo=${p.cfo===null?"NULL":p.cfo}`);
    for(const t of TAGS){
      const os=occ(xml,t);
      if(!os.length){console.log(`     ${pad(t,42)} (absent)`);continue;}
      for(const o of os) console.log(`     ${pad(t,42)} ctx=${pad(o.ctx,8)} dec=${pad(o.dec,4)} ${o.unit==="INR"?(o.val/CR).toFixed(2)+" Cr":o.val+" ["+o.unit+"]"}`);
    }
    // ratio test: OneD vs FourD revenue tells us what One means in THIS document
    const rev=occ(xml,"RevenueFromOperations");
    const one=rev.find(r=>r.ctx==="OneD")?.val, four=rev.find(r=>r.ctx==="FourD")?.val;
    if(one&&four) console.log(`     ⇒ revenue OneD/FourD = ${(one/four).toFixed(3)}  → OneD is ${one/four>0.8?"the SAME period as FourD":"a SUB-period (≈ one quarter)"}`);
    await new Promise(r=>setTimeout(r,400));
  }
}
await prisma.$disconnect();
