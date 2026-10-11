import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { uuidv7 } from "uuidv7";
import {
  BROKER_CONSUMER_GROUPS,
  BROKER_TOPICS,
  BROKER_INGESTION_SOURCE,
  BROKER_STATUS,
  BROKER_LIMITS,
} from "../src/common/constants/broker.constant";
import {
  KAFKA_TOPICS,
  PPE_VIOLATION_TYPES,
  PPE_SEVERITY,
  PPE_DETECTION_CLASS,
} from "../src/common/constants/kafka.constant";
import { EVENT_NAMES } from "../src/common/constants/event.constant";
import {
  publishViolationEventSchema,
  dlqQuerySchema,
  reprocessDlqParamsSchema,
} from "../src/modules/broker/broker.validation";
import { BrokerService } from "../src/modules/broker/broker.service";
import { PpeViolationSubscriber } from "../src/common/subscribers/ppe-violation.subscriber";
import { EventBusService } from "../src/common/services/event-bus.service";
import { AppError } from "../src/common/errors/app-error";
import type { PPEViolationDetectedPayload } from "../src/common/types/kafka-event.type";
import type { EventEnvelope } from "../src/common/types/event.type";

describe("Task BE-12: PPE Message Broker & Event Ingestion Bridge Suite", { concurrency: 1 }, () => {
  let mockEventBus: EventBusService;
  let mockAuditService: any;
  let mockIncidentRepo: any;
  let mockNotificationService: any;
  let mockReportingRepo: any;
  let brokerService: BrokerService;
  let subscriber: PpeViolationSubscriber;

  const createSamplePayload = (
    violationId: string = uuidv7(),
  ): PPEViolationDetectedPayload => ({
    violationId,
    timestamp: new Date().toISOString(),
    site: {
      id: "11111111-1111-1111-1111-111111111111",
      code: "SITE-HN-01",
      name: "Landmark Tower Hà Nội",
    },
    camera: {
      id: "22222222-2222-2222-2222-222222222222",
      code: "CAM-GATE-01",
      name: "Camera Cổng chính số 1",
      zone: "Khu vực cổng vào",
    },
    evidence: {
      snapshotUrl:
        "https://minio.ppe.internal/ppe-evidences/2026/10/11/snap_01.jpg",
      clipUrl:
        "https://minio.ppe.internal/ppe-evidences/2026/10/11/clip_01.mp4",
      frameResolution: {
        width: 1920,
        height: 1080,
      },
    },
    detections: [
      {
        class: PPE_DETECTION_CLASS.PERSON,
        confidence: 0.96,
        box: { x: 100, y: 150, width: 80, height: 200 },
        trackId: 101,
      },
    ],
    violations: [
      {
        violationType: PPE_VIOLATION_TYPES.NO_HELMET,
        severity: PPE_SEVERITY.HIGH,
        description: "Không đội mũ bảo hộ lao động khi vào khu vực thi công",
        confidence: 0.94,
        box: { x: 120, y: 150, width: 40, height: 45 },
        workerName: "Nguyễn Văn A",
        workerId: "W-2026-001",
      },
    ],
    summary: {
      totalPersons: 1,
      totalViolations: 1,
      highestSeverity: PPE_SEVERITY.HIGH,
    },
    metadata: {
      fps: 25,
      latencyMs: 42,
    },
  });

  beforeEach(() => {
    mockEventBus = new EventBusService();

    mockAuditService = {
      recordLog: async () => {},
    };

    mockIncidentRepo = {
      findIncidentByViolationId: async () => null,
      createIncident: async (data: any) => ({
        id: uuidv7(),
        siteId: data.siteId,
        cameraId: data.cameraId,
        violationId: data.violationId,
        violationType: data.violationType,
        severity: data.severity,
        status: data.status,
        detectedAt: data.detectedAt,
      }),
    };

    mockNotificationService = {
      dispatchIncidentNotification: async () => ({
        incidentId: uuidv7(),
        dispatchedCount: 1,
      }),
    };

    mockReportingRepo = {
      recordAiPerformanceMetric: async () => {},
    };

    brokerService = new BrokerService(mockEventBus, mockAuditService);
    subscriber = new PpeViolationSubscriber(
      mockEventBus,
      mockIncidentRepo,
      mockNotificationService,
      mockReportingRepo,
      mockAuditService,
    );
  });

  // ── 1. Domain Constants & Taxonomy ─────────────────────────────────────────
  describe("1. Domain Constants & Taxonomy", () => {
    test("should verify all 4 consumer groups match D08.pdf specification", () => {
      assert.equal(
        BROKER_CONSUMER_GROUPS.INCIDENT_SERVICE,
        "ppe-incident-consumer-group",
      );
      assert.equal(
        BROKER_CONSUMER_GROUPS.NOTIFICATION_SERVICE,
        "ppe-notification-consumer-group",
      );
      assert.equal(
        BROKER_CONSUMER_GROUPS.REPORTING_SERVICE,
        "ppe-reporting-consumer-group",
      );
      assert.equal(
        BROKER_CONSUMER_GROUPS.AUDIT_LOGGER,
        "ppe-audit-consumer-group",
      );
    });

    test("should verify topics and limits", () => {
      assert.equal(
        BROKER_TOPICS.PPE_VIOLATION_DETECTED,
        KAFKA_TOPICS.PPE_VIOLATION_DETECTED,
      );
      assert.equal(
        BROKER_TOPICS.PPE_DEAD_LETTER_QUEUE,
        KAFKA_TOPICS.PPE_DEAD_LETTER_QUEUE,
      );
      assert.equal(BROKER_INGESTION_SOURCE.AI_INFERENCE_ENGINE, "ai-inference-engine");
      assert.equal(BROKER_STATUS.HEALTHY, "HEALTHY");
      assert.equal(BROKER_LIMITS.IDEMPOTENCY_TTL_MS, 24 * 60 * 60 * 1000);
    });
  });

  // ── 2. Boundary Validation with Zod ────────────────────────────────────────
  describe("2. HTTP Boundary Validation with Zod", () => {
    test("should validate successfully a valid raw violation payload", () => {
      const payload = createSamplePayload();
      const result = publishViolationEventSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    test("should validate successfully a full Kafka event envelope", () => {
      const envelope = {
        eventId: uuidv7(),
        topic: KAFKA_TOPICS.PPE_VIOLATION_DETECTED,
        traceId: uuidv7(),
        timestamp: Date.now(),
        producer: "ai-inference-engine",
        payload: createSamplePayload(),
      };
      const result = publishViolationEventSchema.safeParse(envelope);
      assert.equal(result.success, true);
    });

    test("should reject payload when violations array is empty", () => {
      const invalid = createSamplePayload();
      (invalid as any).violations = [];
      const result = publishViolationEventSchema.safeParse(invalid);
      assert.equal(result.success, false);
    });

    test("should reject payload with negative bounding box dimensions", () => {
      const invalid = createSamplePayload();
      invalid.detections[0].box.width = -50;
      const result = publishViolationEventSchema.safeParse(invalid);
      assert.equal(result.success, false);
    });

    test("should validate DLQ query and reprocess params schemas", () => {
      const queryResult = dlqQuerySchema.safeParse({
        page: "2",
        limit: "15",
        topic: "ppe.violation",
      });
      assert.equal(queryResult.success, true);
      if (queryResult.success) {
        assert.equal(queryResult.data.page, 2);
        assert.equal(queryResult.data.limit, 15);
      }

      const paramResult = reprocessDlqParamsSchema.safeParse({
        id: uuidv7(),
      });
      assert.equal(paramResult.success, true);
    });
  });

  // ── 3. Ingestion Bridge & Idempotency ──────────────────────────────────────
  describe("3. Ingestion Bridge & Idempotency (24h Window)", () => {
    test("should publish raw violation payload and return PUBLISHED status", async () => {
      const payload = createSamplePayload();
      const result = await brokerService.publishViolationEvent(
        payload,
        "req-trace-123",
        "actor-ai",
      );

      assert.equal(result.success, true);
      assert.equal(result.status, "PUBLISHED");
      assert.equal(result.duplicate, false);
      assert.equal(result.topic, "ppe.violation.detected");
      assert.ok(result.eventId);
      assert.equal(result.traceId, "req-trace-123");
    });

    test("should publish full Kafka envelope and retain original eventId and traceId", async () => {
      const eventId = uuidv7();
      const traceId = "kafka-trace-999";
      const envelope = {
        eventId,
        topic: KAFKA_TOPICS.PPE_VIOLATION_DETECTED,
        traceId,
        timestamp: Date.now(),
        producer: "ai-inference-engine",
        payload: createSamplePayload(),
      };

      const result = await brokerService.publishViolationEvent(envelope);

      assert.equal(result.success, true);
      assert.equal(result.eventId, eventId);
      assert.equal(result.traceId, traceId);
      assert.equal(result.status, "PUBLISHED");
    });

    test("should skip duplicate eventId within 24 hours (Idempotency protection)", async () => {
      const payload = createSamplePayload();

      // First publish
      const first = await brokerService.publishViolationEvent(payload);
      assert.equal(first.status, "PUBLISHED");
      assert.equal(first.duplicate, false);

      // Duplicate publish with same violationId
      const second = await brokerService.publishViolationEvent(payload);
      assert.equal(second.status, "DUPLICATE_SKIPPED");
      assert.equal(second.duplicate, true);
    });

    test("should move invalid payload to DLQ and throw AppError 400", async () => {
      const invalidPayload: any = {
        violationId: "invalid-uuid",
        site: { id: "not-complete" },
        violations: [],
      };

      await assert.rejects(
        async () => {
          await brokerService.publishViolationEvent(invalidPayload);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 400);
          return true;
        },
      );

      // Verify record moved to DLQ
      const dlqItems = mockEventBus.getDlqEvents();
      assert.equal(dlqItems.length, 1);
      assert.ok(dlqItems[0].error.includes("Zod Schema Validation Failed"));
    });
  });

  // ── 4. 4 Consumer Groups Fan-out Execution ─────────────────────────────────
  describe("4. 4 Consumer Groups Fan-out Execution", () => {
    test("IncidentConsumer: should create Incident and publish ppe.incident.created", async () => {
      let createdIncidentData: any = null;
      mockIncidentRepo.createIncident = async (data: any) => {
        createdIncidentData = data;
        return { id: "inc-100", ...data };
      };

      let publishedCreatedEvent: any = null;
      mockEventBus.publish = async (name: any, p: any) => {
        if (name === EVENT_NAMES.PPE_INCIDENT_CREATED) {
          publishedCreatedEvent = p;
        }
        return {} as any;
      };

      const payload = createSamplePayload();
      const envelope: EventEnvelope<PPEViolationDetectedPayload> = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        timestamp: Date.now(),
        source: "test",
      };

      await subscriber.handleIncidentConsumer(envelope);

      assert.ok(createdIncidentData);
      assert.equal(createdIncidentData.siteId, payload.site.id);
      assert.equal(createdIncidentData.cameraId, payload.camera.id);
      assert.equal(createdIncidentData.violationId, payload.violationId);
      assert.equal(createdIncidentData.violationType, "NO_HELMET");
      assert.equal(createdIncidentData.severity, "HIGH");
      assert.equal(createdIncidentData.status, "PENDING_REVIEW");
      assert.ok(createdIncidentData.initialEvidence);

      assert.ok(publishedCreatedEvent);
      assert.equal(publishedCreatedEvent.incidentId, "inc-100");
    });

    test("IncidentConsumer: should skip duplicate when incident already exists in database", async () => {
      mockIncidentRepo.findIncidentByViolationId = async () => ({
        id: "existing-incident-id",
      });

      let wasCreateCalled = false;
      mockIncidentRepo.createIncident = async () => {
        wasCreateCalled = true;
      };

      const payload = createSamplePayload();
      const envelope: EventEnvelope<PPEViolationDetectedPayload> = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        timestamp: Date.now(),
        source: "test",
      };

      await subscriber.handleIncidentConsumer(envelope);
      assert.equal(wasCreateCalled, false);
    });

    test("NotificationConsumer: should dispatch realtime alert via NotificationService", async () => {
      let dispatchedDto: any = null;
      mockNotificationService.dispatchIncidentNotification = async (dto: any) => {
        dispatchedDto = dto;
        return { incidentId: dto.incidentId, dispatchedCount: 1 };
      };

      const payload = createSamplePayload();
      const envelope: EventEnvelope<PPEViolationDetectedPayload> = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        timestamp: Date.now(),
        source: "test",
      };

      await subscriber.handleNotificationConsumer(envelope);

      assert.ok(dispatchedDto);
      assert.equal(dispatchedDto.incidentId, payload.violationId);
      assert.equal(dispatchedDto.siteId, payload.site.id);
      assert.equal(dispatchedDto.violationType, "NO_HELMET");
      assert.equal(dispatchedDto.severity, "HIGH");
    });

    test("ReportingConsumer: should record AI performance telemetry metrics", async () => {
      let recordedMetric: any = null;
      mockReportingRepo.recordAiPerformanceMetric = async (metric: any) => {
        recordedMetric = metric;
      };

      const payload = createSamplePayload();
      payload.metadata = { fps: 28.5, latencyMs: 38 };

      const envelope: EventEnvelope<PPEViolationDetectedPayload> = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        timestamp: Date.now(),
        source: "test",
      };

      await subscriber.handleReportingConsumer(envelope);

      assert.ok(recordedMetric);
      assert.equal(recordedMetric.cameraId, payload.camera.id);
      assert.equal(recordedMetric.fps, 28.5);
      assert.equal(recordedMetric.latencyMs, 38);
    });

    test("AuditConsumer: should record PPE_VIOLATION_DETECTED audit log", async () => {
      let loggedAudit: any = null;
      mockAuditService.recordLog = async (data: any) => {
        loggedAudit = data;
      };

      const payload = createSamplePayload();
      const envelope: EventEnvelope<PPEViolationDetectedPayload> = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        timestamp: Date.now(),
        source: "test",
      };

      await subscriber.handleAuditConsumer(envelope);

      assert.ok(loggedAudit);
      assert.equal(loggedAudit.actorId, "ai-inference-engine");
      assert.equal(loggedAudit.action, "PPE_VIOLATION_DETECTED");
      assert.equal(loggedAudit.targetType, "PPE_VIOLATION");
      assert.equal(loggedAudit.targetId, payload.violationId);
    });
  });

  // ── 5. Fault Isolation ─────────────────────────────────────────────────────
  describe("5. Fault Isolation (Câu 15 D08.pdf)", () => {
    test("Failure in NotificationConsumer should NOT crash or block IncidentConsumer", async () => {
      // Mock Notification throws error (e.g. SMTP down)
      mockNotificationService.dispatchIncidentNotification = async () => {
        throw new Error("SMTP Mail Server connection timeout");
      };

      let incidentCreated = false;
      mockIncidentRepo.createIncident = async (data: any) => {
        incidentCreated = true;
        return { id: "inc-1", ...data };
      };

      const payload = createSamplePayload();
      const envelope: EventEnvelope<PPEViolationDetectedPayload> = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        timestamp: Date.now(),
        source: "test",
      };

      // Notification handler catches gracefully
      await assert.doesNotReject(async () => {
        await subscriber.handleNotificationConsumer(envelope);
      });

      // Incident handler runs successfully
      await subscriber.handleIncidentConsumer(envelope);
      assert.equal(incidentCreated, true);
    });
  });

  // ── 6. DLQ Management & Health Diagnostics ─────────────────────────────────
  describe("6. DLQ Operations & Health Diagnostics", () => {
    test("should retrieve and paginate DLQ items", async () => {
      await mockEventBus.moveToDlq(
        {
          id: uuidv7(),
          name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
          payload: { foo: "bar" },
          timestamp: Date.now(),
          source: "test",
        },
        "Validation error test 1",
        1,
      );

      await mockEventBus.moveToDlq(
        {
          id: uuidv7(),
          name: "auth.user_registered" as any,
          payload: { test: true },
          timestamp: Date.now(),
          source: "test",
        },
        "SMTP connect error test 2",
        3,
      );

      const result = brokerService.getDlqRecords({ page: 1, limit: 10 });
      assert.equal(result.meta.total, 2);
      assert.equal(result.data.length, 2);

      // Filter by topic
      const filtered = brokerService.getDlqRecords({
        topic: "ppe.violation",
      });
      assert.equal(filtered.meta.total, 1);
    });

    test("should reprocess DLQ record and purge DLQ", async () => {
      const eventId = uuidv7();
      await mockEventBus.moveToDlq(
        {
          id: eventId,
          name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
          payload: createSamplePayload(),
          timestamp: Date.now(),
          source: "test",
        },
        "Temporary DB lock",
        5,
      );

      const reprocessResult = await brokerService.reprocessDlqRecord(eventId);
      assert.equal(reprocessResult.success, true);
      assert.equal(reprocessResult.reprocessed, true);
      assert.equal(reprocessResult.eventId, eventId);

      // Purge DLQ
      const purgeResult = brokerService.purgeDlq("admin-1");
      assert.equal(purgeResult.success, true);
      assert.equal(purgeResult.purgedCount, 1);

      const remaining = brokerService.getDlqRecords();
      assert.equal(remaining.meta.total, 0);
    });

    test("should report accurate broker health", async () => {
      subscriber.register();
      const health = await brokerService.getBrokerHealth();

      assert.equal(health.status, "HEALTHY");
      assert.ok(health.activeSubscribers >= 4); // 4 consumer groups
      assert.equal(typeof health.timestamp, "number");
    });
  });

  // ── 7. Code Review Hardening & Regression Suite ───────────────────────────
  describe("7. Code Review Hardening & Regression Suite", () => {
    test("should reject payload with non-UUID site.id or camera.id", () => {
      const invalidSite = createSamplePayload();
      invalidSite.site.id = "SITE-NOT-UUID";
      const siteResult = publishViolationEventSchema.safeParse(invalidSite);
      assert.equal(siteResult.success, false);

      const invalidCamera = createSamplePayload();
      invalidCamera.camera.id = "CAM-NOT-UUID";
      const camResult = publishViolationEventSchema.safeParse(invalidCamera);
      assert.equal(camResult.success, false);
    });

    test("should update DLQ record status to REPROCESSED on successful reprocess", async () => {
      const eventId = uuidv7();
      await mockEventBus.moveToDlq(
        {
          id: eventId,
          name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
          payload: createSamplePayload(),
          timestamp: Date.now(),
          source: "test",
        },
        "Test failure",
        3,
      );

      const beforeRecords = brokerService.getDlqRecords();
      const targetBefore = beforeRecords.data.find((r) => r.eventId === eventId);
      assert.equal(targetBefore?.status, "PENDING");

      await brokerService.reprocessDlqRecord(eventId, "admin-user");

      const afterRecords = brokerService.getDlqRecords();
      const targetAfter = afterRecords.data.find((r) => r.eventId === eventId);
      assert.equal(targetAfter?.status, "REPROCESSED");
      assert.ok(targetAfter?.reprocessedAt);
    });

    test("should skip duplicate execution in Notification, Reporting, and Audit consumers", async () => {
      const payload = createSamplePayload();
      let notifCount = 0;
      let reportCount = 0;
      let auditCount = 0;

      const customNotificationService: any = {
        dispatchIncidentNotification: async () => {
          notifCount++;
          return { incidentId: payload.violationId, dispatchedCount: 1, channels: [], notifications: [] };
        },
      };

      const customReportingRepo: any = {
        recordAiPerformanceMetric: async () => {
          reportCount++;
        },
      };

      const customAuditService: any = {
        recordLog: async () => {
          auditCount++;
        },
      };

      const hardenedSubscriber = new PpeViolationSubscriber(
        mockEventBus,
        mockIncidentRepo,
        customNotificationService,
        customReportingRepo,
        customAuditService,
      );

      const envelope: EventEnvelope<PPEViolationDetectedPayload> = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        aggregateId: payload.site.id,
        timestamp: Date.now(),
      };

      // First run: all 3 consumers execute
      await hardenedSubscriber.handleNotificationConsumer(envelope);
      await hardenedSubscriber.handleReportingConsumer(envelope);
      await hardenedSubscriber.handleAuditConsumer(envelope);

      assert.equal(notifCount, 1);
      assert.equal(reportCount, 1);
      assert.equal(auditCount, 1);

      // Second run with identical violationId: all 3 consumers skip duplicate
      await hardenedSubscriber.handleNotificationConsumer(envelope);
      await hardenedSubscriber.handleReportingConsumer(envelope);
      await hardenedSubscriber.handleAuditConsumer(envelope);

      assert.equal(notifCount, 1);
      assert.equal(reportCount, 1);
      assert.equal(auditCount, 1);
    });

    test("should strip query string from snapshotUrl when creating storageKey", async () => {
      const payload = createSamplePayload();
      payload.evidence.snapshotUrl =
        "https://s3.amazonaws.com/ppe-bucket/photo_123.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE";

      let capturedStorageKey = "";
      const customIncidentRepo: any = {
        findIncidentByViolationId: async () => null,
        createIncident: async (data: any) => {
          capturedStorageKey = data.initialEvidence?.storageKey;
          return { id: "inc-storage-key", ...data };
        },
      };

      const testSubscriber = new PpeViolationSubscriber(
        mockEventBus,
        customIncidentRepo,
        mockNotificationService,
        mockReportingRepo,
        mockAuditService,
      );

      const envelope: EventEnvelope<PPEViolationDetectedPayload> = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        aggregateId: payload.site.id,
        timestamp: Date.now(),
      };

      await testSubscriber.handleIncidentConsumer(envelope);
      assert.equal(capturedStorageKey, "photo_123.jpg");
    });
  });
});
