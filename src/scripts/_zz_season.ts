import "dotenv/config";
import { resultsScanShouldEnqueue } from "../lib/scheduler.js";
const d=(h:number)=>new Date(Date.UTC(2026,7,17,h,0,0));
for (const h of [0,4,8,12,16,20]) console.log(`  ${String(h).padStart(2,"0")}:00 UTC → ${resultsScanShouldEnqueue(d(h))?"ENQUEUES":"skipped"}`);
const d2=(day:number,h:number)=>new Date(Date.UTC(2026,7,day,h,0,0));
console.log(`  tomorrow 00:00 → ${resultsScanShouldEnqueue(d2(18,0))?"ENQUEUES":"skipped"}`);
