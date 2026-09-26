-- Workflow run lease (single advancing worker), progress and final output.
ALTER TABLE "WorkflowRun" ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkflowRun" ADD COLUMN "output" JSONB;
ALTER TABLE "WorkflowRun" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "WorkflowRun" ADD COLUMN "leaseUntil" TIMESTAMP(3);
ALTER TABLE "WorkflowRun" ADD COLUMN "parentRunId" TEXT;
