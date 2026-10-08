import { PrismaClient as IncidentPrismaClient } from "@prisma/client-incident";
import { envConfig } from "../config/env.config";

/**
 * Cấu hình timeout mặc định cho interactive transactions của Incident Service
 */
export const DEFAULT_INCIDENT_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 15000,
} as const;

export const incidentPrisma = new IncidentPrismaClient({
  log:
    envConfig.nodeEnv === "development"
      ? ["query", "error", "warn"]
      : ["error", "warn"],
});
