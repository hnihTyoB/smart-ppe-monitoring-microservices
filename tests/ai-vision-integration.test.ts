import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  aiVisionIngestEventSchema,
  aiVisionBatchIngestSchema,
  aiVisionSimulateSchema,
  aiVisionSyncQuerySchema,
} from "../src/modules/integration/ai-vision.validation";
import {
  AiVisionIntegrationService,
} from "../src/modules/integration/ai-vision.service";
import {
  AI_VISION_INGESTION_STATUS,
  AI_VISION_MODE,
  BROKER_TOPICS,
} from "../src/common/constants/broker.constant";
import {
  PPE_VIOLATION_TYPES,
  PPE_SEVERITY,
} from "../src/common/constants/kafka.constant";
import { EventBusService } from "../src/common/services/event-bus.service";
import { generateId, isUuid } from "../src/common/helpers/uuid.helper";
import { AppError } from "../src/common/errors/app-error";

describe("Task BE-15: AI Vision Integration Endpoint Test Suite", { concurrency: 1 }, () => {
  let mockEventBus: EventBusService;
  let mockIncidentRepo: any;
  let mockCameraRepo: any;
  let mockSiteRepo: any;
  let service: AiVisionIntegrationService;

  const sampleCameraId = "018e65f3-7a2c-7b12-9c4e-111111111111";
  const sampleSiteId = "018e65f3-7a2c-7b12-9c4e-222222222222";

  beforeEach(() => {
    mockEventBus = new EventBusService();

    // Mock Camera Repository
    mockCameraRepo = {
      findCameraById: async (id: string) => {
        if (id === sampleCameraId) {
          return {
            id: sampleCameraId,
            code: "CAM-GATE-01",
            name: "Camera Cổng Chính",
            siteId: sampleSiteId,
            location: "Khu vực Cổng 1",
            status: "ONLINE",
          };
        }
        return null;
      },
      findCameraByCode: async (code: string) => {
        if (code.toUpperCase() === "CAM-GATE-01") {
          return {
            id: sampleCameraId,
            code: "CAM-GATE-01",
            name: "Camera Cổng Chính",
            siteId: sampleSiteId,
            location: "Khu vực Cổng 1",
            status: "ONLINE",
          };
        }
        return null;
      },
      findAllCameras: async () => ({
        data: [
          {
            id: sampleCameraId,
            code: "CAM-GATE-01",
            name: "Camera Cổng Chính",
            siteId: sampleSiteId,
          },
        ],
        meta: { total: 1, page: 1, limit: 1, totalPages: 1 },
      }),
    };

    // Mock Site Repository
    mockSiteRepo = {
      findSiteById: async (id: string) => {
        if (id === sampleSiteId) {
          return {
            id: sampleSiteId,
            code: "SITE-HN-01",
            name: "Công trường Landmark Tower",
            status: "ACTIVE",
          };
        }
        return null;
      },
      findSiteByCode: async (code: string) => {
        if (code.toUpperCase() === "SITE-HN-01") {
          return {
            id: sampleSiteId,
            code: "SITE-HN-01",
            name: "Công trường Landmark Tower",
            status: "ACTIVE",
          };
        }
        return null;
      },
      findAllSites: async () => ({
        data: [
          {
            id: sampleSiteId,
            code: "SITE-HN-01",
            name: "Công trường Landmark Tower",
          },
        ],
        meta: { total: 1, page: 1, limit: 1, totalPages: 1 },
      }),
    };

    // Mock Incident Repository với in-memory store
    const incidentsDb = new Map<string, any>();
    mockIncidentRepo = {
      _store: incidentsDb,
      findIncidentByViolationId: async (violationId: string) => {
        return incidentsDb.get(violationId) || null;
      },
      createIncident: async (data: any, _actorId: string) => {
        const incidentId = generateId();
        const evidenceId = generateId();
        const record = {
          id: incidentId,
          siteId: data.siteId,
          cameraId: data.cameraId,
          violationId: data.violationId,
          violationType: data.violationType,
          severity: data.severity,
          status: data.status || "PENDING_REVIEW",
          detectedAt: data.detectedAt,
          description: data.description,
          evidences: [
            {
              id: evidenceId,
              storageKey: data.initialEvidence?.storageKey,
              evidenceType: data.initialEvidence?.evidenceType,
              metadata: data.initialEvidence?.metadata,
            },
          ],
        };
        incidentsDb.set(data.violationId, record);
        return record;
      },
      findAllIncidents: async () => ({
        data: Array.from(incidentsDb.values()),
        meta: { total: incidentsDb.size, page: 1, limit: 1, totalPages: 1 },
      }),
    };

    // Khởi tạo Service với các mock repositories
    service = new AiVisionIntegrationService(
      mockEventBus,
      mockIncidentRepo,
      mockCameraRepo,
      mockSiteRepo,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 1: CONTRACT VALIDATION & SCHEMA ENFORCEMENT
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 1: Contract Validation & Schema Enforcement", () => {
    it("Chấp nhận Full Kafka Envelope có đầy đủ site/camera/violations/evidence", () => {
      const fullPayload = {
        violationId: generateId(),
        timestamp: new Date().toISOString(),
        site: {
          id: sampleSiteId,
          code: "SITE-HN-01",
          name: "Landmark Tower",
        },
        camera: {
          id: sampleCameraId,
          code: "CAM-GATE-01",
          name: "Camera Cổng",
          zone: "Khu vực 1",
        },
        evidence: {
          snapshotUrl: "https://minio.ppe.local/ppe-evidences/snapshot_123.jpg",
          clipUrl: "https://minio.ppe.local/ppe-evidences/clip_123.mp4",
          frameResolution: { width: 1920, height: 1080 },
        },
        detections: [
          {
            class: "PERSON",
            confidence: 0.95,
            box: { x: 100, y: 150, width: 200, height: 500 },
          },
        ],
        violations: [
          {
            violationType: "NO_HELMET",
            severity: "HIGH",
            description: "Không đội mũ bảo hộ",
            confidence: 0.92,
          },
        ],
      };

      const parsed = aiVisionIngestEventSchema.safeParse(fullPayload);
      assert.strictEqual(parsed.success, true);
    });

    it("Chấp nhận Lightweight Edge Payload với cameraCode tối giản từ Python Edge (SV2)", () => {
      const edgePayload = {
        cameraCode: "CAM-GATE-01",
        evidence: {
          snapshotUrl: "https://minio.ppe.local/ppe-evidences/snapshot_edge.jpg",
          frameResolution: { width: 1920, height: 1080 },
        },
        violations: [
          {
            violationType: "NO_VEST",
            severity: "MEDIUM",
            description: "Thiếu áo phản quang",
            confidence: 0.88,
          },
        ],
      };

      const parsed = aiVisionIngestEventSchema.safeParse(edgePayload);
      assert.strictEqual(parsed.success, true);
    });

    it("Từ chối khi thiếu hoàn toàn định danh Camera (camera.id, camera.code, cameraId, cameraCode)", () => {
      const malformedPayload = {
        evidence: {
          snapshotUrl: "https://minio.ppe.local/ppe-evidences/snapshot_err.jpg",
          frameResolution: { width: 1920, height: 1080 },
        },
        violations: [
          {
            violationType: "NO_HELMET",
            severity: "HIGH",
            description: "Không đội mũ",
            confidence: 0.9,
          },
        ],
      };

      const parsed = aiVisionIngestEventSchema.safeParse(malformedPayload);
      assert.strictEqual(parsed.success, false);
      assert.ok(
        parsed.error?.issues.some((issue) =>
          issue.message.includes("định danh Camera"),
        ),
      );
    });

    it("Từ chối khi mảng violations rỗng", () => {
      const emptyViolations = {
        cameraCode: "CAM-GATE-01",
        evidence: {
          snapshotUrl: "https://minio.ppe.local/ppe-evidences/snapshot.jpg",
          frameResolution: { width: 1920, height: 1080 },
        },
        violations: [],
      };

      const parsed = aiVisionIngestEventSchema.safeParse(emptyViolations);
      assert.strictEqual(parsed.success, false);
    });

    it("Từ chối khi snapshotUrl không đúng định dạng URL", () => {
      const invalidUrl = {
        cameraCode: "CAM-GATE-01",
        evidence: {
          snapshotUrl: "not-a-valid-url-path",
          frameResolution: { width: 1920, height: 1080 },
        },
        violations: [
          {
            violationType: "NO_HELMET",
            severity: "HIGH",
            description: "Không đội mũ",
            confidence: 0.9,
          },
        ],
      };

      const parsed = aiVisionIngestEventSchema.safeParse(invalidUrl);
      assert.strictEqual(parsed.success, false);
    });

    it("Tự động điền mặc định frameResolution (1920x1080) và severity khi client rút gọn không truyền", () => {
      const minimalEvidencePayload = {
        cameraCode: "CAM-GATE-01",
        evidence: {
          snapshotUrl: "https://minio.ppe.local/ppe-evidences/snapshot_auto.jpg",
        },
        violations: [
          {
            violationType: "NO_HELMET",
            description: "Không đội mũ",
            confidence: 0.9,
          },
        ],
      };

      const parsed = aiVisionIngestEventSchema.safeParse(minimalEvidencePayload);
      assert.strictEqual(parsed.success, true);
      assert.strictEqual(parsed.data?.evidence.frameResolution.width, 1920);
      assert.strictEqual(parsed.data?.evidence.frameResolution.height, 1080);
      assert.strictEqual(parsed.data?.violations[0].severity, "HIGH");
    });

    it("Validate và chuẩn hóa query param ?sync thành boolean an toàn", () => {
      const trueResult = aiVisionSyncQuerySchema.parse({ sync: "true" });
      assert.strictEqual(trueResult.sync, true);

      const oneResult = aiVisionSyncQuerySchema.parse({ sync: "1" });
      assert.strictEqual(oneResult.sync, true);

      const falseResult = aiVisionSyncQuerySchema.parse({ sync: "false" });
      assert.strictEqual(falseResult.sync, false);

      const zeroResult = aiVisionSyncQuerySchema.parse({ sync: "0" });
      assert.strictEqual(zeroResult.sync, false);

      const emptyResult = aiVisionSyncQuerySchema.parse({});
      assert.strictEqual(emptyResult.sync, undefined);

      assert.throws(() => {
        aiVisionSyncQuerySchema.parse({ sync: "invalid_value" });
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 2: AUTO-ENRICHMENT & EVIDENCE NORMALIZATION ENGINE
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 2: Auto-Enrichment & Evidence Normalization Engine", () => {
    it("Tự động tra cứu và điền đầy đủ site/camera khi Edge AI chỉ gửi cameraCode, bóc tách query parameter cả snapshotUrl và clipUrl", async () => {
      let publishedPayload: any = null;
      mockEventBus.subscribe(
        BROKER_TOPICS.PPE_VIOLATION_DETECTED,
        async (envelope) => {
          publishedPayload = envelope.payload;
        },
      );

      const result = await service.ingestEvent({
        cameraCode: "CAM-GATE-01",
        evidence: {
          snapshotUrl:
            "https://minio.ppe.local/ppe-evidences/snapshot_test.jpg?X-Amz-Signature=secret123",
          clipUrl:
            "https://minio.ppe.local/ppe-evidences/clip_test.mp4?X-Amz-Signature=secret456",
          frameResolution: { width: 1920, height: 1080 },
        },
        violations: [
          {
            violationType: "NO_HELMET",
            severity: "HIGH",
            description: "Không đội mũ bảo hộ",
            confidence: 0.95,
          },
        ],
      });

      assert.strictEqual(result.status, AI_VISION_INGESTION_STATUS.QUEUED);
      assert.strictEqual(result.mode, AI_VISION_MODE.ASYNC);
      assert.ok(isUuid(result.violationId));

      // Kiểm chứng payload xuất bản đã được làm giàu thông tin chính xác
      assert.ok(publishedPayload);
      assert.strictEqual(publishedPayload.camera.id, sampleCameraId);
      assert.strictEqual(publishedPayload.camera.code, "CAM-GATE-01");
      assert.strictEqual(publishedPayload.camera.name, "Camera Cổng Chính");
      assert.strictEqual(publishedPayload.site.id, sampleSiteId);
      assert.strictEqual(publishedPayload.site.code, "SITE-HN-01");
      assert.strictEqual(publishedPayload.site.name, "Công trường Landmark Tower");

      // Kiểm chứng Snapshot URL và Clip URL đã được bóc tách query parameter (chữ ký Presigned)
      assert.strictEqual(
        publishedPayload.evidence.snapshotUrl,
        "https://minio.ppe.local/ppe-evidences/snapshot_test.jpg",
      );
      assert.strictEqual(
        publishedPayload.evidence.clipUrl,
        "https://minio.ppe.local/ppe-evidences/clip_test.mp4",
      );
    });

    it("Ném lỗi 404 khi cung cấp camera không tồn tại và không có metadata fallback", async () => {
      await assert.rejects(
        async () => {
          await service.ingestEvent({
            cameraId: "018e65f3-7a2c-7b12-9c4e-999999999999", // non-existent
            evidence: {
              snapshotUrl: "https://minio.ppe.local/test.jpg",
              frameResolution: { width: 1920, height: 1080 },
            },
            violations: [
              {
                violationType: "NO_HELMET",
                severity: "HIGH",
                description: "Không đội mũ",
                confidence: 0.9,
              },
            ],
          });
        },
        (err: any) => {
          assert.strictEqual(err instanceof AppError, true);
          assert.strictEqual(err.statusCode, 404);
          return true;
        },
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 3: E2E PIPELINE TO INCIDENT CREATION (ACCEPTANCE CRITERIA)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 3: E2E Incident Creation in Database (Acceptance Criteria)", () => {
    it("AI event tạo Incident thành công trong CSDL đúng contract ở chế độ Sync (?sync=true)", async () => {
      const testViolationId = generateId();

      const result = await service.ingestEvent(
        {
          violationId: testViolationId,
          cameraCode: "CAM-GATE-01",
          evidence: {
            snapshotUrl:
              "https://minio.ppe.local/ppe-evidences/sites/s1/cameras/c1/evidence_001.jpg?X-Amz-Expires=3600",
            frameResolution: { width: 1920, height: 1080 },
          },
          detections: [
            {
              class: "PERSON",
              confidence: 0.98,
              box: { x: 100, y: 100, width: 200, height: 600 },
              trackId: 42,
            },
          ],
          violations: [
            {
              violationType: "NO_HELMET",
              severity: "CRITICAL",
              description: "Công nhân không đội mũ bảo hộ tại khu vực thi công",
              confidence: 0.96,
            },
          ],
          summary: {
            totalPersons: 1,
            totalViolations: 1,
            highestSeverity: "CRITICAL",
          },
        },
        { sync: true },
      );

      // 1. Phản hồi API chuẩn xác
      assert.strictEqual(result.status, AI_VISION_INGESTION_STATUS.PROCESSED);
      assert.strictEqual(result.mode, AI_VISION_MODE.SYNC);
      assert.strictEqual(result.violationId, testViolationId);
      assert.ok(result.incident);
      assert.ok(isUuid(result.incident.id));
      assert.strictEqual(result.incident.violationType, "NO_HELMET");
      assert.strictEqual(result.incident.severity, "CRITICAL");
      assert.strictEqual(result.incident.status, "PENDING_REVIEW");
      assert.strictEqual(result.incident.siteId, sampleSiteId);
      assert.strictEqual(result.incident.cameraId, sampleCameraId);

      // 2. Kiểm chứng CSDL đã lưu trữ Incident với đúng liên kết Evidence
      const savedInDb = await mockIncidentRepo.findIncidentByViolationId(
        testViolationId,
      );
      assert.ok(savedInDb);
      assert.strictEqual(savedInDb.id, result.incident.id);
      assert.strictEqual(savedInDb.violationId, testViolationId);
      assert.strictEqual(savedInDb.status, "PENDING_REVIEW");
      assert.ok(savedInDb.evidences && savedInDb.evidences.length > 0);
      assert.strictEqual(
        savedInDb.evidences[0].storageKey,
        "evidence_001.jpg",
      );
      assert.strictEqual(
        savedInDb.evidences[0].metadata?.aiDetections?.summary?.highestSeverity,
        "CRITICAL",
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 4: BATCH INGESTION & EDGE OFFLINE BUFFER RECOVERY
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 4: Batch Ingestion & Edge Offline Buffer Recovery", () => {
    it("Xử lý mảng sự kiện hàng loạt, thống kê chính xác số lượng ingested, duplicates, failed", async () => {
      const v1 = generateId();
      const v2 = generateId();

      // Giả lập sự kiện v1 đã có sẵn trong CSDL
      await service.ingestEvent(
        {
          violationId: v1,
          cameraCode: "CAM-GATE-01",
          evidence: {
            snapshotUrl: "https://minio.ppe.local/v1.jpg",
            frameResolution: { width: 1920, height: 1080 },
          },
          violations: [
            {
              violationType: "NO_HELMET",
              severity: "HIGH",
              description: "Lần 1",
              confidence: 0.9,
            },
          ],
        },
        { sync: true },
      );

      // Gửi batch gồm 3 sự kiện: v1 (trùng lặp), v2 (mới hợp lệ), v3 (camera hỏng - fail)
      const batchResult = await service.ingestBatch({
        events: [
          {
            violationId: v1, // Sẽ trùng lặp
            cameraCode: "CAM-GATE-01",
            evidence: {
              snapshotUrl: "https://minio.ppe.local/v1_repeat.jpg",
              frameResolution: { width: 1920, height: 1080 },
            },
            violations: [
              {
                violationType: "NO_HELMET",
                severity: "HIGH",
                description: "Lặp lại",
                confidence: 0.9,
              },
            ],
          },
          {
            violationId: v2, // Mới hợp lệ
            cameraCode: "CAM-GATE-01",
            evidence: {
              snapshotUrl: "https://minio.ppe.local/v2.jpg",
              frameResolution: { width: 1920, height: 1080 },
            },
            violations: [
              {
                violationType: "NO_VEST",
                severity: "HIGH",
                description: "Thiếu áo",
                confidence: 0.92,
              },
            ],
          },
          {
            violationId: generateId(),
            cameraId: "018e65f3-7a2c-7b12-9c4e-999999999999", // Camera không tồn tại -> Fail
            evidence: {
              snapshotUrl: "https://minio.ppe.local/v3.jpg",
              frameResolution: { width: 1920, height: 1080 },
            },
            violations: [
              {
                violationType: "NO_BOOTS",
                severity: "LOW",
                description: "Thiếu giày",
                confidence: 0.8,
              },
            ],
          },
        ],
      });

      assert.strictEqual(batchResult.total, 3);
      assert.strictEqual(batchResult.ingested, 1);
      assert.strictEqual(batchResult.duplicates, 1);
      assert.strictEqual(batchResult.failed, 1);
      assert.strictEqual(batchResult.results.length, 3);
      assert.strictEqual(
        batchResult.results[0].status,
        AI_VISION_INGESTION_STATUS.DUPLICATE,
      );
      assert.strictEqual(
        batchResult.results[1].status,
        AI_VISION_INGESTION_STATUS.QUEUED,
      );
      assert.strictEqual(
        batchResult.results[2].status,
        AI_VISION_INGESTION_STATUS.FAILED,
      );
    });

    it("Validation schema giới hạn mảng batch tối đa 50 phần tử", () => {
      const items = Array.from({ length: 51 }, () => ({
        cameraCode: "CAM-GATE-01",
        evidence: {
          snapshotUrl: "https://minio.ppe.local/item.jpg",
          frameResolution: { width: 1920, height: 1080 },
        },
        violations: [
          {
            violationType: "NO_HELMET",
            severity: "HIGH",
            description: "Test",
            confidence: 0.9,
          },
        ],
      }));

      const parsed = aiVisionBatchIngestSchema.safeParse({ events: items });
      assert.strictEqual(parsed.success, false);
      assert.ok(
        parsed.error?.issues.some((i) => i.message.includes("tối đa 50")),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 5: IDEMPOTENCY & DEDUPLICATION GUARD (BE-13 INTEGRATION)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 5: Idempotency & Deduplication Guard", () => {
    it("Gửi 2 lần cùng một violationId không tạo 2 bản ghi Incident trong CSDL", async () => {
      const fixedViolationId = generateId();

      const call1 = await service.ingestEvent(
        {
          violationId: fixedViolationId,
          cameraCode: "CAM-GATE-01",
          evidence: {
            snapshotUrl: "https://minio.ppe.local/evidence.jpg",
            frameResolution: { width: 1920, height: 1080 },
          },
          violations: [
            {
              violationType: "NO_HELMET",
              severity: "HIGH",
              description: "Vi phạm lần 1",
              confidence: 0.95,
            },
          ],
        },
        { sync: true },
      );

      assert.strictEqual(call1.status, AI_VISION_INGESTION_STATUS.PROCESSED);
      const incidentId1 = call1.incident?.id;
      assert.ok(incidentId1);

      // Gửi lại y hệt
      const call2 = await service.ingestEvent(
        {
          violationId: fixedViolationId,
          cameraCode: "CAM-GATE-01",
          evidence: {
            snapshotUrl: "https://minio.ppe.local/evidence.jpg",
            frameResolution: { width: 1920, height: 1080 },
          },
          violations: [
            {
              violationType: "NO_HELMET",
              severity: "HIGH",
              description: "Vi phạm gửi lại",
              confidence: 0.95,
            },
          ],
        },
        { sync: true },
      );

      assert.strictEqual(call2.status, AI_VISION_INGESTION_STATUS.DUPLICATE);
      assert.strictEqual(call2.incident?.id, incidentId1);

      // Đảm bảo trong CSDL chỉ có duy nhất 1 incident cho violationId này
      const dbRecords = (await mockIncidentRepo.findAllIncidents()).data;
      const matching = dbRecords.filter(
        (inc: any) => inc.violationId === fixedViolationId,
      );
      assert.strictEqual(matching.length, 1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 6: SIMULATION & LIVE DEMO ENDPOINT
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 6: Simulation & Live Demo Endpoint", () => {
    it("Tự động tạo sự kiện vi phạm mô phỏng và lưu Incident vào CSDL", async () => {
      const simResult = await service.simulateViolation({
        violationType: PPE_VIOLATION_TYPES.RESTRICTED_AREA,
        severity: PPE_SEVERITY.CRITICAL,
        workerName: "Trần Văn Thử Nghiệm",
        sync: true,
      });

      assert.strictEqual(simResult.status, AI_VISION_INGESTION_STATUS.PROCESSED);
      assert.ok(simResult.incident);
      assert.strictEqual(
        simResult.incident.violationType,
        "RESTRICTED_AREA",
      );
      assert.strictEqual(simResult.incident.severity, "CRITICAL");
      assert.ok(isUuid(simResult.incident.id));
    });

    it("Validation schema cho simulate có giá trị mặc định hợp lệ", () => {
      const parsed = aiVisionSimulateSchema.safeParse({});
      assert.strictEqual(parsed.success, true);
      if (parsed.success) {
        assert.strictEqual(
          parsed.data.violationType,
          PPE_VIOLATION_TYPES.NO_HELMET,
        );
        assert.strictEqual(parsed.data.severity, PPE_SEVERITY.HIGH);
        assert.strictEqual(parsed.data.sync, true);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 7: CONTRACT SPECIFICATION ENDPOINT
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 7: Contract Specification Endpoint", () => {
    it("Xuất bản đặc tả hợp đồng ALL-03 / VI-11 với schema và các mẫu payload cho SV2", () => {
      const contract = service.getContractSpecification();

      assert.ok(contract.contractVersion);
      assert.strictEqual(
        contract.topic,
        BROKER_TOPICS.PPE_VIOLATION_DETECTED,
      );
      assert.ok(contract.envelopeSchema);
      assert.ok(contract.payloadSchema);
      assert.ok(contract.samples.noHelmet);
      assert.ok(contract.samples.noVest);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 8: PIPELINE HEALTH PROBE
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 8: Pipeline Health Probe", () => {
    it("Trả về trạng thái UP khi các kho dữ liệu kết nối bình thường", async () => {
      const health = await service.getPipelineHealth();

      assert.strictEqual(health.status, "UP");
      assert.strictEqual(health.pipeline.broker, "CONNECTED");
      assert.strictEqual(health.pipeline.cameraDatabase, "CONNECTED");
      assert.strictEqual(health.pipeline.siteDatabase, "CONNECTED");
      assert.strictEqual(health.pipeline.incidentDatabase, "CONNECTED");
      assert.ok(health.timestamp);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 9: HTTP CONTROLLER & STATUS CODE INTEGRATION
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 9: HTTP Controller & Status Code Integration", () => {
    it("Controller.ingestEvent trả về HTTP 202 khi chạy Async Mode", async () => {
      const { AiVisionIntegrationController } = await import(
        "../src/modules/integration/ai-vision.controller"
      );
      const controller = new AiVisionIntegrationController(service);

      const req: any = {
        body: {
          cameraCode: "CAM-GATE-01",
          evidence: {
            snapshotUrl: "https://minio.ppe.local/test_controller.jpg",
            frameResolution: { width: 1920, height: 1080 },
          },
          violations: [
            {
              violationType: "NO_HELMET",
              severity: "HIGH",
              description: "Controller test",
              confidence: 0.95,
            },
          ],
        },
        query: {},
      };

      let resStatus = 0;
      let resJson: any = null;
      const res: any = {
        status: (s: number) => {
          resStatus = s;
          return res;
        },
        json: (d: any) => {
          resJson = d;
          return res;
        },
      };

      await controller.ingestEvent(req, res, () => {});
      assert.strictEqual(resStatus, 202);
      assert.strictEqual(resJson.success, true);
      assert.strictEqual(resJson.data.status, AI_VISION_INGESTION_STATUS.QUEUED);
    });

    it("Controller.ingestEvent trả về HTTP 201 khi chạy Sync Mode (?sync=true)", async () => {
      const { AiVisionIntegrationController } = await import(
        "../src/modules/integration/ai-vision.controller"
      );
      const controller = new AiVisionIntegrationController(service);

      const req: any = {
        body: {
          violationId: generateId(),
          cameraCode: "CAM-GATE-01",
          evidence: {
            snapshotUrl: "https://minio.ppe.local/sync_controller.jpg",
            frameResolution: { width: 1920, height: 1080 },
          },
          violations: [
            {
              violationType: "NO_VEST",
              severity: "HIGH",
              description: "Controller sync test",
              confidence: 0.93,
            },
          ],
        },
        query: { sync: "true" },
      };

      let resStatus = 0;
      let resJson: any = null;
      const res: any = {
        status: (s: number) => {
          resStatus = s;
          return res;
        },
        json: (d: any) => {
          resJson = d;
          return res;
        },
      };

      await controller.ingestEvent(req, res, () => {});
      assert.strictEqual(resStatus, 201);
      assert.strictEqual(resJson.success, true);
      assert.strictEqual(resJson.data.status, AI_VISION_INGESTION_STATUS.PROCESSED);
      assert.ok(resJson.data.incident);
    });

    it("Controller.getContract trả về HTTP 200 với đặc tả hợp đồng", async () => {
      const { AiVisionIntegrationController } = await import(
        "../src/modules/integration/ai-vision.controller"
      );
      const controller = new AiVisionIntegrationController(service);

      let resStatus = 0;
      let resJson: any = null;
      const res: any = {
        status: (s: number) => {
          resStatus = s;
          return res;
        },
        json: (d: any) => {
          resJson = d;
          return res;
        },
      };

      await controller.getContract({} as any, res, () => {});
      assert.strictEqual(resStatus, 200);
      assert.strictEqual(resJson.success, true);
      assert.ok(resJson.data.contractVersion);
    });

    it("Controller chuyển lỗi cho error middleware qua next(err) khi gặp ngoại lệ", async () => {
      const { AiVisionIntegrationController } = await import(
        "../src/modules/integration/ai-vision.controller"
      );
      const throwingService: any = {
        ingestEvent: async () => {
          throw new AppError("Lỗi CSDL mô phỏng", 500, "DB_ERROR");
        },
      };
      const controller = new AiVisionIntegrationController(throwingService);

      let capturedError: any = null;
      const next = (err: any) => {
        capturedError = err;
      };

      await controller.ingestEvent({ body: {}, query: {} } as any, {} as any, next);
      assert.ok(capturedError);
      assert.strictEqual(capturedError.message, "Lỗi CSDL mô phỏng");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 10: TRACE CONTEXT & CORRELATION PROPAGATION (BE-14 INTEGRATION)
  // ───────────────────────────────────────────────────────────────────────────
  describe("Suite 10: Trace Context & Correlation Propagation", () => {
    it("Bảo lưu Trace Context (AsyncLocalStorage) xuyên suốt quá trình Ingestion", async () => {
      const { runWithTraceContext } = await import(
        "../src/common/context/trace-context"
      );
      const customTraceId = "018e65f3-7a2c-7b12-9c4e-trace88888888";

      await runWithTraceContext(
        { traceId: customTraceId, correlationId: customTraceId },
        async () => {
          const res = await service.ingestEvent({
            cameraCode: "CAM-GATE-01",
            evidence: {
              snapshotUrl: "https://minio.ppe.local/trace_test.jpg",
              frameResolution: { width: 1920, height: 1080 },
            },
            violations: [
              {
                violationType: "NO_HELMET",
                severity: "HIGH",
                description: "Tracing test",
                confidence: 0.95,
              },
            ],
          });

          assert.strictEqual(res.traceId, customTraceId);
        },
      );
    });
  });
});

