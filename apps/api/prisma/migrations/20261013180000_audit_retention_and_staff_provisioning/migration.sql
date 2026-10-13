-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'STAFF_PASSWORD_ESTABLISHED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "is_pending_setup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "setup_token_digest" VARCHAR(64),
ADD COLUMN "setup_token_expires_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "users_setup_token_digest_idx" ON "users"("setup_token_digest");

-- AlterTable audit_logs: replace CASCADE with SET NULL referential integrity
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_target_id_fkey";

ALTER TABLE "audit_logs" ALTER COLUMN "target_id" DROP NOT NULL;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
