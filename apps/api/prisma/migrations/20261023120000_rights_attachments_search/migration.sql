-- CreateEnum
CREATE TYPE "SpaceRole" AS ENUM ('admin', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "RestrictionType" AS ENUM ('view', 'edit');

-- AlterTable: Suchindex als generierte Spalte, PostgreSQL hält ihn bei jeder Änderung aktuell
ALTER TABLE "pages" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('german'::regconfig, "title"), 'A') ||
  setweight(to_tsvector('german'::regconfig, "content_text"), 'B')
) STORED;

-- CreateTable
CREATE TABLE "space_permissions" (
    "id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "group_id" UUID,
    "user_id" UUID,
    "role" "SpaceRole" NOT NULL,

    CONSTRAINT "space_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_restrictions" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "type" "RestrictionType" NOT NULL,
    "group_id" UUID,
    "user_id" UUID,

    CONSTRAINT "page_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "space_permissions_group_id_idx" ON "space_permissions"("group_id");

-- CreateIndex
CREATE INDEX "space_permissions_user_id_idx" ON "space_permissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "space_permissions_space_id_group_id_key" ON "space_permissions"("space_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "space_permissions_space_id_user_id_key" ON "space_permissions"("space_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_restrictions_page_id_type_group_id_key" ON "page_restrictions"("page_id", "type", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_restrictions_page_id_type_user_id_key" ON "page_restrictions"("page_id", "type", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_page_id_idx" ON "attachments"("page_id");

-- CreateIndex
CREATE INDEX "pages_search_vector_idx" ON "pages" USING GIN ("search_vector");

-- AddForeignKey
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Genau eins von Gruppe und Benutzer
ALTER TABLE "space_permissions" ADD CONSTRAINT "space_permissions_subject_check" CHECK (num_nonnulls("group_id", "user_id") = 1);
ALTER TABLE "page_restrictions" ADD CONSTRAINT "page_restrictions_subject_check" CHECK (num_nonnulls("group_id", "user_id") = 1);
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_size_check" CHECK ("size_bytes" >= 0);

-- Bestehende Spaces behalten das Verhalten aus Meilenstein 2:
-- der Ersteller ist Space-Admin, alle aktiven Benutzer (Gruppe alle-benutzer) sind Bearbeiter
INSERT INTO "space_permissions" ("id", "space_id", "user_id", "role")
SELECT gen_random_uuid(), "id", "created_by", 'admin' FROM "spaces" WHERE "created_by" IS NOT NULL;

INSERT INTO "space_permissions" ("id", "space_id", "group_id", "role")
SELECT gen_random_uuid(), s."id", g."id", 'editor' FROM "spaces" s CROSS JOIN "groups" g WHERE g."name" = 'alle-benutzer';
