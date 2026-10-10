import { Router } from "express";
import { ReportingController } from "./reporting.controller";
import { validate } from "../../middlewares/validate.middleware";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { PERMISSIONS } from "../../common/constants/permission.constant";
import {
  dashboardFilterSchema,
  trendsFilterSchema,
  cameraStatsFilterSchema,
  aiPerformanceFilterSchema,
  recordAiPerformanceSchema,
  aggregateDailySchema,
  createReportTemplateSchema,
  generateReportSchema,
  reportHistoryQuerySchema,
  createAiModelSchema,
  createAiModelVersionSchema,
  uuidParamSchema,
  modelVersionParamSchema,
} from "./reporting.validation";

export const statisticRouter = Router();
export const reportRouter = Router();
export const aiModelRouter = Router();

const controller = new ReportingController();

// ── 1. Statistics & Dashboard Routes (/api/v1/statistics) ────────────────────

statisticRouter.use(authMiddleware);

statisticRouter.get(
  "/summary",
  requirePermission(PERMISSIONS.PPE_REPORTING_READ),
  validate(dashboardFilterSchema, "query"),
  controller.getDashboardSummary,
);

statisticRouter.get(
  "/trends",
  requirePermission(PERMISSIONS.PPE_REPORTING_READ),
  validate(trendsFilterSchema, "query"),
  controller.getViolationTrends,
);

statisticRouter.get(
  "/by-violation",
  requirePermission(PERMISSIONS.PPE_REPORTING_READ),
  validate(dashboardFilterSchema, "query"),
  controller.getViolationDistribution,
);

statisticRouter.get(
  "/by-camera",
  requirePermission(PERMISSIONS.PPE_REPORTING_READ),
  validate(cameraStatsFilterSchema, "query"),
  controller.getCameraRankings,
);

statisticRouter.get(
  "/ai-performance",
  requirePermission(PERMISSIONS.PPE_AI_METRICS_READ),
  validate(aiPerformanceFilterSchema, "query"),
  controller.getAiPerformance,
);

statisticRouter.post(
  "/record-ai-performance",
  requirePermission(PERMISSIONS.PPE_AI_METRICS_READ),
  validate(recordAiPerformanceSchema, "body"),
  controller.recordAiPerformance,
);

statisticRouter.post(
  "/aggregate-daily",
  requirePermission(PERMISSIONS.PPE_REPORTING_EXPORT),
  validate(aggregateDailySchema, "body"),
  controller.aggregateDaily,
);

// ── 2. Reports & Templates Routes (/api/v1/reports) ──────────────────────────

reportRouter.use(authMiddleware);

reportRouter.get(
  "/templates",
  requirePermission(PERMISSIONS.PPE_REPORTING_READ),
  controller.listReportTemplates,
);

reportRouter.get(
  "/templates/:id",
  requirePermission(PERMISSIONS.PPE_REPORTING_READ),
  validate(uuidParamSchema, "params"),
  controller.getReportTemplateById,
);

reportRouter.post(
  "/templates",
  requirePermission(PERMISSIONS.PPE_REPORTING_EXPORT),
  validate(createReportTemplateSchema, "body"),
  controller.createReportTemplate,
);

reportRouter.post(
  "/generate",
  requirePermission(PERMISSIONS.PPE_REPORTING_EXPORT),
  validate(generateReportSchema, "body"),
  controller.generateReport,
);

reportRouter.get(
  "/history",
  requirePermission(PERMISSIONS.PPE_REPORTING_READ),
  validate(reportHistoryQuerySchema, "query"),
  controller.listReportGenerations,
);

reportRouter.get(
  "/:id/download",
  requirePermission(PERMISSIONS.PPE_REPORTING_EXPORT),
  validate(uuidParamSchema, "params"),
  controller.getReportGenerationDownload,
);

// ── 3. AI Models & Governance Routes (/api/v1/ai-models) ─────────────────────

aiModelRouter.use(authMiddleware);

aiModelRouter.get(
  "/",
  requirePermission(PERMISSIONS.PPE_MODEL_READ),
  controller.listAiModels,
);

aiModelRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.PPE_MODEL_READ),
  validate(uuidParamSchema, "params"),
  controller.getAiModelById,
);

aiModelRouter.post(
  "/",
  requirePermission(PERMISSIONS.PPE_MODEL_MANAGE),
  validate(createAiModelSchema, "body"),
  controller.createAiModel,
);

aiModelRouter.post(
  "/:id/versions",
  requirePermission(PERMISSIONS.PPE_MODEL_MANAGE),
  validate(uuidParamSchema, "params"),
  validate(createAiModelVersionSchema, "body"),
  controller.createAiModelVersion,
);

aiModelRouter.patch(
  "/:id/versions/:versionId/deploy",
  requirePermission(PERMISSIONS.PPE_MODEL_MANAGE),
  validate(modelVersionParamSchema, "params"),
  controller.deployAiModelVersion,
);
