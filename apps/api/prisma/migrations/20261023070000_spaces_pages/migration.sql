-- CreateEnum
CREATE TYPE "SpaceStatus" AS ENUM ('active', 'archived');

-- CreateTable
CREATE TABLE "spaces" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "SpaceStatus" NOT NULL DEFAULT 'active',
    "home_page_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "parent_id" UUID,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "content_text" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_versions" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "content_text" TEXT NOT NULL,
    "author_id" UUID,
    "restored_from" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spaces_key_key" ON "spaces"("key");

-- CreateIndex
CREATE UNIQUE INDEX "spaces_home_page_id_key" ON "spaces"("home_page_id");

-- CreateIndex
CREATE INDEX "pages_space_id_parent_id_idx" ON "pages"("space_id", "parent_id");

-- CreateIndex
CREATE INDEX "pages_space_id_path_idx" ON "pages"("space_id", "path");

-- CreateIndex
CREATE INDEX "pages_deleted_at_idx" ON "pages"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "page_versions_page_id_version_key" ON "page_versions"("page_id", "version");

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_home_page_id_fkey" FOREIGN KEY ("home_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Versionen sind unveränderlich; entfernt werden sie nur mit ihrer Seite (Papierkorb nach 30 Tagen)
CREATE FUNCTION page_versions_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'page_versions ist unveränderlich';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER page_versions_no_update
  BEFORE UPDATE ON "page_versions"
  FOR EACH ROW EXECUTE FUNCTION page_versions_no_update();

ALTER TABLE "pages" ADD CONSTRAINT "pages_position_check" CHECK ("position" >= 0);
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_key_check" CHECK ("key" ~ '^[A-Z][A-Z0-9]{1,9}$');
