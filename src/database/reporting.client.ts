import { PrismaClient as ReportingPrismaClient } from "@prisma/client-reporting";
import { envConfig } from "../config/env.config";

/**
 * Cấu hình timeout mặc định cho interactive transactions của Reporting Service
 */
export const DEFAULT_REPORTING_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 15000,
} as const;

export const reportingPrisma = new ReportingPrismaClient({
  log:
    envConfig.nodeEnv === "development"
      ? ["query", "error", "warn"]
      : ["error", "warn"],
});
