/**
 * Phase 6: Media & File Storage Microservice Test Suite
 *
 * Kiểm thử toàn diện kiến trúc bóc tách Microservice thứ hai (Media Service):
 * 1. ImageProcessingService với Sharp (validate buffer, resize, avatar WebP, thumbnail, MIME check)
 * 2. R2Service Buffer Operations (uploadBuffer, getObjectBuffer)
 * 3. Media Microservice Express App (mediaApp, /health, dual-mount, Request ID, upload-image)
 * 4. Image Transformation & Reference Key Integration
 * 5. Orphan & Stale Files Cleanup Engine & StorageCleanupSubscriber
 * 6. Infrastructure & Traefik Routing Configuration (docker-compose, dev overrides, package scripts)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import {
  imageProcessingService,
  ImageProcessingService,
} from "../src/common/services/image-processing.service";
import {
  IMAGE_FORMAT,
  IMAGE_FIT,
  MEDIA_LIMITS,
  MEDIA_FOLDER,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "../src/common/constants/media.constant";
import { R2Service } from "../src/common/services/r2.service";
import { FileService } from "../src/modules/files/file.service";
import { FileRepository } from "../src/modules/files/file.repository";
import { envConfig } from "../src/config/env.config";
import mediaApp from "../src/media.app";
import {
  StorageCleanupSubscriber,
  storageCleanupSubscriber,
} from "../src/common/subscribers/storage-cleanup.subscriber";
import { eventBus } from "../src/common/services/event-bus.service";
import { EVENT_NAMES } from "../src/common/constants/event.constant";
import { jwtKeyService } from "../src/common/services/jwt-key.service";

describe("Phase 6: Media & File Storage Microservice Test Suite", () => {
  let samplePngBuffer: Buffer;
  let sampleJpegBuffer: Buffer;
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    // 1. Tạo buffer ảnh mẫu hợp lệ trong RAM bằng Sharp (100x100 đỏ)
    samplePngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    sampleJpegBuffer = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: { r: 0, g: 128, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();

    // 2. Khởi động ephemeral test server cho mediaApp
    await new Promise<void>((resolve) => {
      server = http.createServer(mediaApp);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. ImageProcessingService với Sharp
  // ─────────────────────────────────────────────────────────────────────────────
  describe("1. ImageProcessingService with Sharp Engine", () => {
    it("1.1 validateImageBuffer phải xác thực buffer hợp lệ và trả về metadata chính xác", async () => {
      const res =
        await imageProcessingService.validateImageBuffer(samplePngBuffer);
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.metadata.format, "png");
      assert.strictEqual(res.metadata.width, 100);
      assert.strictEqual(res.metadata.height, 100);
      assert.strictEqual(res.metadata.hasAlpha, true);
    });

    it("1.2 validateImageBuffer phải từ chối buffer rỗng hoặc dữ liệu không phải ảnh", async () => {
      await assert.rejects(
        () => imageProcessingService.validateImageBuffer(Buffer.alloc(0)),
        (err: any) => err.code === "VALIDATION_ERROR",
      );

      const fakeBuffer = Buffer.from("this is not an image file content");
      await assert.rejects(
        () => imageProcessingService.validateImageBuffer(fakeBuffer),
        (err: any) => err.code === "VALIDATION_ERROR",
      );
    });

    it("1.3 processImage phải biến đổi kích thước và chuyển định dạng sang WebP thành công", async () => {
      const result = await imageProcessingService.processImage(
        sampleJpegBuffer,
        {
          width: 60,
          height: 40,
          format: IMAGE_FORMAT.WEBP,
          quality: 80,
        },
      );

      assert.ok(Buffer.isBuffer(result.buffer));
      assert.strictEqual(result.info.format, "webp");
      assert.strictEqual(result.info.width, 60);
      assert.strictEqual(result.info.height, 40);
      assert.strictEqual(result.info.mimeType, "image/webp");

      // Verify metadata của output buffer
      const meta = await sharp(result.buffer).metadata();
      assert.strictEqual(meta.format, "webp");
      assert.strictEqual(meta.width, 60);
      assert.strictEqual(meta.height, 40);
    });

    it("1.4 processImage phải hỗ trợ chuyển đổi sang JPEG, PNG và AVIF", async () => {
      const jpegResult = await imageProcessingService.processImage(
        samplePngBuffer,
        {
          format: IMAGE_FORMAT.JPEG,
        },
      );
      assert.strictEqual(jpegResult.info.format, "jpeg");
      assert.strictEqual(jpegResult.info.mimeType, "image/jpeg");

      const pngResult = await imageProcessingService.processImage(
        sampleJpegBuffer,
        {
          format: IMAGE_FORMAT.PNG,
        },
      );
      assert.strictEqual(pngResult.info.format, "png");
      assert.strictEqual(pngResult.info.mimeType, "image/png");

      const avifResult = await imageProcessingService.processImage(
        samplePngBuffer,
        {
          format: IMAGE_FORMAT.AVIF,
        },
      );
      assert.strictEqual(avifResult.info.format, "avif");
      assert.strictEqual(avifResult.info.mimeType, "image/avif");
    });

    it("1.5 generateAvatar phải tạo ảnh vuông 256x256 WebP chất lượng tối ưu", async () => {
      const avatar =
        await imageProcessingService.generateAvatar(sampleJpegBuffer);
      assert.strictEqual(avatar.info.format, "webp");
      assert.strictEqual(avatar.info.width, MEDIA_LIMITS.DEFAULT_AVATAR_SIZE);
      assert.strictEqual(avatar.info.height, MEDIA_LIMITS.DEFAULT_AVATAR_SIZE);
      assert.strictEqual(avatar.info.mimeType, "image/webp");
    });

    it("1.6 generateThumbnail phải tạo ảnh thu nhỏ với fit inside và WebP", async () => {
      const thumb = await imageProcessingService.generateThumbnail(
        sampleJpegBuffer,
        50,
        50,
      );
      assert.strictEqual(thumb.info.format, "webp");
      assert.ok(thumb.info.width <= 50);
      assert.ok(thumb.info.height <= 50);
    });

    it("1.7 isSupportedImageMime phải nhận diện chính xác MIME types được hỗ trợ", () => {
      assert.strictEqual(
        imageProcessingService.isSupportedImageMime("image/jpeg"),
        true,
      );
      assert.strictEqual(
        imageProcessingService.isSupportedImageMime("image/png"),
        true,
      );
      assert.strictEqual(
        imageProcessingService.isSupportedImageMime("image/webp"),
        true,
      );
      assert.strictEqual(
        imageProcessingService.isSupportedImageMime("image/avif"),
        true,
      );
      assert.strictEqual(
        imageProcessingService.isSupportedImageMime("application/pdf"),
        false,
      );
      assert.strictEqual(
        imageProcessingService.isSupportedImageMime("text/plain"),
        false,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. R2Service Buffer Operations
  // ─────────────────────────────────────────────────────────────────────────────
  describe("2. R2Service Buffer Operations", () => {
    it("2.1 uploadBuffer và getObjectBuffer phải là các hàm được định nghĩa trên R2Service", () => {
      const r2Service = new R2Service();
      assert.strictEqual(typeof r2Service.uploadBuffer, "function");
      assert.strictEqual(typeof r2Service.getObjectBuffer, "function");
    });

    it("2.2 uploadBuffer phải gửi PutObjectCommand với buffer và contentType", async () => {
      const mockClient = {
        send: async (cmd: any) => {
          assert.strictEqual(cmd.input.Bucket, "test-bucket");
          assert.strictEqual(cmd.input.Key, "test-key.webp");
          assert.strictEqual(cmd.input.ContentType, "image/webp");
          assert.deepStrictEqual(cmd.input.Body, samplePngBuffer);
          return {};
        },
      };

      const customR2 = new R2Service();
      (customR2 as any).client = mockClient;
      (customR2 as any).bucketName = "test-bucket";

      const res = await customR2.uploadBuffer(
        "test-key.webp",
        samplePngBuffer,
        "image/webp",
      );
      assert.strictEqual(res.key, "test-key.webp");
      assert.strictEqual(res.size, samplePngBuffer.length);
    });

    it("2.3 getObjectBuffer phải nạp buffer đầy đủ từ S3 stream response", async () => {
      const mockClient = {
        send: async () => ({
          Body: {
            transformToByteArray: async () => new Uint8Array(sampleJpegBuffer),
          },
        }),
      };

      const customR2 = new R2Service();
      (customR2 as any).client = mockClient;

      const loadedBuffer = await customR2.getObjectBuffer("some-key.jpg");
      assert.deepStrictEqual(loadedBuffer, sampleJpegBuffer);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Media Microservice Express App (mediaApp)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("3. Media Microservice Express App (mediaApp)", () => {
    it("3.1 GET /health phải trả về 200 OK với thông tin media-service", async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert.strictEqual(res.status, 200);

      const body = (await res.json()) as any;
      assert.strictEqual(body.status, "ok");
      assert.strictEqual(body.service, "media-service");
      assert.ok(body.timestamp);
      assert.ok(typeof body.uptime === "number");
    });

    it("3.2 GET /api/v1/files/health và /files/health phải trả về 200 OK cho loadbalancer", async () => {
      const res1 = await fetch(`${baseUrl}/api/v1/files/health`);
      assert.strictEqual(res1.status, 200);
      const body1 = (await res1.json()) as any;
      assert.strictEqual(body1.service, "media-service");

      const res2 = await fetch(`${baseUrl}/files/health`);
      assert.strictEqual(res2.status, 200);
      const body2 = (await res2.json()) as any;
      assert.strictEqual(body2.service, "media-service");
    });

    it("3.3 mediaApp phải tự động gắn header X-Request-Id vào response", async () => {
      const res = await fetch(`${baseUrl}/health`);
      const reqId = res.headers.get("x-request-id");
      assert.ok(reqId, "Response phải có header X-Request-Id");
      assert.ok(reqId.length > 10, "X-Request-Id phải là identifier hợp lệ");
    });

    it("3.4 Yêu cầu không có token đến /api/v1/files/upload-image phải bị chặn 401 Unauthorized", async () => {
      const res = await fetch(`${baseUrl}/api/v1/files/upload-image`, {
        method: "POST",
      });
      assert.strictEqual(res.status, 401);

      const body = (await res.json()) as any;
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.code, "UNAUTHORIZED");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. FileService Image Processing & Transformation Integration
  // ─────────────────────────────────────────────────────────────────────────────
  describe("4. FileService Image Processing & Direct Upload", () => {
    it("4.1 uploadAndProcessImage phải nén ảnh sang WebP, upload lên R2 và tạo FileRecord với metadata", async () => {
      let uploadedKey = "";
      let uploadedContentType = "";
      let createdRecord: any = null;

      const mockR2 = {
        uploadBuffer: async (
          key: string,
          buffer: Buffer,
          contentType: string,
        ) => {
          uploadedKey = key;
          uploadedContentType = contentType;
          return { key, size: buffer.length };
        },
        getPublicUrl: (key: string) => `https://r2.example.com/${key}`,
      } as any;

      const mockRepo = {
        createDirectFile: async (data: any) => {
          createdRecord = {
            id: "file-test-1",
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return createdRecord;
        },
        createAuditLog: async () => {},
      } as any;

      const customFileService = new FileService(mockRepo, mockR2);

      const result = await customFileService.uploadAndProcessImage(
        {
          buffer: samplePngBuffer,
          originalname: "avatar_raw.png",
          mimetype: "image/png",
          size: samplePngBuffer.length,
        },
        {
          folder: MEDIA_FOLDER.AVATARS,
          width: 80,
          height: 80,
          isPublic: true,
        },
        "usr-1",
        ["FILE_UPLOAD"],
      );

      assert.strictEqual(result.id, "file-test-1");
      assert.strictEqual(result.mimeType, "image/webp");
      assert.strictEqual(uploadedContentType, "image/webp");
      assert.ok(uploadedKey.startsWith("avatars/usr-1/"));
      assert.ok(uploadedKey.endsWith(".webp"));
      assert.ok(result.metadata);
      assert.strictEqual((result.metadata as any).format, "webp");
      assert.strictEqual((result.metadata as any).width, 80);
      assert.strictEqual((result.metadata as any).height, 80);
      assert.ok(result.url?.includes("https://r2.example.com/"));
    });

    it("4.2 transformExistingImage với saveAsNew=true phải đọc ảnh gốc và lưu thành variant mới", async () => {
      const mockFileRecord = {
        id: "orig-1",
        userId: "usr-1",
        originalName: "photo.jpg",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        bucketKey: "images/usr-1/photo.jpg",
        folder: "images",
        isPublic: true,
      };

      const mockRepo = {
        findById: async (id: string) =>
          id === "orig-1" ? mockFileRecord : null,
        createDirectFile: async (data: any) => ({
          id: "trans-1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        createAuditLog: async () => {},
      } as any;

      const mockR2 = {
        getObjectBuffer: async () => sampleJpegBuffer,
        uploadBuffer: async (k: string, b: Buffer) => ({
          key: k,
          size: b.length,
        }),
        getPublicUrl: (k: string) => `https://r2.example.com/${k}`,
      } as any;

      const customFileService = new FileService(mockRepo, mockR2);

      const res = (await customFileService.transformExistingImage(
        "orig-1",
        {
          width: 50,
          height: 50,
          format: IMAGE_FORMAT.WEBP,
          saveAsNew: true,
        },
        "usr-1",
        ["FILE_UPLOAD"],
      )) as any;

      assert.strictEqual(res.id, "trans-1");
      assert.strictEqual(res.mimeType, "image/webp");
      assert.ok(res.originalName.includes("transformed_"));
    });

    it("4.3 transformExistingImage không có saveAsNew phải trả về raw processed buffer", async () => {
      const mockFileRecord = {
        id: "orig-2",
        userId: "usr-1",
        mimeType: "image/jpeg",
        bucketKey: "images/usr-1/photo2.jpg",
        folder: "images",
        isPublic: true,
      };

      const mockRepo = {
        findById: async () => mockFileRecord,
      } as any;

      const mockR2 = {
        getObjectBuffer: async () => sampleJpegBuffer,
      } as any;

      const customFileService = new FileService(mockRepo, mockR2);

      const res = (await customFileService.transformExistingImage(
        "orig-2",
        { width: 40, height: 40, format: IMAGE_FORMAT.WEBP },
        "usr-1",
        ["FILE_READ"],
      )) as any;

      assert.ok(Buffer.isBuffer(res.buffer));
      assert.strictEqual(res.info.format, "webp");
      assert.strictEqual(res.info.width, 40);
      assert.strictEqual(res.info.height, 40);
    });

    it("4.4 transformExistingImage phải chặn anonymous user khi saveAsNew=true (chống BOLA & DoS)", async () => {
      const mockFileRecord = {
        id: "orig-anon",
        userId: null,
        mimeType: "image/jpeg",
        bucketKey: "images/public/photo.jpg",
        folder: "images",
        isPublic: true,
      };
      const mockRepo = {
        findById: async () => mockFileRecord,
      } as any;
      const mockR2 = {
        getObjectBuffer: async () => sampleJpegBuffer,
      } as any;
      const customFileService = new FileService(mockRepo, mockR2);

      await assert.rejects(
        async () => {
          await customFileService.transformExistingImage("orig-anon", {
            saveAsNew: true,
          });
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 401);
          assert.strictEqual(err.code, "UNAUTHORIZED");
          return true;
        },
      );
    });

    it("4.5 transformExistingImage phải từ chối xử lý tệp tin không phải ảnh (Fast-Fail)", async () => {
      const mockDocRecord = {
        id: "doc-1",
        userId: "usr-1",
        mimeType: "application/pdf",
        bucketKey: "documents/usr-1/manual.pdf",
        folder: "documents",
        isPublic: true,
      };
      const mockRepo = {
        findById: async () => mockDocRecord,
      } as any;
      const mockR2 = {
        getObjectBuffer: async () => {
          throw new Error("Should not be called");
        },
      } as any;
      const customFileService = new FileService(mockRepo, mockR2);

      await assert.rejects(
        async () => {
          await customFileService.transformExistingImage(
            "doc-1",
            { width: 100 },
            "usr-1",
            ["FILE_UPLOAD"],
          );
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, "VALIDATION_ERROR");
          return true;
        },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Orphan & Stale Files Cleanup Engine
  // ─────────────────────────────────────────────────────────────────────────────
  describe("5. Orphan & Stale Files Cleanup Engine", () => {
    it("5.1 cleanupOrphanFiles phải xóa files khỏi R2 và hard-delete các bản ghi DB", async () => {
      const deletedR2Keys: string[] = [];
      const hardDeletedIds: string[] = [];

      const mockRepo = {
        findUnconfirmedOlderThan: async () => [
          { id: "unconf-1", bucketKey: "general/unconf-1.pdf" },
          { id: "unconf-2", bucketKey: "general/unconf-2.png" },
        ],
        findSoftDeletedOlderThan: async () => [
          { id: "soft-1", bucketKey: "general/soft-1.jpg" },
        ],
        hardDeleteMany: async (ids: string[]) => {
          hardDeletedIds.push(...ids);
          return { count: ids.length };
        },
        createAuditLog: async () => {},
      } as any;

      const mockR2 = {
        deleteFiles: async (keys: string[]) => {
          deletedR2Keys.push(...keys);
        },
      } as any;

      const customFileService = new FileService(mockRepo, mockR2);

      const result = await customFileService.cleanupOrphanFiles(24, 30);
      assert.strictEqual(result.unconfirmedCleaned, 2);
      assert.strictEqual(result.softDeletedCleaned, 1);
      assert.deepStrictEqual(deletedR2Keys, [
        "general/unconf-1.pdf",
        "general/unconf-2.png",
        "general/soft-1.jpg",
      ]);
      assert.deepStrictEqual(hardDeletedIds, [
        "unconf-1",
        "unconf-2",
        "soft-1",
      ]);
      assert.ok(result.cleanedAt);
    });

    it("5.2 StorageCleanupSubscriber phải lưu trữ metadata unconfirmed uploads an toàn", async () => {
      const customBus = new (eventBus.constructor as any)();
      const subscriber = new StorageCleanupSubscriber(customBus);
      subscriber.register();

      await customBus.publish(EVENT_NAMES.FILE_UPLOADED_UNCONFIRMED, {
        fileId: "test-unconfirmed-file-id",
        key: "avatars/usr-1/unconfirmed.webp",
        bucket: "my-bucket",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const tracked = subscriber.getTrackedFiles();
      assert.ok(tracked.some((f) => f.fileId === "test-unconfirmed-file-id"));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Infrastructure & Traefik Routing Configuration
  // ─────────────────────────────────────────────────────────────────────────────
  describe("6. Infrastructure & Traefik Routing Configuration", () => {
    const rootDir = join(__dirname, "..");

    it("6.1 docker-compose.yml phải chứa service media-service với cấu hình mạng nội bộ", () => {
      const dockerComposePath = join(rootDir, "docker-compose.yml");
      assert.ok(
        existsSync(dockerComposePath),
        "docker-compose.yml phải tồn tại",
      );

      const content = readFileSync(dockerComposePath, "utf-8");
      assert.ok(
        content.includes("media-service:"),
        "docker-compose.yml phải định nghĩa service media-service",
      );
      assert.ok(
        content.includes("dist/media.server.js"),
        "media-service phải chạy dist/media.server.js",
      );
      assert.ok(
        content.includes("MEDIA_PORT"),
        "media-service phải nhận biến MEDIA_PORT",
      );
      assert.ok(
        content.includes("MEDIA_SERVICE_STANDALONE"),
        "media-service phải nhận biến MEDIA_SERVICE_STANDALONE",
      );
    });

    it("6.2 docker-compose.yml phải cấu hình Traefik routing cho files với priority 100", () => {
      const content = readFileSync(
        join(rootDir, "docker-compose.yml"),
        "utf-8",
      );

      assert.ok(
        content.includes(
          "traefik.http.routers.media.rule=PathPrefix(`/api/v1/files`)",
        ),
        "Traefik phải route PathPrefix(/api/v1/files) tới media service",
      );
      assert.ok(
        content.includes("traefik.http.routers.media.priority=100"),
        "Router media phải có priority 100",
      );
      assert.ok(
        content.includes(
          "traefik.http.services.media.loadbalancer.server.port=${MEDIA_PORT:-8890}",
        ),
        "Loadbalancer server port phải là 8890",
      );
      assert.ok(
        content.includes(
          "traefik.http.services.media.loadbalancer.healthcheck.path=/health",
        ),
        "Healthcheck path phải là /health",
      );
    });

    it("6.3 docker-compose.dev.yml phải chứa override cho media-service với hot-reload", () => {
      const devComposePath = join(rootDir, "docker-compose.dev.yml");
      assert.ok(
        existsSync(devComposePath),
        "docker-compose.dev.yml phải tồn tại",
      );

      const content = readFileSync(devComposePath, "utf-8");
      assert.ok(
        content.includes("media-service:"),
        "docker-compose.dev.yml phải có override cho media-service",
      );
      assert.ok(
        content.includes("pnpm") && content.includes("dev:media"),
        "media-service trong dev phải chạy pnpm dev:media",
      );
    });

    it("6.4 package.json phải chứa script dev:media và start:media", () => {
      const pkgPath = join(rootDir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

      assert.ok(
        pkg.scripts["dev:media"],
        "package.json phải có script dev:media",
      );
      assert.ok(
        pkg.scripts["start:media"],
        "package.json phải có script start:media",
      );
      assert.ok(
        pkg.scripts["dev:media"].includes("src/media.server.ts"),
        "dev:media phải chạy src/media.server.ts",
      );
      assert.ok(
        pkg.scripts["start:media"].includes("dist/media.server.js"),
        "start:media phải chạy dist/media.server.js",
      );
    });

    it("6.5 .env.example và envConfig phải tài liệu hóa các biến cấu hình của Media Service", () => {
      const envExamplePath = join(rootDir, ".env.example");
      const content = readFileSync(envExamplePath, "utf-8");

      assert.ok(
        content.includes("MEDIA_PORT"),
        ".env.example phải chứa MEDIA_PORT",
      );
      assert.ok(
        content.includes("MEDIA_SERVICE_STANDALONE"),
        ".env.example phải chứa MEDIA_SERVICE_STANDALONE",
      );
      assert.ok(
        content.includes("MEDIA_SERVICE_URL"),
        ".env.example phải chứa MEDIA_SERVICE_URL",
      );

      assert.strictEqual(typeof envConfig.media.port, "number");
      assert.strictEqual(typeof envConfig.media.standalone, "boolean");
      assert.strictEqual(typeof envConfig.media.serviceUrl, "string");
      assert.strictEqual(envConfig.media.port, 8890);
    });
  });
});
