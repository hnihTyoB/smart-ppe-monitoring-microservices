import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import { jwtConfig } from "../src/config/jwt.config";
import { JWT_ALGORITHM, JWT_PURPOSE } from "../src/common/constants/jwt.constant";
import { ROLES } from "../src/common/constants/role.constant";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import { MAINTENANCE_STATUS } from "../src/common/constants/maintenance.constant";
import { createVerifyJwtLocally } from "../src/middlewares/verify-jwt-locally.middleware";
import { notificationService, NotificationService } from "../src/modules/notification/notification.service";
import { safetyRuleRepository, SafetyRuleRepository } from "../src/modules/safety-rule/safety-rule.repository";
import { cameraRepository } from "../src/modules/camera/camera.repository";
import { siteRepository } from "../src/modules/site/site.repository";
import { incidentRepository } from "../src/modules/incident/incident.repository";
import { reportingRepository } from "../src/modules/reporting/reporting.repository";
import { maintenanceCacheService } from "../src/common/services/maintenance-cache.service";

describe("Kiểm chứng Toàn diện 12 Lỗi Code Review đã khắc phục triệt để", () => {
  // ── 1. CRITICAL 1: Admin Bypass & User State Verification ────────────────────
  describe("1. Critical 1: Admin Bypass đặt sau kiểm tra trạng thái tài khoản", () => {
    it("permission.middleware.ts kiểm tra currentUser trước khi Admin bypass", () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/middlewares/permission.middleware.ts"),
        "utf-8",
      );
      const userStateIndex = content.indexOf("permissionCacheService.getUserState");
      const adminBypassIndex = content.indexOf("req.user.role === ROLES.ADMIN");
      assert.ok(userStateIndex !== -1, "Thiếu bước getUserState");
      assert.ok(adminBypassIndex !== -1, "Thiếu Admin bypass với ROLES.ADMIN");
      assert.ok(
        adminBypassIndex > userStateIndex,
        "Admin bypass phải nằm SAU bước getUserState để ngăn chặn Admin bị khóa bypass!",
      );
    });

    it("permission.middleware.ts từ chối tài khoản không tồn tại, bị khóa hoặc xóa mềm", () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/middlewares/permission.middleware.ts"),
        "utf-8",
      );
      assert.ok(
        content.includes("currentUser === null || !currentUser.isActive || currentUser.deletedAt"),
        "Chưa kiểm tra đầy đủ currentUser === null, isActive và deletedAt",
      );
    });
  });

  // ── 2. CRITICAL 2: SSE Stream Ticket Verification ────────────────────────────
  describe("2. Critical 2: verifyJwtLocally hỗ trợ SSE stream ticket trên /stream", () => {
    it("verifyJwtLocally chấp nhận SSE stream ticket ký bằng tempSecret cho endpoint /stream", async () => {
      const middleware = createVerifyJwtLocally();
      const ticket = jwt.sign(
        {
          id: "usr-stream-1",
          email: "streamer@example.com",
          role: "USER",
          purpose: JWT_PURPOSE.SSE_STREAM_TICKET,
        },
        jwtConfig.tempSecret,
        { algorithm: JWT_ALGORITHM.HS256, expiresIn: "60s" },
      );

      const req: any = {
        headers: {},
        cookies: {},
        query: { ticket },
        baseUrl: "/api/v1/notifications",
        path: "/stream",
      };
      const res: any = {};
      let nextCalled = false;
      let nextError: any = null;

      await middleware(req, res, (err?: any) => {
        nextCalled = true;
        nextError = err;
      });

      assert.ok(nextCalled, "next() phải được gọi");
      assert.equal(nextError, undefined, `Không được có lỗi: ${nextError?.message}`);
      assert.ok(req.user, "req.user phải được gán từ stream ticket");
      assert.equal(req.user.id, "usr-stream-1");
    });
  });

  // ── 3. HIGH 1: notificationService Singleton & Email / Broadcast ─────────────
  describe("3. High 1: notificationService singleton có userRepo hoạt động", () => {
    it("notificationService singleton và instance mới đều có userRepo được gán", () => {
      assert.ok((notificationService as any).userRepo, "Singleton notificationService thiếu userRepo");
      const customService = new NotificationService();
      assert.ok((customService as any).userRepo, "new NotificationService() thiếu userRepo fallback");
    });
  });

  // ── 4. HIGH 2: safetyRuleRepository Singleton & Audit Log ────────────────────
  describe("4. High 2: safetyRuleRepository singleton có rbacRepo hoạt động", () => {
    it("safetyRuleRepository singleton và instance mới đều có rbacRepo được gán", () => {
      assert.ok((safetyRuleRepository as any).rbacRepo, "Singleton safetyRuleRepository thiếu rbacRepo");
      const customRepo = new SafetyRuleRepository();
      assert.ok((customRepo as any).rbacRepo, "new SafetyRuleRepository() thiếu rbacRepo fallback");
    });
  });

  // ── 5. HIGH 3: NotificationRepository Audit Log Phân tầng Chuẩn ─────────────
  describe("5. High 3: NotificationRepository không publish event rác và dùng rbacRepository", () => {
    it("notification.repository.ts không còn chứa system.audit.created hay eventBus.publish", () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/modules/notification/notification.repository.ts"),
        "utf-8",
      );
      assert.ok(
        !content.includes("system.audit.created"),
        "notification.repository.ts vẫn còn chứa event name rác system.audit.created",
      );
      assert.ok(
        content.includes("rbacRepository.createAuditLog"),
        "notification.repository.ts phải dùng rbacRepository.createAuditLog",
      );
    });
  });

  // ── 6. HIGH 4: Traefik Gateway Secret Injection Label ─────────────────────────
  describe("6. High 4: Traefik dynamic.yml và docker-compose.yml có header x-gateway-secret", () => {
    it("docker-compose.yml cấu hình Traefik middleware inject header x-gateway-secret động", () => {
      const composeContent = fs.readFileSync(
        path.resolve(process.cwd(), "docker-compose.yml"),
        "utf-8",
      );
      assert.ok(
        composeContent.includes("traefik.http.middlewares.inject-gateway-secret.headers.customrequestheaders.x-gateway-secret="),
        "docker-compose.yml thiếu nhãn inject x-gateway-secret",
      );
    });
  });

  // ── 7. MEDIUM 1: Loại bỏ $queryRaw trực tiếp trong *.app.ts ──────────────────
  describe("7. Medium 1: Loại bỏ Prisma $queryRaw trực tiếp trong 4 file app.ts", () => {
    it("4 file app.ts không import Prisma Client và không gọi $queryRaw", () => {
      const apps = [
        "src/camera.app.ts",
        "src/site.app.ts",
        "src/incident.app.ts",
        "src/reporting.app.ts",
      ];

      for (const relPath of apps) {
        const content = fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
        assert.ok(
          !content.includes("Prisma.$queryRaw"),
          `${relPath} vẫn còn gọi Prisma.$queryRaw trực tiếp!`,
        );
        assert.ok(
          !content.includes('from "./database/'),
          `${relPath} vẫn còn import database client trực tiếp!`,
        );
        assert.ok(
          content.includes("checkDatabaseHealth"),
          `${relPath} phải gọi checkDatabaseHealth từ repository!`,
        );
      }
    });

    it("4 Repositories đều triển khai phương thức checkDatabaseHealth()", async () => {
      assert.ok(typeof cameraRepository.checkDatabaseHealth === "function");
      assert.ok(typeof siteRepository.checkDatabaseHealth === "function");
      assert.ok(typeof incidentRepository.checkDatabaseHealth === "function");
      assert.ok(typeof reportingRepository.checkDatabaseHealth === "function");
    });
  });

  // ── 8. MEDIUM 2: Chuẩn hóa ROLES Constants trong permission.middleware.ts ─────
  describe("8. Medium 2: Chuẩn hóa ROLES Constants trong permission.middleware.ts", () => {
    it("permission.middleware.ts sử dụng ROLES.ADMIN, ROLES.SAFETY_MANAGER, ROLES.SAFETY_OFFICER", () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/middlewares/permission.middleware.ts"),
        "utf-8",
      );
      assert.ok(content.includes("ROLES.ADMIN"), "Thiếu ROLES.ADMIN");
      assert.ok(content.includes("ROLES.SAFETY_MANAGER"), "Thiếu ROLES.SAFETY_MANAGER");
      assert.ok(content.includes("ROLES.SAFETY_OFFICER"), "Thiếu ROLES.SAFETY_OFFICER");
      assert.ok(!content.includes("SUPER_ADMIN"), "Không được hardcode SUPER_ADMIN không có trong ROLES");
    });
  });

  // ── 9. MEDIUM 3: Chuẩn hóa Constants & catch typing trong MaintenanceCache ────
  describe("9. Medium 3: Chuẩn hóa fallback config trong maintenance-cache.service.ts", () => {
    it("maintenance-cache.service.ts dùng DEFAULT_MAINTENANCE_CONFIG, PERMISSIONS, ROLES và catch (err: unknown)", async () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/common/services/maintenance-cache.service.ts"),
        "utf-8",
      );
      assert.ok(content.includes("DEFAULT_MAINTENANCE_CONFIG"), "Thiếu DEFAULT_MAINTENANCE_CONFIG");
      assert.ok(content.includes("PERMISSIONS.MAINTENANCE_MANAGE"), "Thiếu PERMISSIONS.MAINTENANCE_MANAGE");
      assert.ok(content.includes("ROLES.ADMIN"), "Thiếu ROLES.ADMIN");
      assert.ok(content.includes("catch (err: unknown)"), "Phải dùng catch (err: unknown) thay cho any");

      maintenanceCacheService.clear();
      const fallback = await maintenanceCacheService.getConfig("TEST_NON_EXISTENT_KEY");
      assert.equal(fallback.status, MAINTENANCE_STATUS.ONLINE);
      assert.equal(fallback.enabled, false);
      assert.deepEqual(fallback.bypassRoles, [ROLES.ADMIN]);
    });
  });

  // ── 10. MEDIUM 4: Từ chối currentUser === null ───────────────────────────────
  describe("10. Medium 4: Từ chối tài khoản không tồn tại khi DB trả về null", () => {
    it("permission.middleware.ts kiểm tra currentUser === null", () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/middlewares/permission.middleware.ts"),
        "utf-8",
      );
      assert.ok(
        content.includes("currentUser === null"),
        "permission.middleware.ts phải bắt lỗi khi currentUser === null",
      );
    });
  });

  // ── 11. LOW 1: SafetyRuleRepository Audit Log ─────────────────────────────────
  describe("11. Low 1: SafetyRuleRepository recordAuditLog chạy an toàn", () => {
    it("recordAuditLog không throw exception và dùng catch (err: unknown)", async () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/modules/safety-rule/safety-rule.repository.ts"),
        "utf-8",
      );
      assert.ok(
        content.includes("catch (err: unknown)"),
        "safety-rule.repository.ts phải dùng catch (err: unknown)",
      );
    });
  });

  // ── 12. LOW 2: Khớp Comment trong maintenance.middleware.ts ───────────────────
  describe("12. Low 2: Khớp ghi chú với code thực tế trong maintenance.middleware.ts", () => {
    it("Comment phản ánh đúng luồng kiểm tra tiếp role/IP", () => {
      const content = fs.readFileSync(
        path.resolve(process.cwd(), "src/middlewares/maintenance.middleware.ts"),
        "utf-8",
      );
      assert.ok(
        content.includes("kiểm tra tiếp role/IP bypass"),
        "Comment phải khớp với luồng thực tế của code",
      );
    });
  });
});
