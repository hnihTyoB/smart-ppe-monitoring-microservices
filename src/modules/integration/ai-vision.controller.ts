import { Request, Response, NextFunction } from "express";
import {
  AiVisionIntegrationService,
  aiVisionIntegrationService,
} from "./ai-vision.service";
import { AI_VISION_INGESTION_STATUS } from "../../common/constants/broker.constant";
import type {
  AiVisionIngestEventInput,
  AiVisionBatchIngestInput,
  AiVisionSimulateInput,
  AiVisionSyncQueryInput,
} from "./ai-vision.validation";

export class AiVisionIntegrationController {
  private readonly service: AiVisionIntegrationService;

  constructor(service?: AiVisionIntegrationService) {
    this.service = service || aiVisionIntegrationService;
  }

  /**
   * 1. POST /api/v1/integration/ai-vision/events
   * Tiếp nhận sự kiện vi phạm an toàn từ AI Vision Edge Pipeline
   */
  public ingestEvent = async (
    req: Request<any, any, AiVisionIngestEventInput, any>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const isSync =
        req.query?.sync === true ||
        (req.query?.sync as unknown) === "true" ||
        (req.query?.sync as unknown) === "1" ||
        req.body?.sync === true;

      const result = await this.service.ingestEvent(req.body, {
        sync: isSync,
      });

      // Xác định HTTP Status Code phù hợp
      let statusCode = 202; // Mặc định Async Queued: 202 Accepted
      if (result.status === AI_VISION_INGESTION_STATUS.PROCESSED) {
        statusCode = 201; // Sync Mode tạo Incident thành công: 201 Created
      } else if (result.status === AI_VISION_INGESTION_STATUS.DUPLICATE) {
        statusCode = 200; // Trùng lặp nhưng đã xử lý: 200 OK
      }

      res.status(statusCode).json({
        success: true,
        message:
          result.message || "Tiếp nhận sự kiện AI Vision thành công",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 2. POST /api/v1/integration/ai-vision/events/batch
   * Tiếp nhận mảng sự kiện hàng loạt (Edge Offline Recovery)
   */
  public ingestBatch = async (
    req: Request<any, any, AiVisionBatchIngestInput, any>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const isSync =
        req.query?.sync === true ||
        (req.query?.sync as unknown) === "true" ||
        (req.query?.sync as unknown) === "1" ||
        req.body?.sync === true;

      const result = await this.service.ingestBatch(req.body, {
        sync: isSync,
      });

      res.status(200).json({
        success: true,
        message: `Đã xử lý ${result.total} sự kiện (${result.ingested} thành công, ${result.duplicates} trùng lặp, ${result.failed} lỗi)`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 3. POST /api/v1/integration/ai-vision/simulate
   * Giả lập sự kiện vi phạm phục vụ Live Demo / Testing
   */
  public simulateViolation = async (
    req: Request<unknown, unknown, AiVisionSimulateInput>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.simulateViolation(req.body);

      res.status(201).json({
        success: true,
        message: "Mô phỏng sự kiện vi phạm an toàn PPE thành công",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 4. GET /api/v1/integration/ai-vision/contract
   * Xuất bản tài liệu đặc tả Hợp đồng dữ liệu ALL-03 / VI-11
   */
  public getContract = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const contract = this.service.getContractSpecification();

      res.status(200).json({
        success: true,
        data: contract,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 5. GET /api/v1/integration/ai-vision/health
   * Kiểm tra tình trạng kết nối của pipeline tích hợp
   */
  public getHealth = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const health = await this.service.getPipelineHealth();
      const statusCode = health.status === "DOWN" ? 503 : 200;

      res.status(statusCode).json({
        success: health.status !== "DOWN",
        data: health,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const aiVisionIntegrationController =
  new AiVisionIntegrationController();
