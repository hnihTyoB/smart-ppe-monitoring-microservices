import { Router, Request, Response, NextFunction } from "express";
import { brokerController } from "./broker.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { apiKeyAuthMiddleware } from "../../middlewares/api-key.middleware";
import {
  requirePermission,
  requireAnyPermission,
} from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { PERMISSIONS } from "../../common/constants/permission.constant";
import {
  publishViolationEventSchema,
  dlqQuerySchema,
  reprocessDlqParamsSchema,
} from "./broker.validation";

export const brokerRouter = Router();

/**
 * Middleware chứng thực linh hoạt cho AI Pipeline Ingestion:
 * Chấp nhận API Key (header x-api-key) hoặc JWT Access Token (Bearer Token / Cookie)
 */
export const brokerIngestionAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;
  const hasApiKey = Boolean(
    req.headers["x-api-key"] ||
      (authHeader && authHeader.startsWith("Bearer ak_")),
  );
  if (hasApiKey) {
    return apiKeyAuthMiddleware(req, res, next);
  }
  return authMiddleware(req, res, next);
};

// ── 1. Ingestion Bridge Endpoint cho AI Vision Pipeline (Python - SV2) ────────
brokerRouter.post(
  "/publish",
  brokerIngestionAuth,
  requireAnyPermission(
    PERMISSIONS.PPE_BROKER_PUBLISH,
    PERMISSIONS.PPE_BROKER_MANAGE,
    PERMISSIONS.PPE_INCIDENT_MANAGE,
  ),
  validate(publishViolationEventSchema, "body"),
  brokerController.publishViolation,
);

// ── 2. Health & Telemetry Probe ───────────────────────────────────────────────
brokerRouter.get("/health", brokerController.getHealth);

// ── 3. Dead-Letter Queue (DLQ) Management ─────────────────────────────────────
brokerRouter.get(
  "/dlq",
  authMiddleware,
  requireAnyPermission(
    PERMISSIONS.PPE_BROKER_MANAGE,
    PERMISSIONS.SYSTEM_CONFIG_READ,
  ),
  validate(dlqQuerySchema, "query"),
  brokerController.listDlq,
);

brokerRouter.post(
  "/dlq/:id/reprocess",
  authMiddleware,
  requireAnyPermission(
    PERMISSIONS.PPE_BROKER_MANAGE,
    PERMISSIONS.SYSTEM_CONFIG_MANAGE,
  ),
  validate(reprocessDlqParamsSchema, "params"),
  brokerController.reprocessDlq,
);

brokerRouter.delete(
  "/dlq",
  authMiddleware,
  requireAnyPermission(
    PERMISSIONS.PPE_BROKER_MANAGE,
    PERMISSIONS.SYSTEM_CONFIG_MANAGE,
  ),
  brokerController.purgeDlq,
);

export default brokerRouter;
