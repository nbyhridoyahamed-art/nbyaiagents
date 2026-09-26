-- Marks the seeded sample workspace so the UI can label its data as demo data.
ALTER TABLE "Organization" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
