-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_user_id_fkey";
ALTER TABLE "email_notifications" DROP CONSTRAINT IF EXISTS "email_notifications_user_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "notifications";
DROP TABLE IF EXISTS "email_notifications";
DROP TABLE IF EXISTS "notification_templates";
