import { PrismaClient as SitePrismaClient } from "@prisma/client-site";
import { envConfig } from "../config/env.config";

/**
 * Cấu hình timeout mặc định cho interactive transactions của Site Service
 */
export const DEFAULT_SITE_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 15000,
} as const;

export const sitePrisma = new SitePrismaClient({
  log:
    envConfig.nodeEnv === "development"
      ? ["query", "error", "warn"]
      : ["error", "warn"],
});
