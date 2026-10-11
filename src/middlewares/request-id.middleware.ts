import crypto from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { uuidv7 } from "../common/helpers/uuid.helper";
import { GATEWAY_HEADERS } from "../common/constants/gateway.constant";
import { envConfig } from "../config/env.config";
import { AppError } from "../common/errors/app-error";
import { ERROR_CODE } from "../common/errors/error-code";

import { runWithTraceContext } from "../common/context/trace-context";

export const REQUEST_ID_HEADER = GATEWAY_HEADERS.REQUEST_ID;
export const CORRELATION_ID_HEADER = "x-correlation-id";
export const TRACE_ID_HEADER = "x-trace-id";

/**
 * Regex kiểm tra correlation Request ID an toàn:
 * Chỉ cho phép ký tự alphanumeric, gạch ngang, gạch dưới, độ dài 1-128 ký tự.
 * Chống triệt để CRLF injection (\r\n), HTTP Response Splitting và Log Injection.
 */
export const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Kiểm tra xem ID có đúng định dạng an toàn hay không.
 */
export function isValidRequestId(id: unknown): id is string {
  return typeof id === "string" && SAFE_REQUEST_ID_REGEX.test(id);
}

/**
 * Kiểm tra request có đến từ API Gateway hợp lệ không.
 * Điều kiện: header x-gateway-secret phải khớp với configuredSecret.
 * Nếu configuredSecret rỗng → tắt kiểm tra (backward-compatible).
 * Sử dụng `crypto.timingSafeEqual` để phòng chống tấn công Timing Attack (CWE-208).
 */
export function isTrustedGatewayRequest(
  req: Pick<Request, "headers">,
  configuredSecret: string,
): boolean {
  if (!configuredSecret) return false; // secret chưa cấu hình → không xác thực
  const incoming = req.headers[GATEWAY_HEADERS.INTERNAL_SECRET];
  if (!incoming || typeof incoming !== "string" || incoming.length === 0)
    return false;

  const incomingBuf = Buffer.from(incoming, "utf8");
  const configuredBuf = Buffer.from(configuredSecret, "utf8");

  if (incomingBuf.length !== configuredBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(incomingBuf, configuredBuf);
}

/**
 * Middleware gắn correlation request ID (UUIDv7 — time-ordered) vào req và header response.
 *
 * Chiến lược lấy Request ID theo thứ tự ưu tiên:
 *   1. Nhận từ client/gateway qua x-correlation-id, x-trace-id hoặc x-request-id.
 *   2. Kiểm tra tính tin cậy (gateway secret hoặc dev mode) và regex an toàn.
 *   3. Sinh mới bằng UUIDv7 (time-ordered, chuẩn RFC 9562).
 *
 * Đồng thời:
 *   - Đồng bộ sang AsyncLocalStorage để duy trì TraceContext cho toàn bộ async operations.
 *   - Thiết lập các response header X-Request-Id, X-Correlation-Id, X-Trace-Id.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const secret = envConfig.gateway.internalSecret;
  const incomingCorrelationId =
    req.headers[CORRELATION_ID_HEADER] || req.headers[TRACE_ID_HEADER];
  const incomingRequestId = req.headers[REQUEST_ID_HEADER];

  let requestId: string;

  if (
    typeof incomingCorrelationId === "string" &&
    isValidRequestId(incomingCorrelationId)
  ) {
    // 1. Nhận Correlation ID / Trace ID từ client/upstream phân tán
    requestId = incomingCorrelationId;
  } else if (
    typeof incomingRequestId === "string" &&
    isValidRequestId(incomingRequestId) &&
    (isTrustedGatewayRequest(req, secret) || !secret)
  ) {
    // 2. Nhận Request ID từ API Gateway tin cậy
    requestId = incomingRequestId;
  } else {
    // 3. Tự động sinh mới UUIDv7 (time-ordered, chuẩn RFC 9562)
    requestId = uuidv7();
  }

  req.headers[REQUEST_ID_HEADER] = requestId;
  req.headers[CORRELATION_ID_HEADER] = requestId;
  req.headers[TRACE_ID_HEADER] = requestId;

  req.id = requestId;
  req.traceId = requestId;
  req.correlationId = requestId;

  res.setHeader("X-Correlation-Id", requestId);
  res.setHeader("X-Trace-Id", requestId);
  res.setHeader("X-Request-Id", requestId);

  runWithTraceContext(
    {
      traceId: requestId,
      correlationId: requestId,
      requestId,
      startTime: Date.now(),
    },
    () => {
      next();
    },
  );
}

/**
 * Factory tạo requestIdMiddleware với secret có thể inject (dùng trong testing).
 */
export function createRequestIdMiddleware(secret: string) {
  return function requestIdMiddlewareWithSecret(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const incomingCorrelationId =
      req.headers[CORRELATION_ID_HEADER] || req.headers[TRACE_ID_HEADER];
    const incomingRequestId = req.headers[REQUEST_ID_HEADER];

    let requestId: string;

    if (
      typeof incomingCorrelationId === "string" &&
      isValidRequestId(incomingCorrelationId)
    ) {
      requestId = incomingCorrelationId;
    } else if (
      typeof incomingRequestId === "string" &&
      isValidRequestId(incomingRequestId) &&
      (isTrustedGatewayRequest(req, secret) || !secret)
    ) {
      requestId = incomingRequestId;
    } else {
      requestId = uuidv7();
    }

    req.headers[REQUEST_ID_HEADER] = requestId;
    req.headers[CORRELATION_ID_HEADER] = requestId;
    req.headers[TRACE_ID_HEADER] = requestId;

    req.id = requestId;
    req.traceId = requestId;
    req.correlationId = requestId;

    res.setHeader("X-Correlation-Id", requestId);
    res.setHeader("X-Trace-Id", requestId);
    res.setHeader("X-Request-Id", requestId);

    runWithTraceContext(
      {
        traceId: requestId,
        correlationId: requestId,
        requestId,
        startTime: Date.now(),
      },
      () => {
        next();
      },
    );
  };
}

/**
 * Middleware xác thực bổ sung: chỉ cho phép request đến từ API Gateway tin cậy.
 * Dùng để bảo vệ các internal-only endpoint không cần public exposure.
 *
 * Nếu GATEWAY_INTERNAL_SECRET chưa cấu hình → middleware bỏ qua (không block).
 * Khi bị từ chối, chuyển giao cho errorMiddleware qua AppError với ERROR_CODE.GATEWAY_REQUIRED.
 */
export function requireGatewayOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const secret = envConfig.gateway.internalSecret;
  if (!secret) {
    // Secret chưa cấu hình: bỏ qua kiểm tra (backward-compatible với monolith mode)
    return next();
  }

  if (!isTrustedGatewayRequest(req, secret)) {
    return next(
      new AppError(
        "Access denied: request must originate from the API gateway.",
        403,
        ERROR_CODE.GATEWAY_REQUIRED,
      ),
    );
  }

  next();
}

/**
 * Factory tạo requireGatewayOrigin với secret có thể inject (dùng trong testing).
 */
export function createRequireGatewayOrigin(secret: string) {
  return function requireGatewayOriginWithSecret(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!secret) {
      return next();
    }
    if (!isTrustedGatewayRequest(req, secret)) {
      return next(
        new AppError(
          "Access denied: request must originate from the API gateway.",
          403,
          ERROR_CODE.GATEWAY_REQUIRED,
        ),
      );
    }
    next();
  };
}
