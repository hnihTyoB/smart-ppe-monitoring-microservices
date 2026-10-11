import { openapiRegistry } from "../../config/openapi/openapi.registry";
import {
  idempotencyKeyQuerySchema,
  purgeIdempotencyKeysSchema,
} from "./reliability.validation";
import { z } from "zod";

export function registerReliabilityOpenApi(): void {
  openapiRegistry.register(
    "IdempotencyKeyQueryRequest",
    idempotencyKeyQuerySchema,
  );
  openapiRegistry.register(
    "PurgeIdempotencyKeysRequest",
    purgeIdempotencyKeysSchema,
  );

  // 1. GET /reliability/metrics
  openapiRegistry.registerPath({
    method: "get",
    path: "/reliability/metrics",
    tags: ["Reliability & Fault Tolerance"],
    summary:
      "Thống kê chỉ số độ tin cậy, tỷ lệ khử trùng lặp và telemetry retry (Task BE-13)",
    description:
      "Cung cấp các số liệu thời gian thực về số sự kiện đã tiếp nhận, số duplicate bị chặn theo từng tầng, số lần thử lại với Exponential Backoff và số lượng poison pills.",
    security: [{ BearerAuth: [] }],
    responses: {
      200: {
        description: "Thông số độ tin cậy được trả về thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                totalEventsReceived: z.number(),
                totalDeduplicated: z.number(),
                deduplicationRatePercent: z.number(),
                deduplicationBreakdown: z.object({
                  exactEventId: z.number(),
                  exactViolationId: z.number(),
                  businessCooldown: z.number(),
                  inFlightConcurrency: z.number(),
                }),
                retryMetrics: z.object({
                  totalRetries: z.number(),
                  retrySuccesses: z.number(),
                  retriesExhausted: z.number(),
                  activeRetries: z.number(),
                }),
                dlqMetrics: z.object({
                  totalDlqPoisonPills: z.number(),
                  totalDlqTransientExhausted: z.number(),
                  currentDlqSize: z.number(),
                }),
                cacheMetrics: z.object({
                  storedKeysCount: z.number(),
                  maxCapacity: z.number(),
                  activeLocksCount: z.number(),
                }),
                timestamp: z.number(),
              }),
            }),
          },
        },
      },
      401: { description: "Yêu cầu Bearer Token xác thực" },
      403: { description: "Không đủ quyền truy cập (cần PPE_RELIABILITY_READ)" },
    },
  });

  // 2. GET /reliability/idempotency-keys
  openapiRegistry.registerPath({
    method: "get",
    path: "/reliability/idempotency-keys",
    tags: ["Reliability & Fault Tolerance"],
    summary: "Tra cứu danh sách các khóa Idempotency đang lưu trữ trong hệ thống",
    security: [{ BearerAuth: [] }],
    request: {
      query: idempotencyKeyQuerySchema,
    },
    responses: {
      200: {
        description: "Danh sách khóa Idempotency có phân trang",
      },
      401: { description: "Yêu cầu Bearer Token xác thực" },
      403: { description: "Không đủ quyền truy cập" },
    },
  });

  // 3. DELETE /reliability/idempotency-keys
  openapiRegistry.registerPath({
    method: "delete",
    path: "/reliability/idempotency-keys",
    tags: ["Reliability & Fault Tolerance"],
    summary: "Dọn dẹp hoặc xóa toàn bộ các khóa Idempotency (Super Admin)",
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: purgeIdempotencyKeysSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Đã dọn dẹp các khóa Idempotency thành công",
      },
      401: { description: "Yêu cầu Bearer Token xác thực" },
      403: { description: "Không đủ quyền quản trị (cần PPE_RELIABILITY_MANAGE)" },
    },
  });
}
