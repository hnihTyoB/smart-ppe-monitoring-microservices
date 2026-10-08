import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FileService } from "../src/modules/files/file.service";
import { FileRepository } from "../src/modules/files/file.repository";
import { R2Service } from "../src/common/services/r2.service";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../src/common/constants/audit-log.constant";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { AppError } from "../src/common/errors/app-error";
import {
  requestUploadUrlSchema,
  confirmUploadSchema,
  fileIdParamSchema,
  listFilesSchema,
} from "../src/modules/files/file.validation";
import { swaggerSpec } from "../src/config/swagger.config";
import { permissionCacheService } from "../src/common/services/permission-cache.service";

describe("Files & Media Storage Module Test Suite", () => {
  let fileService: FileService;
  let mockFileRepo: Partial<FileRepository>;
  let mockR2Service: Partial<R2Service>;
  let mockSystemConfigService: any;
  let auditLogs: Array<any> = [];
  let filesDatabase: Map<string, any> = new Map();
  let deletedR2Keys: string[] = [];

  const ownerUserId = "11111111-1111-1111-1111-111111111111";
  const otherUserId = "22222222-2222-2222-2222-222222222222";
  const adminUserId = "99999999-9999-9999-9999-999999999999";

  beforeEach(() => {
    auditLogs = [];
    filesDatabase.clear();
    deletedR2Keys = [];

    mockR2Service = {
      getPresignedUploadUrl: async (
        key: string,
        contentType: string,
        expiresIn?: number,
      ) => {
        return `https://mock-r2.cloudflarestorage.com/upload/${key}?expires=${expiresIn || 300}&type=${contentType}`;
      },
      getPresignedDownloadUrl: async (
        key: string,
        expiresIn?: number,
        filename?: string,
      ) => {
        return `https://mock-r2.cloudflarestorage.com/download/${key}?expires=${expiresIn || 3600}&fn=${filename || ""}`;
      },
      getPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
      deleteFile: async (key: string) => {
        deletedR2Keys.push(key);
      },
    };

    mockFileRepo = {
      create: async (data: any) => {
        const id =
          "33333333-3333-3333-3333-" +
          String(filesDatabase.size + 1).padStart(12, "0");
        const fileRecord = {
          id,
          userId: data.userId ?? null,
          originalName: data.originalName,
          fileName: data.fileName,
          mimeType: data.mimeType,
          size: data.size ?? 0,
          bucketKey: data.bucketKey,
          folder: data.folder ?? "general",
          isPublic: data.isPublic ?? false,
          isConfirmed: false,
          metadata: data.metadata ?? null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        filesDatabase.set(id, fileRecord);
        return fileRecord as any;
      },
      findById: async (id: string) => {
        const file = filesDatabase.get(id);
        if (!file || file.deletedAt) return null;
        return {
          ...file,
          user: file.userId ? { id: file.userId, fullName: "User Name" } : null,
        } as any;
      },
      confirmUpload: async (id: string, size?: number) => {
        const file = filesDatabase.get(id);
        if (!file) throw new Error("Not found");
        file.isConfirmed = true;
        if (size !== undefined) {
          file.size = size;
        }
        file.updatedAt = new Date();
        filesDatabase.set(id, file);
        return {
          ...file,
          user: file.userId ? { id: file.userId, fullName: "User Name" } : null,
        } as any;
      },
      delete: async (id: string) => {
        const file = filesDatabase.get(id);
        if (file) {
          file.deletedAt = new Date();
          filesDatabase.set(id, file);
        }
        return file as any;
      },
      findAll: async (
        query: any,
        currentUserId?: string,
        canManageAll?: boolean,
      ) => {
        let list = Array.from(filesDatabase.values()).filter(
          (f) => !f.deletedAt && f.isConfirmed,
        );

        // Authorization filter
        if (!canManageAll) {
          list = list.filter(
            (f) => f.isPublic || (currentUserId && f.userId === currentUserId),
          );
        }

        // Folder filter
        if (query.folder) {
          list = list.filter((f) => f.folder === query.folder);
        }

        // isPublic filter
        if (query.isPublic !== undefined) {
          list = list.filter((f) => f.isPublic === query.isPublic);
        }

        // Search
        if (query.search) {
          const s = query.search.toLowerCase();
          list = list.filter(
            (f) =>
              f.fileName.toLowerCase().includes(s) ||
              f.originalName.toLowerCase().includes(s),
          );
        }

        return {
          data: list.map((f) => ({
            ...f,
            user: f.userId ? { id: f.userId, fullName: "User Name" } : null,
          })),
          meta: {
            total: list.length,
            page: query.page ?? 1,
            limit: query.limit ?? 20,
            totalPages: Math.ceil(list.length / (query.limit ?? 20)) || 1,
          },
        } as any;
      },
      createAuditLog: async (log: any) => {
        auditLogs.push(log);
        return log;
      },
    };

    const configStore = new Map<string, any>([
      ["storage.max_file_size_mb", 100],
      [
        "storage.allowed_mime_types",
        [
          "image/*",
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.*",
          "text/plain",
        ],
      ],
      ["storage.upload_expires_seconds", 300],
      ["storage.download_expires_seconds", 3600],
    ]);

    mockSystemConfigService = {
      get: async <T>(key: string, defaultValue?: T): Promise<T> => {
        if (configStore.has(key)) return configStore.get(key);
        return defaultValue as T;
      },
    };

    permissionCacheService.getUserPermissions = async (userId: string) => {
      if (userId === adminUserId) {
        return [
          PERMISSIONS.FILE_MANAGE,
          PERMISSIONS.FILE_READ,
          PERMISSIONS.FILE_UPLOAD,
          PERMISSIONS.FILE_DELETE,
        ];
      }
      return [
        PERMISSIONS.FILE_READ,
        PERMISSIONS.FILE_UPLOAD,
        PERMISSIONS.FILE_DELETE,
      ];
    };

    fileService = new FileService(
      mockFileRepo as FileRepository,
      mockR2Service as R2Service,
      mockSystemConfigService,
    );
  });

  describe("1. Input Validation Schemas & Dynamic System Config", () => {
    it("hợp lệ khi requestUploadUrlSchema nhận tệp tài liệu PDF hợp lệ", () => {
      const valid = requestUploadUrlSchema.safeParse({
        fileName: "Quyet_Dinh_2026.pdf",
        mimeType: "application/pdf",
        folder: "documents",
        isPublic: false,
        size: 512000,
      });
      assert.strictEqual(valid.success, true);
    });

    it("từ chối khi MIME type sai format hoặc tệp vượt quá 100MB ở tầng Zod", () => {
      const invalidMime = requestUploadUrlSchema.safeParse({
        fileName: "malicious.sh",
        mimeType: "invalid-mime-format",
      });
      assert.strictEqual(invalidMime.success, false);

      const tooLarge = requestUploadUrlSchema.safeParse({
        fileName: "big.zip",
        mimeType: "application/zip",
        size: 104857601, // > 100MB
      });
      assert.strictEqual(tooLarge.success, false);
    });

    it("từ chối khi folder chứa ký tự nguy hiểm (path traversal prevention)", () => {
      const invalidFolder = requestUploadUrlSchema.safeParse({
        fileName: "safe.png",
        mimeType: "image/png",
        folder: "../etc/passwd",
      });
      assert.strictEqual(invalidFolder.success, false);
    });

    it("listFilesSchema parse chuỗi isPublic thành boolean hợp lệ", () => {
      const parsedTrue = listFilesSchema.parse({
        isPublic: "true",
        page: "2",
        limit: "10",
      });
      assert.strictEqual(parsedTrue.isPublic, true);
      assert.strictEqual(parsedTrue.page, 2);
      assert.strictEqual(parsedTrue.limit, 10);

      const parsedFalse = listFilesSchema.parse({ isPublic: "false" });
      assert.strictEqual(parsedFalse.isPublic, false);
    });

    it("fileIdParamSchema bắt buộc ID là UUID hợp lệ", () => {
      assert.strictEqual(
        fileIdParamSchema.safeParse({ id: "not-a-uuid" }).success,
        false,
      );
      assert.strictEqual(
        fileIdParamSchema.safeParse({
          id: "550e8400-e29b-41d4-a716-446655440000",
        }).success,
        true,
      );
    });

    it("từ chối khi MIME type không nằm trong danh sách cho phép của system-config", async () => {
      await assert.rejects(
        async () => {
          await fileService.requestUploadUrl({
            fileName: "script.sh",
            mimeType: "application/x-sh",
          });
        },
        (err: any) => {
          assert.strictEqual(err instanceof AppError, true);
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, ERROR_CODE.VALIDATION_ERROR);
          assert.ok(err.message.includes("không được hệ thống hỗ trợ"));
          return true;
        },
      );
    });
  });

  describe("2. Request Presigned Upload URL Flow", () => {
    it("yêu cầu upload URL thành công, tạo FileRecord chưa confirm và ghi AuditLog", async () => {
      const res = await fileService.requestUploadUrl(
        {
          fileName: "Hop Dong Lao Dong 2026.pdf",
          mimeType: "application/pdf",
          folder: "contracts",
          isPublic: false,
          size: 204800,
        },
        ownerUserId,
        { ipAddress: "127.0.0.1", userAgent: "NodeTest" },
      );

      assert.ok(res.fileId);
      assert.ok(res.uploadUrl.includes("contracts/"));
      assert.strictEqual(res.isPublic, false);
      assert.strictEqual(res.expiresIn, 300);

      // Kiểm tra DB lưu trữ
      const saved = filesDatabase.get(res.fileId);
      assert.ok(saved);
      assert.strictEqual(saved.userId, ownerUserId);
      assert.strictEqual(saved.isConfirmed, false);
      assert.strictEqual(saved.originalName, "Hop Dong Lao Dong 2026.pdf");

      // Kiểm tra Audit Log
      assert.strictEqual(auditLogs.length, 1);
      assert.strictEqual(auditLogs[0].action, AUDIT_ACTION.REQUEST_FILE_UPLOAD);
      assert.strictEqual(auditLogs[0].targetType, AUDIT_TARGET_TYPE.FILE);
      assert.strictEqual(auditLogs[0].actorId, ownerUserId);
    });
  });

  describe("3. Confirm Upload Flow", () => {
    it("chủ sở hữu xác nhận tải tệp thành công và ghi AuditLog", async () => {
      const requested = await fileService.requestUploadUrl(
        {
          fileName: "avatar.jpg",
          mimeType: "image/jpeg",
          folder: "avatars",
          isPublic: true,
        },
        ownerUserId,
      );

      const confirmed = await fileService.confirmUpload(
        requested.fileId,
        { size: 10240 },
        ownerUserId,
        { ipAddress: "127.0.0.1", userAgent: "NodeTest" },
      );

      assert.strictEqual(confirmed.isConfirmed, true);
      assert.strictEqual(confirmed.size, 10240);
      assert.strictEqual(
        confirmed.url,
        "https://cdn.example.com/" + confirmed.bucketKey,
      );

      // Audit Log được bổ sung CONFIRM_FILE_UPLOAD
      const confirmLog = auditLogs.find(
        (l) => l.action === AUDIT_ACTION.CONFIRM_FILE_UPLOAD,
      );
      assert.ok(confirmLog);
      assert.strictEqual(confirmLog.actorId, ownerUserId);
      assert.strictEqual(confirmLog.targetId, requested.fileId);
    });

    it("từ chối xác nhận lại tệp đã được confirm trước đó (HTTP 400 BAD_REQUEST)", async () => {
      const requested = await fileService.requestUploadUrl(
        {
          fileName: "double_confirm.pdf",
          mimeType: "application/pdf",
        },
        ownerUserId,
      );

      await fileService.confirmUpload(requested.fileId, {}, ownerUserId);

      await assert.rejects(
        async () =>
          fileService.confirmUpload(requested.fileId, {}, ownerUserId),
        (err: any) => {
          assert.strictEqual(err instanceof AppError, true);
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, ERROR_CODE.BAD_REQUEST);
          return true;
        },
      );
    });

    it("chặn người dùng khác xác nhận tệp không thuộc sở hữu của mình (HTTP 403)", async () => {
      const requested = await fileService.requestUploadUrl(
        {
          fileName: "private_doc.pdf",
          mimeType: "application/pdf",
        },
        ownerUserId,
      );

      await assert.rejects(
        async () => {
          await fileService.confirmUpload(requested.fileId, {}, otherUserId);
        },
        (err: any) => {
          assert.strictEqual(err instanceof AppError, true);
          assert.strictEqual(err.statusCode, 403);
          assert.strictEqual(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );
    });

    it("từ chối xác nhận tệp khi dung lượng vượt quá giới hạn động của system-config", async () => {
      const requested = await fileService.requestUploadUrl(
        {
          fileName: "oversized.pdf",
          mimeType: "application/pdf",
        },
        ownerUserId,
      );

      await assert.rejects(
        async () =>
          fileService.confirmUpload(
            requested.fileId,
            { size: 105 * 1024 * 1024 }, // 105MB > 100MB
            ownerUserId,
          ),
        (err: any) => {
          assert.strictEqual(err instanceof AppError, true);
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, ERROR_CODE.VALIDATION_ERROR);
          return true;
        },
      );
    });
  });

  describe("4. File Access Control & Presigned Download URL", () => {
    let privateFileId: string;
    let publicFileId: string;

    beforeEach(async () => {
      const priv = await fileService.requestUploadUrl(
        {
          fileName: "salary_slips.pdf",
          mimeType: "application/pdf",
          isPublic: false,
        },
        ownerUserId,
      );
      privateFileId = priv.fileId;
      await fileService.confirmUpload(privateFileId, {}, ownerUserId);

      const pub = await fileService.requestUploadUrl(
        {
          fileName: "company_brochure.pdf",
          mimeType: "application/pdf",
          isPublic: true,
        },
        ownerUserId,
      );
      publicFileId = pub.fileId;
      await fileService.confirmUpload(publicFileId, {}, ownerUserId);
    });

    it("cho phép bất kỳ ai xem chi tiết tệp public và không làm rò email người dùng", async () => {
      const file = await fileService.getFileById(publicFileId, undefined, []);
      assert.strictEqual(file.id, publicFileId);
      assert.ok(file.url?.startsWith("https://cdn.example.com/"));
      // Đảm bảo không chứa trường email trong object user
      assert.strictEqual((file.user as any)?.email, undefined);
    });

    it("chặn người dùng khác và khách vãng lai xem tệp private (HTTP 401 cho khách, 403 cho user khác)", async () => {
      // Khách vãng lai: yêu cầu 401 UNAUTHORIZED
      await assert.rejects(
        async () => fileService.getFileById(privateFileId, undefined, []),
        (err: any) =>
          err.statusCode === 401 && err.code === ERROR_CODE.UNAUTHORIZED,
      );

      // User khác có FILE_READ nhưng không phải chủ sở hữu: 403 FORBIDDEN
      await assert.rejects(
        async () => fileService.getFileById(privateFileId, otherUserId, []),
        (err: any) =>
          err.statusCode === 403 && err.code === ERROR_CODE.FORBIDDEN,
      );
    });

    it("chặn khách vãng lai và user khác tạo presigned download URL của tệp private (HTTP 401 / 403)", async () => {
      // Khách vãng lai: 401 UNAUTHORIZED
      await assert.rejects(
        async () =>
          fileService.getPresignedDownloadUrl(privateFileId, undefined, []),
        (err: any) =>
          err.statusCode === 401 && err.code === ERROR_CODE.UNAUTHORIZED,
      );

      // User khác: 403 FORBIDDEN
      await assert.rejects(
        async () =>
          fileService.getPresignedDownloadUrl(privateFileId, otherUserId, []),
        (err: any) =>
          err.statusCode === 403 && err.code === ERROR_CODE.FORBIDDEN,
      );
    });

    it("chủ sở hữu xem được tệp private của chính mình", async () => {
      const file = await fileService.getFileById(
        privateFileId,
        ownerUserId,
        [],
      );
      assert.strictEqual(file.id, privateFileId);
      assert.strictEqual(file.isPublic, false);
    });

    it("quản trị viên xem được tệp private của người khác ngay cả khi permissions rỗng (tự nạp quyền)", async () => {
      // Truyền permissions = [] mô phỏng HTTP runtime không có middleware nạp sẵn
      const file = await fileService.getFileById(
        privateFileId,
        adminUserId,
        [],
      );
      assert.strictEqual(file.id, privateFileId);
    });

    it("tạo presigned download URL (GET) có chữ ký thời hạn cho tệp private đã xác nhận", async () => {
      const res = await fileService.getPresignedDownloadUrl(
        privateFileId,
        ownerUserId,
        [],
      );
      assert.ok(
        res.downloadUrl.includes("mock-r2.cloudflarestorage.com/download/"),
      );
      assert.strictEqual(res.expiresIn, 3600);
      assert.ok(res.fileName.includes("salary_slips.pdf"));
    });

    it("từ chối tạo presigned download URL khi tệp chưa được xác nhận tải lên", async () => {
      const unconfirmed = await fileService.requestUploadUrl(
        {
          fileName: "unconfirmed.pdf",
          mimeType: "application/pdf",
        },
        ownerUserId,
      );

      await assert.rejects(
        async () =>
          fileService.getPresignedDownloadUrl(
            unconfirmed.fileId,
            ownerUserId,
            [],
          ),
        (err: any) => {
          assert.strictEqual(err instanceof AppError, true);
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, ERROR_CODE.BAD_REQUEST);
          return true;
        },
      );
    });

    it("báo lỗi 404 FILE_NOT_FOUND khi truy vấn tệp không tồn tại", async () => {
      await assert.rejects(
        async () =>
          fileService.getFileById("00000000-0000-0000-0000-000000000000"),
        (err: any) =>
          err.statusCode === 404 && err.code === ERROR_CODE.FILE_NOT_FOUND,
      );
    });
  });

  describe("5. Delete File Flow & Soft Delete", () => {
    it("chủ sở hữu xóa tệp thành công, xóa object trên R2, soft delete DB và ghi AuditLog", async () => {
      const req = await fileService.requestUploadUrl(
        {
          fileName: "temp_doc.pdf",
          mimeType: "application/pdf",
        },
        ownerUserId,
      );
      await fileService.confirmUpload(req.fileId, {}, ownerUserId);

      const keyToDelete = filesDatabase.get(req.fileId).bucketKey;

      await fileService.deleteFile(req.fileId, ownerUserId, [], {
        ipAddress: "127.0.0.1",
        userAgent: "NodeTest",
      });

      // Bản ghi bị soft delete (deletedAt khác null)
      assert.ok(filesDatabase.get(req.fileId)?.deletedAt);
      // Đã gọi R2 deleteFile
      assert.ok(deletedR2Keys.includes(keyToDelete));

      // Không còn tìm thấy qua findById
      const notFound = await mockFileRepo.findById!(req.fileId);
      assert.strictEqual(notFound, null);

      // Audit Log ghi nhận DELETE_FILE
      const delLog = auditLogs.find(
        (l) => l.action === AUDIT_ACTION.DELETE_FILE,
      );
      assert.ok(delLog);
      assert.strictEqual(delLog.targetId, req.fileId);
      assert.strictEqual(delLog.actorId, ownerUserId);
    });

    it("chặn người dùng khác xóa tệp của người khác ngay cả khi có quyền FILE_DELETE (chỉ FILE_MANAGE mới xóa được tệp người khác)", async () => {
      const req = await fileService.requestUploadUrl(
        {
          fileName: "protected_doc.pdf",
          mimeType: "application/pdf",
        },
        ownerUserId,
      );

      // otherUserId có FILE_DELETE nhưng không phải chủ sở hữu và không có FILE_MANAGE -> 403
      await assert.rejects(
        async () => fileService.deleteFile(req.fileId, otherUserId, []),
        (err: any) =>
          err.statusCode === 403 && err.code === ERROR_CODE.FORBIDDEN,
      );

      // Quản trị viên xóa được dù permissions rỗng (tự nạp quyền FILE_MANAGE)
      await fileService.deleteFile(req.fileId, adminUserId, []);
      assert.ok(filesDatabase.get(req.fileId)?.deletedAt);
    });

    it("chặn chủ sở hữu xóa tệp nếu đã bị thu hồi quyền FILE_DELETE (HTTP 403)", async () => {
      const req = await fileService.requestUploadUrl(
        {
          fileName: "owner_doc.pdf",
          mimeType: "application/pdf",
        },
        ownerUserId,
      );

      // Chủ sở hữu bị thu hồi quyền FILE_DELETE (chỉ còn FILE_READ)
      await assert.rejects(
        async () =>
          fileService.deleteFile(req.fileId, ownerUserId, [
            PERMISSIONS.FILE_READ,
          ]),
        (err: any) =>
          err.statusCode === 403 && err.code === ERROR_CODE.FORBIDDEN,
      );
    });
  });

  describe("6. List Files & Scoping", () => {
    beforeEach(async () => {
      // User 1 tải 1 public, 1 private
      const f1 = await fileService.requestUploadUrl(
        {
          fileName: "public-photo.jpg",
          mimeType: "image/jpeg",
          folder: "photos",
          isPublic: true,
        },
        ownerUserId,
      );
      await fileService.confirmUpload(f1.fileId, {}, ownerUserId);

      const f2 = await fileService.requestUploadUrl(
        {
          fileName: "private-cv.pdf",
          mimeType: "application/pdf",
          folder: "hr",
          isPublic: false,
        },
        ownerUserId,
      );
      await fileService.confirmUpload(f2.fileId, {}, ownerUserId);

      // User 2 tải 1 private
      const f3 = await fileService.requestUploadUrl(
        {
          fileName: "other-secret.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          folder: "secret",
          isPublic: false,
        },
        otherUserId,
      );
      await fileService.confirmUpload(f3.fileId, {}, otherUserId);
    });

    it("người dùng bình thường chỉ nhìn thấy tệp public và tệp riêng của chính mình", async () => {
      const res = await fileService.listFiles({}, ownerUserId, []);
      // Thấy public-photo.jpg và private-cv.pdf, KHÔNG thấy other-secret.docx
      assert.strictEqual(res.data.length, 2);
      const fileNames = res.data.map((d: any) => d.originalName);
      assert.ok(fileNames.includes("public-photo.jpg"));
      assert.ok(fileNames.includes("private-cv.pdf"));
      assert.strictEqual(fileNames.includes("other-secret.docx"), false);
    });

    it("tìm kiếm không làm rò rỉ tệp riêng tư của người dùng khác (chống lỗi ghi đè OR filter)", async () => {
      // ownerUserId tìm kiếm từ khóa "secret" (thuộc tệp private của otherUserId)
      const res = await fileService.listFiles(
        { search: "secret" },
        ownerUserId,
        [],
      );
      assert.strictEqual(
        res.data.length,
        0,
        "Không được nhìn thấy other-secret.docx khi tìm kiếm",
      );

      // ownerUserId tìm kiếm từ khóa "cv" (thuộc tệp của mình)
      const resCv = await fileService.listFiles(
        { search: "cv" },
        ownerUserId,
        [],
      );
      assert.strictEqual(resCv.data.length, 1);
      assert.strictEqual(resCv.data[0].originalName, "private-cv.pdf");
    });

    it("quản trị viên nhìn thấy toàn bộ tệp của tất cả người dùng (tự nạp quyền qua userId)", async () => {
      const res = await fileService.listFiles({}, adminUserId, []);
      assert.strictEqual(res.data.length, 3);
    });
  });

  describe("7. OpenAPI 3.0 Documentation Registration", () => {
    it("đăng ký đầy đủ toàn bộ endpoint /files trong Swagger OpenAPI Spec", () => {
      const paths = swaggerSpec.paths;
      assert.ok(
        paths["/files/upload-url"],
        "Thiếu /files/upload-url trong OpenAPI",
      );
      assert.ok(
        paths["/files/{id}/confirm"],
        "Thiếu /files/{id}/confirm trong OpenAPI",
      );
      assert.ok(paths["/files"], "Thiếu /files trong OpenAPI");
      assert.ok(paths["/files/{id}"], "Thiếu /files/{id} trong OpenAPI");
      assert.ok(
        paths["/files/{id}/download-url"],
        "Thiếu /files/{id}/download-url trong OpenAPI",
      );
      assert.ok(
        paths["/files/{id}/download"],
        "Thiếu /files/{id}/download trong OpenAPI",
      );
    });
  });
});
