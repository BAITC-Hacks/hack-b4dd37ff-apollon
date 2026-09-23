-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "cutoffDate" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suppliers" JSONB NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "article" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "monthlySales" JSONB NOT NULL,
    "stockHistory" JSONB NOT NULL,
    "currentStock" JSONB NOT NULL,
    "transactions" JSONB NOT NULL,
    "deliveries" JSONB NOT NULL,
    "stockouts" JSONB NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "filter" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "baseRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "quantities" JSONB NOT NULL,
    "approvedKeys" JSONB NOT NULL,
    "approver" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "approver" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "acknowledgedEstimates" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "revision" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "resultId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_contentHash_key" ON "Dataset"("contentHash");

-- CreateIndex
CREATE INDEX "Product_datasetId_supplier_category_idx" ON "Product"("datasetId", "supplier", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Product_datasetId_supplier_code_key" ON "Product"("datasetId", "supplier", "code");

-- CreateIndex
CREATE INDEX "Run_datasetId_createdAt_idx" ON "Run"("datasetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_runId_supplier_key" ON "Order"("runId", "supplier");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_orderId_revision_key" ON "Approval"("orderId", "revision");

-- CreateIndex
CREATE INDEX "AuditEvent_orderId_createdAt_idx" ON "AuditEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
