import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { uuidv7 } from "uuidv7";
import {
  ppeViolationDetectedKafkaEventSchema,
  ppeIncidentResolvedKafkaEventSchema,
  ppeCameraStatusChangedKafkaEventSchema,
  ppeSiteAlertTriggeredKafkaEventSchema,
  validateKafkaEvent,
} from "../src/common/validations/kafka-event.schema";
import {
  KAFKA_TOPICS,
  PPE_VIOLATION_TYPES,
  PPE_SEVERITY,
  PPE_DETECTION_CLASS,
} from "../src/common/constants/kafka.constant";
import type { PPEViolationDetectedKafkaEvent } from "../src/common/types/kafka-event.type";

describe("PPE Microservices — Apache Kafka Event Schemas Validation", () => {
  it("1. Phải validate thành công sự kiện ppe.violation.detected hợp lệ", () => {
    const validEvent: PPEViolationDetectedKafkaEvent = {
      eventId: uuidv7(),
      topic: KAFKA_TOPICS.PPE_VIOLATION_DETECTED,
      traceId: uuidv7(),
      timestamp: Date.now(),
      producer: "edge-camera-engine-node-01",
      payload: {
        violationId: uuidv7(),
        timestamp: new Date().toISOString(),
        site: {
          id: uuidv7(),
          code: "SITE-HN-LANDMARK",
          name: "Công trường Landmark Hà Nội",
        },
        camera: {
          id: uuidv7(),
          code: "CAM-01-ENTRANCE",
          name: "Camera Cổng chính số 1",
          zone: "Khu vực thi công móng",
        },
        evidence: {
          snapshotUrl:
            "https://minio.ppe-monitoring.internal/ppe-evidences/2026/10/08/snap_01.jpg",
          clipUrl:
            "https://minio.ppe-monitoring.internal/ppe-evidences/2026/10/08/clip_01.mp4",
          frameResolution: {
            width: 1920,
            height: 1080,
          },
        },
        detections: [
          {
            class: PPE_DETECTION_CLASS.PERSON,
            confidence: 0.98,
            box: { x: 120, y: 150, width: 80, height: 220 },
            trackId: 104,
          },
        ],
        violations: [
          {
            violationType: PPE_VIOLATION_TYPES.NO_HELMET,
            severity: PPE_SEVERITY.HIGH,
            description: "Công nhân không đội mũ bảo hộ lao động",
            confidence: 0.95,
            box: { x: 140, y: 150, width: 40, height: 45 },
            workerName: "Nguyễn Văn A",
            workerId: "W-2026-089",
          },
          {
            violationType: PPE_VIOLATION_TYPES.NO_VEST,
            severity: PPE_SEVERITY.MEDIUM,
            description: "Công nhân không mặc áo phản quang",
            confidence: 0.91,
            box: { x: 130, y: 195, width: 65, height: 90 },
          },
        ],
        summary: {
          totalPersons: 1,
          totalViolations: 2,
          highestSeverity: PPE_SEVERITY.HIGH,
        },
        metadata: {
          contractor: "Vinaconex",
          shift: "Ca sáng",
        },
      },
    };

    const result = validateKafkaEvent(
      ppeViolationDetectedKafkaEventSchema,
      validEvent,
    );

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(
        result.data.topic,
        "ppe.violation.detected",
      );
      assert.strictEqual(result.data.payload.violations.length, 2);
    }
  });

  it("2. Phải từ chối sự kiện vi phạm nếu thiếu trường bắt buộc hoặc danh sách vi phạm rỗng", () => {
    const invalidEvent = {
      eventId: uuidv7(),
      topic: KAFKA_TOPICS.PPE_VIOLATION_DETECTED,
      traceId: "trace-123",
      timestamp: Date.now(),
      payload: {
        violationId: "not-a-uuid", // Sai format UUID
        timestamp: "invalid-date",
        site: { id: "1", code: "SITE" }, // Thiếu name
        camera: { id: "1", code: "CAM", name: "Cam 1", zone: "Zone A" },
        evidence: {
          snapshotUrl: "not-a-valid-url", // Sai format URL
          frameResolution: { width: -10, height: 0 }, // Không dương
        },
        violations: [], // Rỗng (yêu cầu min 1)
        summary: {
          totalPersons: 1,
          totalViolations: 0,
          highestSeverity: "UNKNOWN_SEVERITY", // Sai enum
        },
      },
    };

    const result = validateKafkaEvent(
      ppeViolationDetectedKafkaEventSchema,
      invalidEvent,
    );

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.length > 0);
    }
  });

  it("3. Phải validate thành công sự kiện ppe.incident.resolved", () => {
    const resolvedEvent = {
      eventId: uuidv7(),
      topic: KAFKA_TOPICS.PPE_INCIDENT_RESOLVED,
      traceId: uuidv7(),
      timestamp: Date.now(),
      producer: "ppe-incident-service",
      payload: {
        incidentId: uuidv7(),
        violationId: uuidv7(),
        siteId: "SITE-HN-LANDMARK",
        resolvedBy: {
          userId: uuidv7(),
          fullName: "Trần Văn B (Giám sát ATLĐ)",
          role: "SAFETY_OFFICER",
        },
        resolutionAction: "EQUIPMENT_PROVIDED" as const,
        notes: "Đã cấp phát bổ sung mũ bảo hộ và nhắc nhở công nhân tuân thủ",
        resolvedAt: new Date().toISOString(),
      },
    };

    const result = validateKafkaEvent(
      ppeIncidentResolvedKafkaEventSchema,
      resolvedEvent,
    );

    assert.strictEqual(result.success, true);
  });

  it("4. Phải validate thành công sự kiện ppe.camera.status_changed", () => {
    const cameraEvent = {
      eventId: uuidv7(),
      topic: KAFKA_TOPICS.PPE_CAMERA_STATUS_CHANGED,
      traceId: uuidv7(),
      timestamp: Date.now(),
      producer: "ppe-camera-service",
      payload: {
        cameraId: "CAM-01-ENTRANCE",
        cameraCode: "CAM-01",
        siteId: "SITE-HN-LANDMARK",
        previousStatus: "ONLINE" as const,
        currentStatus: "OFFLINE" as const,
        reason: "Mất kết nối RTSP Stream quá 30 giây",
        timestamp: new Date().toISOString(),
      },
    };

    const result = validateKafkaEvent(
      ppeCameraStatusChangedKafkaEventSchema,
      cameraEvent,
    );

    assert.strictEqual(result.success, true);
  });

  it("5. Phải validate thành công sự kiện ppe.site.alert_triggered", () => {
    const alertEvent = {
      eventId: uuidv7(),
      topic: KAFKA_TOPICS.PPE_SITE_ALERT_TRIGGERED,
      traceId: uuidv7(),
      timestamp: Date.now(),
      producer: "ppe-monitoring-service",
      payload: {
        siteId: "SITE-HN-LANDMARK",
        siteCode: "SITE-HN-01",
        siteName: "Công trường Landmark Hà Nội",
        alertLevel: "CRITICAL" as const,
        activeViolationsCount: 15,
        thresholdLimit: 10,
        message:
          "Số lượng vi phạm an toàn lao động trong 1 giờ vượt ngưỡng cho phép (15/10)",
        timestamp: new Date().toISOString(),
      },
    };

    const result = validateKafkaEvent(
      ppeSiteAlertTriggeredKafkaEventSchema,
      alertEvent,
    );

    assert.strictEqual(result.success, true);
  });
});
