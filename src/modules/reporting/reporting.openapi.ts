import { openapiRegistry } from "../../config/openapi/openapi.registry";
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
import { z } from "zod";

export function registerReportingOpenApi(): void {
  // ── Register Components / Schemas ──────────────────────────────────────────
  openapiRegistry.register(
    "RecordAiPerformanceRequest",
    recordAiPerformanceSchema,
  );
  openapiRegistry.register("AggregateDailyRequest", aggregateDailySchema);
  openapiRegistry.register(
    "CreateReportTemplateRequest",
    createReportTemplateSchema,
  );
  openapiRegistry.register("GenerateReportRequest", generateReportSchema);
  openapiRegistry.register("CreateAiModelRequest", createAiModelSchema);
  openapiRegistry.register(
    "CreateAiModelVersionRequest",
    createAiModelVersionSchema,
  );

  // ── Statistics & Dashboard Endpoints ───────────────────────────────────────

  openapiRegistry.registerPath({
    method: "get",
    path: "/statistics/summary",
    tags: ["Reporting & Statistics"],
    summary: "Lấy số liệu Dashboard KPIs tổng quan (Incidents, Violations, False Alarms, MTTR)",
    security: [{ BearerAuth: [] }],
    request: { query: dashboardFilterSchema },
    responses: {
      200: {
        description: "Lấy số liệu KPI tổng quan thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              data: z.object({
                totalIncidents: z.number().openapi({ example: 48 }),
                openIncidents: z.number().openapi({ example: 5 }),
                resolvedIncidents: z.number().openapi({ example: 43 }),
                trueViolations: z.number().openapi({ example: 42 }),
                falseAlarms: z.number().openapi({ example: 6 }),
                falseAlarmRate: z.number().openapi({ example: 12.5 }),
                complianceRate: z.number().openapi({ example: 91.2 }),
                meanTimeToResolveHours: z.number().openapi({ example: 2.5 }),
                periodStart: z.string().optional().openapi({ example: "2026-10-01" }),
                periodEnd: z.string().optional().openapi({ example: "2026-10-10" }),
              }),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/statistics/trends",
    tags: ["Reporting & Statistics"],
    summary: "Thống kê xu hướng sự cố chuỗi thời gian (theo Ngày, Tuần, Tháng)",
    security: [{ BearerAuth: [] }],
    request: { query: trendsFilterSchema },
    responses: {
      200: {
        description: "Lấy chuỗi dữ liệu xu hướng thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              data: z.array(
                z.object({
                  date: z.string().openapi({ example: "2026-10-08" }),
                  totalIncidents: z.number().openapi({ example: 12 }),
                  trueViolations: z.number().openapi({ example: 10 }),
                  falseAlarms: z.number().openapi({ example: 2 }),
                  resolvedCount: z.number().openapi({ example: 10 }),
                }),
              ),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/statistics/by-violation",
    tags: ["Reporting & Statistics"],
    summary: "Phân bổ sự cố theo loại vi phạm PPE và cấp độ nghiêm trọng",
    security: [{ BearerAuth: [] }],
    request: { query: dashboardFilterSchema },
    responses: {
      200: {
        description: "Lấy phân bổ vi phạm thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              data: z.array(
                z.object({
                  violationType: z.string().openapi({ example: "NO_HELMET" }),
                  count: z.number().openapi({ example: 25 }),
                  percentage: z.number().openapi({ example: 52.08 }),
                  severityBreakdown: z.object({
                    LOW: z.number(),
                    NORMAL: z.number(),
                    MEDIUM: z.number(),
                    HIGH: z.number(),
                    CRITICAL: z.number(),
                  }),
                }),
              ),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/statistics/by-camera",
    tags: ["Reporting & Statistics"],
    summary: "Xếp hạng camera có nhiều vi phạm nhất trên công trường",
    security: [{ BearerAuth: [] }],
    request: { query: cameraStatsFilterSchema },
    responses: {
      200: {
        description: "Lấy danh sách xếp hạng camera thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              data: z.array(
                z.object({
                  cameraId: z.string().uuid(),
                  totalViolations: z.number().openapi({ example: 30 }),
                  confirmedCount: z.number().openapi({ example: 27 }),
                  falseAlarmCount: z.number().openapi({ example: 3 }),
                  resolvedCount: z.number().openapi({ example: 26 }),
                }),
              ),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/statistics/ai-performance",
    tags: ["Reporting & Statistics"],
    summary: "Lấy dữ liệu hiệu năng hệ thống AI (FPS, độ trễ suy luận, tổng số frame)",
    security: [{ BearerAuth: [] }],
    request: { query: aiPerformanceFilterSchema },
    responses: {
      200: {
        description: "Lấy hiệu năng AI thành công",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean().openapi({ example: true }),
              data: z.array(
                z.object({
                  id: z.string().uuid(),
                  cameraId: z.string().uuid(),
                  modelVersionId: z.string().uuid().nullable(),
                  statDate: z.string().openapi({ example: "2026-10-10" }),
                  avgFps: z.number().openapi({ example: 28.5 }),
                  avgLatencyMs: z.number().openapi({ example: 35.2 }),
                  maxLatencyMs: z.number().openapi({ example: 68 }),
                  totalFrames: z.string().openapi({ example: "1250000" }),
                }),
              ),
            }),
          },
        },
      },
    },
  });

  openapiRegistry.registerPath({
    method: "post",
    path: "/statistics/record-ai-performance",
    tags: ["Reporting & Statistics"],
    summary: "Ghi nhận telemetry hiệu năng suy luận AI từ video streaming pipeline",
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": { schema: recordAiPerformanceSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Ghi nhận telemetry AI thành công",
      },
    },
  });

  openapiRegistry.registerPath({
    method: "post",
    path: "/statistics/aggregate-daily",
    tags: ["Reporting & Statistics"],
    summary: "Kích hoạt chốt và tính toán dữ liệu thống kê ngày (Daily Rollup)",
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": { schema: aggregateDailySchema },
        },
      },
    },
    responses: {
      200: {
        description: "Tổng hợp dữ liệu thống kê ngày thành công",
      },
    },
  });

  // ── Reports & Templates Endpoints ──────────────────────────────────────────

  openapiRegistry.registerPath({
    method: "get",
    path: "/reports/templates",
    tags: ["Reports"],
    summary: "Danh sách mẫu báo cáo định kỳ",
    security: [{ BearerAuth: [] }],
    responses: {
      200: {
        description: "Lấy danh sách mẫu báo cáo thành công",
      },
    },
  });

  openapiRegistry.registerPath({
    method: "post",
    path: "/reports/templates",
    tags: ["Reports"],
    summary: "Tạo mẫu báo cáo định kỳ mới",
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": { schema: createReportTemplateSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Tạo mẫu báo cáo thành công",
      },
    },
  });

  openapiRegistry.registerPath({
    method: "post",
    path: "/reports/generate",
    tags: ["Reports"],
    summary: "Yêu cầu sinh báo cáo định kỳ (Daily/Weekly/Monthly)",
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": { schema: generateReportSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Sinh báo cáo thành công",
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/reports/history",
    tags: ["Reports"],
    summary: "Lịch sử các lần sinh báo cáo",
    security: [{ BearerAuth: [] }],
    request: { query: reportHistoryQuerySchema },
    responses: {
      200: {
        description: "Lấy lịch sử báo cáo thành công",
      },
    },
  });

  openapiRegistry.registerPath({
    method: "get",
    path: "/reports/{id}/download",
    tags: ["Reports"],
    summary: "Tải file báo cáo đã xuất",
    security: [{ BearerAuth: [] }],
    request: { params: uuidParamSchema },
    responses: {
      200: {
        description: "Thông tin tải báo cáo thành công",
      },
    },
  });

  // ── AI Models Governance Endpoints ─────────────────────────────────────────

  openapiRegistry.registerPath({
    method: "get",
    path: "/ai-models",
    tags: ["AI Models"],
    summary: "Danh sách các mô hình AI và các phiên bản đã đăng ký",
    security: [{ BearerAuth: [] }],
    responses: {
      200: {
        description: "Lấy danh sách mô hình AI thành công",
      },
    },
  });

  openapiRegistry.registerPath({
    method: "post",
    path: "/ai-models",
    tags: ["AI Models"],
    summary: "Đăng ký mô hình AI mới (YOLO, Tracker,...)",
    security: [{ BearerAuth: [] }],
    request: {
      body: {
        content: {
          "application/json": { schema: createAiModelSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Đăng ký mô hình AI thành công",
      },
    },
  });

  openapiRegistry.registerPath({
    method: "post",
    path: "/ai-models/{id}/versions",
    tags: ["AI Models"],
    summary: "Đăng ký phiên bản mới cho mô hình AI (kèm metrics và weights)",
    security: [{ BearerAuth: [] }],
    request: {
      params: uuidParamSchema,
      body: {
        content: {
          "application/json": { schema: createAiModelVersionSchema },
        },
      },
    },
    responses: {
      201: {
        description: "Đăng ký phiên bản mô hình thành công",
      },
    },
  });

  openapiRegistry.registerPath({
    method: "patch",
    path: "/ai-models/{id}/versions/{versionId}/deploy",
    tags: ["AI Models"],
    summary: "Triển khai (DEPLOYED) phiên bản mô hình AI cho hệ thống suy luận",
    security: [{ BearerAuth: [] }],
    request: { params: modelVersionParamSchema },
    responses: {
      200: {
        description: "Triển khai phiên bản mô hình thành công",
      },
    },
  });
}
