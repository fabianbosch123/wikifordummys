-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "office_key" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "attachment_versions" (
    "id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachment_versions_storage_key_key" ON "attachment_versions"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_versions_attachment_id_version_key" ON "attachment_versions"("attachment_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_office_key_key" ON "attachments"("office_key");

-- AddForeignKey
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Vorhandene Anhänge: die bisherige Datei wird Fassung 1
UPDATE "attachments" SET "updated_at" = "created_at";
INSERT INTO "attachment_versions" ("id", "attachment_id", "version", "mime_type", "size_bytes", "storage_key", "sha256", "created_by", "created_at")
SELECT gen_random_uuid(), "id", 1, "mime_type", "size_bytes", "storage_key", "sha256", "uploaded_by", "created_at" FROM "attachments";
