import { z } from "zod";
import {
  PPE_VIOLATION_TYPES,
  PPE_SEVERITY,
  PPE_DETECTION_CLASS,
} from "../../common/constants/kafka.constant";
import { uuidSchema } from "../../common/validations/common.validation";

/**
 * Tọa độ Bounding Box của đối tượng
 */
export const aiVisionBoundingBoxSchema = z.object({
  x: z.number().min(0, "Tọa độ X không được âm"),
  y: z.number().min(0, "Tọa độ Y không được âm"),
  width: z.number().positive("Chiều rộng box phải là số dương"),
  height: z.number().positive("Chiều cao box phải là số dương"),
});

/**
 * Đối tượng phát hiện được bởi AI (Person / Helmet / Vest)
 */
export const aiVisionDetectionItemSchema = z.object({
  class: z.string().min(1),
  confidence: z.number().min(0).max(1),
  box: aiVisionBoundingBoxSchema,
  trackId: z.number().int().optional(),
});

/**
 * Chi tiết hành vi vi phạm an toàn PPE
 */
export const aiVisionViolationItemSchema = z.object({
  violationType: z.string().min(1),
  severity: z.string().min(1).default(PPE_SEVERITY.HIGH),
  description: z.string().min(1, "Mô tả vi phạm không được để trống"),
  confidence: z.number().min(0).max(1),
  box: aiVisionBoundingBoxSchema.optional(),
  workerName: z.string().trim().nullable().optional(),
  workerId: z.string().trim().nullable().optional(),
});

/**
 * Bằng chứng hình ảnh / clip
 */
export const aiVisionEvidenceSchema = z.object({
  snapshotUrl: z.string().url("Snapshot URL phải là URL hợp lệ"),
  clipUrl: z.string().url("Clip URL phải là URL hợp lệ").optional(),
  frameResolution: z
    .object({
      width: z.number().int().positive().default(1920),
      height: z.number().int().positive().default(1080),
    })
    .default({ width: 1920, height: 1080 }),
});

/**
 * Tóm tắt vi phạm
 */
export const aiVisionSummarySchema = z.object({
  totalPersons: z.number().int().min(0).default(1),
  totalViolations: z.number().int().min(1).default(1),
  highestSeverity: z.string().default(PPE_SEVERITY.HIGH),
});

/**
 * Schema tiếp nhận 1 sự kiện vi phạm từ AI Vision Edge Pipeline (ALL-03 / VI-11)
 * Chấp nhận cả cấu trúc đầy đủ lẫn cấu trúc thu gọn có cameraCode / cameraId
 */
export const aiVisionIngestEventSchema = z
  .object({
    violationId: z.string().uuid().optional(),
    eventId: z.string().uuid().optional(),
    timestamp: z
      .string()
      .datetime({ offset: true })
      .optional()
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/).optional()),
    site: z
      .object({
        id: z.string().uuid().optional(),
        code: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
      })
      .optional(),
    camera: z
      .object({
        id: z.string().uuid().optional(),
        code: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        zone: z.string().min(1).optional(),
      })
      .optional(),
    // Shorthands hỗ trợ Edge AI gửi trực tiếp
    cameraId: z.string().uuid().optional(),
    cameraCode: z.string().min(1).optional(),
    siteId: z.string().uuid().optional(),
    siteCode: z.string().min(1).optional(),
    evidence: aiVisionEvidenceSchema,
    detections: z.array(aiVisionDetectionItemSchema).default([]),
    violations: z
      .array(aiVisionViolationItemSchema)
      .min(1, "Sự kiện vi phạm phải có tối thiểu 1 loại vi phạm PPE"),
    summary: aiVisionSummarySchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    sync: z.boolean().optional(),
  })
  .refine(
    (data) =>
      Boolean(
        data.camera?.id ||
          data.camera?.code ||
          data.cameraId ||
          data.cameraCode,
      ),
    {
      message:
        "Bắt buộc phải cung cấp định danh Camera (camera.id, camera.code, cameraId, hoặc cameraCode)",
      path: ["camera"],
    },
  );

export type AiVisionIngestEventInput = z.infer<
  typeof aiVisionIngestEventSchema
>;

/**
 * Schema nạp hàng loạt sự kiện (Batch Ingestion - Local Buffer Recovery)
 */
export const aiVisionBatchIngestSchema = z.object({
  events: z
    .array(aiVisionIngestEventSchema)
    .min(1, "Danh sách sự kiện không được để trống")
    .max(50, "Mỗi mẻ batch tối đa 50 sự kiện"),
  sync: z.boolean().optional().default(false),
});

export type AiVisionBatchIngestInput = z.infer<
  typeof aiVisionBatchIngestSchema
>;

/**
 * Schema giả lập vi phạm an toàn lao động (Simulation Endpoint)
 */
export const aiVisionSimulateSchema = z.object({
  violationType: z
    .nativeEnum(PPE_VIOLATION_TYPES)
    .default(PPE_VIOLATION_TYPES.NO_HELMET),
  severity: z.nativeEnum(PPE_SEVERITY).default(PPE_SEVERITY.HIGH),
  confidence: z.number().min(0).max(1).default(0.95),
  cameraId: uuidSchema.optional(),
  cameraCode: z.string().trim().optional(),
  siteId: uuidSchema.optional(),
  siteCode: z.string().trim().optional(),
  workerName: z.string().trim().default("Nguyễn Văn A"),
  workerId: z.string().trim().default("NV-001"),
  snapshotUrl: z
    .string()
    .url()
    .default(
      "https://storage.ppe.local/evidences/samples/demo_violation.jpg",
    ),
  sync: z.boolean().optional().default(true),
});

export type AiVisionSimulateInput = z.infer<typeof aiVisionSimulateSchema>;

/**
 * Query schema hỗ trợ cờ ?sync=true
 */
export const aiVisionSyncQuerySchema = z.object({
  sync: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((val) =>
      val !== undefined ? val === "true" || val === "1" : undefined,
    ),
});

export type AiVisionSyncQueryInput = z.infer<typeof aiVisionSyncQuerySchema>;
