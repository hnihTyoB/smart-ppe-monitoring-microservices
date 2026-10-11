import { Request, Response, NextFunction } from "express";
import {
  ReliabilityService,
  reliabilityService,
} from "./reliability.service";
import { IdempotencyKeyQueryDto } from "./reliability.dto";
import { PurgeIdempotencyKeysInput } from "./reliability.validation";

export class ReliabilityController {
  private readonly service: ReliabilityService;

  constructor(service?: ReliabilityService) {
    this.service = service || reliabilityService;
  }

  /**
   * Tra cứu số liệu thống kê độ tin cậy, tỷ lệ khử trùng lặp và retry
   * GET /api/v1/reliability/metrics
   */
  getMetrics = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data = this.service.getReliabilityMetrics();
      res.status(200).json({
        success: true,
        data,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Tra cứu danh sách các khóa Idempotency đang lưu trữ
   * GET /api/v1/reliability/idempotency-keys
   */
  listKeys = async (
    req: Request<unknown, unknown, unknown, IdempotencyKeyQueryDto>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query;
      const result = this.service.listIdempotencyKeys(query);
      res.status(200).json({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Dọn dẹp / Xóa các khóa Idempotency
   * DELETE /api/v1/reliability/idempotency-keys
   */
  purgeKeys = async (
    req: Request<unknown, unknown, PurgeIdempotencyKeysInput>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = req.body || {};
      const actorId = req.user?.id || "SYSTEM";
      const result = this.service.purgeKeys(body.status, actorId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };
}

export const reliabilityController = new ReliabilityController();
