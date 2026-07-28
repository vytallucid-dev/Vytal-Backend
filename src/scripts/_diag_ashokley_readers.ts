// THROWAWAY — READ-ONLY. Deleted at end of session.
import { prisma } from "../db/prisma.js";

async function main() {
  const stock = await prisma.stock.findFirst({ where: { symbol: "ASHOKLEY" }, select: { id: true } });
  if (!stock) { console.log("not found"); return; }
  const holders = await prisma.$queryRaw<{ user_id: string; quantity: string }[]>`
    SELECT user_id, quantity::text FROM holdings WHERE stock_id = ${stock.id} AND quantity > 0`;
  console.log("Holders:", JSON.stringify(holders));

  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%watch%'`;
  console.log("Watch-related tables:", JSON.stringify(tables));
  await prisma.$disconnect();
}
main();
