import { Request, Response, NextFunction } from "express";
import { brokerService, BrokerService } from "./broker.service";
import {
  PublishViolationEventInput,
  ReprocessDlqParamsInput,
} from "./broker.validation";
import { DlqQueryDto } from "./broker.dto";

export class BrokerController {
  private readonly service: BrokerService;

  constructor(service?: BrokerService) {
    this.service = service || brokerService;
  }

  /**
   * Endpoint tiếp nhận sự kiện vi phạm từ AI Inference Engine (Python - SV2)
   * POST /api/v1/broker/publish
   */
  publishViolation = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const incomingTraceId = (
        req.headers["x-request-id"] ||
        req.headers["x-trace-id"] ||
        ""
      ) as string;

      const actorId = req.user?.id || req.apiKey?.id || "ai-inference-engine";

      const result = await this.service.publishViolationEvent(
        req.body as PublishViolationEventInput,
        incomingTraceId,
        actorId,
      );

      // Gắn correlation headers vào HTTP response
      res.setHeader("X-Trace-Id", result.traceId);
      res.setHeader("X-Event-Id", result.eventId);

      const httpStatus = result.duplicate ? 200 : 202;

      res.status(httpStatus).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Kiểm tra tình trạng hoạt động và hàng đợi của Message Broker
   * GET /api/v1/broker/health
   */
  getHealth = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.getBrokerHealth();
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Tra cứu danh sách Poison Pills trong Dead-Letter Queue
   * GET /api/v1/broker/dlq
   */
  listDlq = async (
    req: Request<unknown, unknown, unknown, DlqQueryDto>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = req.query;
      const result = this.service.getDlqRecords(query);
      res.status(200).json({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Tái xử lý thông điệp từ Dead-Letter Queue
   * POST /api/v1/broker/dlq/:id/reprocess
   */
  reprocessDlq = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const actorId = req.user?.id || "SYSTEM";
      const { id } = req.params;
      const result = await this.service.reprocessDlqRecord(id, actorId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Xóa toàn bộ Dead-Letter Queue
   * DELETE /api/v1/broker/dlq
   */
  purgeDlq = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const actorId = req.user?.id || "SYSTEM";
      const result = this.service.purgeDlq(actorId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const brokerController = new BrokerController();
