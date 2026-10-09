-- CreateTable
CREATE TABLE "Website" (
    "id" TEXT NOT NULL DEFAULT vdo_id('site'::text),
    "orgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "gscSiteUrl" TEXT,
    "gaProperty" TEXT,
    "gaPropertyName" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Website_orgId_idx" ON "Website"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Website_orgId_domain_key" ON "Website"("orgId", "domain");

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
