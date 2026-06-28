import { prisma } from "./src/db/prisma.js";
const byType = await prisma.corporateEvent.groupBy({ by:["eventType"], _count:{_all:true} });
console.log("TYPE DISTRIBUTION:", byType.map(t=>`${t.eventType}:${t._count._all}`).join(" "));
const nullDiv = await prisma.corporateEvent.findMany({ where:{ eventType:"dividend", dividendAmount:null }, take:4, select:{symbol:true,eventDate:true,exDate:true,description:true,impactLevel:true} });
console.log("\nNULL-AMOUNT DIVIDENDS:", nullDiv.length, JSON.stringify(nullDiv,null,1));
const bm = await prisma.corporateEvent.findMany({ where:{ eventType:{in:["board_meeting","agm","buyback"]} }, take:6, select:{symbol:true,eventType:true,eventDate:true,description:true} });
console.log("\nBOARD/AGM/BUYBACK:", JSON.stringify(bm,null,1));
// stocks with zero events
const totalStocks = await prisma.stock.count({ where:{ isActive:true } });
const withEvents = await prisma.corporateEvent.findMany({ distinct:["symbol"], select:{symbol:true} });
console.log("\nactive stocks:",totalStocks," stocks with >=1 event:",withEvents.length);
const evSet = new Set(withEvents.map(e=>e.symbol));
const noneEx = await prisma.stock.findMany({ where:{ isActive:true, symbol:{ notIn:[...evSet] } }, take:3, select:{symbol:true,name:true} });
console.log("NO-EVENT stock examples:", JSON.stringify(noneEx));
await prisma.$disconnect();
