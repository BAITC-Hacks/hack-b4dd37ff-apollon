BEGIN;

-- CreateTable
CREATE TABLE "SourceWorkbook" (
    "id" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "originalBytes" BYTEA NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceWorkbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSheet" (
    "id" TEXT NOT NULL,
    "workbookId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "dimension" TEXT,
    "attributes" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "SourceSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRow" (
    "sheetId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "attributes" JSONB NOT NULL,
    "cells" JSONB NOT NULL,
    "extra" JSONB NOT NULL,

    CONSTRAINT "SourceRow_pkey" PRIMARY KEY ("sheetId","ordinal")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceWorkbook_supplier_sha256_parserVersion_key" ON "SourceWorkbook"("supplier", "sha256", "parserVersion");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSheet_workbookId_ordinal_key" ON "SourceSheet"("workbookId", "ordinal");

-- AddForeignKey
ALTER TABLE "SourceSheet" ADD CONSTRAINT "SourceSheet_workbookId_fkey" FOREIGN KEY ("workbookId") REFERENCES "SourceWorkbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRow" ADD CONSTRAINT "SourceRow_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "SourceSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
