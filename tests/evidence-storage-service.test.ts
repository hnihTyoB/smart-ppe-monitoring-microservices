import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  evidenceStorageService,
  EvidenceStorageService,
} from "../src/common/services/evidence-storage.service";
import {
  requestEvidenceUploadUrlSchema,
  directUploadEvidenceSchema,
  downloadUrlQuerySchema,
} from "../src/modules/incident/evidence-storage.validation";
import {
  EVIDENCE_TYPE,
  INCIDENT_STATUS,
  EVIDENCE_ACCESS_ACTION,
} from "../src/common/constants/incident.constant";
import { IncidentService } from "../src/modules/incident/incident.service";
import { IncidentRepository } from "../src/modules/incident/incident.repository";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";

describe("Task BE-07: Media/Evidence Storage Service Suite", () => {
  const fakeSiteId = "11111111-1111-4111-8111-111111111111";
  const fakeCameraId = "22222222-2222-4222-8222-222222222222";
  const fakeIncidentId = "33333333-3333-4333-8333-333333333333";
  const fakeEvidenceId = "44444444-4444-4444-8444-444444444444";
  const fakeActorId = "99999999-9999-4999-8999-999999999999";

  // ── 1. Storage Key Generation & Checksum Computation ────────────────────────
  describe("1. Evidence Storage Utility & Hash Functions", () => {
    it("should generate standard hierarchical S3 storage key partitioned by date and IDs", () => {
      const storageKey = evidenceStorageService.generateStorageKey({
        siteId: fakeSiteId,
        cameraId: fakeCameraId,
        incidentId: fakeIncidentId,
        evidenceType: EVIDENCE_TYPE.SNAPSHOT,
        originalFileName: "violation_capture.jpg",
      });

      const now = new Date();
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");
      const day = String(now.getUTCDate()).padStart(2, "0");

      const expectedPrefix = `evidences/${fakeSiteId}/${fakeCameraId}/${year}/${month}/${day}/${fakeIncidentId}/SNAPSHOT_`;
      assert.ok(
        storageKey.startsWith(expectedPrefix),
        `Storage key "${storageKey}" should start with "${expectedPrefix}"`,
      );
      assert.ok(storageKey.endsWith(".jpg"), "Storage key should retain original extension");
    });

    it("should sanitize and normalize file extensions in storage key", () => {
      const storageKey = evidenceStorageService.generateStorageKey({
        siteId: fakeSiteId,
        cameraId: fakeCameraId,
        incidentId: fakeIncidentId,
        evidenceType: EVIDENCE_TYPE.VIDEO_CLIP,
        originalFileName: "clip.weird.mp4",
      });
      assert.ok(storageKey.endsWith(".mp4"));
    });

    it("should calculate exact SHA-256 checksum for given buffer", () => {
      const testBuffer = Buffer.from("SMART_PPE_EVIDENCE_SAMPLE_DATA_2026", "utf-8");
      const expectedSha256 = crypto
        .createHash("sha256")
        .update(testBuffer)
        .digest("hex");

      const calculated = evidenceStorageService.calculateSha256(testBuffer);
      assert.equal(calculated, expectedSha256);
      assert.equal(calculated.length, 64);
    });
  });

  // ── 2. Zod Validation Schemas ──────────────────────────────────────────────
  describe("2. Storage Request Validation Schemas", () => {
    it("should accept valid payload for Presigned Upload URL request", () => {
      const validPayload = {
        siteId: fakeSiteId,
        cameraId: fakeCameraId,
        incidentId: fakeIncidentId,
        evidenceType: EVIDENCE_TYPE.SNAPSHOT,
        fileName: "camera_entrance_snap.jpg",
        mimeType: "image/jpeg",
        fileSize: 2048500,
        expiresInSeconds: 900,
      };

      const result = requestEvidenceUploadUrlSchema.safeParse(validPayload);
      assert.equal(result.success, true);
    });

    it("should reject malicious fileName with path traversal", () => {
      const invalidPayload = {
        siteId: fakeSiteId,
        cameraId: fakeCameraId,
        incidentId: fakeIncidentId,
        evidenceType: EVIDENCE_TYPE.SNAPSHOT,
        fileName: "../../../etc/shadow",
        mimeType: "image/jpeg",
        fileSize: 1024,
      };

      const result = requestEvidenceUploadUrlSchema.safeParse(invalidPayload);
      assert.equal(result.success, false);
    });

    it("should reject unsupported MIME types (e.g. application/exe, text/html)", () => {
      const invalidPayload = {
        siteId: fakeSiteId,
        cameraId: fakeCameraId,
        incidentId: fakeIncidentId,
        evidenceType: EVIDENCE_TYPE.SNAPSHOT,
        fileName: "malware.exe",
        mimeType: "application/x-msdownload",
        fileSize: 1024,
      };

      const result = requestEvidenceUploadUrlSchema.safeParse(invalidPayload);
      assert.equal(result.success, false);
    });

    it("should reject negative or zero file size", () => {
      const invalidPayload = {
        siteId: fakeSiteId,
        cameraId: fakeCameraId,
        incidentId: fakeIncidentId,
        evidenceType: EVIDENCE_TYPE.SNAPSHOT,
        fileName: "snap.png",
        mimeType: "image/png",
        fileSize: 0,
      };

      const result = requestEvidenceUploadUrlSchema.safeParse(invalidPayload);
      assert.equal(result.success, false);
    });

    it("should validate and apply default query params for download URL", () => {
      const parsedDefault = downloadUrlQuerySchema.parse({});
      assert.equal(parsedDefault.expiresInSeconds, 900);
      assert.equal(parsedDefault.action, EVIDENCE_ACCESS_ACTION.VIEW);

      const parsedExplicit = downloadUrlQuerySchema.parse({
        expiresInSeconds: "1800",
        action: EVIDENCE_ACCESS_ACTION.DOWNLOAD,
      });
      assert.equal(parsedExplicit.expiresInSeconds, 1800);
      assert.equal(parsedExplicit.action, EVIDENCE_ACCESS_ACTION.DOWNLOAD);
    });

    it("should validate direct multipart upload schema", () => {
      const validDirect = {
        siteId: fakeSiteId,
        cameraId: fakeCameraId,
        incidentId: fakeIncidentId,
        evidenceType: EVIDENCE_TYPE.SNAPSHOT,
      };
      const result = directUploadEvidenceSchema.safeParse(validDirect);
      assert.equal(result.success, true);
    });
  });

  // ── 3. Presigned Upload URL Business Flow ──────────────────────────────────
  describe("3. Presigned Upload URL Flow & Status Protection", () => {
    it("should generate presigned upload URL when incident is active", async () => {
      const mockRepo = {
        findIncidentById: async (id: string) => ({
          id,
          siteId: fakeSiteId,
          cameraId: fakeCameraId,
          status: INCIDENT_STATUS.CONFIRMED,
        }),
      } as unknown as IncidentRepository;

      const mockStorage = {
        generateStorageKey: () => "evidences/test/key.jpg",
        getPresignedUploadUrl: async (key: string, _mime: string, _expires: number) =>
          `https://minio.local/ppe-evidences/${key}?signed=true`,
      } as unknown as EvidenceStorageService;

      const service = new IncidentService(mockRepo, mockStorage);
      const res = await service.requestEvidenceUploadUrl(
        {
          siteId: fakeSiteId,
          cameraId: fakeCameraId,
          incidentId: fakeIncidentId,
          evidenceType: EVIDENCE_TYPE.SNAPSHOT,
          fileName: "test.jpg",
          mimeType: "image/jpeg",
          fileSize: 50000,
          expiresInSeconds: 900,
        },
        fakeActorId,
      );

      assert.ok(res.uploadUrl.includes("https://minio.local"));
      assert.equal(res.storageKey, "evidences/test/key.jpg");
      assert.equal(res.expiresInSeconds, 900);
    });

    it("should reject presigned upload URL request if incident is CLOSED", async () => {
      const mockRepo = {
        findIncidentById: async (id: string) => ({
          id,
          siteId: fakeSiteId,
          cameraId: fakeCameraId,
          status: INCIDENT_STATUS.CLOSED,
        }),
      } as unknown as IncidentRepository;

      const service = new IncidentService(mockRepo);

      await assert.rejects(
        async () => {
          await service.requestEvidenceUploadUrl(
            {
              siteId: fakeSiteId,
              cameraId: fakeCameraId,
              incidentId: fakeIncidentId,
              evidenceType: EVIDENCE_TYPE.SNAPSHOT,
              fileName: "test.jpg",
              mimeType: "image/jpeg",
              fileSize: 50000,
            },
            fakeActorId,
          );
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, ERROR_CODE.BAD_REQUEST);
          assert.equal(err.statusCode, 400);
          assert.ok(err.message.includes("đã đóng"));
          return true;
        },
      );
    });

    it("should reject presigned upload URL request if incident does not exist", async () => {
      const mockRepo = {
        findIncidentById: async () => null,
      } as unknown as IncidentRepository;

      const service = new IncidentService(mockRepo);

      await assert.rejects(
        async () => {
          await service.requestEvidenceUploadUrl(
            {
              siteId: fakeSiteId,
              cameraId: fakeCameraId,
              incidentId: fakeIncidentId,
              evidenceType: EVIDENCE_TYPE.SNAPSHOT,
              fileName: "test.jpg",
              mimeType: "image/jpeg",
              fileSize: 50000,
            },
            fakeActorId,
          );
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, ERROR_CODE.INCIDENT_NOT_FOUND);
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });
  });

  // ── 4. Direct Upload & Metadata Extraction Flow ─────────────────────────────
  describe("4. Direct Multipart Upload Flow with Image Processing", () => {
    it("should reject direct upload if no file buffer is provided", async () => {
      const mockRepo = {
        findIncidentById: async (id: string) => ({ id, status: INCIDENT_STATUS.CONFIRMED }),
      } as unknown as IncidentRepository;

      const service = new IncidentService(mockRepo);

      await assert.rejects(
        async () => {
          await service.uploadEvidenceDirect(
            {
              siteId: fakeSiteId,
              cameraId: fakeCameraId,
              incidentId: fakeIncidentId,
              evidenceType: EVIDENCE_TYPE.SNAPSHOT,
            },
            undefined as any,
            fakeActorId,
          );
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, ERROR_CODE.VALIDATION_ERROR);
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
    });

    it("should process image buffer, calculate checksum, upload to storage, and save evidence with metadata", async () => {
      let createdEvidencePayload: any = null;
      let uploadedBufferKey: string = "";

      const sampleFileBuffer = Buffer.from("RAW_JPEG_IMAGE_CONTENT_SAMPLE_FOR_TESTING");
      const sampleChecksum = crypto.createHash("sha256").update(sampleFileBuffer).digest("hex");

      const mockRepo = {
        findIncidentById: async (id: string) => ({
          id,
          siteId: fakeSiteId,
          cameraId: fakeCameraId,
          status: INCIDENT_STATUS.PENDING_REVIEW,
        }),
        createEvidence: async (payload: any) => {
          createdEvidencePayload = payload;
          return {
            id: fakeEvidenceId,
            ...payload,
            fileSize: payload.fileSize,
            createdAt: new Date(),
          };
        },
      } as unknown as IncidentRepository;

      const mockStorage = {
        generateStorageKey: () => "evidences/site1/cam1/2026/10/10/inc1/SNAPSHOT_123.jpg",
        calculateSha256: (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex"),
        uploadBuffer: async (key: string, buf: Buffer) => {
          uploadedBufferKey = key;
          return {
            storageKey: key,
            fileSize: buf.length,
            checksum: sampleChecksum,
          };
        },
      } as unknown as EvidenceStorageService;

      const service = new IncidentService(mockRepo, mockStorage);

      const fakeUploadedFile = {
        buffer: sampleFileBuffer,
        originalname: "worker_no_helmet.jpg",
        mimetype: "image/jpeg",
        size: sampleFileBuffer.length,
      };

      const result = await service.uploadEvidenceDirect(
        {
          siteId: fakeSiteId,
          cameraId: fakeCameraId,
          incidentId: fakeIncidentId,
          evidenceType: EVIDENCE_TYPE.SNAPSHOT,
        },
        fakeUploadedFile,
        fakeActorId,
      );

      assert.equal(result.id, fakeEvidenceId);
      assert.equal(result.fileSize, sampleFileBuffer.length);
      assert.equal(uploadedBufferKey, "evidences/site1/cam1/2026/10/10/inc1/SNAPSHOT_123.jpg");
      assert.ok(createdEvidencePayload);
      assert.equal(createdEvidencePayload.evidenceType, EVIDENCE_TYPE.SNAPSHOT);
      assert.equal(createdEvidencePayload.fileName, "worker_no_helmet.jpg");
      assert.equal(createdEvidencePayload.metadata.checksum, sampleChecksum);
    });
  });

  // ── 5. Presigned Download URL & Access Logging ─────────────────────────────
  describe("5. Presigned Download URL & Evidence Access Logging", () => {
    it("should issue presigned download URL and record audit access log", async () => {
      let loggedAccess: any = null;

      const mockRepo = {
        findEvidenceById: async (id: string) => ({
          id,
          incidentId: fakeIncidentId,
          storageKey: "evidences/test/key.jpg",
          fileName: "test.jpg",
          mimeType: "image/jpeg",
          fileSize: 2048,
        }),
        logEvidenceAccess: async (params: any) => {
          loggedAccess = params;
          return { id: "log-1", ...params, accessedAt: new Date() };
        },
      } as unknown as IncidentRepository;

      const mockStorage = {
        getPresignedDownloadUrl: async (key: string, _expires: number, _name: string) =>
          `http://minio.local/ppe-evidences/${key}?downloadToken=abc`,
      } as unknown as EvidenceStorageService;

      const service = new IncidentService(mockRepo, mockStorage);

      const res = await service.getEvidenceDownloadUrl(
        fakeEvidenceId,
        fakeActorId,
        1200,
      );

      assert.ok(res.downloadUrl.includes("downloadToken=abc"));
      assert.equal(res.expiresInSeconds, 1200);
      assert.equal(res.fileName, "test.jpg");
      assert.equal(res.mimeType, "image/jpeg");

      // Đợi microtask kết thúc ghi log
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.ok(loggedAccess);
      assert.equal(loggedAccess.evidenceId, fakeEvidenceId);
      assert.equal(loggedAccess.userId, fakeActorId);
      assert.equal(loggedAccess.action, EVIDENCE_ACCESS_ACTION.DOWNLOAD);
    });

    it("should throw 404 when requesting download URL for non-existent evidence", async () => {
      const mockRepo = {
        findEvidenceById: async () => null,
      } as unknown as IncidentRepository;

      const service = new IncidentService(mockRepo);

      await assert.rejects(
        async () => {
          await service.getEvidenceDownloadUrl(
            fakeEvidenceId,
            fakeActorId,
          );
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, ERROR_CODE.EVIDENCE_NOT_FOUND);
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });
  });

  // ── 6. Tamper Evidence Checksum Verification ────────────────────────────────
  describe("6. Tamper Evidence Verification (Legal Integrity Check)", () => {
    it("should return isValid = true when storage file hash matches metadata hash", async () => {
      const validBuffer = Buffer.from("SECURE_TAMPER_FREE_EVIDENCE_STREAM");
      const validChecksum = crypto.createHash("sha256").update(validBuffer).digest("hex");

      const mockRepo = {
        findEvidenceById: async (id: string) => ({
          id,
          storageKey: "evidences/secure/tamper_free.jpg",
          fileName: "tamper_free.jpg",
          metadata: {
            checksum: validChecksum,
            algorithm: "SHA-256",
          },
        }),
      } as unknown as IncidentRepository;

      const mockStorage = {
        verifyChecksum: async () => ({
          isValid: true,
          expectedChecksum: validChecksum,
          actualChecksum: validChecksum,
        }),
      } as unknown as EvidenceStorageService;

      const service = new IncidentService(mockRepo, mockStorage);
      const verification = await service.verifyEvidenceIntegrity(fakeEvidenceId);

      assert.equal(verification.isValid, true);
      assert.equal(verification.expectedChecksum, validChecksum);
      assert.equal(verification.actualChecksum, validChecksum);
      assert.equal(verification.evidenceId, fakeEvidenceId);
    });

    it("should return isValid = false when storage file hash does not match metadata hash", async () => {
      const originalChecksum = "a".repeat(64);
      const tamperedChecksum = "b".repeat(64);

      const mockRepo = {
        findEvidenceById: async (id: string) => ({
          id,
          storageKey: "evidences/secure/tampered.jpg",
          fileName: "tampered.jpg",
          metadata: {
            checksum: originalChecksum,
            algorithm: "SHA-256",
          },
        }),
      } as unknown as IncidentRepository;

      const mockStorage = {
        verifyChecksum: async () => ({
          isValid: false,
          expectedChecksum: originalChecksum,
          actualChecksum: tamperedChecksum,
        }),
      } as unknown as EvidenceStorageService;

      const service = new IncidentService(mockRepo, mockStorage);
      const verification = await service.verifyEvidenceIntegrity(fakeEvidenceId);

      assert.equal(verification.isValid, false);
      assert.equal(verification.expectedChecksum, originalChecksum);
      assert.equal(verification.actualChecksum, tamperedChecksum);
    });

    it("should throw AppError if evidence lacks metadata checksum", async () => {
      const mockRepo = {
        findEvidenceById: async (id: string) => ({
          id,
          storageKey: "evidences/legacy/no_meta.jpg",
          fileName: "no_meta.jpg",
          metadata: null,
        }),
      } as unknown as IncidentRepository;

      const service = new IncidentService(mockRepo);

      await assert.rejects(
        async () => {
          await service.verifyEvidenceIntegrity(fakeEvidenceId);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, ERROR_CODE.VALIDATION_ERROR);
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
    });
  });

  // ── 7. Evidence Cleanup on Deletion ────────────────────────────────────────
  describe("7. Physical Object Cleanup on Evidence Deletion", () => {
    it("should delete database record and invoke storage.deleteObject to clean MinIO file", async () => {
      let deletedKey = "";

      const mockRepo = {
        findEvidenceById: async (id: string) => ({
          id,
          storageKey: "evidences/to_delete/target.jpg",
          fileName: "target.jpg",
          fileSize: 1024,
        }),
        deleteEvidence: async (id: string) => ({
          id,
          storageKey: "evidences/to_delete/target.jpg",
          fileName: "target.jpg",
          fileSize: 1024,
        }),
      } as unknown as IncidentRepository;

      const mockStorage = {
        deleteObject: async (key: string) => {
          deletedKey = key;
        },
      } as unknown as EvidenceStorageService;

      const service = new IncidentService(mockRepo, mockStorage);
      const result = await service.deleteEvidence(fakeEvidenceId);

      assert.equal(result.id, fakeEvidenceId);
      assert.equal(deletedKey, "evidences/to_delete/target.jpg");
    });
  });

  // ── 8. Code Review Remediation & Edge Case Verification ─────────────────────
  describe("8. Code Review Remediation & Edge Case Verification", () => {
    it("should parse stringified aiDetections in directUploadEvidenceSchema (multipart handling)", () => {
      const payloadWithStringJson = {
        incidentId: fakeIncidentId,
        cameraId: fakeCameraId,
        evidenceType: EVIDENCE_TYPE.SNAPSHOT,
        aiDetections: JSON.stringify({
          violations: ["NO_HELMET"],
          confidence: 0.94,
        }),
      };

      const parsed = directUploadEvidenceSchema.safeParse(payloadWithStringJson);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.deepEqual(parsed.data.aiDetections, {
          violations: ["NO_HELMET"],
          confidence: 0.94,
        });
      }
    });

    it("should honor custom expiresInSeconds and prioritize incident.siteId in requestEvidenceUploadUrl", async () => {
      let generatedKeyParams: any = null;
      let requestedExpires = 0;

      const mockRepo = {
        findIncidentById: async (id: string) => ({
          id,
          siteId: fakeSiteId, // CSDL có siteId chuẩn
          status: INCIDENT_STATUS.PENDING_REVIEW,
        }),
      } as unknown as IncidentRepository;

      const mockStorage = {
        generateStorageKey: (params: any) => {
          generatedKeyParams = params;
          return "evidences/custom/key.jpg";
        },
        getPresignedUploadUrl: async (_key: string, _mime: string, expires: number) => {
          requestedExpires = expires;
          return "http://minio.local/upload";
        },
      } as unknown as EvidenceStorageService;

      const service = new IncidentService(mockRepo, mockStorage);
      const res = await service.requestEvidenceUploadUrl(
        {
          incidentId: fakeIncidentId,
          cameraId: fakeCameraId,
          siteId: "99999999-9999-9999-9999-999999999999", // Client truyền siteId khác
          evidenceType: EVIDENCE_TYPE.SNAPSHOT,
          fileName: "snap.jpg",
          mimeType: "image/jpeg",
          expiresInSeconds: 1800, // Custom 30 phút
        },
        fakeActorId,
      );

      assert.equal(res.expiresInSeconds, 1800);
      assert.equal(requestedExpires, 1800);
      assert.equal(generatedKeyParams.siteId, fakeSiteId); // Đã ưu tiên siteId từ CSDL
    });

    it("should log exact action VIEW and configure inline disposition when action is VIEW", async () => {
      let loggedAction = "";
      let usedAction = "";

      const mockRepo = {
        findEvidenceById: async (id: string) => ({
          id,
          incidentId: fakeIncidentId,
          storageKey: "evidences/test/view.jpg",
          fileName: "view.jpg",
          mimeType: "image/jpeg",
          fileSize: 1024,
        }),
        logEvidenceAccess: async (params: any) => {
          loggedAction = params.action;
          return { id: "log-view", ...params, accessedAt: new Date() };
        },
      } as unknown as IncidentRepository;

      const mockStorage = {
        getPresignedDownloadUrl: async (
          _key: string,
          _expires: number,
          _name: string,
          action: string,
        ) => {
          usedAction = action;
          return "http://minio.local/view-url";
        },
      } as unknown as EvidenceStorageService;

      const service = new IncidentService(mockRepo, mockStorage);
      const res = await service.getEvidenceDownloadUrl(
        fakeEvidenceId,
        fakeActorId,
        600,
        EVIDENCE_ACCESS_ACTION.VIEW,
      );

      assert.equal(res.expiresInSeconds, 600);
      assert.equal(usedAction, EVIDENCE_ACCESS_ACTION.VIEW);

      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(loggedAction, EVIDENCE_ACCESS_ACTION.VIEW);
    });
  });
});

