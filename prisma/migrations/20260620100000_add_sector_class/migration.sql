-- CreateEnum
CREATE TYPE "SectorClass" AS ENUM ('Quality', 'Defensive', 'Commodity', 'Cyclical', 'Growth', 'PSU');

-- AlterTable
ALTER TABLE "sectors" ADD COLUMN "sector_class" "SectorClass";
