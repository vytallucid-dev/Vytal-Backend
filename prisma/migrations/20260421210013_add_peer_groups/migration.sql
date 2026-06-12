-- CreateTable
CREATE TABLE "peer_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "stock_count" INTEGER NOT NULL DEFAULT 0,
    "build_order" INTEGER,
    "avg_pe_ratio" DECIMAL(10,4),
    "avg_pb_ratio" DECIMAL(10,4),
    "avg_roe" DECIMAL(8,4),
    "avg_roce" DECIMAL(8,4),
    "avg_net_margin" DECIMAL(8,4),
    "avg_debt_to_equity" DECIMAL(8,4),
    "avg_revenue_growth" DECIMAL(8,4),
    "metrics_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_peer_groups" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "peer_group_id" TEXT NOT NULL,

    CONSTRAINT "stock_peer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "peer_groups_sector_id_idx" ON "peer_groups"("sector_id");

-- CreateIndex
CREATE UNIQUE INDEX "peer_groups_sector_id_name_key" ON "peer_groups"("sector_id", "name");

-- CreateIndex
CREATE INDEX "stock_peer_groups_stock_id_idx" ON "stock_peer_groups"("stock_id");

-- CreateIndex
CREATE INDEX "stock_peer_groups_peer_group_id_idx" ON "stock_peer_groups"("peer_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_peer_groups_stock_id_peer_group_id_key" ON "stock_peer_groups"("stock_id", "peer_group_id");

-- AddForeignKey
ALTER TABLE "peer_groups" ADD CONSTRAINT "peer_groups_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_peer_groups" ADD CONSTRAINT "stock_peer_groups_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_peer_groups" ADD CONSTRAINT "stock_peer_groups_peer_group_id_fkey" FOREIGN KEY ("peer_group_id") REFERENCES "peer_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
