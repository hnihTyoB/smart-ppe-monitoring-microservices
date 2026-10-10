import { ReportingRepository } from "./reporting.repository";
import { RbacRepository } from "../rbac/rbac.repository";
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
  AggregateDailyDto,
  ReportTemplateDto,
  CreateReportTemplateDto,
  GenerateReportDto,
  ReportGenerationDto,
  ReportHistoryQueryDto,
  AiModelDto,
  CreateAiModelDto,
  AiModelVersionDto,
  CreateAiModelVersionDto,
  PaginatedResultDto,
} from "./reporting.dto";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODE } from "../../common/errors/error-code";
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../../common/constants/audit-log.constant";

export class ReportingService {
  private readonly repository: ReportingRepository;
  private readonly rbacRepository?: RbacRepository;

  constructor(
    repository?: ReportingRepository,
    rbacRepository?: RbacRepository,
  ) {
    this.repository = repository || new ReportingRepository();
    this.rbacRepository = rbacRepository || new RbacRepository();
  }

  private async logAudit(data: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
  }) {
    if (!this.rbacRepository) return;
    try {
      await this.rbacRepository.createAuditLog({
        actorId: data.actorId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        details: data.details,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      });
    } catch (err: any) {
      console.warn(
        "[ReportingService] AuditLog recording non-blocking warning:",
        err?.message || err,
      );
    }
  }

  // ── 1. Dashboard Statistics & Overview KPIs ─────────────────────────────────

  async getDashboardSummary(
    filter: DashboardFilterDto,
  ): Promise<StatisticsSummaryDto> {
    return this.repository.getIncidentSummary(filter);
  }

  async getViolationTrends(filter: TrendsFilterDto): Promise<TrendItemDto[]> {
    return this.repository.getIncidentTrends(filter);
  }

  async getViolationDistribution(
    filter: DashboardFilterDto,
  ): Promise<ViolationTypeStatDto[]> {
    return this.repository.getViolationBreakdown(filter);
  }

  async getCameraRankings(
    filter: CameraStatsFilterDto,
  ): Promise<CameraStatDto[]> {
    return this.repository.getCameraRankings(filter);
  }

  // ── 2. AI Performance Statistics & Telemetry ───────────────────────────────

  async getAiPerformanceMetrics(
    filter: AiPerformanceFilterDto,
  ): Promise<AiPerformanceStatDto[]> {
    return this.repository.getAiPerformanceStats(filter);
  }

  async recordAiPerformance(
    dto: RecordAiPerformanceDto,
  ): Promise<AiPerformanceStatDto> {
    return this.repository.recordAiPerformanceMetric(dto);
  }

  // ── 3. Daily Rollup Aggregation ────────────────────────────────────────────

  async aggregateDailyStats(
    dto: AggregateDailyDto,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ) {
    const statDate = new Date(dto.statDate);

    // Rollup mẫu tổng hợp
    const incidentStat = await this.repository.upsertIncidentStatistic({
      siteId: dto.siteId,
      statDate,
      totalIncidents: 0,
      openIncidents: 0,
      resolvedIncidents: 0,
      falseAlarms: 0,
      trueViolations: 0,
    });

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.AGGREGATE_DAILY_STATISTICS,
      targetType: AUDIT_TARGET_TYPE.PPE_REPORT,
      targetId: incidentStat.id,
      details: { siteId: dto.siteId, statDate: dto.statDate },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return incidentStat;
  }

  // ── 4. Report Templates ────────────────────────────────────────────────────

  async listReportTemplates(): Promise<ReportTemplateDto[]> {
    return this.repository.findReportTemplates();
  }

  async getReportTemplateById(id: string): Promise<ReportTemplateDto> {
    const template = await this.repository.findReportTemplateById(id);
    if (!template) {
      throw new AppError(
        "Report template not found",
        404,
        ERROR_CODE.REPORT_TEMPLATE_NOT_FOUND,
      );
    }
    return template;
  }

  async createReportTemplate(
    dto: CreateReportTemplateDto,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<ReportTemplateDto> {
    const existing = await this.repository.findReportTemplateByCode(dto.code);
    if (existing) {
      throw new AppError(
        `Report template code '${dto.code}' already exists`,
        409,
        ERROR_CODE.DUPLICATE_ENTRY,
      );
    }

    const created = await this.repository.createReportTemplate(
      dto,
      context?.actorId,
    );

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.CREATE_REPORT_TEMPLATE,
      targetType: AUDIT_TARGET_TYPE.PPE_REPORT,
      targetId: created.id,
      details: { code: created.code, name: created.name },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return created;
  }

  // ── 5. Report Generation & Export ──────────────────────────────────────────

  async generateReport(
    dto: GenerateReportDto,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<ReportGenerationDto> {
    const template = await this.repository.findReportTemplateById(
      dto.templateId,
    );
    if (!template) {
      throw new AppError(
        "Report template not found",
        404,
        ERROR_CODE.REPORT_TEMPLATE_NOT_FOUND,
      );
    }

    const actorId = context?.actorId || "00000000-0000-0000-0000-000000000000";
    const generated = await this.repository.createReportGeneration(
      dto,
      actorId,
    );

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.GENERATE_PPE_REPORT,
      targetType: AUDIT_TARGET_TYPE.PPE_REPORT,
      targetId: generated.id,
      details: {
        reportType: dto.reportType,
        siteId: dto.siteId,
        period: `${dto.periodStart} to ${dto.periodEnd}`,
      },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return generated;
  }

  async listReportGenerations(
    query: ReportHistoryQueryDto,
  ): Promise<PaginatedResultDto<ReportGenerationDto>> {
    return this.repository.findReportGenerations(query);
  }

  async getReportGenerationDownload(id: string) {
    const report = await this.repository.findReportGenerationById(id);
    if (!report) {
      throw new AppError(
        "Report generation not found",
        404,
        ERROR_CODE.REPORT_GENERATION_NOT_FOUND,
      );
    }

    return {
      report,
      downloadUrl: `/api/v1/files/download/${report.id}`,
      contentType: "application/pdf",
      fileName: report.fileName || `report_${report.id}.pdf`,
    };
  }

  // ── 6. AI Models & Governance ──────────────────────────────────────────────

  async listAiModels(): Promise<AiModelDto[]> {
    return this.repository.findAiModels();
  }

  async getAiModelById(id: string): Promise<AiModelDto> {
    const model = await this.repository.findAiModelById(id);
    if (!model) {
      throw new AppError(
        "AI Model not found",
        404,
        ERROR_CODE.AI_MODEL_NOT_FOUND,
      );
    }
    return model;
  }

  async createAiModel(
    dto: CreateAiModelDto,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<AiModelDto> {
    const existing = await this.repository.findAiModelByCode(dto.code);
    if (existing) {
      throw new AppError(
        `AI Model code '${dto.code}' already exists`,
        409,
        ERROR_CODE.DUPLICATE_ENTRY,
      );
    }

    const created = await this.repository.createAiModel(dto);

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.CREATE_AI_MODEL,
      targetType: AUDIT_TARGET_TYPE.PPE_AI_MODEL,
      targetId: created.id,
      details: { code: created.code, name: created.name },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return created;
  }

  async createAiModelVersion(
    modelId: string,
    dto: CreateAiModelVersionDto,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<AiModelVersionDto> {
    const model = await this.repository.findAiModelById(modelId);
    if (!model) {
      throw new AppError(
        "AI Model not found",
        404,
        ERROR_CODE.AI_MODEL_NOT_FOUND,
      );
    }

    const existingVersion =
      await this.repository.findAiModelVersionByModelAndVersion(
        modelId,
        dto.version,
      );
    if (existingVersion) {
      throw new AppError(
        `AI Model version '${dto.version}' already exists for this model`,
        409,
        ERROR_CODE.DUPLICATE_ENTRY,
      );
    }

    const version = await this.repository.createAiModelVersion(modelId, dto);

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.CREATE_AI_MODEL_VERSION,
      targetType: AUDIT_TARGET_TYPE.PPE_AI_MODEL,
      targetId: version.id,
      details: { modelId, version: version.version },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return version;
  }

  async deployAiModelVersion(
    modelId: string,
    versionId: string,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<AiModelVersionDto> {
    const model = await this.repository.findAiModelById(modelId);
    if (!model) {
      throw new AppError(
        "AI Model not found",
        404,
        ERROR_CODE.AI_MODEL_NOT_FOUND,
      );
    }

    const version = await this.repository.findAiModelVersionById(versionId);
    if (!version || version.modelId !== modelId) {
      throw new AppError(
        "AI Model Version not found for this model",
        404,
        ERROR_CODE.AI_MODEL_VERSION_NOT_FOUND,
      );
    }

    const deployed = await this.repository.deployAiModelVersion(
      modelId,
      versionId,
    );

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.DEPLOY_AI_MODEL_VERSION,
      targetType: AUDIT_TARGET_TYPE.PPE_AI_MODEL,
      targetId: deployed.id,
      details: { modelId, version: deployed.version },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return deployed;
  }
}
