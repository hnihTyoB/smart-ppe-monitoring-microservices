import type {
  AiVisionIngestionStatus,
  AiVisionMode,
} from "../../common/constants/broker.constant";
import type {
  PPE_DETECTION_CLASS,
  PPE_VIOLATION_TYPES,
  PPE_SEVERITY,
} from "../../common/constants/kafka.constant";

export interface BoundingBoxDto {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AiVisionDetectionItemDto {
  class: keyof typeof PPE_DETECTION_CLASS | string;
  confidence: number;
  box: BoundingBoxDto;
  trackId?: number;
}

export interface AiVisionViolationItemDto {
  violationType: keyof typeof PPE_VIOLATION_TYPES | string;
  severity: keyof typeof PPE_SEVERITY | string;
  description: string;
  confidence: number;
  box?: BoundingBoxDto;
  workerName?: string | null;
  workerId?: string | null;
}

export interface AiVisionEvidenceDto {
  snapshotUrl: string;
  clipUrl?: string;
  frameResolution: {
    width: number;
    height: number;
  };
}

export interface AiVisionSummaryDto {
  totalPersons: number;
  totalViolations: number;
  highestSeverity: keyof typeof PPE_SEVERITY | string;
}

export interface AiVisionMetadataDto {
  modelVersion?: string;
  fps?: number;
  inferenceLatencyMs?: number;
  edgeDeviceId?: string;
  [key: string]: unknown;
}

export interface AiVisionCameraRefDto {
  id?: string;
  code?: string;
  name?: string;
  zone?: string;
}

export interface AiVisionSiteRefDto {
  id?: string;
  code?: string;
  name?: string;
}

/**
 * DTO nhận diện sự kiện vi phạm gửi từ AI Vision Edge Pipeline (ALL-03 / VI-11)
 * Hỗ trợ cả định dạng Full Envelope lẫn Lightweight Edge Payload
 */
export interface AiVisionIngestEventDto {
  violationId?: string;
  eventId?: string;
  timestamp?: string;
  site?: AiVisionSiteRefDto;
  camera?: AiVisionCameraRefDto;
  // Fallback shorthand fields hỗ trợ Edge AI gửi trực tiếp
  cameraId?: string;
  cameraCode?: string;
  siteId?: string;
  siteCode?: string;
  evidence: AiVisionEvidenceDto;
  detections?: AiVisionDetectionItemDto[];
  violations: AiVisionViolationItemDto[];
  summary?: AiVisionSummaryDto;
  metadata?: AiVisionMetadataDto;
  sync?: boolean;
}

/**
 * DTO nạp hàng loạt sự kiện lưu tạm tại Edge (Local Buffer Recovery)
 */
export interface AiVisionBatchIngestDto {
  events: AiVisionIngestEventDto[];
  sync?: boolean;
}

/**
 * DTO mô phỏng sự kiện vi phạm an toàn lao động (Testing / Live Demo)
 */
export interface AiVisionSimulateDto {
  violationType?: keyof typeof PPE_VIOLATION_TYPES | string;
  severity?: keyof typeof PPE_SEVERITY | string;
  confidence?: number;
  cameraId?: string;
  cameraCode?: string;
  siteId?: string;
  siteCode?: string;
  workerName?: string;
  workerId?: string;
  snapshotUrl?: string;
  sync?: boolean;
}

export interface IncidentBriefDto {
  id: string;
  violationType: string;
  severity: string;
  status: string;
  siteId: string;
  cameraId: string;
  detectedAt: string | Date;
  evidenceId?: string;
}

/**
 * Phản hồi chi tiết sau khi tiếp nhận sự kiện
 */
export interface AiVisionIngestResultDto {
  eventId: string;
  violationId: string;
  traceId: string;
  status: AiVisionIngestionStatus;
  mode: AiVisionMode;
  message?: string;
  incident?: IncidentBriefDto;
}

/**
 * Phản hồi kết quả xử lý theo lô (Batch)
 */
export interface AiVisionBatchResultDto {
  total: number;
  ingested: number;
  duplicates: number;
  failed: number;
  results: AiVisionIngestResultDto[];
}

/**
 * Đặc tả Hợp đồng dữ liệu ALL-03 / VI-11
 */
export interface AiVisionContractDto {
  contractVersion: string;
  description: string;
  topic: string;
  envelopeSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
  samples: Record<string, unknown>;
}

/**
 * Sức khỏe đường ống tích hợp AI Vision
 */
export interface AiVisionHealthDto {
  status: "UP" | "DOWN" | "DEGRADED";
  timestamp: string;
  pipeline: {
    broker: "CONNECTED" | "DISCONNECTED";
    cameraDatabase: "CONNECTED" | "DISCONNECTED";
    siteDatabase: "CONNECTED" | "DISCONNECTED";
    incidentDatabase: "CONNECTED" | "DISCONNECTED";
  };
}
