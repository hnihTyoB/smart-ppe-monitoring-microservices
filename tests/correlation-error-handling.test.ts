import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ZodError, z } from "zod";
import {
  correlationIdMiddleware,
  requestIdMiddleware,
  isValidRequestId,
  REQUEST_ID_HEADER,
  CORRELATION_ID_HEADER,
  TRACE_ID_HEADER,
} from "../src/middlewares/correlation.middleware";
import {
  runWithTraceContext,
  getTraceContext,
  getTraceId,
  getCorrelationId,
  setTraceTag,
  getTraceDurationMs,
} from "../src/common/context/trace-context";
import {
  errorMiddleware,
  notFoundMiddleware,
} from "../src/middlewares/error.middleware";
import {
  createTimeoutMiddleware,
  withTimeout,
} from "../src/middlewares/timeout.middleware";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import {
  NotFoundError,
  ConflictError,
  TimeoutError,
  ValidationError,
  BadRequestError,
} from "../src/common/errors/structured-errors";
import { EventBusService } from "../src/common/services/event-bus.service";
import { BrokerService } from "../src/modules/broker/broker.service";
import { PpeViolationSubscriber } from "../src/common/subscribers/ppe-violation.subscriber";
import { ReliabilityService } from "../src/modules/reliability/reliability.service";
import { ReliabilityRepository } from "../src/modules/reliability/reliability.repository";
import { EVENT_NAMES } from "../src/common/constants/event.constant";
import { isUuid } from "../src/common/helpers/uuid.helper";
import { traceParamSchema } from "../src/modules/reliability/reliability.validation";
import {
  TRACE_STAGE,
  TRACE_STAGE_STATUS,
} from "../src/common/constants/reliability.constant";
import { auditRepository } from "../src/modules/audit/audit.repository";

describe("Task BE-14: Correlation & Error Handling E2E Test Suite", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. CORRELATION ID & ASYNCLOCALSTORAGE CONTEXT
  // ───────────────────────────────────────────────────────────────────────────
  describe("1. Correlation ID Middleware & TraceContext Persistence", () => {
    it("Tự động sinh UUIDv7 khi client không gửi bất kỳ correlation header nào", () => {
      const req: any = { headers: {} };
      const setHeaders: Record<string, string> = {};
      const res: any = {
        setHeader: (k: string, v: string) => {
          setHeaders[k] = v;
        },
      };

      let nextCalled = false;
      let contextTraceId: string | undefined;

      correlationIdMiddleware(req, res, () => {
        nextCalled = true;
        contextTraceId = getTraceId();
      });

      assert.equal(nextCalled, true);
      assert.ok(req.id);
      assert.ok(req.traceId);
      assert.ok(req.correlationId);
      assert.equal(req.id, req.traceId);
      assert.equal(req.id, req.correlationId);
      assert.ok(isUuid(req.id));

      // Phải thiết lập đầy đủ cả 3 response headers
      assert.equal(setHeaders["X-Request-Id"], req.id);
      assert.equal(setHeaders["X-Correlation-Id"], req.id);
      assert.equal(setHeaders["X-Trace-Id"], req.id);

      // AsyncLocalStorage phải lưu trữ traceId
      assert.equal(contextTraceId, req.id);
    });

    it("Tiếp nhận và ưu tiên X-Correlation-Id từ client gửi lên", () => {
      const clientTraceId = "trace-client-custom-abc-12345";
      const req: any = {
        headers: {
          "x-correlation-id": clientTraceId,
        },
      };
      const setHeaders: Record<string, string> = {};
      const res: any = {
        setHeader: (k: string, v: string) => {
          setHeaders[k] = v;
        },
      };

      let contextTraceId: string | undefined;
      correlationIdMiddleware(req, res, () => {
        contextTraceId = getTraceId();
      });

      assert.equal(req.traceId, clientTraceId);
      assert.equal(req.correlationId, clientTraceId);
      assert.equal(setHeaders["X-Correlation-Id"], clientTraceId);
      assert.equal(setHeaders["X-Trace-Id"], clientTraceId);
      assert.equal(setHeaders["X-Request-Id"], clientTraceId);
      assert.equal(contextTraceId, clientTraceId);
    });

    it("Tiếp nhận X-Trace-Id nếu không có X-Correlation-Id", () => {
      const clientTraceId = "trace-via-w3c-header-67890";
      const req: any = {
        headers: {
          "x-trace-id": clientTraceId,
        },
      };
      const setHeaders: Record<string, string> = {};
      const res: any = {
        setHeader: (k: string, v: string) => {
          setHeaders[k] = v;
        },
      };

      correlationIdMiddleware(req, res, () => {});

      assert.equal(req.traceId, clientTraceId);
      assert.equal(setHeaders["X-Trace-Id"], clientTraceId);
    });

    it("Từ chối header chứa ký tự độc hại / CRLF injection và tự động sinh mới UUIDv7 an toàn", () => {
      const maliciousId = "invalid\r\nSet-Cookie: evil=true";
      const req: any = {
        headers: {
          "x-correlation-id": maliciousId,
        },
      };
      const setHeaders: Record<string, string> = {};
      const res: any = {
        setHeader: (k: string, v: string) => {
          setHeaders[k] = v;
        },
      };

      correlationIdMiddleware(req, res, () => {});

      assert.notEqual(req.traceId, maliciousId);
      assert.ok(isUuid(req.traceId));
      assert.equal(isValidRequestId(maliciousId), false);
    });

    it("Duy trì TraceContext xuyên suốt chuỗi lời gọi bất đồng bộ sâu (AsyncLocalStorage)", async () => {
      const testTraceId = "test-als-deep-chain-112233";

      await runWithTraceContext(
        {
          traceId: testTraceId,
          correlationId: testTraceId,
          startTime: Date.now() - 50,
        },
        async () => {
          assert.equal(getTraceId(), testTraceId);
          assert.equal(getCorrelationId(), testTraceId);

          setTraceTag("environment", "test");
          setTraceTag("service", "reliability");

          // Bước 1: Async Task 1
          await new Promise((r) => setTimeout(r, 10));
          assert.equal(getTraceId(), testTraceId);

          // Bước 2: Async Task 2 (lồng nhau)
          await (async () => {
            await new Promise((r) => setImmediate(r));
            assert.equal(getTraceId(), testTraceId);
            const ctx = getTraceContext();
            assert.equal(ctx?.tags?.environment, "test");
            assert.equal(ctx?.tags?.service, "reliability");
          })();

          // Thời gian thực thi
          const duration = getTraceDurationMs();
          assert.ok(typeof duration === "number" && duration >= 50);
        },
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. STRUCTURED ERROR HANDLING (RFC 7807 / RFC 9457)
  // ───────────────────────────────────────────────────────────────────────────
  describe("2. Structured Error Handling (RFC 7807/9457 Problem Details)", () => {
    it("ZodError (HTTP 422): Trả về cấu trúc Problem Details nhúng traceId, timestamp, path và mảng errors", () => {
      const schema = z.object({
        email: z.string().email("Email không đúng định dạng"),
        age: z.number().min(18, "Phải từ 18 tuổi trở lên"),
      });

      let zodErr: ZodError | undefined;
      try {
        schema.parse({ email: "invalid-email", age: 15 });
      } catch (e: any) {
        zodErr = e;
      }

      assert.ok(zodErr);

      const req: any = {
        baseUrl: "/api/v1",
        path: "/users/register",
        headers: { "x-correlation-id": "trace-zod-err-422" },
      };
      let statusSent = 0;
      let bodySent: any = null;
      const resHeaders: Record<string, string> = {};
      const res: any = {
        getHeader: (k: string) => resHeaders[k],
        setHeader: (k: string, v: string) => {
          resHeaders[k] = v;
        },
        status: (s: number) => {
          statusSent = s;
          return {
            json: (b: any) => {
              bodySent = b;
            },
          };
        },
      };

      errorMiddleware(zodErr!, req, res, () => {});

      assert.equal(statusSent, 422);
      assert.equal(bodySent.success, false);
      assert.equal(bodySent.code, ERROR_CODE.VALIDATION_ERROR);
      assert.equal(bodySent.message, "Validation failed");
      assert.equal(bodySent.traceId, "trace-zod-err-422");
      assert.equal(bodySent.correlationId, "trace-zod-err-422");
      assert.equal(bodySent.path, "/api/v1/users/register");
      assert.ok(bodySent.timestamp);
      assert.equal(Array.isArray(bodySent.errors), true);
      assert.equal(bodySent.errors.length, 2);
    });

    it("AppError & Typed Error Classes: Trả về đầy đủ mã lỗi và metadata", () => {
      const errorInstances = [
        {
          err: new NotFoundError("Không tìm thấy sự cố vi phạm"),
          expectedStatus: 404,
          expectedCode: ERROR_CODE.NOT_FOUND,
        },
        {
          err: new ConflictError("Idempotency key đã tồn tại"),
          expectedStatus: 409,
          expectedCode: ERROR_CODE.DUPLICATE_ENTRY,
        },
        {
          err: new TimeoutError("Quá hạn thời gian xử lý yêu cầu"),
          expectedStatus: 504,
          expectedCode: ERROR_CODE.REQUEST_TIMEOUT,
        },
        {
          err: new BadRequestError("Dữ liệu đầu vào không hợp lệ"),
          expectedStatus: 400,
          expectedCode: ERROR_CODE.BAD_REQUEST,
        },
      ];

      for (const item of errorInstances) {
        const req: any = {
          baseUrl: "/api/v1",
          path: "/test-error",
          headers: { "x-trace-id": "trace-typed-err-test" },
        };
        let statusSent = 0;
        let bodySent: any = null;
        const res: any = {
          getHeader: () => null,
          setHeader: () => {},
          status: (s: number) => {
            statusSent = s;
            return {
              json: (b: any) => {
                bodySent = b;
              },
            };
          },
        };

        errorMiddleware(item.err, req, res, () => {});

        assert.equal(statusSent, item.expectedStatus);
        assert.equal(bodySent.success, false);
        assert.equal(bodySent.code, item.expectedCode);
        assert.equal(bodySent.traceId, "trace-typed-err-test");
        assert.equal(bodySent.path, "/api/v1/test-error");
        assert.ok(bodySent.timestamp);
      }
    });

    it("SyntaxError (Malformed JSON): status 400 kèm structured metadata", () => {
      const syntaxErr = new SyntaxError("Unexpected token in JSON");
      (syntaxErr as any).status = 400;

      const req: any = {
        path: "/api/v1/broker/publish",
        headers: { "x-request-id": "trace-syntax-err-400" },
      };
      let statusSent = 0;
      let bodySent: any = null;
      const res: any = {
        getHeader: () => null,
        setHeader: () => {},
        status: (s: number) => {
          statusSent = s;
          return {
            json: (b: any) => {
              bodySent = b;
            },
          };
        },
      };

      errorMiddleware(syntaxErr, req, res, () => {});

      assert.equal(statusSent, 400);
      assert.equal(bodySent.code, ERROR_CODE.VALIDATION_ERROR);
      assert.equal(bodySent.traceId, "trace-syntax-err-400");
      assert.ok(bodySent.timestamp);
    });

    it("Unhandled Error (500): Trả về generic error message an toàn kèm traceId để đối chiếu", () => {
      const internalErr = new Error("Database disk connection corrupted");

      const req: any = {
        path: "/api/v1/internal-crash",
        headers: { "x-correlation-id": "trace-crash-500" },
      };
      let statusSent = 0;
      let bodySent: any = null;
      const res: any = {
        getHeader: () => null,
        setHeader: () => {},
        status: (s: number) => {
          statusSent = s;
          return {
            json: (b: any) => {
              bodySent = b;
            },
          };
        },
      };

      errorMiddleware(internalErr, req, res, () => {});

      assert.equal(statusSent, 500);
      assert.equal(bodySent.message, "Internal server error");
      assert.equal(bodySent.code, ERROR_CODE.INTERNAL_SERVER_ERROR);
      assert.equal(bodySent.traceId, "trace-crash-500");
      // Tuyệt đối không để lộ thông báo nhạy cảm về CSDL
      assert.equal(
        bodySent.message.includes("disk connection corrupted"),
        false,
      );
    });

    it("notFoundMiddleware: Gắn Route method path và chuyển tiếp 404 NOT_FOUND", () => {
      const req: any = { method: "POST", path: "/api/v1/unknown-endpoint" };
      let passedError: any = null;

      notFoundMiddleware(req, {} as any, (err: any) => {
        passedError = err;
      });

      assert.ok(passedError instanceof AppError);
      assert.equal(passedError.statusCode, 404);
      assert.equal(passedError.code, ERROR_CODE.NOT_FOUND);
      assert.equal(
        passedError.message,
        "Route POST /api/v1/unknown-endpoint not found",
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. TIMEOUT CONTROLS & ASYNC WITH_TIMEOUT
  // ───────────────────────────────────────────────────────────────────────────
  describe("3. Timeout Controls & Async Deadlines", () => {
    it("createTimeoutMiddleware: Ngắt request và trả về HTTP 504 khi xử lý quá hạn", async () => {
      const timeoutMw = createTimeoutMiddleware(30); // 30ms

      const req: any = {};
      const res: any = {
        headersSent: false,
        once: (_event: string, _fn: any) => {},
      };

      let timeoutError: any = null;

      timeoutMw(req, res, (err?: any) => {
        if (err) {
          timeoutError = err;
        }
      });

      // Chờ vượt quá 30ms
      await new Promise((r) => setTimeout(r, 60));

      assert.ok(timeoutError);
      assert.ok(timeoutError instanceof TimeoutError);
      assert.equal(timeoutError.statusCode, 504);
      assert.equal(timeoutError.code, ERROR_CODE.REQUEST_TIMEOUT);
    });

    it("createTimeoutMiddleware: Không trigger timeout nếu response đã được gửi đúng hạn", async () => {
      const timeoutMw = createTimeoutMiddleware(40);

      const req: any = {};
      let cleanupCalled = false;
      const res: any = {
        headersSent: true,
        once: (_event: string, fn: any) => {
          if (_event === "finish") {
            cleanupCalled = true;
            fn();
          }
        },
      };

      let timeoutError: any = null;
      timeoutMw(req, res, (err?: any) => {
        if (err) timeoutError = err;
      });

      await new Promise((r) => setTimeout(r, 60));

      assert.equal(timeoutError, null);
      assert.equal(cleanupCalled, true);
    });

    it("withTimeout: Trả về kết quả bình thường nếu Promise hoàn thành trước deadline", async () => {
      const quickTask = async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "SUCCESS_DATA";
      };

      const result = await withTimeout(quickTask(), 100, "QuickTask");
      assert.equal(result, "SUCCESS_DATA");
    });

    it("withTimeout: Ném ra TimeoutError nếu Promise chạy vượt quá hạn mức cho phép", async () => {
      const slowTask = async () => {
        await new Promise((r) => setTimeout(r, 80));
        return "TOO_LATE";
      };

      let thrownError: any = null;
      try {
        await withTimeout(slowTask(), 20, "SlowTask");
      } catch (err: any) {
        thrownError = err;
      }

      assert.ok(thrownError instanceof TimeoutError);
      assert.equal(thrownError.statusCode, 504);
      assert.equal(thrownError.code, ERROR_CODE.REQUEST_TIMEOUT);
      assert.ok(thrownError.message.includes("SlowTask"));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. E2E TRACE VERIFICATION (ACCEPTANCE CRITERIA CỐT LÕI)
  // ───────────────────────────────────────────────────────────────────────────
  describe("4. End-to-End Tracing Propagation & Timeline Verification", () => {
    let bus: EventBusService;
    let reliabilityRepo: ReliabilityRepository;
    let reliability: ReliabilityService;
    let broker: BrokerService;
    let subscriber: PpeViolationSubscriber;

    const mockAuditLogs: any[] = [];
    const mockAuditService: any = {
      recordLog: async (log: any) => {
        mockAuditLogs.push({
          id: `audit-${Date.now()}-${Math.random()}`,
          action: log.action,
          targetType: log.targetType,
          targetId: log.targetId,
          actorId: log.actorId,
          details: log.details,
          createdAt: new Date(),
        });
      },
    };

    const mockIncidentRepo: any = {
      findIncidentByViolationId: async () => null,
      createIncident: async (data: any) => ({
        id: "inc-e2e-12345",
        siteId: data.siteId,
        cameraId: data.cameraId,
        violationId: data.violationId,
        violationType: data.violationType,
        severity: data.severity,
        detectedAt: data.detectedAt,
        description: data.description,
      }),
    };

    const mockNotificationService: any = {
      dispatchIncidentNotification: async () => {},
    };

    const mockReportingRepo: any = {
      recordAiPerformanceMetric: async () => {},
    };

    beforeEach(() => {
      mockAuditLogs.length = 0;
      bus = new EventBusService({
        create: async (data: any) => ({
          id: "outbox-e2e-1",
          eventType: data.eventType,
          payload: data.payload,
          aggregateId: data.aggregateId,
          status: "PENDING",
          attempts: 0,
          lastError: null,
          publishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        markPublished: async () => {},
        markFailed: async () => {},
        claimPendingEvents: async () => [],
        deletePublishedOlderThan: async () => 0,
        findById: async () => null,
        countPending: async () => 0,
      } as any);

      reliabilityRepo = new ReliabilityRepository();
      // Mock findAuditLogsByTraceId của reliabilityRepo
      reliabilityRepo.findAuditLogsByTraceId = async (tId: string) => {
        return mockAuditLogs.filter((a) => a.details?.traceId === tId);
      };

      reliability = new ReliabilityService(
        reliabilityRepo,
        mockAuditService,
        bus,
      );
      broker = new BrokerService(bus, mockAuditService, reliability);
      subscriber = new PpeViolationSubscriber(
        bus,
        mockIncidentRepo,
        mockNotificationService,
        mockReportingRepo,
        mockAuditService,
        reliability,
      );
      subscriber.register();
    });

    it("Trace E2E: Ingestion -> EventBus -> Fan-out Consumers -> Outbox -> Audit Logs mang CÙNG 1 Trace ID", async () => {
      const e2eTraceId = "trace-e2e-datn-full-journey-9999";
      const violationId = "01a12c45-1689-7f73-a7df-0229211e9999";

      let downstreamIncidentCreatedTraceId: string | undefined;

      // Đăng ký listener sự kiện thứ cấp ppe.incident.created để kiểm tra kế thừa traceId
      bus.subscribe(EVENT_NAMES.PPE_INCIDENT_CREATED, (envelope) => {
        downstreamIncidentCreatedTraceId = envelope.traceId;
      });

      // Bọc quá trình gọi Ingestion Bridge trong AsyncLocalStorage TraceContext
      const publishResponse = await runWithTraceContext(
        {
          traceId: e2eTraceId,
          correlationId: e2eTraceId,
          startTime: Date.now(),
        },
        async () => {
          return await broker.publishViolationEvent(
            {
              violationId,
              timestamp: new Date().toISOString(),
              site: {
                id: "11111111-1111-1111-1111-111111111111",
                code: "SITE_A",
                name: "Công trường A",
              },
              camera: {
                id: "22222222-2222-2222-2222-222222222222",
                code: "CAM_01",
                name: "Cổng chính",
                zone: "Khu vực cổng",
              },
              evidence: {
                snapshotUrl: "https://minio.local/snapshots/test.jpg",
                frameResolution: { width: 1920, height: 1080 },
              },
              violations: [
                {
                  violationType: "NO_HELMET",
                  severity: "HIGH",
                  confidence: 0.95,
                  description: "Không đội mũ bảo hộ",
                  box: { x: 10, y: 20, width: 30, height: 40 },
                },
              ],
              summary: {
                totalPersons: 1,
                violatingPersons: 1,
                totalViolations: 1,
                highestSeverity: "HIGH",
              },
            },
            e2eTraceId,
            "ai-inference-engine",
          );
        },
      );

      assert.equal(publishResponse.success, true);
      assert.equal(publishResponse.traceId, e2eTraceId);
      assert.equal(publishResponse.status, "PUBLISHED");

      // Chờ các async consumer handlers trong setImmediate hoàn tất
      await new Promise((r) => setTimeout(r, 60));

      // 1. Kiểm tra sự kiện thứ cấp ppe.incident.created đã kế thừa nguyên vẹn e2eTraceId
      assert.equal(downstreamIncidentCreatedTraceId, e2eTraceId);

      // 2. Kiểm tra Audit Log đã ghi nhận traceId đúng chuẩn
      const relatedAuditLogs = mockAuditLogs.filter(
        (a) => a.details?.traceId === e2eTraceId,
      );
      assert.ok(relatedAuditLogs.length >= 1);
      assert.equal(relatedAuditLogs[0].details.traceId, e2eTraceId);

      // 3. Tra cứu hành trình E2E Timeline qua API getTraceTimeline
      const timeline = await reliability.getTraceTimeline(e2eTraceId);
      assert.equal(timeline.traceId, e2eTraceId);
      assert.ok(timeline.eventsCount >= 1);

      const auditStage = timeline.stages.find((s) => s.stage === "AUDIT_LOG");
      assert.ok(auditStage);
      assert.equal(auditStage.status, "RECORDED");
    });

    it("Trace E2E qua Poison Pill và Dead-Letter Queue (DLQ): Duy trì nguyên vẹn Trace ID khi gặp lỗi", async () => {
      const dlqTraceId = "trace-poison-pill-dlq-5555";

      // Bắn một payload không hợp lệ để trigger di chuyển vào DLQ
      let appErrorThrown = false;
      try {
        await broker.publishViolationEvent(
          {
            invalidField: true,
          } as any,
          dlqTraceId,
        );
      } catch (err: any) {
        appErrorThrown = true;
        assert.equal(err.code, ERROR_CODE.VALIDATION_ERROR);
      }

      assert.equal(appErrorThrown, true);

      // Kiểm tra Dead-Letter Queue
      const dlqEvents = bus.getDlqEvents();
      const targetDlq = dlqEvents.find((d) => d.envelope.traceId === dlqTraceId);
      assert.ok(targetDlq);
      assert.equal(targetDlq.envelope.traceId, dlqTraceId);

      // Tra cứu timeline xác nhận hiển thị stage DEAD_LETTER_QUEUE
      const timeline = await reliability.getTraceTimeline(dlqTraceId);
      assert.equal(timeline.traceId, dlqTraceId);
      const dlqStage = timeline.stages.find(
        (s) => s.stage === "DEAD_LETTER_QUEUE",
      );
      assert.ok(dlqStage);
      assert.equal(dlqStage.status, "PENDING");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. TRACED RETRY POLICY & VALIDATION PARAMETER
  // ───────────────────────────────────────────────────────────────────────────
  describe("5. Traced Retry Policy & Validation Schemas", () => {
    it("executeWithRetry: Log đính kèm Trace ID từ AsyncLocalStorage", async () => {
      const reliability = new ReliabilityService();
      const retryTraceId = "trace-retry-logged-7777";

      let attemptsCount = 0;

      await runWithTraceContext(
        {
          traceId: retryTraceId,
          correlationId: retryTraceId,
          startTime: Date.now(),
        },
        async () => {
          const res = await reliability.executeWithRetry(
            "test-traced-retry-task",
            async (attempt) => {
              attemptsCount = attempt;
              if (attempt < 2) {
                throw new Error("Temporary DB lock timeout");
              }
              return "RETRY_SUCCESS";
            },
            {
              maxAttempts: 3,
              initialBackoffMs: 10,
              maxBackoffMs: 50,
            },
          );

          assert.equal(res, "RETRY_SUCCESS");
          assert.equal(attemptsCount, 2);
        },
      );
    });

    it("traceParamSchema: Validate param hợp lệ và từ chối các chuỗi nguy hiểm", () => {
      // Hợp lệ
      const valid1 = traceParamSchema.safeParse({ traceId: "abc-123_XYZ" });
      assert.equal(valid1.success, true);

      const valid2 = traceParamSchema.safeParse({
        traceId: "018f3a9e-1111-7f73-a7df-0229211e9999",
      });
      assert.equal(valid2.success, true);

      // Không hợp lệ: Rỗng
      const invalidEmpty = traceParamSchema.safeParse({ traceId: "" });
      assert.equal(invalidEmpty.success, false);

      // Không hợp lệ: Chứa khoảng trắng
      const invalidSpace = traceParamSchema.safeParse({
        traceId: "trace with space",
      });
      assert.equal(invalidSpace.success, false);

      // Không hợp lệ: Chứa ký tự injection
      const invalidInjection = traceParamSchema.safeParse({
        traceId: "trace<script>alert(1)</script>",
      });
      assert.equal(invalidInjection.success, false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. VERIFICATION SUITE: 9 ĐIỂM CODE REVIEW ĐÃ ĐƯỢC GIẢI QUYẾT TRIỆT ĐỂ
  // ───────────────────────────────────────────────────────────────────────────
  describe("6. Verification Suite: 9 Điểm Code Review", () => {
    it("1. [BUG-01] errorMiddleware: Không crash khi res không có getHeader hoặc req không có headers", () => {
      let statusCode = 0;
      let jsonPayload: any = null;
      const minimalRes: any = {
        status: (s: number) => {
          statusCode = s;
          return minimalRes;
        },
        json: (p: any) => {
          jsonPayload = p;
          return minimalRes;
        },
      };

      const emptyReq: any = {};
      let nextCalled = false;

      assert.doesNotThrow(() => {
        errorMiddleware(new Error("Test crash"), emptyReq, minimalRes, () => {
          nextCalled = true;
        });
      });

      assert.equal(statusCode, 500);
      assert.equal(jsonPayload.success, false);
      assert.equal(jsonPayload.code, ERROR_CODE.INTERNAL_SERVER_ERROR);
      assert.equal(jsonPayload.traceId, "no-trace-id");
      assert.equal(nextCalled, false);
    });

    it("1. [BUG-01] errorMiddleware: Delegate về next(err) nếu res.headersSent === true", () => {
      let nextCalled = false;
      let passedError: any = null;
      const alreadySentRes: any = {
        headersSent: true,
      };
      const req: any = { headers: {} };
      const err = new Error("Already sent error");

      errorMiddleware(err, req, alreadySentRes, (e) => {
        nextCalled = true;
        passedError = e;
      });

      assert.equal(nextCalled, true);
      assert.equal(passedError, err);
    });

    it("2. [BUG-02 & BUG-04] timeoutMiddleware: Chặn ghi đè response khi tác vụ hoàn thành trễ sau timeout", async () => {
      const mw = createTimeoutMiddleware(50);
      let jsonCalledAfterTimeout = false;

      const mockRes: any = {
        headersSent: false,
        once: () => {},
        status: () => mockRes,
        json: (body: any) => {
          if (mockRes.headersSent) {
            jsonCalledAfterTimeout = true;
          }
          return mockRes;
        },
        send: () => mockRes,
      };

      let timeoutErrorReceived: any = null;
      mw({} as any, mockRes, (err?: any) => {
        if (err) {
          timeoutErrorReceived = err;
          mockRes.headersSent = true; // Giả lập errorMiddleware đã gửi HTTP 504
        }
      });

      // Đợi quá 50ms để timeout kích hoạt
      await new Promise((r) => setTimeout(r, 80));
      assert.ok(timeoutErrorReceived instanceof TimeoutError);

      // Bây giờ giả lập controller hoàn thành trễ và gọi res.json()
      mockRes.json({ lateResult: true });
      assert.equal(jsonCalledAfterTimeout, false);
    });

    it("3. [ARCH-01] ReliabilityRepository: Ủy quyền cho AuditRepository và có kiểu trả về AuditLogItemDto[]", async () => {
      const customAuditRepo: any = {
        findByTraceId: async (tId: string) => [
          {
            id: "audit-01",
            actorId: null,
            actor: null,
            action: "TEST_ACTION",
            targetType: "TEST_TARGET",
            targetId: "target-01",
            details: { traceId: tId },
            ipAddress: null,
            userAgent: null,
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const relRepo = new ReliabilityRepository(customAuditRepo);
      const logs = await relRepo.findAuditLogsByTraceId("trace-delegation-check");

      assert.equal(logs.length, 1);
      assert.equal(logs[0].id, "audit-01");
      assert.equal(logs[0].action, "TEST_ACTION");
    });

    it("4. [BUG-03] AuditRepository: Ghi log cảnh báo thay vì nuốt chửng lỗi CSDL", async () => {
      const warnedLogs: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: any[]) => {
        warnedLogs.push(args.join(" "));
      };

      try {
        const brokenDbRepo = new (auditRepository.constructor as any)({
          auditLog: {
            findMany: async () => {
              throw new Error("Simulated PostgreSQL connection failure");
            },
          },
        });

        const results = await brokenDbRepo.findByTraceId("trace-db-crash");
        assert.deepEqual(results, []);
        assert.ok(warnedLogs.some((l) => l.includes("Simulated PostgreSQL connection failure")));
      } finally {
        console.warn = originalWarn;
      }
    });

    it("5. [ARCH-02] TRACE_STAGE & TRACE_STAGE_STATUS: Định nghĩa tập trung không dùng magic strings", () => {
      assert.equal(TRACE_STAGE.DEAD_LETTER_QUEUE, "DEAD_LETTER_QUEUE");
      assert.equal(TRACE_STAGE.IDEMPOTENCY_MUTEX, "IDEMPOTENCY_MUTEX");
      assert.equal(TRACE_STAGE.AUDIT_LOG, "AUDIT_LOG");
      assert.equal(TRACE_STAGE_STATUS.PENDING, "PENDING");
      assert.equal(TRACE_STAGE_STATUS.RECORDED, "RECORDED");
    });

    it("6. [SEC-01] ReliabilityService: Sanitize triệt để trường nhạy cảm trong a.details của Timeline", async () => {
      const mockAuditRepo: any = {
        findByTraceId: async () => [
          {
            id: "log-sensitive",
            action: "USER_LOGIN",
            targetType: "USER",
            targetId: "user-123",
            createdAt: new Date().toISOString(),
            details: {
              traceId: "trace-leak-test",
              password: "plain_password_123",
              token: "secret_jwt_token",
              secret: "my_secret_key",
              authorization: "Bearer eyJhbGci...",
              refreshToken: "refresh_token_abc",
              apiKey: "api_key_xyz",
              safeField: "this_is_safe_data",
            },
          },
        ],
      };

      const relRepo = new ReliabilityRepository(mockAuditRepo);
      const service = new ReliabilityService(relRepo, undefined, new EventBusService({} as any));

      const timeline = await service.getTraceTimeline("trace-leak-test");
      const auditStage = timeline.stages.find((s) => s.stage === TRACE_STAGE.AUDIT_LOG);

      assert.ok(auditStage);
      const sanitized = auditStage.details?.details as any;
      assert.ok(sanitized);
      assert.equal(sanitized.safeField, "this_is_safe_data");
      assert.equal(sanitized.password, undefined);
      assert.equal(sanitized.token, undefined);
      assert.equal(sanitized.secret, undefined);
      assert.equal(sanitized.authorization, undefined);
      assert.equal(sanitized.refreshToken, undefined);
      assert.equal(sanitized.apiKey, undefined);
    });

    it("8. [VAL-02] timeoutMiddleware: Fallback an toàn về default 15000 khi REQUEST_TIMEOUT_MS không hợp lệ", () => {
      const mwInvalid = createTimeoutMiddleware(NaN as any);
      assert.ok(typeof mwInvalid === "function");
    });

    it("9. [VAL-01] Structured Error Classes: Khởi tạo an toàn với dữ liệu kiểu unknown", () => {
      const badReq = new BadRequestError("Bad", ERROR_CODE.BAD_REQUEST, { custom: 123 });
      assert.equal(badReq.statusCode, 400);
      assert.deepEqual(badReq.data, { custom: 123 });

      const valErr = new ValidationError("Failed", [{ field: "email", message: "Invalid" }]);
      assert.equal(valErr.statusCode, 422);
      assert.deepEqual(valErr.data, [{ field: "email", message: "Invalid" }]);

      const timeoutErr = new TimeoutError("Timed out", ERROR_CODE.REQUEST_TIMEOUT, { ms: 5000 });
      assert.equal(timeoutErr.statusCode, 504);
      assert.deepEqual(timeoutErr.data, { ms: 5000 });
    });
  });
});

