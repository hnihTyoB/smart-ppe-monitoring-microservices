import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { uuidv7 } from "uuidv7";
import { prisma } from "../src/database/prisma.client";
import { identityPrisma } from "../src/database/identity.client";
import { sitePrisma } from "../src/database/site.client";
import { cameraPrisma } from "../src/database/camera.client";
import { incidentPrisma } from "../src/database/incident.client";
import { notificationPrisma } from "../src/database/notification.client";
import { reportingPrisma } from "../src/database/reporting.client";

describe("PPE Microservices — Database-per-Service 6 CSDL Schemas & Isolation Test", () => {
  const testSuffix = Math.floor(Math.random() * 100000);
  let createdSiteId: string;
  let createdCameraId: string;
  let createdIncidentId: string;
  let createdTemplateId: string;
  let createdReportTemplateId: string;
  let createdAiModelId: string;

  before(async () => {
    // Đảm bảo kết nối tới cả 6 CSDL đều thông suốt
    await Promise.all([
      prisma.$queryRawUnsafe("SELECT 1"),
      sitePrisma.$queryRawUnsafe("SELECT 1"),
      cameraPrisma.$queryRawUnsafe("SELECT 1"),
      incidentPrisma.$queryRawUnsafe("SELECT 1"),
      notificationPrisma.$queryRawUnsafe("SELECT 1"),
      reportingPrisma.$queryRawUnsafe("SELECT 1"),
    ]);
  });

  after(async () => {
    // Dọn dẹp dữ liệu kiểm thử
    if (createdSiteId) {
      await sitePrisma.site.deleteMany({ where: { id: createdSiteId } }).catch(() => {});
    }
    if (createdCameraId) {
      await cameraPrisma.camera.deleteMany({ where: { id: createdCameraId } }).catch(() => {});
    }
    if (createdIncidentId) {
      await incidentPrisma.incident.deleteMany({ where: { id: createdIncidentId } }).catch(() => {});
    }
    if (createdTemplateId) {
      await notificationPrisma.notificationTemplate.deleteMany({ where: { id: createdTemplateId } }).catch(() => {});
    }
    if (createdReportTemplateId) {
      await reportingPrisma.reportTemplate.deleteMany({ where: { id: createdReportTemplateId } }).catch(() => {});
    }
    if (createdAiModelId) {
      await reportingPrisma.aiModel.deleteMany({ where: { id: createdAiModelId } }).catch(() => {});
    }

    // Đóng toàn bộ kết nối Prisma
    await Promise.all([
      prisma.$disconnect(),
      sitePrisma.$disconnect(),
      cameraPrisma.$disconnect(),
      incidentPrisma.$disconnect(),
      notificationPrisma.$disconnect(),
      reportingPrisma.$disconnect(),
    ]);
  });

  // ─── 1. SITE SERVICE TESTS ──────────────────────────────────────────────────
  describe("1. Site Service (ppe_site_db)", () => {
    it("1.1 Phải tạo thành công Site, Zone, SafetyConfig và RestrictedArea", async () => {
      const site = await sitePrisma.site.create({
        data: {
          code: `SITE_TEST_${testSuffix}`,
          name: "Công trường Vinhomes Smart City",
          address: "Tây Mỗ, Nam Từ Liêm, Hà Nội",
          description: "Khu đô thị thông minh giai đoạn 2",
          status: "ACTIVE",
          startDate: new Date("2026-01-01"),
          safetyConfigs: {
            create: {
              confidenceThreshold: 0.85,
              confirmationDuration: 3,
              cooldownDuration: 45,
              enableNoHelmet: true,
              enableNoVest: true,
              enableRestrictedArea: true,
            },
          },
          zones: {
            create: [
              {
                code: `ZONE_A_${testSuffix}`,
                name: "Phân khu Tháp A",
                description: "Khu vực ép cọc và tầng hầm",
                status: "ACTIVE",
              },
            ],
          },
        },
        include: {
          safetyConfigs: true,
          zones: true,
        },
      });

      createdSiteId = site.id;
      assert.ok(site.id, "Site ID phải tồn tại");
      assert.match(site.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "Site ID phải là UUIDv7");
      assert.equal(site.code, `SITE_TEST_${testSuffix}`);
      assert.equal(site.zones.length, 1);
      assert.equal(site.safetyConfigs.length, 1);
      assert.equal(Number(site.safetyConfigs[0].confidenceThreshold), 0.85);

      // Thêm RestrictedArea vào Zone
      const restrictedArea = await sitePrisma.restrictedArea.create({
        data: {
          siteId: site.id,
          zoneId: site.zones[0].id,
          name: "Vùng nguy hiểm cẩu tháp 1",
          boundary: [
            { x: 100, y: 150 },
            { x: 300, y: 150 },
            { x: 300, y: 400 },
            { x: 100, y: 400 },
          ],
          status: "ACTIVE",
        },
      });

      assert.ok(restrictedArea.id);
      assert.equal(restrictedArea.siteId, site.id);
    });
  });

  // ─── 2. CAMERA SERVICE TESTS ────────────────────────────────────────────────
  describe("2. Camera Service (ppe_camera_db)", () => {
    it("2.1 Phải tạo thành công Camera kèm Stream, Config và HealthLog", async () => {
      const camera = await cameraPrisma.camera.create({
        data: {
          siteId: createdSiteId,
          code: `CAM_TEST_${testSuffix}`,
          name: "Camera Cổng bảo vệ số 1",
          sourceType: "RTSP",
          streamUrl: "rtsp://admin:pass@192.168.1.100:554/ch0/main",
          status: "ONLINE",
          location: "Cổng chính số 1, đường trục chính",
          config: {
            create: {
              enabled: true,
              captureFps: 15,
              resolution: "1920x1080",
              processingEnabled: true,
            },
          },
          streams: {
            create: [
              {
                protocol: "RTSP",
                streamUrl: "rtsp://admin:pass@192.168.1.100:554/ch0/main",
                resolution: "1920x1080",
                fps: 25,
                status: "ACTIVE",
              },
            ],
          },
          healthLogs: {
            create: [
              {
                status: "HEALTHY",
                latencyMs: 42,
              },
            ],
          },
        },
        include: {
          config: true,
          streams: true,
          healthLogs: true,
        },
      });

      createdCameraId = camera.id;
      assert.ok(camera.id);
      assert.match(camera.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "Camera ID phải là UUIDv7");
      assert.equal(camera.config?.captureFps, 15);
      assert.equal(camera.streams.length, 1);
      assert.equal(camera.healthLogs[0].latencyMs, 42);
    });
  });

  // ─── 3. INCIDENT SERVICE TESTS ──────────────────────────────────────────────
  describe("3. Incident Service (ppe_incident_db)", () => {
    it("3.1 Phải tạo thành công Incident kèm Evidence, Metadata, Assignment và StatusHistory", async () => {
      const officerId = uuidv7();

      const incident = await incidentPrisma.incident.create({
        data: {
          siteId: createdSiteId,
          cameraId: createdCameraId,
          violationId: uuidv7(),
          violationType: "NO_HELMET",
          severity: "HIGH",
          status: "PENDING_REVIEW",
          detectedAt: new Date(),
          description: "Phát hiện 1 công nhân không đội mũ bảo hiểm tại khu vực giàn giáo",
          evidences: {
            create: [
              {
                cameraId: createdCameraId,
                evidenceType: "SNAPSHOT",
                storageKey: `evidences/2026-10-09/test_${testSuffix}.jpg`,
                fileName: `test_${testSuffix}.jpg`,
                mimeType: "image/jpeg",
                fileSize: BigInt(245800),
                capturedAt: new Date(),
                metadata: {
                  create: {
                    width: 1920,
                    height: 1080,
                    checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                    aiDetections: [
                      {
                        class: "PERSON_NO_HELMET",
                        confidence: 0.94,
                        box: [120, 300, 250, 600],
                      },
                    ],
                  },
                },
              },
            ],
          },
          assignments: {
            create: [
              {
                assignedTo: officerId,
                status: "ACTIVE",
              },
            ],
          },
          statusHistory: {
            create: [
              {
                oldStatus: "DETECTED",
                newStatus: "PENDING_REVIEW",
                changedBy: officerId,
                reason: "Tự động kích hoạt quy trình phân xử sự cố",
              },
            ],
          },
          comments: {
            create: [
              {
                userId: officerId,
                comment: "Đã gửi cảnh báo qua bộ đàm cho tổ đội thi công",
              },
            ],
          },
        },
        include: {
          evidences: {
            include: {
              metadata: true,
            },
          },
          assignments: true,
          statusHistory: true,
          comments: true,
        },
      });

      createdIncidentId = incident.id;
      assert.ok(incident.id);
      assert.match(incident.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "Incident ID phải là UUIDv7");
      assert.equal(incident.violationType, "NO_HELMET");
      assert.equal(incident.evidences.length, 1);
      assert.equal(incident.evidences[0].metadata?.width, 1920);
      assert.equal(incident.assignments.length, 1);
      assert.equal(incident.statusHistory[0].newStatus, "PENDING_REVIEW");
      assert.equal(incident.comments.length, 1);
    });
  });

  // ─── 4. NOTIFICATION SERVICE TESTS ──────────────────────────────────────────
  describe("4. Notification Service (ppe_notification_db)", () => {
    it("4.1 Phải tạo thành công NotificationTemplate, Notification, Log và Preference", async () => {
      const template = await notificationPrisma.notificationTemplate.create({
        data: {
          code: `NOTIF_TPL_${testSuffix}`,
          name: "Thông báo vi phạm an toàn PPE",
          channel: "PUSH",
          subjectTemplate: "Cảnh báo vi phạm tại {{siteName}}",
          contentTemplate: "Phát hiện {{violationType}} tại {{location}}",
          status: "ACTIVE",
        },
      });
      createdTemplateId = template.id;

      const dummyUserId = uuidv7();

      const notif = await notificationPrisma.notification.create({
        data: {
          userId: dummyUserId,
          incidentId: createdIncidentId,
          templateId: template.id,
          channel: "PUSH",
          title: "Cảnh báo an toàn khẩn cấp",
          content: "Công nhân không đội mũ bảo hiểm tại Khu vực Tháp A",
          severity: "HIGH",
          status: "SENT",
          sentAt: new Date(),
          logs: {
            create: [
              {
                status: "DELIVERED",
                attempt: 1,
                sentAt: new Date(),
              },
            ],
          },
        },
        include: {
          logs: true,
        },
      });

      assert.ok(notif.id);
      assert.match(notif.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "Notification ID phải là UUIDv7");
      assert.equal(notif.logs.length, 1);
      assert.equal(notif.logs[0].status, "DELIVERED");

      const pref = await notificationPrisma.notificationPreference.create({
        data: {
          userId: dummyUserId,
          channel: "EMAIL",
          enabled: true,
          severityThreshold: "HIGH",
        },
      });
      assert.ok(pref.id);
      assert.equal(pref.userId, dummyUserId);
    });
  });

  // ─── 5. REPORTING SERVICE TESTS ─────────────────────────────────────────────
  describe("5. Reporting Service (ppe_reporting_db)", () => {
    it("5.1 Phải tạo thành công ReportTemplate, Statistics và AiModel/Version", async () => {
      const reportTpl = await reportingPrisma.reportTemplate.create({
        data: {
          code: `REP_TPL_${testSuffix}`,
          name: "Báo cáo vi phạm an toàn lao động tuần",
          description: "Mẫu báo cáo tổng hợp vi phạm an toàn định kỳ tuần",
          fileType: "PDF",
          version: "1.0.0",
          status: "ACTIVE",
        },
      });
      createdReportTemplateId = reportTpl.id;

      const generation = await reportingPrisma.reportGeneration.create({
        data: {
          templateId: reportTpl.id,
          siteId: createdSiteId,
          reportType: "WEEKLY_SAFETY_SUMMARY",
          periodStart: new Date("2026-10-01"),
          periodEnd: new Date("2026-10-07"),
          generatedBy: uuidv7(),
          status: "COMPLETED",
          fileName: `safety_report_${testSuffix}.pdf`,
          filePath: `reports/2026-10/safety_report_${testSuffix}.pdf`,
        },
      });
      assert.ok(generation.id);
      assert.equal(generation.status, "COMPLETED");

      const stat = await reportingPrisma.incidentStatistic.create({
        data: {
          siteId: createdSiteId,
          statDate: new Date("2026-10-08"),
          totalIncidents: 12,
          openIncidents: 2,
          resolvedIncidents: 10,
          falseAlarms: 1,
          trueViolations: 11,
        },
      });
      assert.ok(stat.id);
      assert.equal(stat.totalIncidents, 12);

      const aiModel = await reportingPrisma.aiModel.create({
        data: {
          code: `YOLO_PPE_V11_${testSuffix}`,
          name: "PPE Detection YOLOv11 Model",
          modelType: "YOLOv11",
          status: "ACTIVE",
          versions: {
            create: [
              {
                version: "v1.2.0",
                framework: "PyTorch",
                inputSize: "640x640",
                status: "DEPLOYED",
                metrics: {
                  mAP50: 0.945,
                  mAP50_95: 0.782,
                  precision: 0.96,
                  recall: 0.93,
                },
                deployedAt: new Date(),
              },
            ],
          },
        },
        include: {
          versions: true,
        },
      });
      createdAiModelId = aiModel.id;
      assert.ok(aiModel.id);
      assert.equal(aiModel.versions.length, 1);
      assert.equal(aiModel.versions[0].version, "v1.2.0");
    });
  });

  // ─── 6. ARCHITECTURAL ISOLATION TESTS ───────────────────────────────────────
  describe("6. Architectural Isolation (Database-per-Service Boundaries)", () => {
    it("6.1 Site Prisma client không chứa model của Identity hoặc Camera", () => {
      // TypeScript & runtime boundary check
      assert.equal((sitePrisma as any).user, undefined, "sitePrisma tuyệt đối không có model 'user'");
      assert.equal((sitePrisma as any).camera, undefined, "sitePrisma tuyệt đối không có model 'camera'");
      assert.equal((sitePrisma as any).incident, undefined, "sitePrisma tuyệt đối không có model 'incident'");
    });

    it("6.2 Camera Prisma client không chứa model của Site hoặc Reporting", () => {
      assert.equal((cameraPrisma as any).site, undefined, "cameraPrisma tuyệt đối không có model 'site'");
      assert.equal((cameraPrisma as any).reportTemplate, undefined, "cameraPrisma tuyệt đối không có model 'reportTemplate'");
    });

    it("6.3 Incident Prisma client không chứa model của Notification", () => {
      assert.equal((incidentPrisma as any).notification, undefined, "incidentPrisma tuyệt đối không có model 'notification'");
      assert.equal((incidentPrisma as any).notificationTemplate, undefined, "incidentPrisma tuyệt đối không có model 'notificationTemplate'");
    });

    it("6.4 Identity Prisma client tương thích hoàn toàn và cô lập với các services khác", () => {
      assert.ok(identityPrisma, "identityPrisma client phải khởi tạo thành công");
      assert.equal((identityPrisma as any).camera, undefined, "identityPrisma không chứa model 'camera'");
      assert.equal((identityPrisma as any).evidence, undefined, "identityPrisma không chứa model 'evidence'");
      assert.equal((identityPrisma as any).zone, undefined, "identityPrisma không chứa model 'zone'");
    });
  });
});
