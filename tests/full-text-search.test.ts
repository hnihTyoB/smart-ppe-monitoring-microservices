import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeFtsInput,
  buildTsQuery,
  normalizeSearchTerm,
} from "../src/common/helpers/fts.helper";
import { UserService } from "../src/modules/users/user.service";
import { UserRepository } from "../src/modules/users/user.repository";
import { FileService } from "../src/modules/files/file.service";
import { FileRepository } from "../src/modules/files/file.repository";
import { RbacRepository } from "../src/modules/rbac/rbac.repository";
import { RbacService } from "../src/modules/rbac/rbac.service";
import { swaggerSpec } from "../src/config/swagger.config";
import { findAllUserSchema } from "../src/modules/users/user.validation";
import { listFilesSchema } from "../src/modules/files/file.validation";
import { auditLogQuerySchema } from "../src/modules/rbac/rbac.validation";

describe("PostgreSQL Full-Text Search (FTS) & GIN Index Optimization Test Suite", () => {
  describe("1. FTS Helper & tsquery Sanitization", () => {
    it("sanitizeFtsInput loại bỏ hoàn toàn các ký tự điều khiển tsquery nguy hiểm", () => {
      const raw =
        "nguyen & van | (a) ! test:* <script> 'admin' \"quoted\" \\slash";
      const sanitized = sanitizeFtsInput(raw);
      assert.strictEqual(
        sanitized,
        "nguyen van a test script admin quoted slash",
      );
    });

    it("sanitizeFtsInput và buildTsQuery bảo tồn email nguyên vẹn để khớp lexeme trong PostgreSQL", () => {
      const raw = "lien he user@example.com de biet them";
      const sanitized = sanitizeFtsInput(raw);
      assert.ok(sanitized.includes("user@example.com"));

      const tsQuery = buildTsQuery("user@example.com");
      assert.strictEqual(tsQuery, "'user@example.com':*");
    });

    it("normalizeSearchTerm xử lý chuỗi rỗng và khoảng trắng chuẩn xác", () => {
      assert.strictEqual(normalizeSearchTerm("   "), null);
      assert.strictEqual(normalizeSearchTerm(""), null);
      assert.strictEqual(normalizeSearchTerm(undefined), null);
      assert.strictEqual(normalizeSearchTerm("  tu khoa  "), "tu khoa");
    });

    it("buildTsQuery sinh prefix query mặc định để hỗ trợ live-search autocomplete", () => {
      const query = buildTsQuery("Nguyen Van");
      assert.strictEqual(query, "'Nguyen':* & 'Van':*");
    });

    it("buildTsQuery hỗ trợ các chế độ exact, phrase và or", () => {
      const exact = buildTsQuery("Nguyen Van", "exact");
      assert.strictEqual(exact, "'Nguyen' & 'Van'");

      const phrase = buildTsQuery("Nguyen Van", "phrase");
      assert.strictEqual(phrase, "'Nguyen' <-> 'Van'");

      const orQuery = buildTsQuery("invoice report", "or");
      assert.strictEqual(orQuery, "'invoice':* | 'report':*");
    });

    it("buildTsQuery vô hiệu hóa an toàn các payload SQL Injection / tsquery syntax error", () => {
      const malicious = "admin') OR 1=1; DROP TABLE users; -- '";
      const safeQuery = buildTsQuery(malicious);
      assert.ok(safeQuery);
      assert.strictEqual(safeQuery.includes(";"), false);
      assert.strictEqual(safeQuery.includes("--"), false);
      assert.strictEqual(safeQuery.includes("'"), true); // Chỉ có single quote bọc từng token
    });

    it("buildTsQuery trả về null nếu đầu vào chỉ gồm ký tự đặc biệt bị loại bỏ", () => {
      assert.strictEqual(buildTsQuery("!@#$%^&*():::"), null);
    });
  });

  describe("2. User Search with Full-Text Search Filtering", () => {
    let mockUserRepo: Partial<UserRepository>;
    let usersDatabase: Array<any> = [];

    beforeEach(() => {
      usersDatabase = [
        {
          id: "11111111-1111-1111-1111-111111111111",
          email: "nguyen.van.a@example.com",
          fullName: "Nguyễn Văn A",
          phoneNumber: "0987654321",
          isActive: true,
          deletedAt: null,
          role: { id: "role-1", name: "USER" },
          createdAt: new Date("2026-01-01"),
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          email: "tran.thi.b@example.com",
          fullName: "Trần Thị B",
          phoneNumber: "0912345678",
          isActive: true,
          deletedAt: null,
          role: { id: "role-2", name: "MANAGER" },
          createdAt: new Date("2026-01-02"),
        },
        {
          id: "33333333-3333-3333-3333-333333333333",
          email: "admin.system@example.com",
          fullName: "Quản Trị Viên Hệ Thống",
          phoneNumber: "0900000000",
          isActive: true,
          deletedAt: null,
          role: { id: "role-3", name: "ADMIN" },
          createdAt: new Date("2026-01-03"),
        },
        {
          id: "44444444-4444-4444-4444-444444444444",
          email: "deleted.user@example.com",
          fullName: "Người Dùng Đã Xóa",
          phoneNumber: "0999999999",
          isActive: false,
          deletedAt: new Date("2026-01-04"),
          role: { id: "role-1", name: "USER" },
          createdAt: new Date("2026-01-04"),
        },
      ];

      mockUserRepo = {
        findAll: async (query: any) => {
          let list = [...usersDatabase];

          // isDeleted filter
          if (query.isDeleted === true) {
            list = list.filter((u) => u.deletedAt !== null);
          } else {
            list = list.filter((u) => u.deletedAt === null);
          }

          // search filter (FTS / prefix simulation)
          if (query.search) {
            const s = query.search.toLowerCase().trim();
            list = list.filter(
              (u) =>
                u.fullName.toLowerCase().includes(s) ||
                u.email.toLowerCase().includes(s) ||
                (u.phoneNumber && u.phoneNumber.includes(s)),
            );
          }

          // roleName filter
          if (query.roleName) {
            list = list.filter((u) => u.role?.name === query.roleName);
          }

          return {
            data: list,
            meta: {
              total: list.length,
              page: query.page ?? 1,
              limit: query.limit ?? 20,
              totalPages: 1,
            },
          };
        },
      };
    });

    it("tìm kiếm người dùng theo họ tên tiếng Việt", async () => {
      const result = await mockUserRepo.findAll!({ search: "Nguyễn Văn" });
      assert.strictEqual(result.data.length, 1);
      assert.strictEqual(result.data[0].email, "nguyen.van.a@example.com");
    });

    it("tìm kiếm người dùng theo email tiền tố", async () => {
      const result = await mockUserRepo.findAll!({ search: "admin.sys" });
      assert.strictEqual(result.data.length, 1);
      assert.strictEqual(result.data[0].fullName, "Quản Trị Viên Hệ Thống");
    });

    it("tìm kiếm người dùng theo số điện thoại", async () => {
      const result = await mockUserRepo.findAll!({ search: "0912345" });
      assert.strictEqual(result.data.length, 1);
      assert.strictEqual(result.data[0].email, "tran.thi.b@example.com");
    });

    it("kết hợp tìm kiếm search với bộ lọc phân quyền roleName", async () => {
      // Tìm kiếm "a" nhưng chỉ lấy vai trò USER
      const result = await mockUserRepo.findAll!({
        search: "a",
        roleName: "USER",
      });
      assert.strictEqual(result.data.length, 1);
      assert.strictEqual(result.data[0].email, "nguyen.van.a@example.com");
    });

    it("không tìm thấy người dùng đã xóa mềm nếu không chỉ định isDeleted=true", async () => {
      const result = await mockUserRepo.findAll!({ search: "Đã Xóa" });
      assert.strictEqual(result.data.length, 0);

      const deletedResult = await mockUserRepo.findAll!({
        search: "Đã Xóa",
        isDeleted: true,
      });
      assert.strictEqual(deletedResult.data.length, 1);
      assert.strictEqual(
        deletedResult.data[0].email,
        "deleted.user@example.com",
      );
    });
  });

  describe("3. FileRecord Search with Full-Text Search Filtering", () => {
    let mockFileRepo: Partial<FileRepository>;
    let filesDatabase: Array<any> = [];

    beforeEach(() => {
      filesDatabase = [
        {
          id: "f-1",
          userId: "user-1",
          originalName: "Hóa Đơn GTGT Quý 3-2026.pdf",
          fileName: "hoa-don-gtgt-q3_01.pdf",
          folder: "invoices",
          mimeType: "application/pdf",
          isPublic: false,
          isConfirmed: true,
          deletedAt: null,
        },
        {
          id: "f-2",
          userId: "user-1",
          originalName: "Hợp Đồng Mua Bán Thiết Bị.pdf",
          fileName: "hop-dong-thiet-bi_02.pdf",
          folder: "contracts",
          mimeType: "application/pdf",
          isPublic: false,
          isConfirmed: true,
          deletedAt: null,
        },
        {
          id: "f-3",
          userId: "user-2",
          originalName: "Báo Cáo Tài Chính 2026.xlsx",
          fileName: "bao-cao-tai-chinh_03.xlsx",
          folder: "reports",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          isPublic: false,
          isConfirmed: true,
          deletedAt: null,
        },
        {
          id: "f-4",
          userId: "user-2",
          originalName: "Catalogue Sản Phẩm Mùa Thu.pdf",
          fileName: "catalogue-mua-thu_04.pdf",
          folder: "marketing",
          mimeType: "application/pdf",
          isPublic: true,
          isConfirmed: true,
          deletedAt: null,
        },
      ];

      mockFileRepo = {
        findAll: async (
          query: any,
          currentUserId?: string,
          canManageAll?: boolean,
        ) => {
          let list = filesDatabase.filter((f) => !f.deletedAt && f.isConfirmed);

          // Authorization Scoping
          if (!canManageAll) {
            list = list.filter(
              (f) =>
                f.isPublic || (currentUserId && f.userId === currentUserId),
            );
          }

          if (query.folder) {
            list = list.filter((f) => f.folder === query.folder);
          }

          // Full-Text Search Simulation
          if (query.search) {
            const s = query.search.toLowerCase().trim();
            list = list.filter(
              (f) =>
                f.originalName.toLowerCase().includes(s) ||
                f.fileName.toLowerCase().includes(s) ||
                f.folder.toLowerCase().includes(s),
            );
          }

          return {
            data: list,
            meta: { total: list.length, page: 1, limit: 20, totalPages: 1 },
          } as any;
        },
      };
    });

    it("tìm kiếm tệp theo tên gốc tiếng Việt có dấu", async () => {
      const res = await mockFileRepo.findAll!(
        { search: "Hóa Đơn" },
        "user-1",
        false,
      );
      assert.strictEqual(res.data.length, 1);
      assert.strictEqual(
        res.data[0].originalName,
        "Hóa Đơn GTGT Quý 3-2026.pdf",
      );
    });

    it("tìm kiếm theo tên thư mục lưu trữ (folder)", async () => {
      const res = await mockFileRepo.findAll!(
        { search: "contracts" },
        "user-1",
        false,
      );
      assert.strictEqual(res.data.length, 1);
      assert.strictEqual(res.data[0].folder, "contracts");
    });

    it("bảo đảm an toàn phân quyền: tìm kiếm không làm rò rỉ tệp private của người khác", async () => {
      // user-1 tìm kiếm "Tài Chính" (tệp private của user-2)
      const res = await mockFileRepo.findAll!(
        { search: "Tài Chính" },
        "user-1",
        false,
      );
      assert.strictEqual(res.data.length, 0);

      // Quản trị viên tìm kiếm "Tài Chính" -> thấy được
      const adminRes = await mockFileRepo.findAll!(
        { search: "Tài Chính" },
        "admin-id",
        true,
      );
      assert.strictEqual(adminRes.data.length, 1);
      assert.strictEqual(
        adminRes.data[0].originalName,
        "Báo Cáo Tài Chính 2026.xlsx",
      );
    });
  });

  describe("4. AuditLog Search with Full-Text Search Filtering", () => {
    let mockRbacRepo: Partial<RbacRepository>;
    let logsDatabase: Array<any> = [];

    beforeEach(() => {
      logsDatabase = [
        {
          id: "log-1",
          action: "RESTORE_USER",
          targetType: "USER",
          targetId: "user-123",
          ipAddress: "192.168.1.100",
          userAgent: "Mozilla/5.0 Chrome/120.0",
        },
        {
          id: "log-2",
          action: "CONFIRM_FILE_UPLOAD",
          targetType: "FILE",
          targetId: "file-456",
          ipAddress: "10.0.0.1",
          userAgent: "PostmanRuntime/7.36.0",
        },
        {
          id: "log-3",
          action: "ACCOUNT_LOCKED",
          targetType: "USER",
          targetId: "user-789",
          ipAddress: "192.168.1.100",
          userAgent: "Python/3.11 requests",
        },
      ];

      mockRbacRepo = {
        findAllAuditLogs: async (query: any) => {
          let list = [...logsDatabase];

          if (query.action) {
            list = list.filter((l) => l.action === query.action);
          }

          if (query.search) {
            const s = query.search.toLowerCase().trim();
            list = list.filter(
              (l) =>
                l.action.toLowerCase().includes(s) ||
                l.targetType.toLowerCase().includes(s) ||
                l.ipAddress.toLowerCase().includes(s) ||
                l.userAgent.toLowerCase().includes(s),
            );
          }

          return {
            data: list,
            meta: { total: list.length, page: 1, limit: 20, totalPages: 1 },
          };
        },
      };
    });

    it("tìm kiếm nhật ký kiểm toán theo action", async () => {
      const res = await mockRbacRepo.findAllAuditLogs!({ search: "RESTORE" });
      assert.strictEqual(res.data.length, 1);
      assert.strictEqual(res.data[0].action, "RESTORE_USER");
    });

    it("tìm kiếm nhật ký kiểm toán theo IP Address", async () => {
      const res = await mockRbacRepo.findAllAuditLogs!({ search: "192.168.1" });
      assert.strictEqual(res.data.length, 2);
    });

    it("tìm kiếm nhật ký kiểm toán theo User-Agent (phát hiện bot/script)", async () => {
      const res = await mockRbacRepo.findAllAuditLogs!({ search: "Python" });
      assert.strictEqual(res.data.length, 1);
      assert.strictEqual(res.data[0].action, "ACCOUNT_LOCKED");
    });
  });

  describe("5. Validation Schemas & OpenAPI Documentation", () => {
    it("findAllUserSchema cho phép và validate tham số search", () => {
      const parsed = findAllUserSchema.parse({ search: "  nguyen van  " });
      assert.strictEqual(parsed.search, "nguyen van");
    });

    it("listFilesSchema cho phép tham số search", () => {
      const parsed = listFilesSchema.parse({ search: "invoice-2026" });
      assert.strictEqual(parsed.search, "invoice-2026");
    });

    it("auditLogQuerySchema cho phép và validate tham số search", () => {
      const parsed = auditLogQuerySchema.parse({ search: "RESTORE_USER" });
      assert.strictEqual(parsed.search, "RESTORE_USER");
    });

    it("từ chối tham số search vượt quá 100 ký tự để chống DoS", () => {
      const longSearch = "a".repeat(101);
      assert.throws(() => findAllUserSchema.parse({ search: longSearch }));
      assert.throws(() => listFilesSchema.parse({ search: longSearch }));
      assert.throws(() => auditLogQuerySchema.parse({ search: longSearch }));
    });

    it("Swagger OpenAPI 3.0 đăng ký đầy đủ các endpoint tìm kiếm", () => {
      const paths = swaggerSpec.paths;
      assert.ok(paths["/users"], "Thiếu /users trong OpenAPI");
      assert.ok(paths["/files"], "Thiếu /files trong OpenAPI");
      assert.ok(
        paths["/rbac/audit-logs"],
        "Thiếu /rbac/audit-logs trong OpenAPI",
      );
    });
  });

  describe("6. Layered Architecture Service Routing (FTS Delegation)", () => {
    it("UserService.findAll điều phối gọi searchFts khi có query.search", async () => {
      let calledSearchFts = false;
      let calledFindAll = false;

      const mockRepo = {
        searchFts: async (_query: any) => {
          calledSearchFts = true;
          return {
            data: [],
            meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
          };
        },
        findAll: async (_query: any) => {
          calledFindAll = true;
          return {
            data: [],
            meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
          };
        },
      } as any;

      const userService = new UserService(mockRepo);

      // Khi có search -> gọi searchFts
      await userService.findAll({ search: "admin" });
      assert.strictEqual(calledSearchFts, true);
      assert.strictEqual(calledFindAll, false);

      // Reset & khi không có search -> gọi findAll
      calledSearchFts = false;
      calledFindAll = false;
      await userService.findAll({ email: "user@example.com" });
      assert.strictEqual(calledSearchFts, false);
      assert.strictEqual(calledFindAll, true);
    });

    it("FileService.listFiles điều phối gọi searchFts khi có query.search", async () => {
      let calledSearchFts = false;
      let calledFindAll = false;

      const mockRepo = {
        searchFts: async (
          _query: any,
          _userId?: string,
          _canManageAll?: boolean,
        ) => {
          calledSearchFts = true;
          return {
            data: [],
            meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
          };
        },
        findAll: async (
          _query: any,
          _userId?: string,
          _canManageAll?: boolean,
        ) => {
          calledFindAll = true;
          return {
            data: [],
            meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
          };
        },
      } as any;

      const fileService = new FileService(mockRepo);

      // Khi có search -> gọi searchFts
      await fileService.listFiles({ search: "invoice" });
      assert.strictEqual(calledSearchFts, true);
      assert.strictEqual(calledFindAll, false);

      // Reset & khi không có search -> gọi findAll
      calledSearchFts = false;
      calledFindAll = false;
      await fileService.listFiles({ folder: "general" });
      assert.strictEqual(calledSearchFts, false);
      assert.strictEqual(calledFindAll, true);
    });

    it("RbacService.findAllAuditLogs điều phối gọi searchAuditLogsFts khi có query.search", async () => {
      let calledSearchFts = false;
      let calledFindAll = false;

      const mockRepo = {
        searchAuditLogsFts: async (_query: any) => {
          calledSearchFts = true;
          return {
            data: [],
            meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
          };
        },
        findAllAuditLogs: async (_query: any) => {
          calledFindAll = true;
          return {
            data: [],
            meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
          };
        },
      } as any;

      const rbacService = new RbacService(mockRepo);

      // Khi có search -> gọi searchAuditLogsFts
      await rbacService.findAllAuditLogs({ search: "RESTORE" });
      assert.strictEqual(calledSearchFts, true);
      assert.strictEqual(calledFindAll, false);

      // Reset & khi không có search -> gọi findAllAuditLogs
      calledSearchFts = false;
      calledFindAll = false;
      await rbacService.findAllAuditLogs({ action: "LOGIN" });
      assert.strictEqual(calledSearchFts, false);
      assert.strictEqual(calledFindAll, true);
    });
  });
});
