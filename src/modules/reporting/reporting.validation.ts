import { z } from "zod";
import {
  REPORT_TYPE,
  REPORT_STATUS,
  REPORT_FILE_TYPE,
  AI_MODEL_TYPE,
  STATISTIC_GROUP_BY,
} from "../../common/constants/reporting.constant";

const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const semverRegex = /^v?\d+\.\d+\.\d+$/;
const codeRegex = /^[A-Za-z0-9_.-]+$/;

// ── 1. Statistics & KPI Filter Schemas ────────────────────────────────────────

export const dashboardFilterSchema = z
  .object({
    siteId: z.string().uuid("Invalid siteId UUID format").optional(),
    startDate: z
      .string()
      .regex(dateRegex, "startDate must be in YYYY-MM-DD format")
      .optional(),
    endDate: z
      .string()
      .regex(dateRegex, "endDate must be in YYYY-MM-DD format")
      .optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: "endDate must be equal to or greater than startDate",
      path: ["endDate"],
    },
  );

export const trendsFilterSchema = z
  .object({
    siteId: z.string().uuid("Invalid siteId UUID format").optional(),
    startDate: z
      .string()
      .regex(dateRegex, "startDate must be in YYYY-MM-DD format")
      .optional(),
    endDate: z
      .string()
      .regex(dateRegex, "endDate must be in YYYY-MM-DD format")
      .optional(),
    groupBy: z
      .enum([
        STATISTIC_GROUP_BY.DAY,
        STATISTIC_GROUP_BY.WEEK,
        STATISTIC_GROUP_BY.MONTH,
      ])
      .default(STATISTIC_GROUP_BY.DAY),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: "endDate must be equal to or greater than startDate",
      path: ["endDate"],
    },
  );

export const cameraStatsFilterSchema = z
  .object({
    siteId: z.string().uuid("Invalid siteId UUID format").optional(),
    startDate: z
      .string()
      .regex(dateRegex, "startDate must be in YYYY-MM-DD format")
      .optional(),
    endDate: z
      .string()
      .regex(dateRegex, "endDate must be in YYYY-MM-DD format")
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: "endDate must be equal to or greater than startDate",
      path: ["endDate"],
    },
  );

export const aiPerformanceFilterSchema = z
  .object({
    cameraId: z.string().uuid("Invalid cameraId UUID format").optional(),
    startDate: z
      .string()
      .regex(dateRegex, "startDate must be in YYYY-MM-DD format")
      .optional(),
    endDate: z
      .string()
      .regex(dateRegex, "endDate must be in YYYY-MM-DD format")
      .optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: "endDate must be equal to or greater than startDate",
      path: ["endDate"],
    },
  );

export const recordAiPerformanceSchema = z.object({
  cameraId: z.string().uuid("Invalid cameraId UUID format"),
  modelVersionId: z.string().uuid("Invalid modelVersionId UUID format").optional(),
  statDate: z
    .string()
    .regex(dateRegex, "statDate must be in YYYY-MM-DD format")
    .optional(),
  fps: z.coerce
    .number()
    .positive("FPS must be positive")
    .max(240, "FPS cannot exceed 240"),
  latencyMs: z.coerce
    .number()
    .positive("Latency must be positive")
    .max(10000, "Latency cannot exceed 10,000ms"),
  frameCount: z.coerce
    .number()
    .int()
    .positive("frameCount must be positive integer")
    .default(1),
});

export const aggregateDailySchema = z.object({
  siteId: z.string().uuid("Invalid siteId UUID format"),
  statDate: z.string().regex(dateRegex, "statDate must be in YYYY-MM-DD format"),
});

// ── 2. Report Templates & Generations Schemas ─────────────────────────────────

export const createReportTemplateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 chars").max(150),
  code: z
    .string()
    .trim()
    .min(2, "Code must be at least 2 chars")
    .max(50)
    .regex(codeRegex, "Code must contain alphanumeric, dot, dash, or underscore"),
  description: z.string().trim().max(500).optional(),
  filePath: z.string().trim().optional(),
  fileName: z.string().trim().max(255).optional(),
  fileType: z
    .enum([
      REPORT_FILE_TYPE.PDF,
      REPORT_FILE_TYPE.EXCEL,
      REPORT_FILE_TYPE.CSV,
      REPORT_FILE_TYPE.JSON,
    ])
    .default(REPORT_FILE_TYPE.PDF),
  version: z
    .string()
    .regex(semverRegex, "Version must follow SemVer (e.g. 1.0.0)")
    .default("1.0.0"),
});

export const generateReportSchema = z
  .object({
    templateId: z.string().uuid("Invalid templateId UUID format"),
    siteId: z.string().uuid("Invalid siteId UUID format"),
    reportType: z.enum([
      REPORT_TYPE.DAILY,
      REPORT_TYPE.WEEKLY,
      REPORT_TYPE.MONTHLY,
      REPORT_TYPE.VIOLATION_SUMMARY,
      REPORT_TYPE.AI_PERFORMANCE,
    ]),
    periodStart: z
      .string()
      .regex(dateRegex, "periodStart must be in YYYY-MM-DD format"),
    periodEnd: z
      .string()
      .regex(dateRegex, "periodEnd must be in YYYY-MM-DD format"),
  })
  .refine((data) => data.periodStart <= data.periodEnd, {
    message: "periodEnd must be equal to or greater than periodStart",
    path: ["periodEnd"],
  });

export const reportHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  siteId: z.string().uuid().optional(),
  reportType: z
    .enum([
      REPORT_TYPE.DAILY,
      REPORT_TYPE.WEEKLY,
      REPORT_TYPE.MONTHLY,
      REPORT_TYPE.VIOLATION_SUMMARY,
      REPORT_TYPE.AI_PERFORMANCE,
    ])
    .optional(),
  status: z
    .enum([
      REPORT_STATUS.PENDING,
      REPORT_STATUS.PROCESSING,
      REPORT_STATUS.COMPLETED,
      REPORT_STATUS.FAILED,
    ])
    .optional(),
});

// ── 3. AI Models & Governance Schemas ─────────────────────────────────────────

export const createAiModelSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 chars").max(150),
  code: z
    .string()
    .trim()
    .min(2, "Code must be at least 2 chars")
    .max(50)
    .regex(codeRegex, "Code must contain alphanumeric, dot, dash, or underscore"),
  modelType: z
    .enum([
      AI_MODEL_TYPE.OBJECT_DETECTION,
      AI_MODEL_TYPE.TRACKING,
      AI_MODEL_TYPE.CLASSIFICATION,
    ])
    .default(AI_MODEL_TYPE.OBJECT_DETECTION),
  description: z.string().trim().max(1000).optional(),
});

export const createAiModelVersionSchema = z.object({
  version: z
    .string()
    .regex(semverRegex, "Version must follow SemVer (e.g. 1.0.0)"),
  modelPath: z.string().trim().max(500).optional(),
  framework: z.string().trim().max(50).default("PyTorch"),
  inputSize: z
    .string()
    .trim()
    .regex(/^\d+x\d+$/i, "Input size must be in WxH format (e.g. 640x640)")
    .default("640x640"),
  metrics: z.record(z.unknown()).optional(),
});

export const uuidParamSchema = z.object({
  id: z.string().uuid("Invalid UUID parameter"),
});

export const modelVersionParamSchema = z.object({
  id: z.string().uuid("Invalid model ID parameter"),
  versionId: z.string().uuid("Invalid version ID parameter"),
});
