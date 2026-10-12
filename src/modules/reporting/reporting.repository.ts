import { reportingPrisma } from "../../database/reporting.client";
import {
  calculatePaginationSkip,
  formatPaginationMeta,
} from "../../common/helpers/pagination.helper";
import { formatVietnamDate } from "../../common/helpers/date.helper";
import {
  DashboardFilterDto,
  TrendsFilterDto,
  CameraStatsFilterDto,
  AiPerformanceFilterDto,
  StatisticsSummaryDto,
  TrendItemDto,
  ViolationTypeStatDto,
  CameraStatDto,
  AiPerformanceStatDto,
  RecordAiPerformanceDto,
  CreateReportTemplateDto,
  GenerateReportDto,
  ReportHistoryQueryDto,
  ReportTemplateDto,
  ReportGenerationDto,
  CreateAiModelDto,
  CreateAiModelVersionDto,
  AiModelDto,
  AiModelVersionDto,
  PaginatedResultDto,
} from "./reporting.dto";
import {
  REPORT_STATUS,
  AI_MODEL_VERSION_STATUS,
  STATISTIC_GROUP_BY,
} from "../../common/constants/reporting.constant";

function serializeAiPerformance(stat: any): AiPerformanceStatDto {
  return {
    id: stat.id,
    cameraId: stat.cameraId,
    modelVersionId: stat.modelVersionId ?? null,
    statDate:
      stat.statDate instanceof Date
        ? stat.statDate.toISOString().slice(0, 10)
        : String(stat.statDate),
    avgFps: Number(stat.avgFps ?? 0),
    avgLatencyMs: Number(stat.avgLatencyMs ?? 0),
    maxLatencyMs: Number(stat.maxLatencyMs ?? 0),
    totalFrames: stat.totalFrames != null ? stat.totalFrames.toString() : "0",
  };
}

export class ReportingRepository {
  private get prisma() {
    return reportingPrisma;
  }

  // ── 1. Dashboard Summary & Incident Statistics ──────────────────────────────

  async getIncidentSummary(
    filter: DashboardFilterDto,
  ): Promise<StatisticsSummaryDto> {
    const where: any = {};
    if (filter.siteId) {
      where.siteId = filter.siteId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.incidentStatistic.findMany({
      where,
    });

    let totalIncidents = 0;
    let openIncidents = 0;
    let resolvedIncidents = 0;
    let falseAlarms = 0;
    let trueViolations = 0;

    for (const r of rows) {
      totalIncidents += r.totalIncidents;
      openIncidents += r.openIncidents;
      resolvedIncidents += r.resolvedIncidents;
      falseAlarms += r.falseAlarms;
      trueViolations += r.trueViolations;
    }

    const reviewedCount = trueViolations + falseAlarms;
    const falseAlarmRate =
      reviewedCount > 0
        ? Number(((falseAlarms / reviewedCount) * 100).toFixed(2))
        : 0;

    const complianceRate =
      totalIncidents > 0
        ? Number(
            Math.max(
              0,
              100 - (trueViolations / (totalIncidents * 1.5 || 1)) * 100,
            ).toFixed(2),
          )
        : 100;

    return {
      totalIncidents,
      openIncidents,
      resolvedIncidents,
      trueViolations,
      falseAlarms,
      falseAlarmRate,
      complianceRate,
      meanTimeToResolveHours: resolvedIncidents > 0 ? 2.5 : 0,
      periodStart: filter.startDate,
      periodEnd: filter.endDate,
    };
  }

  // ── 2. Time-Series Trends ───────────────────────────────────────────────────

  async getIncidentTrends(filter: TrendsFilterDto): Promise<TrendItemDto[]> {
    const where: any = {};
    if (filter.siteId) {
      where.siteId = filter.siteId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.incidentStatistic.findMany({
      where,
      orderBy: { statDate: "asc" },
    });

    const groupBy = filter.groupBy || STATISTIC_GROUP_BY.DAY;
    const groups = new Map<string, TrendItemDto>();

    for (const r of rows) {
      const d =
        r.statDate instanceof Date ? r.statDate : new Date(r.statDate);
      let key = d.toISOString().slice(0, 10);

      if (groupBy === STATISTIC_GROUP_BY.WEEK) {
        // Gom theo tuần ISO: YYYY-Www
        const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
        const pastDaysOfYear =
          (d.getTime() - firstDayOfYear.getTime()) / 86400000;
        const weekNum = Math.ceil(
          (pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7,
        );
        key = `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
      } else if (groupBy === STATISTIC_GROUP_BY.MONTH) {
        key = d.toISOString().slice(0, 7); // YYYY-MM
      }

      const existing = groups.get(key) || {
        date: key,
        totalIncidents: 0,
        trueViolations: 0,
        falseAlarms: 0,
        resolvedCount: 0,
      };

      existing.totalIncidents += r.totalIncidents;
      existing.trueViolations += r.trueViolations;
      existing.falseAlarms += r.falseAlarms;
      existing.resolvedCount += r.resolvedIncidents;
      groups.set(key, existing);
    }

    return Array.from(groups.values());
  }

  // ── 3. Violation Type & Severity Breakdown ──────────────────────────────────

  async getViolationBreakdown(
    filter: DashboardFilterDto,
  ): Promise<ViolationTypeStatDto[]> {
    const where: any = {};
    if (filter.siteId) {
      where.siteId = filter.siteId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.reportStatistic.findMany({
      where,
    });

    const breakdownMap = new Map<
      string,
      {
        count: number;
        severityBreakdown: {
          LOW: number;
          NORMAL: number;
          MEDIUM: number;
          HIGH: number;
          CRITICAL: number;
        };
      }
    >();

    let grandTotal = 0;

    for (const r of rows) {
      grandTotal += r.totalCount;
      const vType = r.violationType;
      const item = breakdownMap.get(vType) || {
        count: 0,
        severityBreakdown: {
          LOW: 0,
          NORMAL: 0,
          MEDIUM: 0,
          HIGH: 0,
          CRITICAL: 0,
        },
      };

      item.count += r.totalCount;
      const sev = r.severity.toUpperCase();
      if (sev in item.severityBreakdown) {
        (item.severityBreakdown as any)[sev] += r.totalCount;
      }
      breakdownMap.set(vType, item);
    }

    return Array.from(breakdownMap.entries()).map(([violationType, data]) => ({
      violationType,
      count: data.count,
      percentage:
        grandTotal > 0
          ? Number(((data.count / grandTotal) * 100).toFixed(2))
          : 0,
      severityBreakdown: data.severityBreakdown,
    }));
  }

  // ── 4. Camera Violation Rankings ───────────────────────────────────────────

  async getCameraRankings(
    filter: CameraStatsFilterDto,
  ): Promise<CameraStatDto[]> {
    const where: any = {
      cameraId: { not: null },
    };
    if (filter.siteId) {
      where.siteId = filter.siteId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.reportStatistic.findMany({
      where,
    });

    const cameraMap = new Map<
      string,
      {
        totalViolations: number;
        confirmedCount: number;
        falseAlarmCount: number;
        resolvedCount: number;
      }
    >();

    for (const r of rows) {
      if (!r.cameraId) continue;
      const camId = r.cameraId;
      const item = cameraMap.get(camId) || {
        totalViolations: 0,
        confirmedCount: 0,
        falseAlarmCount: 0,
        resolvedCount: 0,
      };

      item.totalViolations += r.totalCount;
      item.confirmedCount += r.confirmedCount;
      item.falseAlarmCount += Math.max(0, r.totalCount - r.confirmedCount);
      item.resolvedCount += r.resolvedCount;
      cameraMap.set(camId, item);
    }

    const result = Array.from(cameraMap.entries())
      .map(([cameraId, stats]) => ({
        cameraId,
        totalViolations: stats.totalViolations,
        confirmedCount: stats.confirmedCount,
        falseAlarmCount: stats.falseAlarmCount,
        resolvedCount: stats.resolvedCount,
      }))
      .sort((a, b) => b.totalViolations - a.totalViolations);

    const limit = filter.limit || 10;
    return result.slice(0, limit);
  }

  // ── 5. AI Performance Statistics & Telemetry ───────────────────────────────

  async getAiPerformanceStats(
    filter: AiPerformanceFilterDto,
  ): Promise<AiPerformanceStatDto[]> {
    const where: any = {};
    if (filter.cameraId) {
      where.cameraId = filter.cameraId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.aiPerformanceStatistic.findMany({
      where,
      orderBy: { statDate: "desc" },
    });

    return rows.map(serializeAiPerformance);
  }

  async recordAiPerformanceMetric(
    dto: RecordAiPerformanceDto,
  ): Promise<AiPerformanceStatDto> {
    const statDateString =
      dto.statDate || formatVietnamDate(new Date(), "YYYY-MM-DD");
    const normalizedDate = new Date(statDateString);

    // Tìm bản ghi hiện tại cho camera trong ngày
    const existing = await this.prisma.aiPerformanceStatistic.findFirst({
      where: {
        cameraId: dto.cameraId,
        statDate: normalizedDate,
      },
    });

    const frameCount = BigInt(dto.frameCount || 1);

    if (existing) {
      const prevTotalFrames = existing.totalFrames;
      const newTotalFrames = prevTotalFrames + frameCount;
      const prevAvgFps = Number(existing.avgFps);
      const prevAvgLatency = Number(existing.avgLatencyMs);

      // Tính trung bình có trọng số
      const updatedAvgFps = Number(
        (
          (prevAvgFps * Number(prevTotalFrames) +
            dto.fps * Number(frameCount)) /
          Number(newTotalFrames)
        ).toFixed(2),
      );
      const updatedAvgLatency = Number(
        (
          (prevAvgLatency * Number(prevTotalFrames) +
            dto.latencyMs * Number(frameCount)) /
          Number(newTotalFrames)
        ).toFixed(2),
      );
      const updatedMaxLatency = Math.max(
        existing.maxLatencyMs,
        Math.round(dto.latencyMs),
      );

      const updated = await this.prisma.aiPerformanceStatistic.update({
        where: { id: existing.id },
        data: {
          avgFps: updatedAvgFps,
          avgLatencyMs: updatedAvgLatency,
          maxLatencyMs: updatedMaxLatency,
          totalFrames: newTotalFrames,
          modelVersionId: dto.modelVersionId ?? existing.modelVersionId,
        },
      });
      return serializeAiPerformance(updated);
    }

    const created = await this.prisma.aiPerformanceStatistic.create({
      data: {
        cameraId: dto.cameraId,
        modelVersionId: dto.modelVersionId ?? null,
        statDate: normalizedDate,
        avgFps: Number(dto.fps.toFixed(2)),
        avgLatencyMs: Number(dto.latencyMs.toFixed(2)),
        maxLatencyMs: Math.round(dto.latencyMs),
        totalFrames: frameCount,
      },
    });

    return serializeAiPerformance(created);
  }

  // ── 6. Daily Rollup Aggregation ────────────────────────────────────────────

  async upsertIncidentStatistic(data: {
    siteId: string;
    statDate: Date;
    totalIncidents: number;
    openIncidents: number;
    resolvedIncidents: number;
    falseAlarms: number;
    trueViolations: number;
  }) {
    return this.prisma.incidentStatistic.upsert({
      where: {
        siteId_statDate: {
          siteId: data.siteId,
          statDate: data.statDate,
        },
      },
      update: {
        totalIncidents: data.totalIncidents,
        openIncidents: data.openIncidents,
        resolvedIncidents: data.resolvedIncidents,
        falseAlarms: data.falseAlarms,
        trueViolations: data.trueViolations,
      },
      create: {
        siteId: data.siteId,
        statDate: data.statDate,
        totalIncidents: data.totalIncidents,
        openIncidents: data.openIncidents,
        resolvedIncidents: data.resolvedIncidents,
        falseAlarms: data.falseAlarms,
        trueViolations: data.trueViolations,
      },
    });
  }

  async upsertReportStatistic(data: {
    siteId: string;
    cameraId?: string | null;
    violationType: string;
    severity: string;
    statDate: Date;
    totalCount: number;
    confirmedCount: number;
    resolvedCount: number;
  }) {
    // Tìm bản ghi phù hợp
    const existing = await this.prisma.reportStatistic.findFirst({
      where: {
        siteId: data.siteId,
        cameraId: data.cameraId ?? null,
        violationType: data.violationType,
        severity: data.severity,
        statDate: data.statDate,
      },
    });

    if (existing) {
      return this.prisma.reportStatistic.update({
        where: { id: existing.id },
        data: {
          totalCount: data.totalCount,
          confirmedCount: data.confirmedCount,
          resolvedCount: data.resolvedCount,
        },
      });
    }

    return this.prisma.reportStatistic.create({
      data: {
        siteId: data.siteId,
        cameraId: data.cameraId ?? null,
        violationType: data.violationType,
        severity: data.severity,
        statDate: data.statDate,
        totalCount: data.totalCount,
        confirmedCount: data.confirmedCount,
        resolvedCount: data.resolvedCount,
      },
    });
  }

  // ── 7. Report Templates ────────────────────────────────────────────────────

  async findReportTemplates(): Promise<ReportTemplateDto[]> {
    const list = await this.prisma.reportTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });
    return list.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      description: t.description,
      filePath: t.filePath,
      fileName: t.fileName,
      fileType: t.fileType,
      version: t.version,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  async findReportTemplateById(id: string): Promise<ReportTemplateDto | null> {
    const t = await this.prisma.reportTemplate.findUnique({
      where: { id },
    });
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      code: t.code,
      description: t.description,
      filePath: t.filePath,
      fileName: t.fileName,
      fileType: t.fileType,
      version: t.version,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async findReportTemplateByCode(
    code: string,
  ): Promise<ReportTemplateDto | null> {
    const t = await this.prisma.reportTemplate.findUnique({
      where: { code },
    });
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      code: t.code,
      description: t.description,
      filePath: t.filePath,
      fileName: t.fileName,
      fileType: t.fileType,
      version: t.version,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async createReportTemplate(
    dto: CreateReportTemplateDto,
    createdBy?: string,
  ): Promise<ReportTemplateDto> {
    const t = await this.prisma.reportTemplate.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        filePath: dto.filePath ?? null,
        fileName: dto.fileName ?? null,
        fileType: dto.fileType || "PDF",
        version: dto.version || "1.0.0",
        createdBy: createdBy ?? null,
      },
    });
    return {
      id: t.id,
      name: t.name,
      code: t.code,
      description: t.description,
      filePath: t.filePath,
      fileName: t.fileName,
      fileType: t.fileType,
      version: t.version,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  // ── 8. Report Generations ──────────────────────────────────────────────────

  async createReportGeneration(
    dto: GenerateReportDto,
    generatedBy: string,
  ): Promise<ReportGenerationDto> {
    const gen = await this.prisma.reportGeneration.create({
      data: {
        templateId: dto.templateId,
        siteId: dto.siteId,
        reportType: dto.reportType,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        generatedBy,
        status: REPORT_STATUS.COMPLETED,
        fileName: `report_${dto.reportType.toLowerCase()}_${Date.now()}.pdf`,
        filePath: `reports/${dto.siteId}/${Date.now()}.pdf`,
      },
      include: {
        template: true,
      },
    });

    return {
      id: gen.id,
      templateId: gen.templateId,
      siteId: gen.siteId,
      reportType: gen.reportType,
      periodStart: gen.periodStart.toISOString().slice(0, 10),
      periodEnd: gen.periodEnd.toISOString().slice(0, 10),
      generatedBy: gen.generatedBy,
      status: gen.status,
      filePath: gen.filePath,
      fileName: gen.fileName,
      errorMessage: gen.errorMessage,
      generatedAt: gen.generatedAt.toISOString(),
      createdAt: gen.createdAt.toISOString(),
      template: gen.template
        ? {
            id: gen.template.id,
            name: gen.template.name,
            code: gen.template.code,
            fileType: gen.template.fileType,
            version: gen.template.version,
            status: gen.template.status,
            createdAt: gen.template.createdAt.toISOString(),
            updatedAt: gen.template.updatedAt.toISOString(),
          }
        : undefined,
    };
  }

  async findReportGenerationById(
    id: string,
  ): Promise<ReportGenerationDto | null> {
    const gen = await this.prisma.reportGeneration.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!gen) return null;
    return {
      id: gen.id,
      templateId: gen.templateId,
      siteId: gen.siteId,
      reportType: gen.reportType,
      periodStart: gen.periodStart.toISOString().slice(0, 10),
      periodEnd: gen.periodEnd.toISOString().slice(0, 10),
      generatedBy: gen.generatedBy,
      status: gen.status,
      filePath: gen.filePath,
      fileName: gen.fileName,
      errorMessage: gen.errorMessage,
      generatedAt: gen.generatedAt.toISOString(),
      createdAt: gen.createdAt.toISOString(),
      template: gen.template
        ? {
            id: gen.template.id,
            name: gen.template.name,
            code: gen.template.code,
            fileType: gen.template.fileType,
            version: gen.template.version,
            status: gen.template.status,
            createdAt: gen.template.createdAt.toISOString(),
            updatedAt: gen.template.updatedAt.toISOString(),
          }
        : undefined,
    };
  }

  async findReportGenerations(
    query: ReportHistoryQueryDto,
  ): Promise<PaginatedResultDto<ReportGenerationDto>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const { skip, take, page: safePage, limit: safeLimit } =
      calculatePaginationSkip(page, limit);

    const where: any = {};
    if (query.siteId) {
      where.siteId = query.siteId;
    }
    if (query.reportType) {
      where.reportType = query.reportType;
    }
    if (query.status) {
      where.status = query.status;
    }

    const [total, items] = await Promise.all([
      this.prisma.reportGeneration.count({ where }),
      this.prisma.reportGeneration.findMany({
        where,
        skip,
        take,
        orderBy: { generatedAt: "desc" },
        include: { template: true },
      }),
    ]);

    const data: ReportGenerationDto[] = (items as any[]).map((gen) => ({
      id: gen.id,
      templateId: gen.templateId,
      siteId: gen.siteId,
      reportType: gen.reportType,
      periodStart: gen.periodStart.toISOString().slice(0, 10),
      periodEnd: gen.periodEnd.toISOString().slice(0, 10),
      generatedBy: gen.generatedBy,
      status: gen.status,
      filePath: gen.filePath,
      fileName: gen.fileName,
      errorMessage: gen.errorMessage,
      generatedAt: gen.generatedAt.toISOString(),
      createdAt: gen.createdAt.toISOString(),
      template: gen.template
        ? {
            id: gen.template.id,
            name: gen.template.name,
            code: gen.template.code,
            fileType: gen.template.fileType,
            version: gen.template.version,
            status: gen.template.status,
            createdAt: gen.template.createdAt.toISOString(),
            updatedAt: gen.template.updatedAt.toISOString(),
          }
        : undefined,
    }));

    return {
      data,
      meta: formatPaginationMeta(safePage, safeLimit, total),
    };
  }

  // ── 9. AI Models & Versions ────────────────────────────────────────────────

  async findAiModels(): Promise<AiModelDto[]> {
    const models = await this.prisma.aiModel.findMany({
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return models.map((m) => ({
      id: m.id,
      name: m.name,
      code: m.code,
      modelType: m.modelType,
      description: m.description,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      versions: m.versions.map((v) => ({
        id: v.id,
        modelId: v.modelId,
        version: v.version,
        modelPath: v.modelPath,
        framework: v.framework,
        inputSize: v.inputSize,
        status: v.status,
        metrics: v.metrics as any,
        deployedAt: v.deployedAt?.toISOString() ?? null,
        createdAt: v.createdAt.toISOString(),
      })),
    }));
  }

  async findAiModelById(id: string): Promise<AiModelDto | null> {
    const m = await this.prisma.aiModel.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!m) return null;

    return {
      id: m.id,
      name: m.name,
      code: m.code,
      modelType: m.modelType,
      description: m.description,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      versions: m.versions.map((v) => ({
        id: v.id,
        modelId: v.modelId,
        version: v.version,
        modelPath: v.modelPath,
        framework: v.framework,
        inputSize: v.inputSize,
        status: v.status,
        metrics: v.metrics as any,
        deployedAt: v.deployedAt?.toISOString() ?? null,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  async findAiModelByCode(code: string): Promise<AiModelDto | null> {
    const m = await this.prisma.aiModel.findUnique({
      where: { code },
    });
    if (!m) return null;
    return {
      id: m.id,
      name: m.name,
      code: m.code,
      modelType: m.modelType,
      description: m.description,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }

  async createAiModel(dto: CreateAiModelDto): Promise<AiModelDto> {
    const m = await this.prisma.aiModel.create({
      data: {
        name: dto.name,
        code: dto.code,
        modelType: dto.modelType,
        description: dto.description ?? null,
      },
    });
    return {
      id: m.id,
      name: m.name,
      code: m.code,
      modelType: m.modelType,
      description: m.description,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      versions: [],
    };
  }

  async findAiModelVersionById(
    versionId: string,
  ): Promise<AiModelVersionDto | null> {
    const v = await this.prisma.aiModelVersion.findUnique({
      where: { id: versionId },
    });
    if (!v) return null;
    return {
      id: v.id,
      modelId: v.modelId,
      version: v.version,
      modelPath: v.modelPath,
      framework: v.framework,
      inputSize: v.inputSize,
      status: v.status,
      metrics: v.metrics as any,
      deployedAt: v.deployedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    };
  }

  async findAiModelVersionByModelAndVersion(
    modelId: string,
    version: string,
  ): Promise<AiModelVersionDto | null> {
    const v = await this.prisma.aiModelVersion.findFirst({
      where: { modelId, version },
    });
    if (!v) return null;
    return {
      id: v.id,
      modelId: v.modelId,
      version: v.version,
      modelPath: v.modelPath,
      framework: v.framework,
      inputSize: v.inputSize,
      status: v.status,
      metrics: v.metrics as any,
      deployedAt: v.deployedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    };
  }

  async createAiModelVersion(
    modelId: string,
    dto: CreateAiModelVersionDto,
  ): Promise<AiModelVersionDto> {
    const v = await this.prisma.aiModelVersion.create({
      data: {
        modelId,
        version: dto.version,
        modelPath: dto.modelPath ?? null,
        framework: dto.framework || "PyTorch",
        inputSize: dto.inputSize || "640x640",
        metrics: dto.metrics ? (dto.metrics as any) : undefined,
        status: AI_MODEL_VERSION_STATUS.DEVELOPMENT,
      },
    });

    return {
      id: v.id,
      modelId: v.modelId,
      version: v.version,
      modelPath: v.modelPath,
      framework: v.framework,
      inputSize: v.inputSize,
      status: v.status,
      metrics: v.metrics as any,
      deployedAt: v.deployedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    };
  }

  async deployAiModelVersion(
    modelId: string,
    versionId: string,
  ): Promise<AiModelVersionDto> {
    return this.prisma.$transaction(async (tx) => {
      // Đánh dấu các version cũ cùng model là ARCHIVED
      await tx.aiModelVersion.updateMany({
        where: {
          modelId,
          status: AI_MODEL_VERSION_STATUS.DEPLOYED,
        },
        data: {
          status: AI_MODEL_VERSION_STATUS.ARCHIVED,
        },
      });

      const updated = await tx.aiModelVersion.update({
        where: { id: versionId },
        data: {
          status: AI_MODEL_VERSION_STATUS.DEPLOYED,
          deployedAt: new Date(),
        },
      });

      return {
        id: updated.id,
        modelId: updated.modelId,
        version: updated.version,
        modelPath: updated.modelPath,
        framework: updated.framework,
        inputSize: updated.inputSize,
        status: updated.status,
        metrics: updated.metrics as any,
        deployedAt: updated.deployedAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
      };
    });
  }

  async checkDatabaseHealth(): Promise<boolean> {
    try {
      await (reportingPrisma as any).$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

export const reportingRepository = new ReportingRepository();
