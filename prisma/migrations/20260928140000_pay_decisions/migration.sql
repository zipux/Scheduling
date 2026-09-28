-- AlterTable
ALTER TABLE "BreakRule" DROP COLUMN "paidWhenNotTaken";

-- AlterTable
ALTER TABLE "PayRules" ADD COLUMN "holidayPremiumRequiresEligibility" BOOLEAN NOT NULL DEFAULT false;
