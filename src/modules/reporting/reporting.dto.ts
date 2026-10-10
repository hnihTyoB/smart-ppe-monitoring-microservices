import {
  ReportType,
  ReportStatus,
  ReportFileType,
  ReportTemplateStatus,
  AiModelType,
  AiModelStatus,
  AiModelVersionStatus,
  StatisticGroupBy,
} from "../../common/constants/reporting.constant";
import { PaginationMeta } from "../../common/types/pagination.type";

export interface PaginatedResultDto<T> {
  data: T[];
  meta: PaginationMeta;
}

// ── Dashboard & KPI Filter DTOs ───────────────────────────────────────────────

export interface DashboardFilterDto {
  siteId?: string;
  startDate?: string;
  endDate?: string;
}

export interface TrendsFilterDto extends DashboardFilterDto {
  groupBy?: StatisticGroupBy;
}

export interface CameraStatsFilterDto extends DashboardFilterDto {
  limit?: number;
}

export interface AiPerformanceFilterDto {
  cameraId?: string;
  startDate?: string;
  endDate?: string;
}

// ── Dashboard Summary & Analytics Results DTOs ───────────────────────────────

export interface StatisticsSummaryDto {
  totalIncidents: number;
  openIncidents: number;
  resolvedIncidents: number;
  trueViolations: number;
  falseAlarms: number;
  falseAlarmRate: number; // Tỷ lệ cảnh báo sai: 0 - 100%
  complianceRate: number; // Tỷ lệ tuân thủ an toàn: 0 - 100%
  meanTimeToResolveHours: number; // Thời gian giải quyết trung bình (MTTR)
  periodStart?: string;
  periodEnd?: string;
}

export interface TrendItemDto {
  date: string;
  totalIncidents: number;
  trueViolations: number;
  falseAlarms: number;
  resolvedCount: number;
}

export interface ViolationTypeStatDto {
  violationType: string;
  count: number;
  percentage: number;
  severityBreakdown: {
    LOW: number;
    NORMAL: number;
    MEDIUM: number;
    HIGH: number;
    CRITICAL: number;
  };
}

export interface CameraStatDto {
  cameraId: string;
  totalViolations: number;
  confirmedCount: number;
  falseAlarmCount: number;
  resolvedCount: number;
}

export interface AiPerformanceStatDto {
  id: string;
  cameraId: string;
  modelVersionId?: string | null;
  statDate: string;
  avgFps: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  totalFrames: string;
}

export interface RecordAiPerformanceDto {
  cameraId: string;
  modelVersionId?: string;
  statDate?: string;
  fps: number;
  latencyMs: number;
  frameCount?: number;
}

export interface AggregateDailyDto {
  siteId: string;
  statDate: string;
}

// ── Report Templates & Generations DTOs ───────────────────────────────────────

export interface ReportTemplateDto {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  fileType: ReportFileType | string;
  version: string;
  status: ReportTemplateStatus | string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportTemplateDto {
  name: string;
  code: string;
  description?: string;
  filePath?: string;
  fileName?: string;
  fileType?: ReportFileType | string;
  version?: string;
}

export interface GenerateReportDto {
  templateId: string;
  siteId: string;
  reportType: ReportType | string;
  periodStart: string;
  periodEnd: string;
}

export interface ReportGenerationDto {
  id: string;
  templateId: string;
  siteId: string;
  reportType: ReportType | string;
  periodStart: string;
  periodEnd: string;
  generatedBy: string;
  status: ReportStatus | string;
  filePath?: string | null;
  fileName?: string | null;
  errorMessage?: string | null;
  generatedAt: string;
  createdAt: string;
  template?: ReportTemplateDto;
}

export interface ReportHistoryQueryDto {
  page?: number;
  limit?: number;
  siteId?: string;
  reportType?: string;
  status?: string;
}

// ── AI Models & Version Governance DTOs ───────────────────────────────────────

export interface AiModelDto {
  id: string;
  name: string;
  code: string;
  modelType: AiModelType | string;
  description?: string | null;
  status: AiModelStatus | string;
  createdAt: string;
  updatedAt: string;
  versions?: AiModelVersionDto[];
}

export interface CreateAiModelDto {
  name: string;
  code: string;
  modelType: AiModelType | string;
  description?: string;
}

export interface AiModelVersionDto {
  id: string;
  modelId: string;
  version: string;
  modelPath?: string | null;
  framework: string;
  inputSize: string;
  status: AiModelVersionStatus | string;
  metrics?: Record<string, any> | null;
  deployedAt?: string | null;
  createdAt: string;
}

export interface CreateAiModelVersionDto {
  version: string;
  modelPath?: string;
  framework?: string;
  inputSize?: string;
  metrics?: {
    precision?: number;
    recall?: number;
    f1?: number;
    mAP50?: number;
    mAP95?: number;
    fps?: number;
    latencyMs?: number;
    [key: string]: any;
  };
}
