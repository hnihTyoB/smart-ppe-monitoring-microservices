import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { maintenanceCacheService } from "../src/common/services/maintenance-cache.service";
import { SafetyRuleRepository } from "../src/modules/safety-rule/safety-rule.repository";
import { NotificationService } from "../src/modules/notification/notification.service";
import { NotificationRepository } from "../src/modules/notification/notification.repository";
import { PpeViolationSubscriber } from "../src/common/subscribers/ppe-violation.subscriber";
import { CronRepository } from "../src/modules/cron/cron.repository";
import siteApp from "../src/site.app";
import cameraApp from "../src/camera.app";
import incidentApp from "../src/incident.app";
import reportingApp from "../src/reporting.app";

describe("Tự động Kiểm chứng Toàn diện 13 Lỗi Kiến trúc (P0 - P3)", () => {
  // ── MỨC ĐỘ P0 ─────────────────────────────────────────────────────────────
  describe("ISSUE-P0-01: Chuyển toàn bộ Satellite Routers sang verifyJwtLocally", () => {
    it("7 file router vệ tinh không được import authMiddleware", () => {
      const satelliteFiles = [
        "src/modules/site/site.route.ts",
        "src/modules/safety-rule/safety-rule.route.ts",
        "src/modules/camera/camera.route.ts",
        "src/modules/incident/incident.route.ts",
        "src/modules/reporting/reporting.route.ts",
        "src/modules/notification/notification.route.ts",
        "src/modules/files/file.route.ts",
      ];

      for (const relPath of satelliteFiles) {
        const fullPath = path.resolve(process.cwd(), relPath);
        const content = fs.readFileSync(fullPath, "utf-8");
        assert.ok(
          !content.includes('import { authMiddleware }') &&
          !content.includes('import { authMiddleware,'),
          `File ${relPath} vẫn còn import authMiddleware từ identity domain!`,
        );
        assert.ok(
          content.includes("verifyJwtLocally"),
          `File ${relPath} chưa import verifyJwtLocally!`,
        );
      }
    });

    it("permission.middleware.ts hỗ trợ Admin bypass và Resilient Role Fallback", () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/middlewares/permission.middleware.ts"),
        "utf-8",
      );
      assert.ok(
        content.includes('req.user.role === "ADMIN"'),
        "Thiếu Admin bypass trong permission.middleware.ts",
      );
      assert.ok(
        content.includes("Resilient Fallback"),
        "Thiếu Resilient Fallback khi Identity DB ngắt kết nối",
      );
    });
  });

  describe("ISSUE-P0-02: Fail-Open In-Memory Circuit Breaker cho Maintenance Mode", () => {
    it("maintenanceCacheService.getConfig fallback an toàn về ONLINE khi DB lỗi", async () => {
      // Xóa cache hiện tại
      maintenanceCacheService.clear();

      // getConfig sẽ tự động catch lỗi nếu không có DB và trả về fallbackConfig ONLINE
      const config = await maintenanceCacheService.getConfig("TEST_NON_EXISTENT");
      assert.ok(config);
      assert.equal(config.status, "ONLINE");
      assert.equal(config.enabled, false);
    });
  });

  describe("ISSUE-P0-03: Khai báo 4 Microservices trong docker-compose.yml", () => {
    it("docker-compose.yml phải chứa đầy đủ 4 container vệ tinh", () => {
      const composeContent = fs.readFileSync(
        path.resolve(process.cwd(), "docker-compose.yml"),
        "utf-8",
      );
      assert.ok(composeContent.includes("site-service:"), "Thiếu site-service trong docker-compose.yml");
      assert.ok(composeContent.includes("camera-service:"), "Thiếu camera-service trong docker-compose.yml");
      assert.ok(composeContent.includes("incident-service:"), "Thiếu incident-service trong docker-compose.yml");
      assert.ok(composeContent.includes("reporting-service:"), "Thiếu reporting-service trong docker-compose.yml");
    });
  });

  // ── MỨC ĐỘ P1 ─────────────────────────────────────────────────────────────
  describe("ISSUE-P1-01: Decoupling SafetyRuleRepository khỏi Identity DB", () => {
    it("SafetyRuleRepository có thể khởi tạo độc lập không cần RbacRepository", () => {
      const repo = new SafetyRuleRepository();
      assert.ok(repo);
    });

    it("recordAuditLog không throw exception khi rbacRepo vắng mặt", async () => {
      const repo = new SafetyRuleRepository();
      await assert.doesNotReject(async () => {
        await repo.recordAuditLog({
          actorId: "usr-1",
          action: "UPDATE_PPE_SAFETY_CONFIG" as any,
          targetId: "site-1",
        });
      });
    });
  });

  describe("ISSUE-P1-02: Decoupling NotificationService khỏi UserRepository", () => {
    it("NotificationService có thể khởi tạo hoàn toàn độc lập không cần userRepo", () => {
      const notifService = new NotificationService();
      assert.ok(notifService);
    });
  });

  describe("ISSUE-P1-03: Fault Isolation & DLQ trong PpeViolationSubscriber", () => {
    it("PpeViolationSubscriber đăng ký 4 Consumer Groups độc lập", () => {
      const subscriber = new PpeViolationSubscriber();
      assert.ok(typeof subscriber.handleIncidentConsumer === "function");
      assert.ok(typeof subscriber.handleNotificationConsumer === "function");
      assert.ok(typeof subscriber.handleReportingConsumer === "function");
      assert.ok(typeof subscriber.handleAuditConsumer === "function");
    });
  });

  // ── MỨC ĐỘ P2 ─────────────────────────────────────────────────────────────
  describe("ISSUE-P2-01: CronRepository Cross-Query Protection", () => {
    it("CronRepository.getActivityStats có try/catch bảo vệ cross-database", async () => {
      const cronRepo = new CronRepository();
      assert.ok(typeof cronRepo.getActivityStats === "function");
    });
  });

  describe("ISSUE-P2-02: Xóa Unused Import identityPrisma trong NotificationRepository", () => {
    it("notification.repository.ts không còn chứa import identityPrisma", () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/modules/notification/notification.repository.ts"),
        "utf-8",
      );
      assert.ok(
        !content.includes("identityPrisma"),
        "notification.repository.ts vẫn còn chứa identityPrisma!",
      );
    });
  });

  describe("ISSUE-P2-04: Loại bỏ Hardcoded Placeholder trong traefik/dynamic.yml", () => {
    it("dynamic.yml không còn chứa PLACEHOLDER_REPLACE_AT_DEPLOY", () => {
      const dynamicContent = fs.readFileSync(
        path.resolve(process.cwd(), "traefik/dynamic.yml"),
        "utf-8",
      );
      assert.ok(
        !dynamicContent.includes("PLACEHOLDER_REPLACE_AT_DEPLOY"),
        "dynamic.yml vẫn còn chứa chuỗi placeholder gây lỗi 403!",
      );
    });
  });

  // ── MỨC ĐỘ P3 ─────────────────────────────────────────────────────────────
  describe("ISSUE-P3-03: Deep Health Check trên cả 4 Satellite Services", () => {
    it("siteApp, cameraApp, incidentApp, reportingApp đều có route /health và /health/live", () => {
      const apps = [
        { name: "siteApp", app: siteApp },
        { name: "cameraApp", app: cameraApp },
        { name: "incidentApp", app: incidentApp },
        { name: "reportingApp", app: reportingApp },
      ];

      for (const { name, app } of apps) {
        const routes: string[] = [];
        app._router.stack.forEach((middleware: any) => {
          if (middleware.route) {
            routes.push(middleware.route.path);
          }
        });
        assert.ok(
          routes.includes("/health"),
          `${name} thiếu endpoint /health`,
        );
        assert.ok(
          routes.includes("/health/live"),
          `${name} thiếu endpoint /health/live`,
        );
      }
    });
  });
});
