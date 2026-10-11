import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { uuidv7 } from "uuidv7";
import {
  IDEMPOTENCY_STATUS,
  IDEMPOTENCY_REASON,
  ERROR_CATEGORY,
  RETRY_POLICY,
} from "../src/common/constants/reliability.constant";
import {
  KAFKA_TOPICS,
  PPE_VIOLATION_TYPES,
  PPE_SEVERITY,
  PPE_DETECTION_CLASS,
} from "../src/common/constants/kafka.constant";
import { EVENT_NAMES } from "../src/common/constants/event.constant";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import {
  ReliabilityService,
} from "../src/modules/reliability/reliability.service";
import {
  ReliabilityRepository,
} from "../src/modules/reliability/reliability.repository";
import {
  idempotencyKeyQuerySchema,
  purgeIdempotencyKeysSchema,
} from "../src/modules/reliability/reliability.validation";
import { BrokerService } from "../src/modules/broker/broker.service";
import { PpeViolationSubscriber } from "../src/common/subscribers/ppe-violation.subscriber";
import { EventBusService } from "../src/common/services/event-bus.service";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import type { PPEViolationDetectedPayload } from "../src/common/types/kafka-event.type";
import reliabilityRouter from "../src/modules/reliability/reliability.route";
import { reliabilityController } from "../src/modules/reliability/reliability.controller";

describe("Task BE-13: PPE Reliability Service (Retry + Idempotency Engine) Suite", { concurrency: 1 }, () => {
  let eventBus: EventBusService;
  let reliabilityRepo: ReliabilityRepository;
  let reliabilityService: ReliabilityService;
  let brokerService: BrokerService;
  let subscriber: PpeViolationSubscriber;

  let createdIncidents: any[] = [];
  let dispatchedNotifications: any[] = [];
  let recordedMetrics: any[] = [];
  let recordedAudits: any[] = [];

  const createSamplePayload = (
    violationId: string = uuidv7(),
    trackId: number = 101,
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
        "https://minio.ppe.internal/ppe-evidences/2026/10/12/snap_01.jpg",
      clipUrl:
        "https://minio.ppe.internal/ppe-evidences/2026/10/12/clip_01.mp4",
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
        trackId,
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
        workerId: `W-${trackId}`,
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
    createdIncidents = [];
    dispatchedNotifications = [];
    recordedMetrics = [];
    recordedAudits = [];

    eventBus = new EventBusService();
    reliabilityRepo = new ReliabilityRepository();
    reliabilityService = new ReliabilityService(reliabilityRepo);

    const mockAuditService = {
      recordLog: async (data: any) => {
        recordedAudits.push(data);
      },
    };

    const mockIncidentRepo = {
      findIncidentByViolationId: async (violationId: string) => {
        return createdIncidents.find((inc) => inc.violationId === violationId) || null;
      },
      createIncident: async (data: any) => {
        // Mô phỏng kiểm tra atomic DB level (Task BE-13)
        if (data.violationId) {
          const existing = createdIncidents.find((inc) => inc.violationId === data.violationId);
          if (existing) return existing;
        }
        const newInc = {
          id: `inc-${createdIncidents.length + 1}`,
          ...data,
          createdAt: new Date(),
        };
        createdIncidents.push(newInc);
        return newInc;
      },
    };

    const mockNotificationService = {
      dispatchIncidentNotification: async (data: any) => {
        dispatchedNotifications.push(data);
        return { incidentId: data.incidentId, dispatchedCount: 1 };
      },
    };

    const mockReportingRepo = {
      recordAiPerformanceMetric: async (data: any) => {
        recordedMetrics.push(data);
      },
    };

    brokerService = new BrokerService(eventBus, mockAuditService as any, reliabilityService);
    subscriber = new PpeViolationSubscriber(
      eventBus,
      mockIncidentRepo as any,
      mockNotificationService as any,
      mockReportingRepo as any,
      mockAuditService as any,
      reliabilityService,
    );
    subscriber.register();
  });

  describe("1. Acceptance Criteria: Duplicate Event Không Tạo Duplicate Incident", () => {
    test("Gửi cùng một violationId 2 lần liên tiếp -> Chỉ duy nhất 1 Incident được tạo", async () => {
      const violationId = uuidv7();
      const payload = createSamplePayload(violationId);

      // Gửi lần thứ 1
      const firstRes = await brokerService.publishViolationEvent(payload);
      assert.equal(firstRes.success, true);
      assert.equal(firstRes.status, "PUBLISHED");
      assert.equal(firstRes.duplicate, false);

      // Đợi micro-task consumer xử lý
      await new Promise((r) => setTimeout(r, 60));
      assert.equal(createdIncidents.length, 1);
      assert.equal(createdIncidents[0].violationId, violationId);

      // Gửi lần thứ 2 với cùng violationId
      const secondRes = await brokerService.publishViolationEvent(payload);
      assert.equal(secondRes.success, true);
      assert.equal(secondRes.status, "DUPLICATE_SKIPPED");
      assert.equal(secondRes.duplicate, true);

      // Đợi consumer
      await new Promise((r) => setTimeout(r, 60));

      // TIÊU CHÍ NGHIỆM THU: Tổng số incident vẫn là 1, hoàn toàn KHÔNG bị duplicate!
      assert.equal(createdIncidents.length, 1);
    });

    test("Gửi lại cùng một Kafka Envelope (cùng eventId) -> Bị chặn ngay tại Ingestion Bridge", async () => {
      const eventId = uuidv7();
      const violationId = uuidv7();
      const envelope = {
        eventId,
        topic: KAFKA_TOPICS.PPE_VIOLATION_DETECTED,
        traceId: "trace-dup-101",
        timestamp: Date.now(),
        producer: "ai-inference-engine",
        payload: createSamplePayload(violationId),
      };

      // Publish lần 1
      const res1 = await brokerService.publishViolationEvent(envelope);
      assert.equal(res1.status, "PUBLISHED");
      assert.equal(res1.duplicate, false);

      await new Promise((r) => setTimeout(r, 50));
      assert.equal(createdIncidents.length, 1);

      // Publish lần 2 cùng eventId
      const res2 = await brokerService.publishViolationEvent(envelope);
      assert.equal(res2.status, "DUPLICATE_SKIPPED");
      assert.equal(res2.duplicate, true);

      await new Promise((r) => setTimeout(r, 50));
      assert.equal(createdIncidents.length, 1);
    });
  });

  describe("2. Concurrency Mutex & Race Condition Prevention", () => {
    test("Bắn 10 sự kiện trùng lặp đồng thời qua Promise.all -> Chỉ đúng 1 Incident được tạo", async () => {
      const violationId = uuidv7();
      const payload = createSamplePayload(violationId);

      // Gửi 10 request đồng thời tại cùng một mili-giây
      const requests = Array.from({ length: 10 }, () =>
        brokerService.publishViolationEvent({ ...payload }),
      );

      const results = await Promise.all(requests);

      // Đúng 1 request được PUBLISHED, 9 request còn lại bị chặn (DUPLICATE_SKIPPED)
      const publishedCount = results.filter((r) => r.status === "PUBLISHED").length;
      const skippedCount = results.filter((r) => r.status === "DUPLICATE_SKIPPED").length;

      assert.equal(publishedCount, 1, "Chỉ có duy nhất 1 request được publish");
      assert.equal(skippedCount, 9, "9 requests còn lại phải bị chặn an toàn");

      await new Promise((r) => setTimeout(r, 100));

      // Tổng số bản ghi Incident trong DB bắt buộc phải là 1
      assert.equal(createdIncidents.length, 1, "Chỉ duy nhất 1 bản ghi Incident được lưu trong CSDL");
      assert.equal(createdIncidents[0].violationId, violationId);
    });

    test("Atomic Mutex: In-Flight lock tự động chặn luồng thứ hai khi luồng thứ nhất đang xử lý", async () => {
      const key = "inc:concurrent-lock-test";
      const lock1 = reliabilityRepo.atomicAcquire(key, IDEMPOTENCY_REASON.IN_FLIGHT_CONCURRENCY, 5000);
      assert.equal(lock1.acquired, true);
      assert.equal(lock1.record.status, IDEMPOTENCY_STATUS.PROCESSING);

      // Luồng 2 thử acquire ngay sau đó
      const lock2 = reliabilityRepo.atomicAcquire(key, IDEMPOTENCY_REASON.IN_FLIGHT_CONCURRENCY, 5000);
      assert.equal(lock2.acquired, false, "Luồng thứ hai phải bị từ chối cấp khóa");
      assert.equal(lock2.record.status, IDEMPOTENCY_STATUS.PROCESSING);

      // Hoàn tất luồng 1
      reliabilityRepo.completeKey(key, { incidentId: "inc-1" });

      // Luồng 3 thử acquire sau khi đã COMPLETED
      const lock3 = reliabilityRepo.atomicAcquire(key, IDEMPOTENCY_REASON.IN_FLIGHT_CONCURRENCY, 5000);
      assert.equal(lock3.acquired, false);
      assert.equal(lock3.record.status, IDEMPOTENCY_STATUS.COMPLETED);
    });

    test("Stale Lock Auto-Release: Tự động tái chiếm khóa khi worker trước bị timeout (Deadlock protection)", async () => {
      const key = "inc:stale-lock-test";
      // Khóa với lockDurationMs cực ngắn: 20ms
      const lock1 = reliabilityRepo.atomicAcquire(key, IDEMPOTENCY_REASON.IN_FLIGHT_CONCURRENCY, 20);
      assert.equal(lock1.acquired, true);

      // Chờ 30ms để khóa hết hạn
      await new Promise((r) => setTimeout(r, 30));

      // Luồng mới thử lại -> Sẽ được cấp lock vì lock cũ đã stale
      const lock2 = reliabilityRepo.atomicAcquire(key, IDEMPOTENCY_REASON.IN_FLIGHT_CONCURRENCY, 5000);
      assert.equal(lock2.acquired, true, "Khóa stale phải được tự động giải phóng và cấp cho worker mới");
      assert.equal(lock2.record.attempts, 2);
    });
  });

  describe("3. Business Fingerprint Cooldown (AI Frame Jitter Defense)", () => {
    test("Tính toán Business Dedup Key chính xác theo format biz:site:camera:trackId:type", () => {
      const payload = createSamplePayload("violation-123", 404);
      const key = reliabilityService.computeBusinessDedupKey(payload);

      assert.equal(
        key,
        "biz:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222:404:NO_HELMET",
      );
    });

    test("Business Fingerprint Cooldown: Chặn frame liên tiếp cho cùng công nhân trong cooldown và cho phép sau khi hết cooldown", async () => {
      const payload = createSamplePayload(uuidv7(), 505);
      const bizKey = reliabilityService.computeBusinessDedupKey(payload);

      // Frame 1 với cooldown 40ms
      const check1 = reliabilityService.checkAndAcquireIdempotency(
        bizKey,
        IDEMPOTENCY_REASON.BUSINESS_FINGERPRINT_COOLDOWN,
        40,
      );
      assert.equal(check1.isDuplicate, false);
      assert.equal(check1.status, IDEMPOTENCY_STATUS.PROCESSING);
      reliabilityService.completeIdempotency(bizKey, null, undefined, 40);

      // Frame 2 gửi ngay 10ms sau trong khoảng cooldown 40ms -> Bị chặn
      await new Promise((r) => setTimeout(r, 10));
      const check2 = reliabilityService.checkAndAcquireIdempotency(
        bizKey,
        IDEMPOTENCY_REASON.BUSINESS_FINGERPRINT_COOLDOWN,
        40,
      );
      assert.equal(check2.isDuplicate, true);
      assert.equal(check2.reason, IDEMPOTENCY_REASON.BUSINESS_FINGERPRINT_COOLDOWN);

      // Frame 3 gửi sau 50ms (đã quá thời hạn 40ms cooldown) -> Được cho phép lại
      await new Promise((r) => setTimeout(r, 45));
      const check3 = reliabilityService.checkAndAcquireIdempotency(
        bizKey,
        IDEMPOTENCY_REASON.BUSINESS_FINGERPRINT_COOLDOWN,
        40,
      );
      assert.equal(check3.isDuplicate, false, "Khóa sau khi hết hạn cooldown phải cho phép phát hiện vi phạm mới");
    });
  });

  describe("4. Consumer Group Isolation & Fault Isolation", () => {
    test("Notification Consumer lỗi và retry -> Incident Consumer KHÔNG bị gọi lại và KHÔNG tạo duplicate incident", async () => {
      const violationId = uuidv7();
      const payload = createSamplePayload(violationId);

      let notifAttempts = 0;
      const failingNotifService = {
        dispatchIncidentNotification: async () => {
          notifAttempts++;
          if (notifAttempts === 1) {
            throw new Error("SMTP server connection timeout");
          }
          return { incidentId: violationId, dispatchedCount: 1 };
        },
      };

      const isolatedBus = new EventBusService();
      const customBroker = new BrokerService(isolatedBus, { recordLog: async () => {} } as any, reliabilityService);
      const customSubscriber = new PpeViolationSubscriber(
        isolatedBus,
        {
          findIncidentByViolationId: async () => createdIncidents.find((i) => i.violationId === violationId) || null,
          createIncident: async (data: any) => {
            const inc = { id: `inc-${createdIncidents.length + 1}`, ...data };
            createdIncidents.push(inc);
            return inc;
          },
        } as any,
        failingNotifService as any,
        { recordAiPerformanceMetric: async () => {} } as any,
        { recordLog: async () => {} } as any,
        reliabilityService,
      );
      customSubscriber.register();

      // Publish event
      await customBroker.publishViolationEvent(payload);
      await new Promise((r) => setTimeout(r, 80));

      // Incident được tạo thành công
      assert.equal(createdIncidents.length, 1);
      assert.equal(notifAttempts, 1);

      // Khi Notification consumer được dispatch lại
      const envelope = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        aggregateId: payload.site.id,
        timestamp: Date.now(),
        source: "test",
      };

      // Thử dispatch lại trực tiếp qua subscriber notification consumer
      await customSubscriber.handleNotificationConsumer(envelope as any);
      assert.equal(notifAttempts, 2, "Notification consumer thử lại thành công");

      // Khẳng định chắc chắn: IncidentConsumer không bao giờ bị gọi lại hay tạo thêm incident
      assert.equal(createdIncidents.length, 1, "Incident count vẫn phải là 1!");
    });
  });

  describe("5. Exponential Backoff Retry Policy & Error Classification", () => {
    test("Phân loại lỗi chính xác: Transient vs Permanent (Poison Pill)", () => {
      // 1. Transient errors
      const errDbTimeout = new Error("Query timeout occurred");
      assert.equal(reliabilityService.classifyError(errDbTimeout).category, ERROR_CATEGORY.TRANSIENT);
      assert.equal(reliabilityService.classifyError(errDbTimeout).isRetryable, true);

      const errDeadlock = new Error("deadlock detected: 40P01");
      assert.equal(reliabilityService.classifyError(errDeadlock).category, ERROR_CATEGORY.TRANSIENT);

      const errPool = new Error("Prisma connection pool exhausted P2024");
      assert.equal(reliabilityService.classifyError(errPool).category, ERROR_CATEGORY.TRANSIENT);

      // 2. Permanent errors (Poison Pills)
      const errApp400 = new AppError("Invalid input parameters", 400, ERROR_CODE.VALIDATION_ERROR);
      assert.equal(reliabilityService.classifyError(errApp400).category, ERROR_CATEGORY.PERMANENT);
      assert.equal(reliabilityService.classifyError(errApp400).isRetryable, false);

      const errUuid = new Error("Zod validation: Invalid uuid for cameraId");
      assert.equal(reliabilityService.classifyError(errUuid).category, ERROR_CATEGORY.PERMANENT);
      assert.equal(reliabilityService.classifyError(errUuid).isRetryable, false);
    });

    test("Transient Error: Tự động thử lại với Exponential Backoff và thành công ở lần thử thứ 3", async () => {
      let attempts = 0;
      const startTime = Date.now();

      const result = await reliabilityService.executeWithRetry(
        "test-transient-retry",
        async (attempt) => {
          attempts = attempt;
          if (attempt < 3) {
            throw new Error("Temporary DB lock timeout");
          }
          return "SUCCESS_DATA";
        },
        {
          maxAttempts: 3,
          initialBackoffMs: 20,
          backoffMultiplier: 2,
          jitterFactor: 0.1,
        },
      );

      const duration = Date.now() - startTime;
      assert.equal(result, "SUCCESS_DATA");
      assert.equal(attempts, 3);
      // Có delay: lần 1 (20ms) + lần 2 (40ms) >= ~50ms
      assert.ok(duration >= 40, `Duration ${duration}ms phải có khoảng chờ exponential backoff`);
    });

    test("Poison Pill: Dừng retry ngay lập tức mà không lặp lại vô ích gây nghẽn hàng đợi", async () => {
      let attempts = 0;

      await assert.rejects(
        async () => {
          await reliabilityService.executeWithRetry(
            "test-poison-pill",
            async (attempt) => {
              attempts = attempt;
              throw new AppError("Payload missing required schema", 400, ERROR_CODE.VALIDATION_ERROR);
            },
            { maxAttempts: 5 },
          );
        },
        (err: any) => {
          assert.equal(err.statusCode, 400);
          return true;
        },
      );

      // Không retry: số lần gọi đúng 1
      assert.equal(attempts, 1, "Poison pill không được retry làm nghẽn hàng đợi");
    });

    test("Transient Exhausted: Lỗi kéo dài vượt quá maxAttempts -> Ném RETRY_EXHAUSTED", async () => {
      let attempts = 0;

      await assert.rejects(
        async () => {
          await reliabilityService.executeWithRetry(
            "test-exhausted",
            async (attempt) => {
              attempts = attempt;
              throw new Error("Continuous network ETIMEDOUT");
            },
            {
              maxAttempts: 3,
              initialBackoffMs: 10,
              backoffMultiplier: 1.5,
            },
          );
        },
        (err: any) => {
          assert.equal(err.code, ERROR_CODE.RETRY_EXHAUSTED);
          return true;
        },
      );

      assert.equal(attempts, 3);
    });
  });

  describe("6. Dead-Letter Queue (DLQ) Re-drive & Reprocess Idempotency", () => {
    test("DLQ Reprocess: Tái xử lý thông điệp từ DLQ thành công mà không gây duplicate", async () => {
      const violationId = uuidv7();
      const payload = createSamplePayload(violationId);

      // Giả lập đưa vào DLQ do lỗi mạng ban đầu
      const envelope = {
        id: uuidv7(),
        name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
        payload,
        aggregateId: payload.site.id,
        timestamp: Date.now(),
        source: "test",
      };

      await eventBus.moveToDlq(envelope as any, "Network temporary failure", 3);
      assert.equal(eventBus.getDlqEvents().length, 1);
      assert.equal(eventBus.getDlqEvents()[0].status, "PENDING");

      // Thực hiện Reprocess DLQ Record qua brokerService
      const reprocessRes = await brokerService.reprocessDlqRecord(envelope.id);
      assert.equal(reprocessRes.success, true);
      assert.equal(reprocessRes.reprocessed, true);

      // Đợi consumers
      await new Promise((r) => setTimeout(r, 60));

      // Incident được tạo thành công
      assert.equal(createdIncidents.length, 1);
      assert.equal(eventBus.getDlqEvents()[0].status, "REPROCESSED");

      // Thử Reprocess lần 2 -> Idempotency bảo vệ, không sinh ra Incident thứ hai
      await brokerService.reprocessDlqRecord(envelope.id);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(createdIncidents.length, 1, "Không được tạo duplicate Incident khi reprocess lại");
    });
  });

  describe("7. Observability, Telemetry Metrics & Key Management", () => {
    test("getReliabilityMetrics: Báo cáo đầy đủ và chính xác số liệu khử trùng lặp và retry", async () => {
      reliabilityService.resetMetrics();

      // Tạo 1 event thành công
      const v1 = uuidv7();
      await brokerService.publishViolationEvent(createSamplePayload(v1));

      // Tạo 2 duplicate events của v1
      await brokerService.publishViolationEvent(createSamplePayload(v1));
      await brokerService.publishViolationEvent(createSamplePayload(v1));

      const metrics = reliabilityService.getReliabilityMetrics();

      assert.ok(metrics.totalEventsReceived >= 3);
      assert.equal(metrics.totalDeduplicated, 2);
      assert.ok(metrics.deduplicationRatePercent > 0);
      assert.ok(metrics.deduplicationBreakdown.exactViolationId >= 2);
      assert.ok(metrics.cacheMetrics.storedKeysCount >= 1);
    });

    test("listIdempotencyKeys & purgeKeys: Tra cứu và dọn dẹp các khóa Idempotency", () => {
      reliabilityRepo.purgeKeys();

      reliabilityRepo.completeKey("key-1", { data: 1 });
      reliabilityRepo.completeKey("key-2", { data: 2 });
      reliabilityRepo.failKey("key-3", "Test error");

      const listAll = reliabilityRepo.listKeys();
      assert.equal(listAll.total, 3);
      assert.equal(listAll.data.length, 3);

      const listFailed = reliabilityRepo.listKeys({ status: IDEMPOTENCY_STATUS.FAILED });
      assert.equal(listFailed.total, 1);
      assert.equal(listFailed.data[0].key, "key-3");

      // Purge theo status FAILED
      const purgedFailed = reliabilityRepo.purgeKeys(IDEMPOTENCY_STATUS.FAILED);
      assert.equal(purgedFailed, 1);
      assert.equal(reliabilityRepo.listKeys().total, 2);

      // Purge all
      const purgedAll = reliabilityRepo.purgeKeys();
      assert.equal(purgedAll, 2);
      assert.equal(reliabilityRepo.listKeys().total, 0);
    });

    test("Zod Validation: idempotencyKeyQuerySchema & purgeIdempotencyKeysSchema", () => {
      // Query schema
      const validQuery = idempotencyKeyQuerySchema.parse({
        page: "2",
        limit: "50",
        status: "COMPLETED",
        search: "biz:site-1",
      });
      assert.equal(validQuery.page, 2);
      assert.equal(validQuery.limit, 50);
      assert.equal(validQuery.status, IDEMPOTENCY_STATUS.COMPLETED);
      assert.equal(validQuery.search, "biz:site-1");

      // Purge schema
      const validPurge = purgeIdempotencyKeysSchema.parse({
        confirm: true,
        status: "FAILED",
      });
      assert.equal(validPurge.confirm, true);
      assert.equal(validPurge.status, IDEMPOTENCY_STATUS.FAILED);
    });
  });

  describe("8. Express Router & Permissions Setup", () => {
    test("Định nghĩa đúng các routes và quyền PPE_RELIABILITY_READ / PPE_RELIABILITY_MANAGE", () => {
      assert.ok(PERMISSIONS.PPE_RELIABILITY_READ);
      assert.ok(PERMISSIONS.PPE_RELIABILITY_MANAGE);
      assert.ok(reliabilityRouter);
      assert.equal(typeof reliabilityRouter, "function");
    });

    test("Controller listKeys & purgeKeys xử lý request an toàn không bị ZodError", async () => {
      let resData: any = null;
      const reqList: any = {
        query: { page: 1, limit: 20 },
      };
      const resList: any = {
        status: (code: number) => ({
          json: (data: any) => {
            resData = data;
          },
        }),
      };
      await reliabilityController.listKeys(reqList, resList, (err) => {
        if (err) throw err;
      });
      assert.equal(resData.success, true);
      assert.ok(Array.isArray(resData.data));
      assert.equal(resData.meta.limit, 20);

      let purgeRes: any = null;
      const reqPurge: any = {
        body: { confirm: true },
        user: { id: uuidv7() },
      };
      const resPurge: any = {
        status: (code: number) => ({
          json: (data: any) => {
            purgeRes = data;
          },
        }),
      };
      await reliabilityController.purgeKeys(reqPurge, resPurge, (err) => {
        if (err) throw err;
      });
      assert.equal(purgeRes.success, true);
    });
  });
});
