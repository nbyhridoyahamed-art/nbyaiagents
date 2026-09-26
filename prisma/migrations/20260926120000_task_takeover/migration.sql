-- Human takeover: a person can take a task over from an AI employee.
ALTER TABLE "Task" ADD COLUMN "assigneeUserId" TEXT;
ALTER TABLE "Task" ADD COLUMN "takenOverAt" TIMESTAMP(3);

CREATE INDEX "Task_orgId_assigneeUserId_idx" ON "Task"("orgId", "assigneeUserId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
