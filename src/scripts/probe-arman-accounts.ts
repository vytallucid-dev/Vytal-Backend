// TEMP PROBE — arman's accounts: state, ledger presence, broker holdings. Read-only.
import { prisma } from "../db/prisma.js";

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "arman.shaikh01082003@gmail.com" },
    select: { id: true, email: true },
  });
  if (!user) {
    console.log("no arman user by that email — searching for any user with accounts…");
    const anyUsers = await prisma.user.findMany({ select: { id: true, email: true }, take: 20 });
    console.log(anyUsers);
    return;
  }
  console.log(`user ${user.email} (${user.id})`);

  const accounts = await prisma.portfolioAccount.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      broker: true,
      state: true,
      brokerConnectionId: true,
      _count: { select: { transactions: true, holdings: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const a of accounts) {
    const brokerHoldingCount = a.brokerConnectionId
      ? await prisma.brokerHolding.count({ where: { brokerConnectionId: a.brokerConnectionId } })
      : 0;
    console.log(
      `  · ${a.name} [${a.state}] broker=${a.broker} conn=${a.brokerConnectionId ?? "—"} ` +
        `txns=${a._count.transactions} manualHoldings=${a._count.holdings} brokerHoldings=${brokerHoldingCount} id=${a.id}`,
    );
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
