-- CreateTable
CREATE TABLE "stock_overviews" (
    "id"            TEXT         NOT NULL,
    "stock_id"      TEXT         NOT NULL,
    "industry"      TEXT         NOT NULL,
    "listed_since"  INTEGER,
    "core_business" TEXT         NOT NULL,
    "revenue_model" TEXT         NOT NULL,
    "business_tags" TEXT[]       NOT NULL DEFAULT '{}',
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_overviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_overviews_stock_id_key" ON "stock_overviews"("stock_id");

-- AddForeignKey
ALTER TABLE "stock_overviews"
    ADD CONSTRAINT "stock_overviews_stock_id_fkey"
    FOREIGN KEY ("stock_id") REFERENCES "stocks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
