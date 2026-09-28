-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "timeOffTypes" TEXT[] DEFAULT ARRAY['vacation', 'sick', 'personal', 'unpaid', 'other']::TEXT[];

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "claimGeneration" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ShiftTradeRequest" ADD COLUMN     "claimGeneration" INTEGER NOT NULL DEFAULT 0;

-- §6.3: at most one pending-or-approved claim per shift, per claimable round.
DROP INDEX IF EXISTS "ShiftTradeRequest_one_active_pickup_per_shift";
CREATE UNIQUE INDEX "ShiftTradeRequest_one_active_pickup_per_shift"
  ON "ShiftTradeRequest" ("shiftId", "claimGeneration")
  WHERE "type" = 'pickup' AND "status" IN ('pending', 'approved');
