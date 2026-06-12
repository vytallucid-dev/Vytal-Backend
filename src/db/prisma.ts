import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = `${process.env.DATABASE_URL}`;

const pool = new Pool({
  connectionString,
  // Keep TCP connections alive so the OS/network doesn't silently drop them.
  keepAlive: true,
  // Discard idle connections after 30 s — must be shorter than the server's
  // idle_in_transaction_session_timeout / any proxy timeout (often 60 s).
  idleTimeoutMillis: 30_000,
  // Limit pool size; the worker is single-threaded so 5 is plenty.
  max: 5,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export { prisma };
