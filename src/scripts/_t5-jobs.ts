import "dotenv/config";
import { prisma } from "../db/prisma.js";
const r = await prisma.$queryRawUnsafe(`SELECT "type", "status", count(*)::int n FROM background_jobs
  WHERE "created_at" > TIMESTAMP '2026-08-16 09:30:00' GROUP BY 1,2 ORDER BY 3 DESC`);
console.log(JSON.stringify(r));
await prisma.$disconnect();
