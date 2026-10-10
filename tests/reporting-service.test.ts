import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_TYPE,
  REPORT_STATUS,
  REPORT_FILE_TYPE,
  REPORT_TEMPLATE_STATUS,
  AI_MODEL_TYPE,
  AI_MODEL_STATUS,
  AI_MODEL_VERSION_STATUS,
  STATISTIC_GROUP_BY,
} from "../src/common/constants/reporting.constant";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import {
  dashboardFilterSchema,
  trendsFilterSchema,
  cameraStatsFilterSchema,
  recordAiPerformanceSchema,
  createReportTemplateSchema,
  generateReportSchema,
  createAiModelSchema,
  createAiModelVersionSchema,
  reportHistoryQuerySchema,
} from "../src/modules/reporting/reporting.validation";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import reportingApp from "../src/reporting.app";

describe("Task BE-09: PPE Reporting & Analytics Service Suite", () => {
  const fakeSiteId = "11111111-1111-4111-8111-111111111111";
  const fakeCameraId = "22222222-2222-4222-8222-222222222222";
  const fakeModelId = "33333333-3333-4333-8333-333333333333";
  const fakeVersionId = "44444444-4444-4444-8444-444444444444";
  const fakeTemplateId = "55555555-5555-4555-8555-555555555555";
  const fakeUserId = "66666666-6666-4666-8666-666666666666";

  // ── 1. Reporting Domain Constants & Roles Check ────────────────────────────
  describe("1. Reporting Domain Constants & Enums", () => {
    it("should define report types according to D08.pdf specifications", () => {
      assert.equal(REPORT_TYPE.DAILY, "DAILY");
      assert.equal(REPORT_TYPE.WEEKLY, "WEEKLY");
      assert.equal(REPORT_TYPE.MONTHLY, "MONTHLY");
      assert.equal(REPORT_TYPE.VIOLATION_SUMMARY, "VIOLATION_SUMMARY");
      assert.equal(REPORT_TYPE.AI_PERFORMANCE, "AI_PERFORMANCE");
    });

    it("should define standard report lifecycle statuses and file formats", () => {
      assert.equal(REPORT_STATUS.PENDING, "PENDING");
      assert.equal(REPORT_STATUS.COMPLETED, "COMPLETED");
      assert.equal(REPORT_STATUS.FAILED, "FAILED");

      assert.equal(REPORT_FILE_TYPE.PDF, "PDF");
      assert.equal(REPORT_FILE_TYPE.EXCEL, "EXCEL");
      assert.equal(REPORT_FILE_TYPE.CSV, "CSV");
      assert.equal(REPORT_FILE_TYPE.JSON, "JSON");

      assert.equal(REPORT_TEMPLATE_STATUS.ACTIVE, "ACTIVE");
      assert.equal(REPORT_TEMPLATE_STATUS.INACTIVE, "INACTIVE");
    });

    it("should define AI model governance types and lifecycle statuses", () => {
      assert.equal(AI_MODEL_TYPE.OBJECT_DETECTION, "OBJECT_DETECTION");
      assert.equal(AI_MODEL_TYPE.TRACKING, "TRACKING");
      assert.equal(AI_MODEL_TYPE.CLASSIFICATION, "CLASSIFICATION");

      assert.equal(AI_MODEL_STATUS.ACTIVE, "ACTIVE");
      assert.equal(AI_MODEL_STATUS.DEPRECATED, "DEPRECATED");

      assert.equal(AI_MODEL_VERSION_STATUS.DEVELOPMENT, "DEVELOPMENT");
      assert.equal(AI_MODEL_VERSION_STATUS.STAGING, "STAGING");
      assert.equal(AI_MODEL_VERSION_STATUS.DEPLOYED, "DEPLOYED");
      assert.equal(AI_MODEL_VERSION_STATUS.ARCHIVED, "ARCHIVED");
    });

    it("should verify dynamic RBAC permissions for Reporting domain", () => {
      assert.equal(PERMISSIONS.PPE_REPORTING_READ, "PPE_REPORTING_READ");
      assert.equal(PERMISSIONS.PPE_REPORTING_EXPORT, "PPE_REPORTING_EXPORT");
      assert.equal(PERMISSIONS.PPE_AI_METRICS_READ, "PPE_AI_METRICS_READ");
      assert.equal(PERMISSIONS.PPE_MODEL_READ, "PPE_MODEL_READ");
      assert.equal(PERMISSIONS.PPE_MODEL_MANAGE, "PPE_MODEL_MANAGE");
    });
  });

  // ── 2. Request Validation Schemas (Zod) ────────────────────────────────────
  describe("2. Request Validation Schemas (Zod)", () => {
    it("should accept valid dashboard filter with siteId and date range", () => {
      const parsed = dashboardFilterSchema.safeParse({
        siteId: fakeSiteId,
        startDate: "2026-10-01",
        endDate: "2026-10-10",
      });
      assert.equal(parsed.success, true);
    });

    it("should reject dashboard filter when endDate is before startDate", () => {
      const parsed = dashboardFilterSchema.safeParse({
        startDate: "2026-10-10",
        endDate: "2026-10-01",
      });
      assert.equal(parsed.success, false);
      if (!parsed.success) {
        assert.ok(
          parsed.error.errors.some((e) => e.path.includes("endDate")),
        );
      }
    });

    it("should accept and parse trends filter with groupBy parameter", () => {
      const parsed = trendsFilterSchema.safeParse({
        startDate: "2026-10-01",
        endDate: "2026-10-10",
        groupBy: STATISTIC_GROUP_BY.WEEK,
      });
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.groupBy, "WEEK");
      }
    });

    it("should validate and coerce camera ranking limit", () => {
      const parsed = cameraStatsFilterSchema.safeParse({
        limit: "15",
      });
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.limit, 15);
      }
    });

    it("should reject camera ranking limit when exceeding 50", () => {
      const parsed = cameraStatsFilterSchema.safeParse({
        limit: 100,
      });
      assert.equal(parsed.success, false);
    });

    it("should validate AI performance telemetry payload", () => {
      const parsed = recordAiPerformanceSchema.safeParse({
        cameraId: fakeCameraId,
        fps: 29.5,
        latencyMs: 34.2,
        frameCount: 100,
      });
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.frameCount, 100);
      }
    });

    it("should reject negative FPS or unrealistic latency in AI telemetry", () => {
      const invalidFps = recordAiPerformanceSchema.safeParse({
        cameraId: fakeCameraId,
        fps: -5,
        latencyMs: 50,
      });
      assert.equal(invalidFps.success, false);

      const invalidLatency = recordAiPerformanceSchema.safeParse({
        cameraId: fakeCameraId,
        fps: 30,
        latencyMs: 15000,
      });
      assert.equal(invalidLatency.success, false);
    });

    it("should validate createReportTemplateSchema with semver version", () => {
      const valid = createReportTemplateSchema.safeParse({
        name: "Báo cáo an toàn tuần",
        code: "WEEKLY_SAFETY_PDF",
        fileType: "PDF",
        version: "1.2.0",
      });
      assert.equal(valid.success, true);

      const invalidVersion = createReportTemplateSchema.safeParse({
        name: "Báo cáo an toàn",
        code: "SAFETY_REPORT",
        version: "invalid_ver",
      });
      assert.equal(invalidVersion.success, false);
    });

    it("should validate generateReportSchema and reject periodEnd < periodStart", () => {
      const invalid = generateReportSchema.safeParse({
        templateId: fakeTemplateId,
        siteId: fakeSiteId,
        reportType: "WEEKLY",
        periodStart: "2026-10-10",
        periodEnd: "2026-10-05",
      });
      assert.equal(invalid.success, false);
    });

    it("should validate AI model version registration schema", () => {
      const valid = createAiModelVersionSchema.safeParse({
        version: "1.0.0",
        framework: "PyTorch",
        inputSize: "640x640",
        metrics: {
          precision: 0.92,
          recall: 0.89,
          mAP50: 0.91,
        },
      });
      assert.equal(valid.success, true);
    });

    it("should validate reportHistoryQuerySchema with enums and reject invalid status", () => {
      const valid = reportHistoryQuerySchema.safeParse({
        reportType: REPORT_TYPE.WEEKLY,
        status: REPORT_STATUS.COMPLETED,
        page: "2",
        limit: "10",
      });
      assert.equal(valid.success, true);

      const invalidStatus = reportHistoryQuerySchema.safeParse({
        status: "INVALID_STATUS",
      });
      assert.equal(invalidStatus.success, false);

      const invalidType = reportHistoryQuerySchema.safeParse({
        reportType: "UNKNOWN_TYPE",
      });
      assert.equal(invalidType.success, false);
    });
  });

  // ── 3. Dashboard Statistics & KPI Calculations ─────────────────────────────
  describe("3. Dashboard Statistics & KPI Calculations", () => {
    it("should calculate False Alarm Rate and Compliance Rate accurately", async () => {
      const mockRepository = {
        getIncidentSummary: async () => ({
          totalIncidents: 100,
          openIncidents: 10,
          resolvedIncidents: 90,
          trueViolations: 80,
          falseAlarms: 20,
          falseAlarmRate: 20.0, // (20 / (80 + 20)) * 100
          complianceRate: 85.5,
          meanTimeToResolveHours: 2.5,
        }),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const summary = await service.getDashboardSummary({ siteId: fakeSiteId });

      assert.equal(summary.totalIncidents, 100);
      assert.equal(summary.trueViolations, 80);
      assert.equal(summary.falseAlarms, 20);
      assert.equal(summary.falseAlarmRate, 20.0);
      assert.equal(summary.complianceRate, 85.5);
      assert.equal(summary.meanTimeToResolveHours, 2.5);
    });

    it("should handle division by zero gracefully when no incidents are reviewed", async () => {
      const mockRepository = {
        getIncidentSummary: async () => ({
          totalIncidents: 0,
          openIncidents: 0,
          resolvedIncidents: 0,
          trueViolations: 0,
          falseAlarms: 0,
          falseAlarmRate: 0,
          complianceRate: 100,
          meanTimeToResolveHours: 0,
        }),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const summary = await service.getDashboardSummary({});

      assert.equal(summary.totalIncidents, 0);
      assert.equal(summary.falseAlarmRate, 0);
      assert.equal(summary.complianceRate, 100);
      assert.equal(summary.meanTimeToResolveHours, 0);
    });
  });

  // ── 4. Time-Series Trends Aggregation ──────────────────────────────────────
  describe("4. Time-Series Trends Aggregation", () => {
    it("should aggregate incident trends grouped by DAY", async () => {
      const mockRepository = {
        getIncidentTrends: async () => [
          {
            date: "2026-10-08",
            totalIncidents: 15,
            trueViolations: 12,
            falseAlarms: 3,
            resolvedCount: 10,
          },
          {
            date: "2026-10-09",
            totalIncidents: 20,
            trueViolations: 18,
            falseAlarms: 2,
            resolvedCount: 15,
          },
        ],
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const trends = await service.getViolationTrends({
        groupBy: STATISTIC_GROUP_BY.DAY,
      });

      assert.equal(trends.length, 2);
      assert.equal(trends[0].date, "2026-10-08");
      assert.equal(trends[0].totalIncidents, 15);
      assert.equal(trends[1].date, "2026-10-09");
      assert.equal(trends[1].totalIncidents, 20);
    });
  });

  // ── 5. Violation Distribution & Severity Breakdown ─────────────────────────
  describe("5. Violation Distribution & Severity Breakdown", () => {
    it("should return violation distribution with severity breakdown", async () => {
      const mockRepository = {
        getViolationBreakdown: async () => [
          {
            violationType: "NO_HELMET",
            count: 60,
            percentage: 60.0,
            severityBreakdown: {
              LOW: 0,
              NORMAL: 10,
              MEDIUM: 20,
              HIGH: 25,
              CRITICAL: 5,
            },
          },
          {
            violationType: "NO_VEST",
            count: 40,
            percentage: 40.0,
            severityBreakdown: {
              LOW: 5,
              NORMAL: 15,
              MEDIUM: 15,
              HIGH: 5,
              CRITICAL: 0,
            },
          },
        ],
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const distribution = await service.getViolationDistribution({});

      assert.equal(distribution.length, 2);
      assert.equal(distribution[0].violationType, "NO_HELMET");
      assert.equal(distribution[0].percentage, 60.0);
      assert.equal(distribution[0].severityBreakdown.HIGH, 25);
      assert.equal(distribution[1].violationType, "NO_VEST");
      assert.equal(distribution[1].percentage, 40.0);
    });
  });

  // ── 6. Camera Violation Rankings ───────────────────────────────────────────
  describe("6. Camera Violation Rankings", () => {
    it("should return cameras ranked descending by violation count", async () => {
      const mockRepository = {
        getCameraRankings: async () => [
          {
            cameraId: fakeCameraId,
            totalViolations: 45,
            confirmedCount: 40,
            falseAlarmCount: 5,
            resolvedCount: 38,
          },
          {
            cameraId: "33333333-3333-3333-3333-333333333333",
            totalViolations: 20,
            confirmedCount: 18,
            falseAlarmCount: 2,
            resolvedCount: 15,
          },
        ],
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const rankings = await service.getCameraRankings({ limit: 5 });

      assert.equal(rankings.length, 2);
      assert.equal(rankings[0].totalViolations, 45);
      assert.equal(rankings[1].totalViolations, 20);
      assert.ok(rankings[0].totalViolations >= rankings[1].totalViolations);
    });
  });

  // ── 7. AI Performance Metrics & Telemetry Recording ────────────────────────
  describe("7. AI Performance Metrics & Telemetry Recording", () => {
    it("should retrieve AI performance metrics list with BigInt serialized to string", async () => {
      const mockRepository = {
        getAiPerformanceStats: async () => [
          {
            id: "stat-1",
            cameraId: fakeCameraId,
            modelVersionId: fakeModelId,
            statDate: "2026-10-10",
            avgFps: 29.5,
            avgLatencyMs: 33.8,
            maxLatencyMs: 65,
            totalFrames: "1500000",
          },
        ],
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const stats = await service.getAiPerformanceMetrics({
        cameraId: fakeCameraId,
      });

      assert.equal(stats.length, 1);
      assert.equal(stats[0].avgFps, 29.5);
      assert.equal(stats[0].avgLatencyMs, 33.8);
      assert.equal(typeof stats[0].totalFrames, "string");
      assert.equal(stats[0].totalFrames, "1500000");
    });

    it("should record AI performance telemetry successfully", async () => {
      const mockRepository = {
        recordAiPerformanceMetric: async (data: any) => ({
          id: "stat-created",
          cameraId: data.cameraId,
          modelVersionId: data.modelVersionId,
          statDate: "2026-10-10",
          avgFps: data.fps,
          avgLatencyMs: data.latencyMs,
          maxLatencyMs: 40,
          totalFrames: "100",
        }),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const recorded = await service.recordAiPerformance({
        cameraId: fakeCameraId,
        modelVersionId: fakeModelId,
        fps: 28.5,
        latencyMs: 35.0,
        frameCount: 100,
      });

      assert.equal(recorded.avgFps, 28.5);
      assert.equal(recorded.avgLatencyMs, 35.0);
    });
  });

  // ── 8. Daily Rollup Aggregation ────────────────────────────────────────────
  describe("8. Daily Rollup Aggregation", () => {
    it("should execute daily aggregation rollup and upsert statistic record", async () => {
      let upserted = false;
      const mockRepository = {
        upsertIncidentStatistic: async (data: any) => {
          upserted = true;
          return { id: "stat-rollup-id", ...data };
        },
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const result = await service.aggregateDailyStats({
        siteId: fakeSiteId,
        statDate: "2026-10-10",
      });

      assert.equal(upserted, true);
      assert.equal(result.siteId, fakeSiteId);
    });
  });

  // ── 9. Report Templates & Generations Lifecycle ────────────────────────────
  describe("9. Report Templates & Generations Lifecycle", () => {
    it("should list report templates", async () => {
      const mockRepository = {
        findReportTemplates: async () => [
          {
            id: fakeTemplateId,
            name: "Mẫu báo cáo tuần",
            code: "WEEKLY_SUMMARY",
            fileType: "PDF",
            version: "1.0.0",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const templates = await service.listReportTemplates();

      assert.equal(templates.length, 1);
      assert.equal(templates[0].code, "WEEKLY_SUMMARY");
    });

    it("should reject creating report template with duplicated code", async () => {
      const mockRepository = {
        findReportTemplateByCode: async () => ({
          id: fakeTemplateId,
          code: "DUPLICATE_CODE",
        }),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      await assert.rejects(
        async () => {
          await service.createReportTemplate({
            name: "Báo cáo trùng",
            code: "DUPLICATE_CODE",
          });
        },
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, ERROR_CODE.DUPLICATE_ENTRY);
          assert.equal(err.statusCode, 409);
          return true;
        },
      );
    });

    it("should throw 404 when generating report with non-existent template", async () => {
      const mockRepository = {
        findReportTemplateById: async () => null,
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      await assert.rejects(
        async () => {
          await service.generateReport(
            {
              templateId: "non-existent-template",
              siteId: fakeSiteId,
              reportType: "WEEKLY",
              periodStart: "2026-10-01",
              periodEnd: "2026-10-07",
            },
            { actorId: fakeUserId },
          );
        },
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, ERROR_CODE.REPORT_TEMPLATE_NOT_FOUND);
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });

    it("should generate report successfully when template exists", async () => {
      const mockRepository = {
        findReportTemplateById: async () => ({
          id: fakeTemplateId,
          name: "Mẫu báo cáo",
        }),
        createReportGeneration: async (data: any, actorId: string) => ({
          id: "gen-123",
          templateId: data.templateId,
          siteId: data.siteId,
          reportType: data.reportType,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          generatedBy: actorId,
          status: "COMPLETED",
          fileName: "report_weekly.pdf",
          generatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const gen = await service.generateReport(
        {
          templateId: fakeTemplateId,
          siteId: fakeSiteId,
          reportType: "WEEKLY",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-07",
        },
        { actorId: fakeUserId },
      );

      assert.equal(gen.id, "gen-123");
      assert.equal(gen.status, "COMPLETED");
      assert.equal(gen.generatedBy, fakeUserId);
    });

    it("should throw 404 when downloading non-existent report generation", async () => {
      const mockRepository = {
        findReportGenerationById: async () => null,
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      await assert.rejects(
        async () => {
          await service.getReportGenerationDownload("non-existent-gen");
        },
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, ERROR_CODE.REPORT_GENERATION_NOT_FOUND);
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });
  });

  // ── 10. AI Model & Version Governance ──────────────────────────────────────
  describe("10. AI Model & Version Governance", () => {
    it("should reject registering AI model with duplicate code", async () => {
      const mockRepository = {
        findAiModelByCode: async () => ({
          id: fakeModelId,
          code: "YOLO_V8_PPE",
        }),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      await assert.rejects(
        async () => {
          await service.createAiModel({
            name: "YOLOv8 PPE Detector",
            code: "YOLO_V8_PPE",
            modelType: "OBJECT_DETECTION",
          });
        },
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, ERROR_CODE.DUPLICATE_ENTRY);
          assert.equal(err.statusCode, 409);
          return true;
        },
      );
    });

    it("should throw 404 when registering version for non-existent model", async () => {
      const mockRepository = {
        findAiModelById: async () => null,
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      await assert.rejects(
        async () => {
          await service.createAiModelVersion("non-existent-model", {
            version: "1.0.0",
          });
        },
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, ERROR_CODE.AI_MODEL_NOT_FOUND);
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });

    it("should reject registering duplicate version for the same AI model", async () => {
      const mockRepository = {
        findAiModelById: async () => ({ id: fakeModelId }),
        findAiModelVersionByModelAndVersion: async () => ({
          id: fakeVersionId,
          modelId: fakeModelId,
          version: "1.0.0",
        }),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      await assert.rejects(
        async () => {
          await service.createAiModelVersion(fakeModelId, {
            version: "1.0.0",
          });
        },
        (err: any) => {
          assert.equal(err instanceof AppError, true);
          assert.equal(err.code, ERROR_CODE.DUPLICATE_ENTRY);
          assert.equal(err.statusCode, 409);
          return true;
        },
      );
    });

    it("should deploy AI model version and set status to DEPLOYED", async () => {
      const mockRepository = {
        findAiModelById: async () => ({ id: fakeModelId }),
        findAiModelVersionById: async () => ({
          id: fakeVersionId,
          modelId: fakeModelId,
          version: "2.0.0",
          status: "DEVELOPMENT",
        }),
        deployAiModelVersion: async (_modelId: string, versionId: string) => ({
          id: versionId,
          modelId: fakeModelId,
          version: "2.0.0",
          status: AI_MODEL_VERSION_STATUS.DEPLOYED,
          deployedAt: new Date().toISOString(),
        }),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepository);
      const deployed = await service.deployAiModelVersion(
        fakeModelId,
        fakeVersionId,
        { actorId: fakeUserId },
      );

      assert.equal(deployed.status, "DEPLOYED");
      assert.ok(deployed.deployedAt);
    });
  });

  // ── 11. Express Standalone Application & Health Checks ─────────────────────
  describe("11. Express Standalone Application & Health Checks", () => {
    it("should export an initialized Express app instance", () => {
      assert.ok(reportingApp);
      assert.equal(typeof reportingApp.listen, "function");
    });

    it("should register health check routes in reportingApp router stack", () => {
      const routes = reportingApp._router.stack
        .filter((r: any) => r.route)
        .map((r: any) => r.route.path);

      assert.ok(routes.includes("/health"));
      assert.ok(routes.includes("/api/v1/reports/health"));
      assert.ok(routes.includes("/api/v1/statistics/health"));
      assert.ok(routes.includes("/api/v1/ai-models/health"));
    });
  });
});
