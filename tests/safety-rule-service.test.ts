import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SAFETY_CONFIG,
  CONFIG_RESOLUTION_SOURCE,
  SAFETY_RULE_LIMITS,
} from "../src/modules/safety-rule/safety-rule.constant";
import {
  updateSiteSafetyConfigSchema,
  updateCameraSafetyConfigSchema,
  effectiveSafetyConfigQuerySchema,
  invalidateCacheSchema,
} from "../src/modules/safety-rule/safety-rule.validation";
import {
  SafetyRuleService,
} from "../src/modules/safety-rule/safety-rule.service";
import { SafetyRuleCacheService } from "../src/modules/safety-rule/safety-rule-cache.service";
import { AppError } from "../src/common/errors/app-error";
import siteApp from "../src/site.app";

describe("Task BE-10: PPE Safety Rule & AI Threshold Config Service Suite", () => {
  // ── 1. Domain Constants & Limits ──────────────────────────────────────────
  describe("1. Domain Constants & Limits", () => {
    test("should export correct system default thresholds and rule flags", () => {
      assert.equal(DEFAULT_SAFETY_CONFIG.confidenceThreshold, 0.8);
      assert.equal(DEFAULT_SAFETY_CONFIG.confirmationDuration, 2);
      assert.equal(DEFAULT_SAFETY_CONFIG.cooldownDuration, 30);
      assert.equal(DEFAULT_SAFETY_CONFIG.enableNoHelmet, true);
      assert.equal(DEFAULT_SAFETY_CONFIG.enableNoVest, true);
      assert.equal(DEFAULT_SAFETY_CONFIG.enableRestrictedArea, true);
      assert.equal(DEFAULT_SAFETY_CONFIG.modelVersionId, null);
    });

    test("should export correct resolution source constants", () => {
      assert.equal(CONFIG_RESOLUTION_SOURCE.CAMERA_OVERRIDE, "CAMERA_OVERRIDE");
      assert.equal(CONFIG_RESOLUTION_SOURCE.SITE_LEVEL, "SITE_LEVEL");
      assert.equal(CONFIG_RESOLUTION_SOURCE.SYSTEM_DEFAULT, "SYSTEM_DEFAULT");
    });

    test("should verify safety rule bounds", () => {
      assert.equal(SAFETY_RULE_LIMITS.MIN_CONFIDENCE_THRESHOLD, 0.01);
      assert.equal(SAFETY_RULE_LIMITS.MAX_CONFIDENCE_THRESHOLD, 0.99);
      assert.equal(SAFETY_RULE_LIMITS.MIN_CONFIRMATION_DURATION, 1);
      assert.equal(SAFETY_RULE_LIMITS.MAX_CONFIRMATION_DURATION, 60);
      assert.equal(SAFETY_RULE_LIMITS.MIN_COOLDOWN_DURATION, 5);
      assert.equal(SAFETY_RULE_LIMITS.MAX_COOLDOWN_DURATION, 300);
    });
  });

  // ── 2. Request Validation Schemas (Zod) ────────────────────────────────────
  describe("2. Request Validation Schemas", () => {
    test("should validate valid updateSiteSafetyConfigSchema payload", () => {
      const parsed = updateSiteSafetyConfigSchema.parse({
        confidenceThreshold: 0.85,
        confirmationDuration: 3,
        cooldownDuration: 45,
        enableNoHelmet: true,
        enableNoVest: false,
        enableRestrictedArea: true,
        modelVersionId: "01925b6c-9418-7777-8000-000000000001",
      });
      assert.equal(parsed.confidenceThreshold, 0.85);
      assert.equal(parsed.confirmationDuration, 3);
      assert.equal(parsed.cooldownDuration, 45);
      assert.equal(parsed.enableNoVest, false);
      assert.equal(
        parsed.modelVersionId,
        "01925b6c-9418-7777-8000-000000000001",
      );
    });

    test("should reject confidenceThreshold outside [0.01, 0.99]", () => {
      assert.throws(
        () => updateSiteSafetyConfigSchema.parse({ confidenceThreshold: 0 }),
        /Ngưỡng độ tin cậy tối thiểu/,
      );
      assert.throws(
        () => updateSiteSafetyConfigSchema.parse({ confidenceThreshold: 1.05 }),
        /Ngưỡng độ tin cậy tối đa/,
      );
    });

    test("should reject confirmationDuration outside [1, 60]", () => {
      assert.throws(
        () => updateSiteSafetyConfigSchema.parse({ confirmationDuration: 0 }),
        /Thời gian xác nhận tối thiểu/,
      );
      assert.throws(
        () => updateSiteSafetyConfigSchema.parse({ confirmationDuration: 65 }),
        /Thời gian xác nhận tối đa/,
      );
    });

    test("should reject cooldownDuration outside [5, 300]", () => {
      assert.throws(
        () => updateSiteSafetyConfigSchema.parse({ cooldownDuration: 3 }),
        /Thời gian cooldown tối thiểu/,
      );
      assert.throws(
        () => updateSiteSafetyConfigSchema.parse({ cooldownDuration: 500 }),
        /Thời gian cooldown tối đa/,
      );
    });

    test("should reject empty update payload", () => {
      assert.throws(
        () => updateSiteSafetyConfigSchema.parse({}),
        /Cần cung cấp ít nhất một trường để cập nhật/,
      );
    });

    test("should validate updateCameraSafetyConfigSchema allowing nullable overrides", () => {
      const parsed = updateCameraSafetyConfigSchema.parse({
        confidenceThreshold: null,
        confirmationDuration: 5,
        cooldownDuration: null,
        modelVersionId: null,
      });
      assert.equal(parsed.confidenceThreshold, null);
      assert.equal(parsed.confirmationDuration, 5);
      assert.equal(parsed.cooldownDuration, null);
      assert.equal(parsed.modelVersionId, null);
    });

    test("should validate effectiveSafetyConfigQuerySchema requiring siteId or cameraId", () => {
      const valid1 = effectiveSafetyConfigQuerySchema.parse({
        siteId: "01925b6c-9418-7777-8000-000000000001",
      });
      assert.equal(valid1.siteId, "01925b6c-9418-7777-8000-000000000001");

      const valid2 = effectiveSafetyConfigQuerySchema.parse({
        cameraId: "01925b6c-9418-7777-8000-000000000002",
      });
      assert.equal(valid2.cameraId, "01925b6c-9418-7777-8000-000000000002");

      assert.throws(
        () => effectiveSafetyConfigQuerySchema.parse({}),
        /Cần cung cấp ít nhất siteId hoặc cameraId/,
      );
    });

    test("should validate invalidateCacheSchema correctly", () => {
      const validEmpty = invalidateCacheSchema.parse({});
      assert.deepEqual(validEmpty, {});

      const validWithId = invalidateCacheSchema.parse({
        siteId: "01925b6c-9418-7777-8000-000000000001",
      });
      assert.equal(validWithId.siteId, "01925b6c-9418-7777-8000-000000000001");

      assert.throws(
        () => invalidateCacheSchema.parse({ siteId: "not-a-uuid" }),
        /Invalid UUID format/,
      );
    });
  });

  // ── 3. In-Memory Cache Service ─────────────────────────────────────────────
  describe("3. In-Memory Cache Service", () => {
    let cache: SafetyRuleCacheService;

    beforeEach(() => {
      cache = new SafetyRuleCacheService(500); // 500ms TTL for testing
    });

    test("should set and retrieve cached effective config entry", () => {
      const mockResult: any = {
        siteId: "site-1",
        cameraId: "cam-1",
        confidenceThreshold: 0.85,
        confirmationDuration: 2,
        cooldownDuration: 30,
        rules: {
          enableNoHelmet: true,
          enableNoVest: true,
          enableRestrictedArea: true,
        },
        modelVersion: null,
        restrictedAreas: [],
        source: "CAMERA_OVERRIDE",
        resolvedAt: new Date().toISOString(),
      };

      cache.set("effective:camera:cam-1", mockResult);
      const retrieved = cache.get("effective:camera:cam-1");
      assert.deepEqual(retrieved, mockResult);
    });

    test("should expire cache entry after TTL", async () => {
      const mockResult: any = { siteId: "site-1" };
      cache.set("effective:camera:cam-expired", mockResult, 50); // 50ms TTL

      assert.equal(cache.get("effective:camera:cam-expired")?.siteId, "site-1");

      await new Promise((resolve) => setTimeout(resolve, 70));
      assert.equal(cache.get("effective:camera:cam-expired"), null);
    });

    test("should invalidate cache by camera and site", () => {
      const mockResult: any = { siteId: "site-1" };
      cache.set("effective:camera:cam-1", mockResult);
      cache.set("effective:site:site-1", mockResult);
      cache.set("effective:camera:cam-2", mockResult);

      assert.equal(cache.size(), 3);

      cache.invalidateCamera("cam-1");
      assert.equal(cache.get("effective:camera:cam-1"), null);
      assert.notEqual(cache.get("effective:site:site-1"), null);

      cache.invalidateSite("site-1");
      assert.equal(cache.get("effective:site:site-1"), null);

      cache.clear();
      assert.equal(cache.size(), 0);
    });
  });

  // ── 4. Hierarchical Config Resolution ─────────────────────────────────────
  describe("4. Hierarchical Config Resolution Engine", () => {
    test("should return SYSTEM_DEFAULT when camera and site have no custom configs", async () => {
      const mockRepo: any = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "site-100",
          name: "Cam 1",
          code: "CAM-01",
          zoneId: null,
        }),
        findSiteById: async (id: string) => ({
          id,
          name: "Site Test",
          code: "SITE-01",
        }),
        findCameraConfig: async () => null,
        findSiteSafetyConfig: async () => null,
        findActiveModelVersion: async () => null,
        findRestrictedAreas: async () => [],
      };

      const service = new SafetyRuleService(mockRepo, new SafetyRuleCacheService());
      const res = await service.getEffectiveConfig({ cameraId: "cam-100" });

      assert.equal(res.siteId, "site-100");
      assert.equal(res.cameraId, "cam-100");
      assert.equal(res.source, CONFIG_RESOLUTION_SOURCE.SYSTEM_DEFAULT);
      assert.equal(res.confidenceThreshold, 0.8);
      assert.equal(res.confirmationDuration, 2);
      assert.equal(res.cooldownDuration, 30);
      assert.equal(res.rules.enableNoHelmet, true);
    });

    test("should return SITE_LEVEL when site has custom config and camera has no override", async () => {
      const mockRepo: any = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "site-100",
          name: "Cam 1",
          code: "CAM-01",
          zoneId: null,
        }),
        findSiteById: async (id: string) => ({
          id,
          name: "Site Test",
          code: "SITE-01",
        }),
        findCameraConfig: async () => null,
        findSiteSafetyConfig: async () => ({
          confidenceThreshold: 0.9,
          confirmationDuration: 4,
          cooldownDuration: 60,
          enableNoHelmet: true,
          enableNoVest: false,
          enableRestrictedArea: true,
          modelVersionId: null,
        }),
        findActiveModelVersion: async () => null,
        findRestrictedAreas: async () => [],
      };

      const service = new SafetyRuleService(mockRepo, new SafetyRuleCacheService());
      const res = await service.getEffectiveConfig({ cameraId: "cam-100" });

      assert.equal(res.source, CONFIG_RESOLUTION_SOURCE.SITE_LEVEL);
      assert.equal(res.confidenceThreshold, 0.9);
      assert.equal(res.confirmationDuration, 4);
      assert.equal(res.cooldownDuration, 60);
      assert.equal(res.rules.enableNoVest, false);
    });

    test("should return CAMERA_OVERRIDE when camera overrides specific thresholds", async () => {
      const mockRepo: any = {
        findCameraById: async (id: string) => ({
          id,
          siteId: "site-100",
          name: "Cam 1",
          code: "CAM-01",
          zoneId: "zone-1",
        }),
        findSiteById: async (id: string) => ({
          id,
          name: "Site Test",
          code: "SITE-01",
        }),
        findCameraConfig: async () => ({
          confidenceThreshold: 0.75, // Camera override
          confirmationDuration: null, // Fallback to site
          cooldownDuration: 15, // Camera override
          enableNoHelmet: null, // Fallback to site
          enableNoVest: null,
          enableRestrictedArea: false, // Camera override
          modelVersionId: null,
        }),
        findSiteSafetyConfig: async () => ({
          confidenceThreshold: 0.9,
          confirmationDuration: 5,
          cooldownDuration: 60,
          enableNoHelmet: true,
          enableNoVest: true,
          enableRestrictedArea: true,
          modelVersionId: null,
        }),
        findActiveModelVersion: async () => ({
          id: "model-v1",
          version: "v1.2.0",
          modelName: "YOLO PPE Detector",
          modelCode: "YOLO_PPE",
          framework: "PyTorch",
          inputSize: "640x640",
          status: "DEPLOYED",
          modelPath: "models/yolo_ppe_v1.2.0.pt",
          metrics: { mAP50: 0.94 },
        }),
        findRestrictedAreas: async () => [
          {
            id: "area-1",
            name: "Vùng nguy hiểm cẩu tháp",
            zoneId: "zone-1",
            boundary: [
              { x: 100, y: 100 },
              { x: 300, y: 100 },
              { x: 200, y: 300 },
            ],
            status: "ACTIVE",
          },
        ],
      };

      const service = new SafetyRuleService(mockRepo, new SafetyRuleCacheService());
      const res = await service.getEffectiveConfig({ cameraId: "cam-100" });

      assert.equal(res.source, CONFIG_RESOLUTION_SOURCE.CAMERA_OVERRIDE);
      assert.equal(res.confidenceThreshold, 0.75); // Từ camera
      assert.equal(res.confirmationDuration, 5); // Kế thừa từ site
      assert.equal(res.cooldownDuration, 15); // Từ camera
      assert.equal(res.rules.enableNoHelmet, true); // Kế thừa từ site
      assert.equal(res.rules.enableRestrictedArea, false); // Từ camera
      assert.equal(res.modelVersion?.version, "v1.2.0");
      assert.equal(res.restrictedAreas.length, 1);
      assert.equal(res.restrictedAreas[0].name, "Vùng nguy hiểm cẩu tháp");
    });

    test("should throw NOT_FOUND when querying effective config for non-existent camera", async () => {
      const mockRepo: any = {
        findCameraById: async () => null,
      };

      const service = new SafetyRuleService(mockRepo, new SafetyRuleCacheService());
      await assert.rejects(
        () => service.getEffectiveConfig({ cameraId: "unknown-camera" }),
        (err: AppError) => {
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });
  });

  // ── 5. Site & Camera CRUD & Audit Trail ───────────────────────────────────
  describe("5. Site & Camera CRUD & Audit Trail", () => {
    test("should retrieve system default config object", () => {
      const service = new SafetyRuleService();
      const def = service.getSystemDefault();
      assert.equal(def.confidenceThreshold, 0.8);
      assert.equal(def.source, CONFIG_RESOLUTION_SOURCE.SYSTEM_DEFAULT);
    });

    test("should provision default site safety config when none exists", async () => {
      let created = false;
      const mockRepo: any = {
        findSiteById: async (id: string) => ({ id, name: "Site A" }),
        findSiteSafetyConfig: async () => null,
        upsertSiteSafetyConfig: async (siteId: string) => {
          created = true;
          return {
            id: "cfg-1",
            siteId,
            confidenceThreshold: 0.8,
            confirmationDuration: 2,
            cooldownDuration: 30,
            enableNoHelmet: true,
            enableNoVest: true,
            enableRestrictedArea: true,
            modelVersionId: null,
            updatedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      };

      const service = new SafetyRuleService(mockRepo);
      const res = await service.getSiteSafetyConfig("site-1");
      assert.equal(created, true);
      assert.equal(res.confidenceThreshold, 0.8);
    });

    test("should update site safety config, invalidate cache and record audit log", async () => {
      let auditLogged = false;
      const mockRepo: any = {
        findSiteById: async (id: string) => ({
          id,
          name: "Site Test",
          code: "SITE-01",
        }),
        findActiveModelVersion: async () => ({ id: "m-v1" }),
        upsertSiteSafetyConfig: async (siteId: string, data: any) => ({
          id: "cfg-1",
          siteId,
          confidenceThreshold: data.confidenceThreshold,
          confirmationDuration: data.confirmationDuration,
          cooldownDuration: data.cooldownDuration,
          enableNoHelmet: data.enableNoHelmet,
          enableNoVest: data.enableNoVest,
          enableRestrictedArea: data.enableRestrictedArea,
          modelVersionId: data.modelVersionId,
          updatedBy: "user-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        recordAuditLog: async (params: any) => {
          auditLogged = true;
          assert.equal(params.action, "UPDATE_PPE_SAFETY_CONFIG");
          assert.equal(params.targetId, "site-1");
        },
      };

      const cache = new SafetyRuleCacheService();
      cache.set("effective:site:site-1", {} as any);

      const service = new SafetyRuleService(mockRepo, cache);
      const res = await service.updateSiteSafetyConfig(
        "site-1",
        {
          confidenceThreshold: 0.95,
          confirmationDuration: 3,
          cooldownDuration: 40,
          modelVersionId: "m-v1",
        },
        "user-1",
      );

      assert.equal(res.confidenceThreshold, 0.95);
      assert.equal(auditLogged, true);
      assert.equal(cache.get("effective:site:site-1"), null); // Cache cleared
    });

    test("should update and delete camera safety overrides with audit log", async () => {
      let auditCount = 0;
      const mockRepo: any = {
        findCameraById: async (id: string) => ({
          id,
          name: "Cam 1",
          code: "CAM-01",
        }),
        findActiveModelVersion: async () => null,
        upsertCameraSafetyConfig: async (cameraId: string, data: any) => ({
          id: "cam-cfg-1",
          cameraId,
          confidenceThreshold: data.confidenceThreshold,
          confirmationDuration: data.confirmationDuration,
          cooldownDuration: data.cooldownDuration,
          enableNoHelmet: data.enableNoHelmet,
          enableNoVest: data.enableNoVest,
          enableRestrictedArea: data.enableRestrictedArea,
          modelVersionId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        clearCameraSafetyConfig: async () => {},
        recordAuditLog: async () => {
          auditCount++;
        },
      };

      const service = new SafetyRuleService(mockRepo);
      const updated = await service.updateCameraSafetyConfig("cam-1", {
        confidenceThreshold: 0.88,
      });
      assert.equal(updated.confidenceThreshold, 0.88);

      await service.deleteCameraSafetyConfig("cam-1", "user-1");
      assert.equal(auditCount, 2);
    });

    test("should throw 404 NOT_FOUND when updating with non-existent modelVersionId", async () => {
      const mockRepo: any = {
        findSiteById: async (id: string) => ({ id, name: "Site A" }),
        findActiveModelVersion: async () => null,
      };
      const service = new SafetyRuleService(mockRepo);
      await assert.rejects(
        () =>
          service.updateSiteSafetyConfig("site-1", {
            modelVersionId: "01925b6c-9418-7777-8000-000000000099",
          }),
        (err: AppError) => {
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });

    test("should invalidate both site and camera caches when site config is updated", async () => {
      const mockRepo: any = {
        findSiteById: async (id: string) => ({
          id,
          name: "Site Test",
          code: "SITE-01",
        }),
        findActiveModelVersion: async () => null,
        upsertSiteSafetyConfig: async (siteId: string, data: any) => ({
          id: "cfg-1",
          siteId,
          confidenceThreshold: data.confidenceThreshold,
          confirmationDuration: 2,
          cooldownDuration: 30,
          enableNoHelmet: true,
          enableNoVest: true,
          enableRestrictedArea: true,
          modelVersionId: null,
          updatedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        recordAuditLog: async () => {},
      };

      const cache = new SafetyRuleCacheService();
      cache.set("effective:site:site-1", { siteId: "site-1" } as any);
      cache.set("effective:site:site-1:camera:cam-1", {
        siteId: "site-1",
        cameraId: "cam-1",
      } as any);

      const service = new SafetyRuleService(mockRepo, cache);
      await service.updateSiteSafetyConfig("site-1", {
        confidenceThreshold: 0.9,
      });

      assert.equal(cache.get("effective:site:site-1"), null);
      assert.equal(cache.getForCamera("cam-1"), null);
    });
  });

  // ── 6. Express Application & Route Endpoints ──────────────────────────────
  describe("6. Express Application & Route Endpoints", () => {
    test("should export initialized Express application with safety-rule routes", () => {
      assert.ok(siteApp);
      const routes = (siteApp as any)._router.stack
        .filter((r: any) => r.route || r.name === "router")
        .map((r: any) => r.regexp?.toString());
      assert.ok(routes.length > 0);
    });
  });
});
