import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_CATEGORY,
  AUDIT_CATEGORY_ACTIONS,
  AUDIT_EXPORT_FORMAT,
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../src/modules/audit/audit.constant";
import {
  auditLogQuerySchema,
  auditLogIdParamSchema,
  auditLogResourceParamSchema,
  exportAuditLogSchema,
  auditSummaryQuerySchema,
  resourceAuditTrailQuerySchema,
} from "../src/modules/audit/audit.validation";
import { AuditService } from "../src/modules/audit/audit.service";
import { AuditRepository } from "../src/modules/audit/audit.repository";
import { IncidentService } from "../src/modules/incident/incident.service";
import { INCIDENT_STATUS } from "../src/common/constants/incident.constant";
import { AppError } from "../src/common/errors/app-error";
import auditRouter from "../src/modules/audit/audit.route";

describe("Task BE-11: PPE Audit Log Service Suite", () => {
  // ── 1. Domain Constants & Taxonomy ─────────────────────────────────────────
  describe("1. Domain Constants & Taxonomy", () => {
    test("should export all standard audit categories and format options", () => {
      assert.equal(AUDIT_CATEGORY.ALL, "ALL");
      assert.equal(AUDIT_CATEGORY.CONFIG, "CONFIG");
      assert.equal(AUDIT_CATEGORY.INCIDENT_REVIEW, "INCIDENT_REVIEW");
      assert.equal(AUDIT_CATEGORY.ACCESS_CONTROL, "ACCESS_CONTROL");
      assert.equal(AUDIT_CATEGORY.SYSTEM, "SYSTEM");

      assert.equal(AUDIT_EXPORT_FORMAT.CSV, "csv");
      assert.equal(AUDIT_EXPORT_FORMAT.JSON, "json");
    });

    test("should verify CONFIG actions mapping includes PPE and system config actions", () => {
      const configActions = AUDIT_CATEGORY_ACTIONS.CONFIG;
      assert.ok(configActions.includes(AUDIT_ACTION.UPDATE_PPE_SAFETY_CONFIG));
      assert.ok(configActions.includes(AUDIT_ACTION.UPDATE_PPE_CAMERA_SAFETY_CONFIG));
      assert.ok(configActions.includes(AUDIT_ACTION.DELETE_PPE_CAMERA_SAFETY_CONFIG));
      assert.ok(configActions.includes(AUDIT_ACTION.CREATE_PPE_SITE));
      assert.ok(configActions.includes(AUDIT_ACTION.UPDATE_PPE_SITE));
      assert.ok(configActions.includes(AUDIT_ACTION.REGISTER_PPE_CAMERA));
      assert.ok(configActions.includes(AUDIT_ACTION.UPDATE_PPE_CAMERA));
      assert.ok(configActions.includes(AUDIT_ACTION.CREATE_SYSTEM_CONFIG));
    });

    test("should verify INCIDENT_REVIEW actions mapping includes review and lifecycle actions", () => {
      const reviewActions = AUDIT_CATEGORY_ACTIONS.INCIDENT_REVIEW;
      assert.ok(reviewActions.includes(AUDIT_ACTION.REVIEW_PPE_INCIDENT));
      assert.ok(reviewActions.includes(AUDIT_ACTION.RESOLVE_PPE_INCIDENT));
      assert.ok(reviewActions.includes(AUDIT_ACTION.CLOSE_PPE_INCIDENT));
      assert.ok(reviewActions.includes(AUDIT_ACTION.ASSIGN_PPE_INCIDENT));
      assert.ok(reviewActions.includes(AUDIT_ACTION.CREATE_PPE_INCIDENT));
    });
  });

  // ── 2. Request Validation Schemas ──────────────────────────────────────────
  describe("2. Request Validation Schemas", () => {
    test("should parse valid query with pagination and filters", () => {
      const parsed = auditLogQuerySchema.parse({
        category: "CONFIG",
        actorId: "01925b6c-9418-7777-8000-000000000001",
        action: "UPDATE_PPE_SAFETY_CONFIG",
        targetType: "PPE_SAFETY_CONFIG",
        page: "2",
        limit: "50",
        sortBy: "createdAt",
        order: "desc",
      });

      assert.equal(parsed.category, "CONFIG");
      assert.equal(parsed.page, 2);
      assert.equal(parsed.limit, 50);
      assert.equal(parsed.order, "desc");
    });

    test("should reject invalid actorId format", () => {
      assert.throws(
        () => auditLogQuerySchema.parse({ actorId: "invalid-uuid" }),
        /Invalid UUID format/,
      );
    });

    test("should reject date range where endDate is before startDate", () => {
      assert.throws(
        () =>
          auditLogQuerySchema.parse({
            startDate: "2026-10-15",
            endDate: "2026-10-10",
          }),
        /endDate phải lớn hơn hoặc bằng startDate/,
      );
    });

    test("should validate auditLogResourceParamSchema", () => {
      const valid = auditLogResourceParamSchema.parse({
        targetType: "PPE_INCIDENT",
        targetId: "inc-12345",
      });
      assert.equal(valid.targetType, "PPE_INCIDENT");
      assert.equal(valid.targetId, "inc-12345");

      assert.throws(
        () =>
          auditLogResourceParamSchema.parse({
            targetType: "",
            targetId: "123",
          }),
        /targetType không được để trống/,
      );
    });

    test("should validate exportAuditLogSchema allowing csv and json formats", () => {
      const csvExport = exportAuditLogSchema.parse({
        format: "csv",
        category: "INCIDENT_REVIEW",
      });
      assert.equal(csvExport.format, "csv");

      const jsonExport = exportAuditLogSchema.parse({
        format: "json",
      });
      assert.equal(jsonExport.format, "json");
    });

    test("should validate auditSummaryQuerySchema and enforce date order", () => {
      const valid = auditSummaryQuerySchema.parse({
        startDate: "2026-10-01",
        endDate: "2026-10-11",
      });
      assert.equal(valid.startDate, "2026-10-01");
      assert.equal(valid.endDate, "2026-10-11");

      assert.throws(
        () =>
          auditSummaryQuerySchema.parse({
            startDate: "2026-10-20",
            endDate: "2026-10-10",
          }),
        /endDate phải lớn hơn hoặc bằng startDate/,
      );
    });

    test("should validate resourceAuditTrailQuerySchema with limit clamping", () => {
      const parsed = resourceAuditTrailQuerySchema.parse({ limit: "25" });
      assert.equal(parsed.limit, 25);

      assert.throws(
        () => resourceAuditTrailQuerySchema.parse({ limit: "500" }),
      );
    });
  });

  // ── 3. Audit Service Business Operations & Enrichment ──────────────────────
  describe("3. Audit Service Business Operations & Enrichment", () => {
    const mockAuditLogItem = {
      id: "01925b6c-9418-7777-8000-000000000099",
      actorId: "01925b6c-9418-7777-8000-000000000001",
      actor: {
        id: "01925b6c-9418-7777-8000-000000000001",
        email: "officer@example.com",
        fullName: "Safety Officer John",
        roleName: "SAFETY_OFFICER",
      },
      action: AUDIT_ACTION.REVIEW_PPE_INCIDENT,
      targetType: AUDIT_TARGET_TYPE.PPE_INCIDENT,
      targetId: "inc-99",
      details: { decision: "CONFIRMED", reason: "Không đội nón" },
      ipAddress: "192.168.1.100",
      userAgent: "Mozilla/5.0",
      createdAt: new Date().toISOString(),
    };

    test("should list audit logs and enrich actor profile", async () => {
      const mockRepo: any = {
        findAll: async () => ({
          data: [mockAuditLogItem],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        }),
      };

      const service = new AuditService(mockRepo);
      const result = await service.listLogs({ page: 1 });

      assert.equal(result.data.length, 1);
      assert.equal(result.data[0].action, AUDIT_ACTION.REVIEW_PPE_INCIDENT);
      assert.equal(result.data[0].actor?.email, "officer@example.com");
    });

    test("should route to searchFts when search query is provided", async () => {
      let ftsCalled = false;
      const mockRepo: any = {
        searchFts: async () => {
          ftsCalled = true;
          return {
            data: [mockAuditLogItem],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
          };
        },
      };

      const service = new AuditService(mockRepo);
      await service.listLogs({ search: "CONFIRMED" });
      assert.ok(ftsCalled);
    });

    test("should filter config changes with category CONFIG", async () => {
      let capturedCategory: string | undefined;
      const mockRepo: any = {
        findAll: async (query: any) => {
          capturedCategory = query.category;
          return { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };
        },
      };

      const service = new AuditService(mockRepo);
      await service.getConfigChanges({});
      assert.equal(capturedCategory, "CONFIG");
    });

    test("should filter incident reviews with category INCIDENT_REVIEW", async () => {
      let capturedCategory: string | undefined;
      const mockRepo: any = {
        findAll: async (query: any) => {
          capturedCategory = query.category;
          return { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };
        },
      };

      const service = new AuditService(mockRepo);
      await service.getIncidentReviews({});
      assert.equal(capturedCategory, "INCIDENT_REVIEW");
    });

    test("should retrieve resource audit trail timeline", async () => {
      const mockRepo: any = {
        findByResource: async (targetType: string, targetId: string) => [
          { ...mockAuditLogItem, targetType, targetId },
        ],
      };

      const service = new AuditService(mockRepo);
      const timeline = await service.getResourceAuditTrail(
        AUDIT_TARGET_TYPE.PPE_INCIDENT,
        "inc-99",
      );

      assert.equal(timeline.length, 1);
      assert.equal(timeline[0].targetId, "inc-99");
    });

    test("should throw 404 when log detail is not found", async () => {
      const mockRepo: any = {
        findById: async () => null,
      };

      const service = new AuditService(mockRepo);
      await assert.rejects(
        () => service.getLogDetail("01925b6c-9418-7777-8000-000000000000"),
        (err: AppError) => {
          assert.equal(err.statusCode, 404);
          return true;
        },
      );
    });

    test("should retrieve KPI summary aggregation metrics", async () => {
      const mockSummary = {
        totalLogs: 150,
        categoryCounts: {
          config: 40,
          incidentReview: 80,
          accessControl: 20,
          system: 10,
        },
        topActors: [{ actorId: "user-1", actorName: "John", count: 50 }],
        topActions: [{ action: AUDIT_ACTION.REVIEW_PPE_INCIDENT, count: 80 }],
        recentActivity: [mockAuditLogItem],
      };

      const mockRepo: any = {
        getSummary: async () => mockSummary,
      };

      const service = new AuditService(mockRepo);
      const summary = await service.getSummary();
      assert.equal(summary.totalLogs, 150);
      assert.equal(summary.categoryCounts.incidentReview, 80);
    });
  });

  // ── 4. RFC 4180 CSV & JSON Export ──────────────────────────────────────────
  describe("4. RFC 4180 CSV & JSON Export", () => {
    const mockLogs = [
      {
        id: "01925b6c-9418-7777-8000-000000000001",
        actorId: "actor-1",
        actor: {
          id: "actor-1",
          email: "test@domain.com",
          fullName: 'Tran "Special" Van A',
          roleName: "SAFETY_OFFICER",
        },
        action: AUDIT_ACTION.REVIEW_PPE_INCIDENT,
        targetType: AUDIT_TARGET_TYPE.PPE_INCIDENT,
        targetId: "inc-1",
        details: { note: "Line 1\nLine 2, with comma" },
        ipAddress: "127.0.0.1",
        userAgent: "Agent",
        createdAt: "2026-10-11T20:00:00.000Z",
      },
    ];

    test("should export CSV properly formatted with RFC 4180 quotes escaping", async () => {
      const mockRepo: any = {
        findForExport: async () => mockLogs,
      };

      const service = new AuditService(mockRepo);
      const result = await service.exportLogs({ format: "csv" });

      assert.equal(result.format, "csv");
      assert.equal(result.count, 1);
      assert.ok(typeof result.data === "string");
      // Check UTF-8 BOM
      assert.ok(result.data.startsWith("\uFEFF"));
      // Check double-quoted internal quotes
      assert.ok(result.data.includes('Tran ""Special"" Van A'));
    });

    test("should export JSON properly structured", async () => {
      const mockRepo: any = {
        findForExport: async () => mockLogs,
      };

      const service = new AuditService(mockRepo);
      const result = await service.exportLogs({ format: "json" });

      assert.equal(result.format, "json");
      assert.equal(result.count, 1);
      assert.ok(Array.isArray(result.data));
    });

    test("should neutralize formula injection triggers (=, +, -, @) in CSV export", async () => {
      const formulaLogs: any = [
        {
          id: "01925b6c-9418-7777-8000-000000000001",
          actorId: "01925b6c-9418-7777-8000-000000000002",
          actor: {
            id: "01925b6c-9418-7777-8000-000000000002",
            email: "attacker@example.com",
            fullName: "=CMD|' /C calc'!A0",
            roleName: "SAFETY_OFFICER",
          },
          action: "+MALICIOUS_ACTION",
          targetType: "-PPE_RESOURCE",
          targetId: "@TARGET_ID",
          details: { note: "=2+5" },
          ipAddress: "127.0.0.1",
          userAgent: "\tMozilla/5.0",
          createdAt: "2026-10-11T12:00:00.000Z",
        },
      ];

      const mockRepo: any = {
        findForExport: async () => formulaLogs,
      };

      const service = new AuditService(mockRepo);
      const result = await service.exportLogs({ format: "csv" });

      assert.ok(typeof result.data === "string");
      assert.ok(result.data.includes("'=CMD|"));
      assert.ok(result.data.includes("'+MALICIOUS_ACTION"));
      assert.ok(result.data.includes("'-PPE_RESOURCE"));
      assert.ok(result.data.includes("'@TARGET_ID"));
    });
  });

  // ── 5. Incident Service Review Audit Trail Integration ─────────────────────
  describe("5. Incident Service Review Audit Trail Integration", () => {
    test("should record audit log with actor/action/time/resource when reviewIncident is called", async () => {
      let recordedAudit: any = null;

      const mockIncidentRepo: any = {
        findIncidentById: async (id: string) => ({
          id,
          status: INCIDENT_STATUS.PENDING_REVIEW,
          violationType: "NO_HELMET",
          siteId: "site-1",
          cameraId: "cam-1",
        }),
        transitionStatus: async (params: any) => ({
          id: params.incidentId,
          status: params.newStatus,
        }),
      };

      const mockAuditService: any = {
        recordLog: async (params: any) => {
          recordedAudit = params;
          return params;
        },
      };

      const incidentService = new IncidentService(
        mockIncidentRepo,
        undefined,
        undefined,
        mockAuditService,
      );

      await incidentService.reviewIncident(
        "inc-001",
        { decision: "CONFIRMED", reason: "Công nhân không đội mũ bảo hộ" },
        "officer-uuid-01",
      );

      assert.ok(recordedAudit, "Audit log must be recorded");
      assert.equal(recordedAudit.actorId, "officer-uuid-01");
      assert.equal(recordedAudit.action, AUDIT_ACTION.REVIEW_PPE_INCIDENT);
      assert.equal(recordedAudit.targetType, AUDIT_TARGET_TYPE.PPE_INCIDENT);
      assert.equal(recordedAudit.targetId, "inc-001");
      assert.equal(recordedAudit.details.decision, "CONFIRMED");
      assert.equal(recordedAudit.details.newStatus, INCIDENT_STATUS.CONFIRMED);
    });

    test("should record audit log when resolveIncident is called", async () => {
      let recordedAudit: any = null;

      const mockIncidentRepo: any = {
        findIncidentById: async (id: string) => ({
          id,
          status: INCIDENT_STATUS.CONFIRMED,
          violationType: "NO_HELMET",
        }),
        transitionStatus: async (params: any) => ({
          id: params.incidentId,
          status: params.newStatus,
        }),
      };

      const mockAuditService: any = {
        recordLog: async (params: any) => {
          recordedAudit = params;
          return params;
        },
      };

      const incidentService = new IncidentService(
        mockIncidentRepo,
        undefined,
        undefined,
        mockAuditService,
      );

      await incidentService.resolveIncident(
        "inc-002",
        { resolutionNote: "Đã nhắc nhở công nhân trang bị nón" },
        "officer-uuid-02",
      );

      assert.ok(recordedAudit);
      assert.equal(recordedAudit.action, AUDIT_ACTION.RESOLVE_PPE_INCIDENT);
      assert.equal(recordedAudit.targetId, "inc-002");
      assert.equal(recordedAudit.details.newStatus, INCIDENT_STATUS.RESOLVED);
    });

    test("should record audit log when closeIncident is called", async () => {
      let recordedAudit: any = null;

      const mockIncidentRepo: any = {
        findIncidentById: async (id: string) => ({
          id,
          status: INCIDENT_STATUS.RESOLVED,
        }),
        transitionStatus: async (params: any) => ({
          id: params.incidentId,
          status: params.newStatus,
        }),
      };

      const mockAuditService: any = {
        recordLog: async (params: any) => {
          recordedAudit = params;
          return params;
        },
      };

      const incidentService = new IncidentService(
        mockIncidentRepo,
        undefined,
        undefined,
        mockAuditService,
      );

      await incidentService.closeIncident(
        "inc-003",
        { closeNote: "Đã hoàn tất xử lý" },
        "officer-uuid-03",
      );

      assert.ok(recordedAudit);
      assert.equal(recordedAudit.action, AUDIT_ACTION.CLOSE_PPE_INCIDENT);
      assert.equal(recordedAudit.targetId, "inc-003");
      assert.equal(recordedAudit.details.newStatus, INCIDENT_STATUS.CLOSED);
    });

    test("should record audit log when assignIncident is called", async () => {
      let recordedAudit: any = null;

      const mockIncidentRepo: any = {
        findIncidentById: async (id: string) => ({
          id,
          status: INCIDENT_STATUS.CONFIRMED,
        }),
        assignIncident: async (incidentId: string, assignedTo: string) => ({
          id: "assign-1",
          incidentId,
          assignedTo,
        }),
      };

      const mockAuditService: any = {
        recordLog: async (params: any) => {
          recordedAudit = params;
          return params;
        },
      };

      const incidentService = new IncidentService(
        mockIncidentRepo,
        undefined,
        undefined,
        mockAuditService,
      );

      await incidentService.assignIncident(
        "inc-004",
        { assignedTo: "officer-uuid-99" },
        "officer-manager-01",
      );

      assert.ok(recordedAudit);
      assert.equal(recordedAudit.actorId, "officer-manager-01");
      assert.equal(recordedAudit.action, AUDIT_ACTION.ASSIGN_PPE_INCIDENT);
      assert.equal(recordedAudit.targetId, "inc-004");
      assert.equal(recordedAudit.details.assignedTo, "officer-uuid-99");
    });
  });

  // ── 6. Express Application & Route Endpoints ──────────────────────────────
  describe("6. Express Application & Route Endpoints", () => {
    test("should export initialized auditRouter with registered endpoints", () => {
      assert.ok(auditRouter, "auditRouter must be defined");
      assert.equal(typeof auditRouter, "function");
    });
  });
});
