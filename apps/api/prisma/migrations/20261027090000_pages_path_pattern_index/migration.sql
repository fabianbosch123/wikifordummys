-- Präfix-Abfragen auf den Seitenpfad (path LIKE '/a/b/%' beim Verschieben, Löschen und Wiederherstellen)
-- nutzen einen normalen B-Baum-Index nur mit Sortierung C. Mit text_pattern_ops geht es mit jeder Sortierung.

-- DropIndex
DROP INDEX "pages_space_id_path_idx";

-- CreateIndex
CREATE INDEX "pages_space_id_path_idx" ON "pages"("space_id", "path" text_pattern_ops);
