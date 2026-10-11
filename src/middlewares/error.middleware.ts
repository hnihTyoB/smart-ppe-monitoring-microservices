import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import multer from "multer";
import { AppError } from "../common/errors/app-error";
import { ERROR_CODE } from "../common/errors/error-code";

import { getTraceId } from "../common/context/trace-context";

export function notFoundMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // LOW-01 Fix: Dùng req.path thay cho req.originalUrl để không để lộ query params nhạy cảm
  next(
    new AppError(
      `Route ${req.method} ${req.path} not found`,
      404,
      ERROR_CODE.NOT_FOUND,
    ),
  );
}

function resolveTraceId(req?: Request): string {
  const contextTraceId = getTraceId();
  if (contextTraceId) return contextTraceId;
  if (!req) return "no-trace-id";
  if (req.traceId) return req.traceId;
  if (req.id) return req.id;
  const headers = req.headers;
  if (headers && typeof headers === "object") {
    const headerId =
      headers["x-trace-id"] ||
      headers["x-correlation-id"] ||
      headers["x-request-id"];
    if (typeof headerId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(headerId)) {
      return headerId;
    }
  }
  return "no-trace-id";
}

export function errorMiddleware(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const traceId = resolveTraceId(req);
  const timestamp = new Date().toISOString();
  const requestPath = req?.baseUrl ? `${req.baseUrl}${req.path}` : (req?.path || "");

  // Đảm bảo response header luôn có traceId an toàn (kiểm tra headersSent và function existence)
  if (!res.headersSent && typeof res.setHeader === "function") {
    const getHeader =
      typeof res.getHeader === "function"
        ? res.getHeader.bind(res)
        : () => undefined;
    if (!getHeader("X-Trace-Id")) {
      res.setHeader("X-Trace-Id", traceId);
    }
    if (!getHeader("X-Correlation-Id")) {
      res.setHeader("X-Correlation-Id", traceId);
    }
    if (!getHeader("X-Request-Id")) {
      res.setHeader("X-Request-Id", traceId);
    }
  }

  if (res.headersSent) {
    return next(error);
  }

  // Bắt ZodError tập trung (RFC 7807 / 422)
  if (error instanceof ZodError) {
    const formattedErrors = error.errors.map((e) => ({
      field: e.path.join(".") || "unknown",
      message: e.message,
    }));
    res.status(422).json({
      success: false,
      message: "Validation failed",
      code: ERROR_CODE.VALIDATION_ERROR,
      traceId,
      correlationId: traceId,
      timestamp,
      path: requestPath,
      errors: formattedErrors,
    });
    return;
  }

  if (error instanceof AppError) {
    const payload: Record<string, any> = {
      success: false,
      message: error.message,
      code: error.code || ERROR_CODE.INTERNAL_SERVER_ERROR,
      traceId,
      correlationId: traceId,
      timestamp,
      path: requestPath,
    };
    if (error.data !== undefined) {
      if (error.code === ERROR_CODE.VALIDATION_ERROR) {
        payload.errors = error.data;
      } else {
        payload.data = error.data;
      }
    }
    res.status(error.statusCode).json(payload);
    return;
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as any).status === 400
  ) {
    res.status(400).json({
      success: false,
      message: "Invalid JSON payload format",
      code: ERROR_CODE.VALIDATION_ERROR,
      traceId,
      correlationId: traceId,
      timestamp,
      path: requestPath,
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Kích thước tệp tin vượt quá giới hạn tối đa cho phép"
        : `Lỗi tải lên tệp tin: ${error.message}`;
    res.status(400).json({
      success: false,
      message,
      code: ERROR_CODE.VALIDATION_ERROR,
      traceId,
      correlationId: traceId,
      timestamp,
      path: requestPath,
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const conflictingFields =
        (error.meta?.target as string[] | undefined) ?? [];
      const isSlug = conflictingFields.some((f) =>
        f.toLowerCase().includes("slug"),
      );
      res.status(409).json({
        success: false,
        message: isSlug
          ? "Đường dẫn định danh đã tồn tại. Vui lòng chọn tên khác."
          : "Dữ liệu đã tồn tại trong hệ thống (trùng lặp giá trị duy nhất)",
        code: ERROR_CODE.DUPLICATE_ENTRY,
        traceId,
        correlationId: traceId,
        timestamp,
        path: requestPath,
      });
      return;
    }

    if (error.code === "P2025") {
      res.status(404).json({
        success: false,
        message: "Bản ghi không tồn tại hoặc đã bị xóa",
        code: ERROR_CODE.NOT_FOUND,
        traceId,
        correlationId: traceId,
        timestamp,
        path: requestPath,
      });
      return;
    }

    if (error.code === "P2003" || error.code === "P2014") {
      res.status(400).json({
        success: false,
        message: "Dữ liệu liên kết hoặc ràng buộc quan hệ không hợp lệ",
        code: ERROR_CODE.VALIDATION_ERROR,
        traceId,
        correlationId: traceId,
        timestamp,
        path: requestPath,
      });
      return;
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({
      success: false,
      message: "Dữ liệu truy vấn không hợp lệ",
      code: ERROR_CODE.VALIDATION_ERROR,
      traceId,
      correlationId: traceId,
      timestamp,
      path: requestPath,
    });
    return;
  }

  // LOW-02 Fix: Sanitize request ID chống tấn công log injection / CRLF
  console.error(`[Unhandled Error][Trace-ID: ${traceId}]`, error);

  res.status(500).json({
    success: false,
    message: "Internal server error",
    code: ERROR_CODE.INTERNAL_SERVER_ERROR,
    traceId,
    correlationId: traceId,
    timestamp,
    path: requestPath,
  });
}
