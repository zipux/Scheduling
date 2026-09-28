-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
