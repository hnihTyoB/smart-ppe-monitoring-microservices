import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import {
  errorMiddleware,
  notFoundMiddleware,
} from "./middlewares/error.middleware";
import {
  statisticRouter,
  reportRouter,
  aiModelRouter,
} from "./modules/reporting/reporting.route";
import { rateLimitMiddleware } from "./middlewares/rate-limit.middleware";
import { requestIdMiddleware } from "./middlewares/request-id.middleware";
import { maintenanceGuard } from "./middlewares/maintenance.middleware";
import { envConfig } from "./config/env.config";

/**
 * Express Application cho Reporting & Analytics Microservice (:8894)
 *
 * Đảm nhiệm:
 * - REST API cho thống kê & KPI Dashboard (/api/v1/statistics/*)
 * - REST API cho mẫu báo cáo & sinh báo cáo (/api/v1/reports/*)
 * - REST API cho quản trị mô hình AI & versioning (/api/v1/ai-models/*)
 * - Health check cho Traefik Reverse Proxy load balancer
 */
const reportingApp = express();

reportingApp.set("trust proxy", envConfig.trustProxy);

// 1. Distributed Tracing & Security Headers
reportingApp.use(requestIdMiddleware);
reportingApp.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }),
);

// 2. CORS Handling
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowed = envConfig.cors.allowedOrigins.map((o) =>
      o.replace(/\/+$/, ""),
    );
    if (!origin) {
      callback(null, true);
      return;
    }
    const cleanOrigin = origin.replace(/\/+$/, "");
    if (allowed.includes("*")) {
      if (envConfig.nodeEnv !== "production") {
        callback(null, true);
        return;
      }
      console.error(
        "[CORS] CORS_ALLOWED_ORIGINS=* is not permitted in production.",
      );
      callback(null, false);
      return;
    }
    if (allowed.includes(cleanOrigin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
};
reportingApp.use(cors(corsOptions));
reportingApp.use(
  morgan(envConfig.nodeEnv === "production" ? "combined" : "dev"),
);
reportingApp.use(express.json({ limit: "2mb" }));
reportingApp.use(express.urlencoded({ extended: true, limit: "2mb" }));
reportingApp.use(cookieParser());

// 3. Health check endpoints cho Traefik Gateway & Monitoring
const healthHandler = (_req: express.Request, res: express.Response) => {
  res.status(200).json({
    status: "ok",
    service: "reporting-service",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
};

reportingApp.get("/health", healthHandler);
reportingApp.get("/api/v1/reports/health", healthHandler);
reportingApp.get("/reports/health", healthHandler);
reportingApp.get("/api/v1/statistics/health", healthHandler);
reportingApp.get("/statistics/health", healthHandler);
reportingApp.get("/api/v1/ai-models/health", healthHandler);
reportingApp.get("/ai-models/health", healthHandler);

// 4. Mount Reporting, Statistics & AI Model Routes
// Hỗ trợ dual-mount cả prefix /api/v1/... và /... khi qua Gateway hoặc gọi trực tiếp
reportingApp.use(
  "/api/v1/statistics",
  rateLimitMiddleware,
  maintenanceGuard(),
  statisticRouter,
);
reportingApp.use(
  "/statistics",
  rateLimitMiddleware,
  maintenanceGuard(),
  statisticRouter,
);

reportingApp.use(
  "/api/v1/reports",
  rateLimitMiddleware,
  maintenanceGuard(),
  reportRouter,
);
reportingApp.use(
  "/reports",
  rateLimitMiddleware,
  maintenanceGuard(),
  reportRouter,
);

reportingApp.use(
  "/api/v1/ai-models",
  rateLimitMiddleware,
  maintenanceGuard(),
  aiModelRouter,
);
reportingApp.use(
  "/ai-models",
  rateLimitMiddleware,
  maintenanceGuard(),
  aiModelRouter,
);

// 5. Error & 404 Handlers
reportingApp.use(notFoundMiddleware);
reportingApp.use(errorMiddleware);

export default reportingApp;
