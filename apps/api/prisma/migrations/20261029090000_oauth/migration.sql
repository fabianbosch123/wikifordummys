-- OAuth für den MCP-Server (claude.ai-Connector): Clients und Felder für Access- und Refresh-Tokens
-- AlterTable
ALTER TABLE "api_tokens" ADD COLUMN     "access_expires_at" TIMESTAMP(3),
ADD COLUMN     "client_id" UUID,
ADD COLUMN     "refresh_hash" TEXT;

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "secret_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_ip" TEXT,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_refresh_hash_key" ON "api_tokens"("refresh_hash");

-- CreateIndex
CREATE INDEX "api_tokens_client_id_idx" ON "api_tokens"("client_id");

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

