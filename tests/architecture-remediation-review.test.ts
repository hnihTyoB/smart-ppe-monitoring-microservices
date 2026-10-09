import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { EventBusService } from "../src/common/services/event-bus.service";
import { NotificationService } from "../src/modules/notification/notification.service";
import { UserService } from "../src/modules/users/user.service";
import { jwtConfig } from "../src/config/jwt.config";
import { JWT_PURPOSE } from "../src/common/constants/jwt.constant";
import { AUDIT_ACTION, AUDIT_TARGET_TYPE, SYSTEM_TARGET_ID } from "../src/common/constants/audit-log.constant";
import { cameraPrisma, getCameraPrisma } from "../src/database/camera.client";
import { incidentPrisma, getIncidentPrisma } from "../src/database/incident.client";
import { notificationPrisma, getNotificationPrisma } from "../src/database/notification.client";
import { reportingPrisma, getReportingPrisma } from "../src/database/reporting.client";
import { sitePrisma, getSitePrisma } from "../src/database/site.client";
import { uploadImageMiddleware } from "../src/middlewares/upload.middleware";

describe("Architecture Remediation & Compliance Verification Suite", () => {
  describe("1. EventBus Transactional Outbox Integrity (P0)", () => {
    it("should re-throw error when outbox write fails within an active transaction (options.tx)", async () => {
      const mockOutboxRepo: any = {
        create: async () => {
          throw new Error("Outbox table connection timeout / deadlock");
        },
      };

      const eventBus = new EventBusService(mockOutboxRepo);
      const fakeTx: any = {};

      await assert.rejects(
        async () => {
          await eventBus.publish(
            "user.created",
            { userId: "usr-123" },
            { tx: fakeTx },
          );
        },
        {
          name: "Error",
          message: "Outbox table connection timeout / deadlock",
        },
      );
    });

    it("should fallback without throwing when outbox write fails without options.tx", async () => {
      let fallbackEnqueued = false;
      const mockOutboxRepo: any = {
        create: async () => {
          throw new Error("DB temporarily unavailable");
        },
      };

      const eventBus = new EventBusService(mockOutboxRepo);

      // Monkey patch enqueueEnvelope to track fallback
      (eventBus as any).enqueueEnvelope = async () => {
        fallbackEnqueued = true;
      };

      const envelope = await eventBus.publish("user.created", { userId: "usr-123" });
      assert.ok(envelope);
      assert.equal(fallbackEnqueued, true);
    });
  });

  describe("2. Notification SSE Stream Ticket in Service Layer (P1)", () => {
    it("should generate a valid SSE Stream Ticket using jwtConfig.tempSecret and JWT_PURPOSE.SSE_STREAM_TICKET", () => {
      const notificationService = new NotificationService();

      const testUser = {
        id: "user-uuid-456",
        email: "test@example.com",
        role: "ADMIN",
        roleId: "role-1",
      };

      const result = notificationService.createStreamTicket(testUser);
      assert.ok(result.ticket);
      assert.equal(result.expiresIn, 60);

      // Verify token decoded
      const decoded = jwt.verify(result.ticket, jwtConfig.tempSecret) as any;
      assert.equal(decoded.id, testUser.id);
      assert.equal(decoded.email, testUser.email);
      assert.equal(decoded.role, testUser.role);
      assert.equal(decoded.purpose, JWT_PURPOSE.SSE_STREAM_TICKET);
    });
  });

  describe("3. UserService Soft Delete Audit Log (P1)", () => {
    it("should invoke repository.createAuditLog with AUDIT_ACTION.DELETE_USER on softDelete", async () => {
      let auditLogCreated: any = null;
      let userSoftDeleted: any = null;

      const mockUserRepo: any = {
        findById: async (id: string) => ({ id, email: "user@example.com", deletedAt: null }),
        softDelete: async (id: string, adminId: string) => {
          userSoftDeleted = { id, adminId };
          return [{ id, deletedAt: new Date() }, { count: 1 }];
        },
        createAuditLog: async (data: any) => {
          auditLogCreated = data;
        },
      };

      const userService = new UserService(mockUserRepo);

      await userService.softDelete("target-user-id", "admin-user-id", {
        ipAddress: "192.168.1.1",
        userAgent: "JestTestAgent/1.0",
      });

      assert.deepEqual(userSoftDeleted, {
        id: "target-user-id",
        adminId: "admin-user-id",
      });

      assert.ok(auditLogCreated);
      assert.equal(auditLogCreated.actorId, "admin-user-id");
      assert.equal(auditLogCreated.action, AUDIT_ACTION.DELETE_USER);
      assert.equal(auditLogCreated.targetType, AUDIT_TARGET_TYPE.USER);
      assert.equal(auditLogCreated.targetId, "target-user-id");
      assert.equal(auditLogCreated.ipAddress, "192.168.1.1");
      assert.equal(auditLogCreated.userAgent, "JestTestAgent/1.0");
    });
  });

  describe("4. Constants & Magic Strings (P2)", () => {
    it("should export SYSTEM_TARGET_ID as 'SYSTEM'", () => {
      assert.equal(SYSTEM_TARGET_ID, "SYSTEM");
    });
  });

  describe("5. Upload Middleware Separation (P3)", () => {
    it("should properly export uploadImageMiddleware as a Multer instance", () => {
      assert.ok(uploadImageMiddleware);
      assert.equal(typeof uploadImageMiddleware.single, "function");
      assert.equal(typeof uploadImageMiddleware.array, "function");
    });
  });

  describe("6. Satellite Database Clients Lazy Singleton Proxies (P3)", () => {
    it("should provide lazy proxies that resolve singleton client getters", () => {
      const camera = getCameraPrisma();
      const incident = getIncidentPrisma();
      const notification = getNotificationPrisma();
      const reporting = getReportingPrisma();
      const site = getSitePrisma();

      assert.ok(camera);
      assert.ok(incident);
      assert.ok(notification);
      assert.ok(reporting);
      assert.ok(site);

      assert.ok(cameraPrisma);
      assert.ok(incidentPrisma);
      assert.ok(notificationPrisma);
      assert.ok(reportingPrisma);
      assert.ok(sitePrisma);
    });
  });
});
