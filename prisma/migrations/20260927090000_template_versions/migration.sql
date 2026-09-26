-- Remember which template (and version) employees and workflows were installed from.
ALTER TABLE "Agent" ADD COLUMN "templateKey" TEXT;
ALTER TABLE "Agent" ADD COLUMN "templateVersion" INTEGER;
ALTER TABLE "Workflow" ADD COLUMN "templateVersion" INTEGER;
