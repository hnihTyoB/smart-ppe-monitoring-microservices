-- CreateTable
CREATE TABLE IF NOT EXISTS "email_notifications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID,
    "to_email" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "template_key" VARCHAR(100) NOT NULL,
    "template_data" JSONB NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "email_notifications_status_attempts_created_at_idx" ON "email_notifications"("status", "attempts", "created_at");
CREATE INDEX IF NOT EXISTS "email_notifications_user_id_idx" ON "email_notifications"("user_id");
CREATE INDEX IF NOT EXISTS "email_notifications_to_email_idx" ON "email_notifications"("to_email");
