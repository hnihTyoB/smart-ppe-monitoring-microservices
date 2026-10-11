import { eventBus, EventBusService } from "../services/event-bus.service";
import { EVENT_NAMES } from "../constants/event.constant";
import { BROKER_CONSUMER_GROUPS } from "../constants/broker.constant";
import {
  INCIDENT_STATUS,
  EVIDENCE_TYPE,
  VIOLATION_TYPE,
  ViolationType,
  IncidentSeverity,
} from "../constants/incident.constant";
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../constants/audit-log.constant";
import {
  IncidentRepository,
  incidentRepository,
} from "../../modules/incident/incident.repository";
import {
  NotificationService,
  notificationService,
} from "../../modules/notification/notification.service";
import {
  ReportingRepository,
  reportingRepository,
} from "../../modules/reporting/reporting.repository";
import {
  AuditService,
  auditService,
} from "../../modules/audit/audit.service";
import type { EventEnvelope } from "../types/event.type";
import type { PPEViolationDetectedPayload } from "../types/kafka-event.type";

function mapToIncidentViolationType(rawType: string): ViolationType {
  if (rawType in VIOLATION_TYPE) {
    return rawType as ViolationType;
  }
  if (rawType === "UNAUTHORIZED_ZONE") {
    return VIOLATION_TYPE.RESTRICTED_AREA;
  }
  return VIOLATION_TYPE.MULTI_VIOLATION;
}

/**
 * PPE Violation Event Subscriber (Task BE-12)
 *
 * Triển khai mô hình Fan-out Publish/Subscribe với 4 Consumer Groups độc lập (Chuẩn D08.pdf):
 * 1. INCIDENT_SERVICE: Tự động ghi nhận Incident vào ppe_incident_db kèm Evidence Snapshot.
 * 2. NOTIFICATION_SERVICE: Phát SSE Realtime alert và xếp hàng gửi email cảnh báo.
 * 3. REPORTING_SERVICE: Cập nhật thống kê vi phạm và telemetry hiệu năng mô hình AI.
 * 4. AUDIT_LOGGER: Ghi nhận vết kiểm toán hệ thống.
 */
export class PpeViolationSubscriber {
  private readonly bus: EventBusService;
  private readonly incidentRepo: IncidentRepository;
  private readonly notification: NotificationService;
  private readonly reportingRepo: ReportingRepository;
  private readonly audit: AuditService;
  private isRegistered = false;

  constructor(
    bus?: EventBusService,
    incidentRepo?: IncidentRepository,
    notification?: NotificationService,
    reportingRepo?: ReportingRepository,
    audit?: AuditService,
  ) {
    this.bus = bus || eventBus;
    this.incidentRepo = incidentRepo || incidentRepository;
    this.notification = notification || notificationService;
    this.reportingRepo = reportingRepo || reportingRepository;
    this.audit = audit || auditService;
  }

  /**
   * Đăng ký 4 Consumer Groups độc lập vào EventBus
   */
  public register(): void {
    if (this.isRegistered) return;
    this.isRegistered = true;

    // ── 1. Consumer Group: INCIDENT_SERVICE (ppe-incident-consumer-group) ─────
    this.bus.subscribe(
      EVENT_NAMES.PPE_VIOLATION_DETECTED,
      async (envelope: EventEnvelope<PPEViolationDetectedPayload>) => {
        await this.handleIncidentConsumer(envelope);
      },
    );

    // ── 2. Consumer Group: NOTIFICATION_SERVICE (ppe-notification-consumer-group)
    this.bus.subscribe(
      EVENT_NAMES.PPE_VIOLATION_DETECTED,
      async (envelope: EventEnvelope<PPEViolationDetectedPayload>) => {
        await this.handleNotificationConsumer(envelope);
      },
    );

    // ── 3. Consumer Group: REPORTING_SERVICE (ppe-reporting-consumer-group) ───
    this.bus.subscribe(
      EVENT_NAMES.PPE_VIOLATION_DETECTED,
      async (envelope: EventEnvelope<PPEViolationDetectedPayload>) => {
        await this.handleReportingConsumer(envelope);
      },
    );

    // ── 4. Consumer Group: AUDIT_LOGGER (ppe-audit-consumer-group) ───────────
    this.bus.subscribe(
      EVENT_NAMES.PPE_VIOLATION_DETECTED,
      async (envelope: EventEnvelope<PPEViolationDetectedPayload>) => {
        await this.handleAuditConsumer(envelope);
      },
    );

    console.log(
      `[PpeViolationSubscriber] 🚀 4 Consumer Groups registered for [${EVENT_NAMES.PPE_VIOLATION_DETECTED}]`,
    );
  }

  /**
   * Xử lý tạo Incident trong ppe_incident_db
   */
  public async handleIncidentConsumer(
    envelope: EventEnvelope<PPEViolationDetectedPayload>,
  ): Promise<void> {
    const payload = envelope.payload;
    try {
      // 1. Kiểm tra Idempotency tại CSDL: nếu violationId đã tồn tại -> bỏ qua
      if (payload.violationId) {
        const existing = await this.incidentRepo.findIncidentByViolationId(
          payload.violationId,
        );
        if (existing) {
          console.log(
            `[IncidentConsumer] ⏭️ Violation ${payload.violationId} already has Incident ${existing.id}. Skipping.`,
          );
          return;
        }
      }

      // 2. Xác định vi phạm trọng tâm
      const primaryViolation =
        payload.violations.length > 1
          ? payload.violations.find((v) => v.severity === "CRITICAL") ||
            payload.violations.find((v) => v.severity === "HIGH") ||
            payload.violations[0]
          : payload.violations[0];

      const mappedViolationType = mapToIncidentViolationType(
        primaryViolation.violationType,
      );
      const severity = (payload.summary.highestSeverity ||
        primaryViolation.severity ||
        "HIGH") as IncidentSeverity;

      // 3. Chuẩn bị bằng chứng Snapshot
      const cleanSnapshotUrl = payload.evidence.snapshotUrl.split("?")[0];
      const storageKey =
        cleanSnapshotUrl.split("/").pop() ||
        `snapshot_${payload.violationId}.jpg`;

      const initialEvidence = {
        cameraId: payload.camera.id,
        evidenceType: EVIDENCE_TYPE.SNAPSHOT,
        storageKey,
        fileName: `snapshot_${payload.violationId}.jpg`,
        mimeType: "image/jpeg",
        capturedAt: new Date(payload.timestamp),
        metadata: {
          width: payload.evidence.frameResolution.width,
          height: payload.evidence.frameResolution.height,
          aiDetections: {
            detections: payload.detections,
            violations: payload.violations,
            summary: payload.summary,
            metadata: payload.metadata,
          },
        },
      };

      // 4. Tạo bản ghi Incident
      const created = await this.incidentRepo.createIncident(
        {
          siteId: payload.site.id,
          cameraId: payload.camera.id,
          violationId: payload.violationId,
          violationType: mappedViolationType,
          severity,
          status: INCIDENT_STATUS.PENDING_REVIEW,
          detectedAt: new Date(payload.timestamp),
          description:
            primaryViolation.description ||
            `Phát hiện vi phạm ${mappedViolationType} tại ${payload.camera.name || payload.camera.code}`,
          initialEvidence,
        },
        "ai-inference-engine",
      );

      console.log(
        `[IncidentConsumer] ✅ Created Incident ${created.id} for violation ${payload.violationId}`,
      );

      // 5. Phát sự kiện nội bộ ppe.incident.created
      await this.bus.publish(
        EVENT_NAMES.PPE_INCIDENT_CREATED,
        {
          incidentId: created.id,
          siteId: created.siteId,
          cameraId: created.cameraId,
          violationType: created.violationType,
          severity: created.severity,
          description: created.description || undefined,
          detectedAt: created.detectedAt,
        },
        {
          aggregateId: created.siteId,
          traceId: envelope.traceId,
          useOutbox: false,
        },
      );
    } catch (err: any) {
      console.error(
        `[IncidentConsumer] ❌ Error processing violation ${payload.violationId}:`,
        err?.message || err,
      );
      throw err; // Nack để kích hoạt retry/DLQ cho IncidentConsumer nếu lỗi DB
    }
  }

  /**
   * Xử lý phát cảnh báo thời gian thực qua Notification Service
   */
  public async handleNotificationConsumer(
    envelope: EventEnvelope<PPEViolationDetectedPayload>,
  ): Promise<void> {
    const payload = envelope.payload;
    const notifKey = `notif:${payload.violationId}`;
    if (this.bus.isEventAlreadyProcessed(notifKey)) {
      console.log(
        `[NotificationConsumer] ⏭️ Notification already dispatched for violation ${payload.violationId}. Skipping.`,
      );
      return;
    }

    try {
      const primaryViolation = payload.violations[0];
      await this.notification.dispatchIncidentNotification({
        incidentId: payload.violationId,
        siteId: payload.site.id,
        siteName: payload.site.name,
        cameraId: payload.camera.id,
        cameraCode: payload.camera.code,
        violationType: primaryViolation?.violationType || "PPE_VIOLATION",
        severity: payload.summary.highestSeverity,
        description:
          primaryViolation?.description ||
          `Phát hiện vi phạm an toàn tại ${payload.camera.name || payload.camera.code}`,
        detectedAt: payload.timestamp,
      });

      this.bus.markEventProcessed(notifKey);
      console.log(
        `[NotificationConsumer] 🔔 Realtime alert dispatched for violation ${payload.violationId}`,
      );
    } catch (err: any) {
      // Fault Isolation: Log cảnh báo, không làm crash toàn pipeline của Incident
      console.warn(
        `[NotificationConsumer] ⚠️ Failed to dispatch alert for violation ${payload.violationId}:`,
        err?.message || err,
      );
    }
  }

  /**
   * Xử lý cập nhật số liệu thống kê & telemetry hiệu năng AI
   */
  public async handleReportingConsumer(
    envelope: EventEnvelope<PPEViolationDetectedPayload>,
  ): Promise<void> {
    const payload = envelope.payload;
    const reportKey = `report:${payload.violationId}`;
    if (this.bus.isEventAlreadyProcessed(reportKey)) {
      console.log(
        `[ReportingConsumer] ⏭️ Metrics already recorded for violation ${payload.violationId}. Skipping.`,
      );
      return;
    }

    try {
      const meta = payload.metadata as Record<string, unknown> | undefined;
      const fps = typeof meta?.fps === "number" ? meta.fps : undefined;
      const latencyMs =
        typeof meta?.latencyMs === "number" ? meta.latencyMs : undefined;

      if (fps !== undefined || latencyMs !== undefined) {
        await this.reportingRepo.recordAiPerformanceMetric({
          cameraId: payload.camera.id,
          modelVersionId: (meta?.modelVersionId as string) || undefined,
          fps: fps ?? 15,
          latencyMs: latencyMs ?? 50,
          frameCount: (meta?.totalFrames as number) || 1,
        });

        this.bus.markEventProcessed(reportKey);
        console.log(
          `[ReportingConsumer] 📊 Recorded AI telemetry metric for camera ${payload.camera.id}`,
        );
      }
    } catch (err: any) {
      // Fault Isolation
      console.warn(
        `[ReportingConsumer] ⚠️ Failed to record reporting metrics:`,
        err?.message || err,
      );
    }
  }

  /**
   * Xử lý ghi nhận nhật ký kiểm toán cho sự kiện vi phạm
   */
  public async handleAuditConsumer(
    envelope: EventEnvelope<PPEViolationDetectedPayload>,
  ): Promise<void> {
    const payload = envelope.payload;
    const auditKey = `audit:${payload.violationId}`;
    if (this.bus.isEventAlreadyProcessed(auditKey)) {
      console.log(
        `[AuditConsumer] ⏭️ Audit log already recorded for violation ${payload.violationId}. Skipping.`,
      );
      return;
    }

    try {
      await this.audit.recordLog({
        actorId: "ai-inference-engine",
        action: AUDIT_ACTION.PPE_VIOLATION_DETECTED,
        targetType: AUDIT_TARGET_TYPE.PPE_VIOLATION,
        targetId: payload.violationId,
        details: {
          site: payload.site,
          camera: payload.camera,
          summary: payload.summary,
          violations: payload.violations.map((v) => ({
            type: v.violationType,
            severity: v.severity,
            confidence: v.confidence,
          })),
        },
      });

      this.bus.markEventProcessed(auditKey);
      console.log(
        `[AuditConsumer] 📝 Audit log recorded for violation ${payload.violationId}`,
      );
    } catch (err: any) {
      // Fault Isolation
      console.warn(
        `[AuditConsumer] ⚠️ Failed to record audit log:`,
        err?.message || err,
      );
    }
  }
}

export const ppeViolationSubscriber = new PpeViolationSubscriber();
