import { generateId } from "../../common/helpers/uuid.helper";
import { getTraceId } from "../../common/context/trace-context";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODE } from "../../common/errors/error-code";
import {
  AI_VISION_INGESTION_STATUS,
  AI_VISION_MODE,
  BROKER_TOPICS,
  BROKER_INGESTION_SOURCE,
} from "../../common/constants/broker.constant";
import {
  PPE_VIOLATION_TYPES,
  PPE_SEVERITY,
  PPE_DETECTION_CLASS,
} from "../../common/constants/kafka.constant";
import { eventBus, EventBusService } from "../../common/services/event-bus.service";
import {
  PpeViolationSubscriber,
} from "../../common/subscribers/ppe-violation.subscriber";
import {
  IncidentRepository,
  incidentRepository,
} from "../incident/incident.repository";
import {
  CameraRepository,
  cameraRepository,
} from "../camera/camera.repository";
import {
  SiteRepository,
  siteRepository,
} from "../site/site.repository";
import {
  ReliabilityService,
  reliabilityService,
} from "../reliability/reliability.service";
import type {
  AiVisionIngestEventDto,
  AiVisionBatchIngestDto,
  AiVisionSimulateDto,
  AiVisionIngestResultDto,
  AiVisionBatchResultDto,
  AiVisionContractDto,
  AiVisionHealthDto,
  AiVisionCameraRefDto,
  AiVisionSiteRefDto,
} from "./ai-vision.dto";
import type {
  EventEnvelope,
} from "../../common/types/event.type";
import type {
  PPEViolationDetectedPayload,
  PPEViolationType,
  PPESeverity,
  PPEDetectionClass,
} from "../../common/types/kafka-event.type";

export class AiVisionIntegrationService {
  private readonly bus: EventBusService;
  private readonly incidentRepo: IncidentRepository;
  private readonly cameraRepo: CameraRepository;
  private readonly siteRepo: SiteRepository;
  private readonly subscriber: PpeViolationSubscriber;
  private readonly reliability: ReliabilityService;
  private cachedHealth: { data: AiVisionHealthDto; expiresAt: number } | null = null;

  constructor(
    bus?: EventBusService,
    incidentRepo?: IncidentRepository,
    cameraRepo?: CameraRepository,
    siteRepo?: SiteRepository,
    subscriber?: PpeViolationSubscriber,
    reliability?: ReliabilityService,
  ) {
    this.bus = bus || eventBus;
    this.incidentRepo = incidentRepo || incidentRepository;
    this.cameraRepo = cameraRepo || cameraRepository;
    this.siteRepo = siteRepo || siteRepository;
    this.reliability = reliability || reliabilityService;
    this.subscriber =
      subscriber ||
      new PpeViolationSubscriber(
        this.bus,
        this.incidentRepo,
        undefined,
        undefined,
        undefined,
        this.reliability,
      );
  }

  /**
   * 1. Tiếp nhận và xử lý sự kiện vi phạm an toàn từ AI Vision Edge Pipeline (ALL-03 / VI-11)
   */
  public async ingestEvent(
    rawInput: AiVisionIngestEventDto,
    options?: { sync?: boolean },
  ): Promise<AiVisionIngestResultDto> {
    const traceId = getTraceId() || generateId();
    const isSync = Boolean(options?.sync || rawInput.sync);

    // ── B1. Tự động tra cứu và làm giàu siêu dữ liệu Camera & Site (Auto-Enrichment) ──
    const { camera, site } = await this.resolveAndEnrichCameraAndSite(rawInput);

    // ── B2. Chuẩn hóa Bằng chứng (Snapshot URL & StorageKey) ──────────────────────────
    const cleanSnapshotUrl = rawInput.evidence.snapshotUrl.split("?")[0];
    const cleanClipUrl = rawInput.evidence.clipUrl
      ? rawInput.evidence.clipUrl.split("?")[0]
      : undefined;
    const violationId = rawInput.violationId || generateId();
    const eventId = rawInput.eventId || generateId();
    const timestamp = rawInput.timestamp || new Date().toISOString();

    // ── B3. Chuẩn hóa Summary vi phạm ────────────────────────────────────────────────
    const summary = rawInput.summary || {
      totalPersons: rawInput.detections?.length || 1,
      totalViolations: rawInput.violations.length,
      highestSeverity:
        rawInput.violations.find((v) => v.severity === PPE_SEVERITY.CRITICAL)?.severity ||
        rawInput.violations.find((v) => v.severity === PPE_SEVERITY.HIGH)?.severity ||
        rawInput.violations[0]?.severity ||
        PPE_SEVERITY.HIGH,
    };

    // ── B4. Lắp ráp Payload hợp chuẩn ALL-03 / VI-11 ──────────────────────────────────
    const payload: PPEViolationDetectedPayload = {
      violationId,
      timestamp,
      site: {
        id: site.id || generateId(),
        code: site.code || "SITE-DEFAULT",
        name: site.name || "Công trường mặc định",
      },
      camera: {
        id: camera.id || generateId(),
        code: camera.code || "CAM-DEFAULT",
        name: camera.name || "Camera mặc định",
        zone: camera.zone || "Khu vực thi công",
      },
      evidence: {
        snapshotUrl: cleanSnapshotUrl,
        clipUrl: cleanClipUrl,
        frameResolution: rawInput.evidence.frameResolution || {
          width: 1920,
          height: 1080,
        },
      },
      detections: (rawInput.detections || []).map((d) => ({
        class: d.class as PPEDetectionClass,
        confidence: d.confidence,
        box: d.box,
        trackId: d.trackId,
      })),
      violations: rawInput.violations.map((v) => ({
        violationType: v.violationType as PPEViolationType,
        severity: v.severity as PPESeverity,
        description: v.description,
        confidence: v.confidence,
        box: v.box,
        workerName: v.workerName,
        workerId: v.workerId,
      })),
      summary: {
        totalPersons: summary.totalPersons,
        totalViolations: summary.totalViolations,
        highestSeverity: summary.highestSeverity as PPESeverity,
      },
      metadata: {
        ...rawInput.metadata,
        ingestionSource: BROKER_INGESTION_SOURCE.AI_INFERENCE_ENGINE,
        enrichedAt: new Date().toISOString(),
      },
    };

    const envelope: EventEnvelope<PPEViolationDetectedPayload> = {
      id: eventId,
      name: BROKER_TOPICS.PPE_VIOLATION_DETECTED,
      aggregateId: payload.site.id,
      traceId,
      timestamp: Date.now(),
      source: BROKER_INGESTION_SOURCE.AI_INFERENCE_ENGINE,
      payload,
    };

    // ── B5. Kiểm tra Idempotency & Deduplication Guard (Task BE-13) ───────────────────
    const existingIncident = await this.incidentRepo.findIncidentByViolationId(violationId);
    if (existingIncident) {
      console.log(
        `[AiVisionIntegrationService] ⏭️ Violation ${violationId} already persisted as Incident ${existingIncident.id}. Returning existing.`,
      );
      return {
        eventId,
        violationId,
        traceId,
        status: AI_VISION_INGESTION_STATUS.DUPLICATE,
        mode: isSync ? AI_VISION_MODE.SYNC : AI_VISION_MODE.ASYNC,
        message: "Duplicate violation ignored (already processed in CSDL)",
        incident: {
          id: existingIncident.id,
          violationType: existingIncident.violationType,
          severity: existingIncident.severity,
          status: existingIncident.status,
          siteId: existingIncident.siteId,
          cameraId: existingIncident.cameraId,
          detectedAt: existingIncident.detectedAt,
          evidenceId: existingIncident.evidences?.[0]?.id,
        },
      };
    }

    // ── B6. Thực thi chế độ Ingestion: Sync (Chờ tạo Incident) vs Async (Đẩy Queue) ────
    if (isSync) {
      // Gọi trực tiếp Incident Consumer để ghi bản ghi vào CSDL tức thì
      await this.subscriber.handleIncidentConsumer(envelope);

      // Tra cứu bản ghi Incident vừa tạo thành công
      const created = await this.incidentRepo.findIncidentByViolationId(violationId);

      // Phát sự kiện lên EventBus để 3 consumer còn lại (Notification, Reporting, Audit) xử lý
      await this.bus.publish(
        BROKER_TOPICS.PPE_VIOLATION_DETECTED,
        payload,
        {
          aggregateId: payload.site.id,
          traceId,
          useOutbox: false,
        },
      );

      return {
        eventId,
        violationId,
        traceId,
        status: AI_VISION_INGESTION_STATUS.PROCESSED,
        mode: AI_VISION_MODE.SYNC,
        message: "AI event ingested and Incident successfully created in database",
        incident: created
          ? {
              id: created.id,
              violationType: created.violationType,
              severity: created.severity,
              status: created.status,
              siteId: created.siteId,
              cameraId: created.cameraId,
              detectedAt: created.detectedAt,
              evidenceId: created.evidences?.[0]?.id,
            }
          : undefined,
      };
    }

    // Async Mode (Mặc định): Đẩy vào EventBus / Transactional Outbox và trả về HTTP 202
    await this.bus.publish(
      BROKER_TOPICS.PPE_VIOLATION_DETECTED,
      payload,
      {
        aggregateId: payload.site.id,
        traceId,
        useOutbox: true,
      },
    );

    return {
      eventId,
      violationId,
      traceId,
      status: AI_VISION_INGESTION_STATUS.QUEUED,
      mode: AI_VISION_MODE.ASYNC,
      message: "AI event accepted and queued for fan-out processing",
    };
  }

  /**
   * 2. Xử lý nạp hàng loạt sự kiện (Batch Ingestion - Local Offline Buffer Recovery)
   */
  public async ingestBatch(
    batchInput: AiVisionBatchIngestDto,
    options?: { sync?: boolean },
  ): Promise<AiVisionBatchResultDto> {
    const isSync = Boolean(options?.sync || batchInput.sync);
    const results: AiVisionIngestResultDto[] = [];
    let ingestedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;

    for (const eventItem of batchInput.events) {
      try {
        const res = await this.ingestEvent(eventItem, { sync: isSync });
        results.push(res);
        if (res.status === AI_VISION_INGESTION_STATUS.DUPLICATE) {
          duplicateCount++;
        } else {
          ingestedCount++;
        }
      } catch (err: any) {
        failedCount++;
        const errorMessage =
          err instanceof AppError
            ? err.message
            : "Lỗi xử lý sự kiện vi phạm trong mẻ batch";
        results.push({
          eventId: eventItem.eventId || generateId(),
          violationId: eventItem.violationId || generateId(),
          traceId: getTraceId() || generateId(),
          status: AI_VISION_INGESTION_STATUS.FAILED,
          mode: isSync ? AI_VISION_MODE.SYNC : AI_VISION_MODE.ASYNC,
          message: errorMessage,
        });
      }
    }

    return {
      total: batchInput.events.length,
      ingested: ingestedCount,
      duplicates: duplicateCount,
      failed: failedCount,
      results,
    };
  }

  /**
   * 3. Giả lập sự kiện vi phạm an toàn lao động (Live Demo & Testing Rehearsal)
   */
  public async simulateViolation(
    simulateInput: AiVisionSimulateDto,
  ): Promise<AiVisionIngestResultDto> {
    // 1. Tìm camera mẫu nếu không chỉ định
    let targetCameraId = simulateInput.cameraId;
    let targetCameraCode = simulateInput.cameraCode;
    let targetSiteId = simulateInput.siteId;

    if (!targetCameraId && !targetCameraCode) {
      const cameraList = await this.cameraRepo.findAllCameras({ limit: 1 });
      if (cameraList.data && cameraList.data.length > 0) {
        const firstCam = cameraList.data[0];
        targetCameraId = firstCam.id;
        targetCameraCode = firstCam.code;
        targetSiteId = firstCam.siteId;
      }
    }

    const violationType =
      simulateInput.violationType || PPE_VIOLATION_TYPES.NO_HELMET;
    const severity = simulateInput.severity || PPE_SEVERITY.HIGH;
    const confidence = simulateInput.confidence ?? 0.95;

    const mockEvent: AiVisionIngestEventDto = {
      violationId: generateId(),
      timestamp: new Date().toISOString(),
      cameraId: targetCameraId,
      cameraCode: targetCameraCode,
      siteId: targetSiteId,
      evidence: {
        snapshotUrl:
          simulateInput.snapshotUrl ||
          `https://storage.ppe.local/evidences/simulation_${Date.now()}.jpg?X-Amz-Signature=mock`,
        clipUrl: `https://storage.ppe.local/evidences/simulation_${Date.now()}.mp4`,
        frameResolution: { width: 1920, height: 1080 },
      },
      detections: [
        {
          class: PPE_DETECTION_CLASS.PERSON,
          confidence: 0.96,
          box: { x: 200, y: 150, width: 250, height: 600 },
          trackId: 101,
        },
      ],
      violations: [
        {
          violationType,
          severity,
          confidence,
          description: `Mô phỏng tự động: Phát hiện vi phạm ${violationType}`,
          box: { x: 240, y: 160, width: 120, height: 90 },
          workerName: simulateInput.workerName || "Nguyễn Văn Demo",
          workerId: simulateInput.workerId || "NV-SIM-01",
        },
      ],
      summary: {
        totalPersons: 1,
        totalViolations: 1,
        highestSeverity: severity,
      },
      metadata: {
        isSimulation: true,
        simulatedAt: new Date().toISOString(),
      },
      sync: simulateInput.sync ?? true,
    };

    return this.ingestEvent(mockEvent, { sync: simulateInput.sync ?? true });
  }

  /**
   * 4. Xuất bản đặc tả hợp đồng dữ liệu AI Vision (ALL-03 / VI-11)
   */
  public getContractSpecification(): AiVisionContractDto {
    return {
      contractVersion: "2.1.0-PPE-STABLE",
      description:
        "Hợp đồng giao tiếp giữa Computer Vision Edge Pipeline (Python - SV2) và Backend Microservices (NodeJS - SV3)",
      topic: BROKER_TOPICS.PPE_VIOLATION_DETECTED,
      envelopeSchema: {
        eventId: "UUIDv7 (bắt buộc trong Envelope)",
        topic: BROKER_TOPICS.PPE_VIOLATION_DETECTED,
        traceId: "UUIDv7 Correlation ID (tiếp nhận hoặc tự sinh)",
        timestamp: "Epoch milliseconds",
        producer: BROKER_INGESTION_SOURCE.AI_INFERENCE_ENGINE,
        payload: "Xem payloadSchema",
      },
      payloadSchema: {
        violationId: "UUIDv7 (Tùy chọn, tự sinh nếu thiếu)",
        timestamp: "ISO 8601 UTC string",
        camera: {
          id: "UUID camera (hoặc cung cấp cameraCode tại gốc)",
          code: "Mã camera (VD: CAM-GATE-01)",
          name: "Tên vị trí camera",
          zone: "Khu vực giám sát",
        },
        site: {
          id: "UUID công trường (tự động làm giàu từ camera)",
          code: "Mã công trường",
          name: "Tên công trường",
        },
        evidence: {
          snapshotUrl: "URL ảnh chụp vi phạm trên MinIO/S3",
          clipUrl: "Tùy chọn: URL video clip 10-15s",
          frameResolution: "{ width: number, height: number }",
        },
        detections: "Danh sách bounding boxes nhận diện (PERSON, HELMET, VEST...)",
        violations: "Danh sách vi phạm (NO_HELMET, NO_VEST, RESTRICTED_AREA...)",
        summary: "{ totalPersons: number, totalViolations: number, highestSeverity: string }",
      },
      samples: {
        noHelmet: {
          cameraCode: "CAM-GATE-01",
          evidence: {
            snapshotUrl: "https://minio.ppe.local/ppe-evidences/snapshot_no_helmet.jpg",
            frameResolution: { width: 1920, height: 1080 },
          },
          violations: [
            {
              violationType: "NO_HELMET",
              severity: "HIGH",
              confidence: 0.94,
              description: "Công nhân không đội mũ bảo hộ tại cổng chính",
            },
          ],
        },
        noVest: {
          cameraCode: "CAM-ZONE-A",
          evidence: {
            snapshotUrl: "https://minio.ppe.local/ppe-evidences/snapshot_no_vest.jpg",
            frameResolution: { width: 1920, height: 1080 },
          },
          violations: [
            {
              violationType: "NO_VEST",
              severity: "MEDIUM",
              confidence: 0.89,
              description: "Thiếu áo phản quang khi di chuyển trong khu vực thi công",
            },
          ],
        },
      },
    };
  }

  /**
   * 5. Kiểm tra sức khỏe toàn bộ đường ống tích hợp AI Vision
   */
  public async getPipelineHealth(): Promise<AiVisionHealthDto> {
    const now = Date.now();
    if (this.cachedHealth && this.cachedHealth.expiresAt > now) {
      return this.cachedHealth.data;
    }

    let cameraDbStatus: "CONNECTED" | "DISCONNECTED" = "DISCONNECTED";
    let siteDbStatus: "CONNECTED" | "DISCONNECTED" = "DISCONNECTED";
    let incidentDbStatus: "CONNECTED" | "DISCONNECTED" = "DISCONNECTED";

    try {
      await this.cameraRepo.findAllCameras({ limit: 1 });
      cameraDbStatus = "CONNECTED";
    } catch {
      cameraDbStatus = "DISCONNECTED";
    }

    try {
      await this.siteRepo.findAllSites({ limit: 1 });
      siteDbStatus = "CONNECTED";
    } catch {
      siteDbStatus = "DISCONNECTED";
    }

    try {
      await this.incidentRepo.findAllIncidents({ limit: 1 });
      incidentDbStatus = "CONNECTED";
    } catch {
      incidentDbStatus = "DISCONNECTED";
    }

    const brokerStatus = "CONNECTED";

    const allHealthy =
      cameraDbStatus === "CONNECTED" &&
      siteDbStatus === "CONNECTED" &&
      incidentDbStatus === "CONNECTED" &&
      brokerStatus === "CONNECTED";

    const healthResult: AiVisionHealthDto = {
      status: allHealthy ? "UP" : "DEGRADED",
      timestamp: new Date().toISOString(),
      pipeline: {
        broker: brokerStatus,
        cameraDatabase: cameraDbStatus,
        siteDatabase: siteDbStatus,
        incidentDatabase: incidentDbStatus,
      },
    };

    this.cachedHealth = { data: healthResult, expiresAt: now + 5000 };
    return healthResult;
  }

  /**
   * Helper phân giải và làm giàu thông tin Camera & Site
   */
  private async resolveAndEnrichCameraAndSite(
    rawInput: AiVisionIngestEventDto,
  ): Promise<{ camera: AiVisionCameraRefDto; site: AiVisionSiteRefDto }> {
    let resolvedCamera: AiVisionCameraRefDto | null = null;
    let resolvedSite: AiVisionSiteRefDto | null = null;

    const cameraId = rawInput.camera?.id || rawInput.cameraId;
    const cameraCode = rawInput.camera?.code || rawInput.cameraCode;

    // 1. Tra cứu Camera trong Database
    let foundCamera: any = null;
    if (cameraId) {
      foundCamera = await this.cameraRepo.findCameraById(cameraId);
    }
    if (!foundCamera && cameraCode) {
      foundCamera = await this.cameraRepo.findCameraByCode(cameraCode);
    }

    if (foundCamera) {
      resolvedCamera = {
        id: foundCamera.id,
        code: foundCamera.code,
        name: foundCamera.name,
        zone: foundCamera.location || foundCamera.zoneId || "Khu vực thi công",
      };

      // 2. Tra cứu Site từ camera.siteId
      if (foundCamera.siteId) {
        const foundSite = await this.siteRepo.findSiteById(foundCamera.siteId);
        if (foundSite) {
          resolvedSite = {
            id: foundSite.id,
            code: foundSite.code,
            name: foundSite.name,
          };
        }
      }
    }

    // 3. Nếu không tìm thấy Camera trong DB:
    if (!resolvedCamera) {
      // Fallback nếu client cung cấp đủ thông tin định danh
      if (rawInput.camera?.name || cameraCode) {
        resolvedCamera = {
          id: cameraId || generateId(),
          code: cameraCode || "CAM-AUTO",
          name: rawInput.camera?.name || `Camera ${cameraCode || "Edge"}`,
          zone: rawInput.camera?.zone || "Khu vực thi công",
        };
      } else {
        throw new AppError(
          `Camera '${cameraId || cameraCode}' không tồn tại trong hệ thống`,
          404,
          ERROR_CODE.NOT_FOUND,
        );
      }
    }

    // 4. Nếu chưa có Site, kiểm tra thông tin site client gửi lên
    if (!resolvedSite) {
      const siteId = rawInput.site?.id || rawInput.siteId;
      const siteCode = rawInput.site?.code || rawInput.siteCode;

      let foundSite: any = null;
      if (siteId) {
        foundSite = await this.siteRepo.findSiteById(siteId);
      }
      if (!foundSite && siteCode) {
        foundSite = await this.siteRepo.findSiteByCode(siteCode);
      }

      if (foundSite) {
        resolvedSite = {
          id: foundSite.id,
          code: foundSite.code,
          name: foundSite.name,
        };
      } else if (rawInput.site?.name || siteCode) {
        resolvedSite = {
          id: siteId || generateId(),
          code: siteCode || "SITE-AUTO",
          name: rawInput.site?.name || `Công trường ${siteCode || "Mặc định"}`,
        };
      } else {
        // Lấy site đầu tiên trong hệ thống làm fallback an toàn
        const sites = await this.siteRepo.findAllSites({ limit: 1 });
        if (sites.data && sites.data.length > 0) {
          resolvedSite = {
            id: sites.data[0].id,
            code: sites.data[0].code,
            name: sites.data[0].name,
          };
        } else {
          resolvedSite = {
            id: generateId(),
            code: "SITE-DEFAULT",
            name: "Công trường Trung tâm",
          };
        }
      }
    }

    return { camera: resolvedCamera, site: resolvedSite };
  }
}

export const aiVisionIntegrationService = new AiVisionIntegrationService();
