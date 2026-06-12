-- CreateEnum
CREATE TYPE "FiscalYearEnd" AS ENUM ('march', 'december');

-- AlterTable
ALTER TABLE "stocks" ADD COLUMN     "fiscalYearEnd" "FiscalYearEnd" NOT NULL DEFAULT 'march';
