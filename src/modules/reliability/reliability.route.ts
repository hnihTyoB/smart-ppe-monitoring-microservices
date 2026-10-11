import { Router } from "express";
import { reliabilityController } from "./reliability.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import {
  requirePermission,
} from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { PERMISSIONS } from "../../common/constants/permission.constant";
import {
  idempotencyKeyQuerySchema,
  purgeIdempotencyKeysSchema,
} from "./reliability.validation";

export const reliabilityRouter = Router();

/**
 * 1. Tra cứu chỉ số độ tin cậy, tỷ lệ khử trùng lặp và thống kê retry
 * GET /api/v1/reliability/metrics
 */
reliabilityRouter.get(
  "/metrics",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_RELIABILITY_READ),
  reliabilityController.getMetrics,
);

/**
 * 2. Tra cứu danh sách các khóa Idempotency đang lưu trữ
 * GET /api/v1/reliability/idempotency-keys
 */
reliabilityRouter.get(
  "/idempotency-keys",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_RELIABILITY_READ),
  validate(idempotencyKeyQuerySchema, "query"),
  reliabilityController.listKeys,
);

/**
 * 3. Dọn dẹp / Xóa các khóa Idempotency
 * DELETE /api/v1/reliability/idempotency-keys
 */
reliabilityRouter.delete(
  "/idempotency-keys",
  authMiddleware,
  requirePermission(PERMISSIONS.PPE_RELIABILITY_MANAGE),
  validate(purgeIdempotencyKeysSchema, "body"),
  reliabilityController.purgeKeys,
);

export default reliabilityRouter;
