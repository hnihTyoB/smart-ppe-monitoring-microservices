import { openapiRegistry } from "../../config/openapi/openapi.registry";
import {
  publishViolationEventSchema,
  dlqQuerySchema,
  reprocessDlqParamsSchema,
} from "./broker.validation";
import { z } from "zod";

export function registerBrokerOpenApi(): void {
  openapiRegistry.register(
    "PublishViolationEventRequest",
    publishViolationEventSchema,
  );
  openapiRegistry.register("DlqQueryRequest", dlqQuerySchema);
  openapiRegistry.register(
    "ReprocessDlqParamsRequest",
    reprocessDlqParamsSchema,
  );

  // 1. POST /broker/publish
  openapiRegistry.registerPath({
    method: "post",
    path: "/broker/publish",
    tags: ["Message Broker & AI Ingestion"],
    summary:
      "Ingestion Bridge: Tiếp nhận và xuất bản sự kiện vi phạm PPE từ AI Inference Engine (Python - SV2)",
    description:
      "Xác thực qua Bearer Token hoặc API Key (x-api-key). Tự động kiểm tra Idempotency chống duplicate và chuyển sự kiện lỗi vào Dead-Letter Queue.",
    security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: publishViolationEventSchema,
          },
        },
      },
    },
    responses: {
      202: {
        description: "Sự kiện vi phạm đã được tiếp nhận và xuất bản thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                success: z.boolean(),
                eventId: z.string().uuid(),
                traceId: z.string(),
                topic: z.string(),
                status: z.literal("PUBLISHED"),
                duplicate: z.literal(false),
                timestamp: z.number(),
              }),
            }),
          },
        },
      },
      200: {
        description:
          "Sự kiện đã từng được xử lý trong vòng 24 giờ (Idempotency protection)",
      },
      400: {
        description: "Dữ liệu sự kiện vi phạm không đúng định dạng",
      },
      401: {
        description: "Chưa xác thực qua Token hoặc API Key",
      },
      403: {
        description: "Không đủ quyền hạn xuất bản thông điệp",
      },
    },
  });

  // 2. GET /broker/health
  openapiRegistry.registerPath({
    method: "get",
    path: "/broker/health",
    tags: ["Message Broker & AI Ingestion"],
    summary:
      "Kiểm tra tình trạng kết nối và số lượng subscribers của Message Broker",
    responses: {
      200: {
        description: "Trạng thái Broker",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                status: z.string(),
                redisConnected: z.boolean(),
                activeSubscribers: z.number(),
                dlqCount: z.number(),
                processedCacheCount: z.number(),
                timestamp: z.number(),
              }),
            }),
          },
        },
      },
    },
  });

  // 3. GET /broker/dlq
  openapiRegistry.registerPath({
    method: "get",
    path: "/broker/dlq",
    tags: ["Message Broker & AI Ingestion"],
    summary:
      "Tra cứu danh sách các thông điệp bị lỗi trong Dead-Letter Queue (DLQ)",
    security: [{ BearerAuth: [] }],
    request: {
      query: dlqQuerySchema,
    },
    responses: {
      200: {
        description: "Danh sách Poison Pills trong DLQ",
      },
      401: {
        description: "Chưa xác thực",
      },
      403: {
        description: "Không đủ quyền hạn",
      },
    },
  });

  // 4. POST /broker/dlq/{id}/reprocess
  openapiRegistry.registerPath({
    method: "post",
    path: "/broker/dlq/{id}/reprocess",
    tags: ["Message Broker & AI Ingestion"],
    summary:
      "Tái xử lý (Reprocess) một thông điệp từ Dead-Letter Queue",
    security: [{ BearerAuth: [] }],
    request: {
      params: reprocessDlqParamsSchema,
    },
    responses: {
      200: {
        description: "Thông điệp đã được tái xử lý qua consumers",
      },
      404: {
        description: "Không tìm thấy sự kiện trong DLQ",
      },
    },
  });

  // 5. DELETE /broker/dlq
  openapiRegistry.registerPath({
    method: "delete",
    path: "/broker/dlq",
    tags: ["Message Broker & AI Ingestion"],
    summary: "Xóa toàn bộ Dead-Letter Queue",
    security: [{ BearerAuth: [] }],
    responses: {
      200: {
        description: "Đã dọn dẹp DLQ thành công",
      },
    },
  });
}
