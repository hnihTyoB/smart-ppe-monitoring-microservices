import { PrismaClient as NotificationPrismaClient } from "@prisma/client-notification";
import { envConfig } from "../config/env.config";

/**
 * Cấu hình timeout mặc định cho interactive transactions của Notification Service
 */
export const DEFAULT_NOTIFICATION_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 15000,
} as const;

export const notificationPrisma = new NotificationPrismaClient({
  log:
    envConfig.nodeEnv === "development"
      ? ["query", "error", "warn"]
      : ["error", "warn"],
});
