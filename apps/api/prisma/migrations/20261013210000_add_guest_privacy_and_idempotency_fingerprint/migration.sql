-- AlterTable
ALTER TABLE "orders" ADD COLUMN "guest_token_hash" VARCHAR(64);
ALTER TABLE "orders" ADD COLUMN "request_fingerprint" VARCHAR(64);

-- CreateIndex
CREATE INDEX "orders_guest_token_hash_idx" ON "orders"("guest_token_hash");
