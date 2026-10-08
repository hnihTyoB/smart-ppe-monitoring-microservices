import { Router } from "express";
import multer from "multer";
import { FileController } from "./file.controller";
import {
  authMiddleware,
  optionalAuthMiddleware,
} from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireAnyPermission,
} from "../../middlewares/permission.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { PERMISSIONS } from "../../common/constants/permission.constant";
import {
  MEDIA_LIMITS,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "../../common/constants/media.constant";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODE } from "../../common/errors/error-code";
import {
  fileIdParamSchema,
  requestUploadUrlSchema,
  confirmUploadSchema,
  listFilesSchema,
  imageTransformSchema,
  directImageUploadSchema,
  cleanupFilesSchema,
} from "./file.validation";

const router = Router();
const controller = new FileController();

// Cấu hình multer lưu buffer trong RAM (tối đa theo MEDIA_LIMITS) và lọc MIME type chặt chẽ
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MEDIA_LIMITS.MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const isSupported = (
      SUPPORTED_IMAGE_MIME_TYPES as readonly string[]
    ).includes(file.mimetype.toLowerCase());
    if (isSupported) {
      cb(null, true);
    } else {
      cb(
        new AppError(
          "Định dạng tệp không được hỗ trợ. Chỉ chấp nhận các định dạng ảnh (JPEG, PNG, WebP, AVIF, GIF, TIFF)",
          400,
          ERROR_CODE.VALIDATION_ERROR,
        ),
      );
    }
  },
});

// 1. Xin presigned upload URL (yêu cầu đăng nhập và có quyền FILE_UPLOAD hoặc FILE_MANAGE)
router.post(
  "/upload-url",
  authMiddleware,
  requireAnyPermission(PERMISSIONS.FILE_UPLOAD, PERMISSIONS.FILE_MANAGE),
  validate(requestUploadUrlSchema),
  controller.requestUploadUrl,
);

// 2. Tải lên và tối ưu hóa ảnh trực tiếp bằng Sharp (WebP, avatar, resize)
router.post(
  "/upload-image",
  authMiddleware,
  requireAnyPermission(PERMISSIONS.FILE_UPLOAD, PERMISSIONS.FILE_MANAGE),
  upload.single("image"),
  validate(directImageUploadSchema, "body"),
  controller.uploadImage,
);

// 3. Quét dọn tệp tin rác / mồ côi (chỉ Quản trị viên có quyền FILE_MANAGE)
router.post(
  "/cleanup",
  authMiddleware,
  requirePermission(PERMISSIONS.FILE_MANAGE),
  validate(cleanupFilesSchema, "body"),
  controller.cleanupOrphanFiles,
);

// 4. Xác nhận đã upload file lên S3/R2 thành công
router.post(
  "/:id/confirm",
  authMiddleware,
  validate(fileIdParamSchema, "params"),
  validate(confirmUploadSchema),
  controller.confirmUpload,
);

// 5. Danh sách tệp tin (public files hoặc tệp của user)
router.get(
  "/",
  optionalAuthMiddleware,
  validate(listFilesSchema, "query"),
  controller.findAll,
);

// 6. Lấy chi tiết thông tin tệp
router.get(
  "/:id",
  optionalAuthMiddleware,
  validate(fileIdParamSchema, "params"),
  controller.findById,
);

// 7. Biến đổi ảnh (resize, crop, convert format) qua Sharp
router.get(
  "/:id/transform",
  optionalAuthMiddleware,
  validate(fileIdParamSchema, "params"),
  validate(imageTransformSchema, "query"),
  controller.transformImage,
);

// 8. Xin presigned download URL (dành cho file private)
router.get(
  "/:id/download-url",
  optionalAuthMiddleware,
  validate(fileIdParamSchema, "params"),
  controller.getDownloadUrl,
);

// 9. Direct download (302 redirect trực tiếp tới signed URL)
router.get(
  "/:id/download",
  optionalAuthMiddleware,
  validate(fileIdParamSchema, "params"),
  controller.downloadDirect,
);

// 10. Xóa tệp (yêu cầu đăng nhập và có quyền FILE_DELETE hoặc FILE_MANAGE)
router.delete(
  "/:id",
  authMiddleware,
  requireAnyPermission(PERMISSIONS.FILE_DELETE, PERMISSIONS.FILE_MANAGE),
  validate(fileIdParamSchema, "params"),
  controller.delete,
);

export default router;
