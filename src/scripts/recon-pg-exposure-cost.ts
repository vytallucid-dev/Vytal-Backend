import { prisma } from "../db/prisma.js";
import { probeStockRelationship } from "../ai/insight/relationship.js";
import { holdsPositiveQuantity } from "../relational/reader-context.js";
import { getPeerGroupMembers } from "../scoring/read/peer-group-lookup.js";

const main = async () => {
  const pg = await prisma.peerGroup.findFirst({ where: { displayName: "Large-Cap Pharma" }, select: { id: true } });
  const user = await prisma.user.findFirst({ where: { email: "amankamaljain@gmail.com" }, select: { id: true } });
  if (!pg || !user) return console.log("missing fixture");

  const t0 = Date.now();
  const members = await getPeerGroupMembers(pg.id);
  console.log(`getPeerGroupMembers: ${members.length} members in ${Date.now() - t0} ms`);

  for (const round of [1, 2, 3]) {
    const t = Date.now();
    const res = await Promise.all(
      members.map(async (m) => {
        const probe = await probeStockRelationship(user.id, m.stockId);
        if (probe.held && (await holdsPositiveQuantity(user.id, m.stockId))) return "held";
        if (probe.watchlist) return "watching";
        return "none";
      }),
    );
    console.log(
      `round ${round}: reuse path (probeStockRelationship + holdsPositiveQuantity) over ${members.length} members → ${Date.now() - t} ms  [${res.filter((r) => r === "held").length} held, ${res.filter((r) => r === "watching").length} watching]`,
    );
  }

  // Same answer via ONE grouped read, for the cost comparison.
  for (const round of [1, 2, 3]) {
    const t = Date.now();
    const rows = await prisma.$queryRaw<{ stock_id: string; watched: boolean; held: boolean }[]>`
      SELECT m.stock_id,
        EXISTS (SELECT 1 FROM watchlist w WHERE w.user_id = ${user.id} AND w.stock_id = m.stock_id) AS watched,
        (EXISTS (SELECT 1 FROM holdings h WHERE h.user_id = ${user.id} AND h.stock_id = m.stock_id AND h.quantity > 0)
         OR EXISTS (SELECT 1 FROM broker_holdings b WHERE b.user_id = ${user.id} AND b.stock_id = m.stock_id AND b.quantity > 0)) AS held
      FROM (SELECT unnest(${members.map((m) => m.stockId)}::text[]) AS stock_id) m
    `;
    console.log(`round ${round}: one grouped read → ${Date.now() - t} ms  [${rows.filter((r) => r.held).length} held, ${rows.filter((r) => r.watched && !r.held).length} watching]`);
  }
};
main().catch(console.error).finally(() => prisma.$disconnect());
