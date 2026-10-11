import { Router } from "express";
import { aiVisionIntegrationController } from "./ai-vision.controller";
import { brokerIngestionAuth } from "../broker/broker.route";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { requireAnyPermission } from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { PERMISSIONS } from "../../common/constants/permission.constant";
import {
  aiVisionIngestEventSchema,
  aiVisionBatchIngestSchema,
  aiVisionSimulateSchema,
  aiVisionSyncQuerySchema,
} from "./ai-vision.validation";

export const aiVisionRouter = Router();

// ── 1. Tiếp nhận sự kiện vi phạm an toàn từ AI Vision Edge Pipeline ────────────
aiVisionRouter.post(
  "/events",
  brokerIngestionAuth,
  requireAnyPermission(
    PERMISSIONS.PPE_BROKER_PUBLISH,
    PERMISSIONS.PPE_BROKER_MANAGE,
    PERMISSIONS.PPE_INCIDENT_MANAGE,
  ),
  validate(aiVisionSyncQuerySchema, "query"),
  validate(aiVisionIngestEventSchema, "body"),
  aiVisionIntegrationController.ingestEvent,
);

// ── 2. Tiếp nhận hàng loạt sự kiện lưu tạm (Edge Offline Recovery) ──────────────
aiVisionRouter.post(
  "/events/batch",
  brokerIngestionAuth,
  requireAnyPermission(
    PERMISSIONS.PPE_BROKER_PUBLISH,
    PERMISSIONS.PPE_BROKER_MANAGE,
    PERMISSIONS.PPE_INCIDENT_MANAGE,
  ),
  validate(aiVisionSyncQuerySchema, "query"),
  validate(aiVisionBatchIngestSchema, "body"),
  aiVisionIntegrationController.ingestBatch,
);

// ── 3. Giả lập sự kiện vi phạm phục vụ Live Demo / Testing Rehearsal ───────────
aiVisionRouter.post(
  "/simulate",
  authMiddleware,
  requireAnyPermission(
    PERMISSIONS.PPE_BROKER_MANAGE,
    PERMISSIONS.PPE_INCIDENT_MANAGE,
  ),
  validate(aiVisionSimulateSchema, "body"),
  aiVisionIntegrationController.simulateViolation,
);

// ── 4. Đặc tả hợp đồng dữ liệu ALL-03 / VI-11 (JSON Schema Spec) ──────────────
aiVisionRouter.get("/contract", aiVisionIntegrationController.getContract);

// ── 5. Health Probe kiểm tra tình trạng kết nối đường ống AI Vision ───────────
aiVisionRouter.get("/health", aiVisionIntegrationController.getHealth);

export default aiVisionRouter;
