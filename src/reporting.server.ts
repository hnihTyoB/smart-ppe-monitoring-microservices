import "dotenv/config";
import dns from "node:dns";

// Force IPv4-first resolution in Node.js runtime to prevent ENETUNREACH on platforms without IPv6 routing
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Graceful fallback if not supported in runtime
}

import reportingApp from "./reporting.app";
import { envConfig } from "./config/env.config";
import { reportingPrisma } from "./database/reporting.client";

const PORT = envConfig.reporting.port || 8894;

/**
 * Reporting & Analytics Microservice Process (:8894)
 *
 * Chịu trách nhiệm độc quyền:
 * 1. Phục vụ HTTP API cho Dashboard KPIs, Time-Series Trends, Violation Breakdown, Camera Rankings
 * 2. Tiếp nhận AI Performance telemetry và chốt dữ liệu thống kê hàng ngày (Daily Rollup)
 * 3. Quản lý Mẫu báo cáo và sinh báo cáo định kỳ
 * 4. Quản lý danh mục mô hình AI (YOLO) và quản trị phiên bản mô hình
 * 5. Tương tác trực tiếp với cơ sở dữ liệu ppe_reporting_db
 * 6. Hoạt động sau Traefik reverse proxy hoặc Standalone
 */
export const server = reportingApp.listen(PORT, () => {
  console.log(
    `[Reporting Service] Running on http://localhost:${PORT} in ${envConfig.nodeEnv} mode`,
  );
  console.log(
    `[Reporting Service] ✅ Listening for reports, statistics and AI model governance on port ${PORT}`,
  );
});

let isShuttingDown = false;

export async function handleReportingShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(
    `\n[Reporting Service] Received ${signal}. Starting graceful shutdown...`,
  );

  const forceExitTimer = setTimeout(() => {
    console.error(
      "[Reporting Service] Graceful shutdown timed out (10s). Forcing termination.",
    );
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  try {
    // 1. Close idle HTTP connections
    if (typeof server.closeIdleConnections === "function") {
      server.closeIdleConnections();
    }

    // 2. Stop accepting new HTTP requests
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          console.error("[Reporting Service] Error closing HTTP server:", err);
        } else {
          console.log("[Reporting Service] Closed HTTP server successfully.");
        }
        resolve();
      });
    });

    // 3. Disconnect database client
    await reportingPrisma.$disconnect().catch((err: unknown) => {
      console.warn(
        "[Reporting Service] Error disconnecting reportingPrisma:",
        (err as Error)?.message || err,
      );
    });
    console.log("[Reporting Service] Disconnected from reporting database.");

    clearTimeout(forceExitTimer);
    console.log("[Reporting Service] Graceful shutdown completed.");
    process.exit(0);
  } catch (error) {
    console.error("[Reporting Service] Error during graceful shutdown:", error);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void handleReportingShutdown("SIGTERM"));
process.on("SIGINT", () => void handleReportingShutdown("SIGINT"));
