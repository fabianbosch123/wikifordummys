-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('system', 'light', 'dark');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "theme" "ThemePreference" NOT NULL DEFAULT 'system';
