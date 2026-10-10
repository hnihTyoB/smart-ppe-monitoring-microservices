import { Request, Response, NextFunction } from "express";
import { ReportingService } from "./reporting.service";
import {
  DashboardFilterDto,
  TrendsFilterDto,
  CameraStatsFilterDto,
  AiPerformanceFilterDto,
  RecordAiPerformanceDto,
  AggregateDailyDto,
  CreateReportTemplateDto,
  GenerateReportDto,
  ReportHistoryQueryDto,
  CreateAiModelDto,
  CreateAiModelVersionDto,
} from "./reporting.dto";

export class ReportingController {
  private readonly service: ReportingService;

  constructor(service?: ReportingService) {
    this.service = service || new ReportingService();
  }

  // ── 1. Statistics & Dashboard Endpoints ─────────────────────────────────────

  getDashboardSummary = async (
    req: Request<unknown, unknown, unknown, DashboardFilterDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const summary = await this.service.getDashboardSummary(req.query);
      return res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      return next(error);
    }
  };

  getViolationTrends = async (
    req: Request<unknown, unknown, unknown, TrendsFilterDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const trends = await this.service.getViolationTrends(req.query);
      return res.status(200).json({
        success: true,
        data: trends,
      });
    } catch (error) {
      return next(error);
    }
  };

  getViolationDistribution = async (
    req: Request<unknown, unknown, unknown, DashboardFilterDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const distribution = await this.service.getViolationDistribution(
        req.query,
      );
      return res.status(200).json({
        success: true,
        data: distribution,
      });
    } catch (error) {
      return next(error);
    }
  };

  getCameraRankings = async (
    req: Request<unknown, unknown, unknown, CameraStatsFilterDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const rankings = await this.service.getCameraRankings(req.query);
      return res.status(200).json({
        success: true,
        data: rankings,
      });
    } catch (error) {
      return next(error);
    }
  };

  getAiPerformance = async (
    req: Request<unknown, unknown, unknown, AiPerformanceFilterDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const performance = await this.service.getAiPerformanceMetrics(
        req.query,
      );
      return res.status(200).json({
        success: true,
        data: performance,
      });
    } catch (error) {
      return next(error);
    }
  };

  recordAiPerformance = async (
    req: Request<unknown, unknown, RecordAiPerformanceDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const metric = await this.service.recordAiPerformance(req.body);
      return res.status(201).json({
        success: true,
        message: "AI performance telemetry recorded successfully",
        data: metric,
      });
    } catch (error) {
      return next(error);
    }
  };

  aggregateDaily = async (
    req: Request<unknown, unknown, AggregateDailyDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.service.aggregateDailyStats(req.body, {
        actorId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      return res.status(200).json({
        success: true,
        message: "Daily rollup statistics aggregated successfully",
        data: result,
      });
    } catch (error) {
      return next(error);
    }
  };

  // ── 2. Report Templates & Generations Endpoints ─────────────────────────────

  listReportTemplates = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const templates = await this.service.listReportTemplates();
      return res.status(200).json({
        success: true,
        data: templates,
      });
    } catch (error) {
      return next(error);
    }
  };

  getReportTemplateById = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const template = await this.service.getReportTemplateById(req.params.id);
      return res.status(200).json({
        success: true,
        data: template,
      });
    } catch (error) {
      return next(error);
    }
  };

  createReportTemplate = async (
    req: Request<unknown, unknown, CreateReportTemplateDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const created = await this.service.createReportTemplate(req.body, {
        actorId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      return res.status(201).json({
        success: true,
        message: "Report template created successfully",
        data: created,
      });
    } catch (error) {
      return next(error);
    }
  };

  generateReport = async (
    req: Request<unknown, unknown, GenerateReportDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const generated = await this.service.generateReport(req.body, {
        actorId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      return res.status(201).json({
        success: true,
        message: "Report generated successfully",
        data: generated,
      });
    } catch (error) {
      return next(error);
    }
  };

  listReportGenerations = async (
    req: Request<unknown, unknown, unknown, ReportHistoryQueryDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.service.listReportGenerations(req.query);
      return res.status(200).json({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    } catch (error) {
      return next(error);
    }
  };

  getReportGenerationDownload = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const download = await this.service.getReportGenerationDownload(
        req.params.id,
      );
      return res.status(200).json({
        success: true,
        data: download,
      });
    } catch (error) {
      return next(error);
    }
  };

  // ── 3. AI Models & Governance Endpoints ─────────────────────────────────────

  listAiModels = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const models = await this.service.listAiModels();
      return res.status(200).json({
        success: true,
        data: models,
      });
    } catch (error) {
      return next(error);
    }
  };

  getAiModelById = async (
    req: Request<{ id: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const model = await this.service.getAiModelById(req.params.id);
      return res.status(200).json({
        success: true,
        data: model,
      });
    } catch (error) {
      return next(error);
    }
  };

  createAiModel = async (
    req: Request<unknown, unknown, CreateAiModelDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const created = await this.service.createAiModel(req.body, {
        actorId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      return res.status(201).json({
        success: true,
        message: "AI Model registered successfully",
        data: created,
      });
    } catch (error) {
      return next(error);
    }
  };

  createAiModelVersion = async (
    req: Request<{ id: string }, unknown, CreateAiModelVersionDto>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const version = await this.service.createAiModelVersion(
        req.params.id,
        req.body,
        {
          actorId: req.user?.id,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        },
      );
      return res.status(201).json({
        success: true,
        message: "AI Model version registered successfully",
        data: version,
      });
    } catch (error) {
      return next(error);
    }
  };

  deployAiModelVersion = async (
    req: Request<{ id: string; versionId: string }>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const deployed = await this.service.deployAiModelVersion(
        req.params.id,
        req.params.versionId,
        {
          actorId: req.user?.id,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
        },
      );
      return res.status(200).json({
        success: true,
        message: "AI Model version deployed successfully",
        data: deployed,
      });
    } catch (error) {
      return next(error);
    }
  };
}
