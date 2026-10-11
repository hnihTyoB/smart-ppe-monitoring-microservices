-- AlterTable
ALTER TABLE "camera_configs" ADD COLUMN IF NOT EXISTS "confidence_threshold" DECIMAL(5,4);
ALTER TABLE "camera_configs" ADD COLUMN IF NOT EXISTS "confirmation_duration" INTEGER;
ALTER TABLE "camera_configs" ADD COLUMN IF NOT EXISTS "cooldown_duration" INTEGER;
ALTER TABLE "camera_configs" ADD COLUMN IF NOT EXISTS "enable_no_helmet" BOOLEAN;
ALTER TABLE "camera_configs" ADD COLUMN IF NOT EXISTS "enable_no_vest" BOOLEAN;
ALTER TABLE "camera_configs" ADD COLUMN IF NOT EXISTS "enable_restricted_area" BOOLEAN;
ALTER TABLE "camera_configs" ADD COLUMN IF NOT EXISTS "model_version_id" UUID;
