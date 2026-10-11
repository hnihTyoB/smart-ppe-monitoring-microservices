import { Request, Response, NextFunction } from "express";
import { TimeoutError } from "../common/errors/structured-errors";

/**
 * Thời gian timeout mặc định cho HTTP request (15 giây).
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

/**
 * Factory tạo Timeout Middleware với ngưỡng thời gian cấu hình được.
 *
 * @param timeoutMs Thời gian tối đa (ms) chờ request xử lý trước khi ngắt.
 */
export function createTimeoutMiddleware(
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
) {
  return function timeoutMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    let timedOut = false;

    // Chặn ERR_HTTP_HEADERS_SENT nếu controller/service hoàn tất trễ sau khi đã timeout
    const originalJson = typeof res.json === "function" ? res.json.bind(res) : undefined;
    const originalSend = typeof res.send === "function" ? res.send.bind(res) : undefined;

    if (originalJson) {
      res.json = function (body: unknown) {
        if (res.headersSent || timedOut) {
          return res;
        }
        return originalJson(body);
      };
    }

    if (originalSend) {
      res.send = function (body: unknown) {
        if (res.headersSent || timedOut) {
          return res;
        }
        return originalSend(body);
      };
    }

    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        next(
          new TimeoutError(
            `Thời gian xử lý yêu cầu vượt quá giới hạn cho phép (${timeoutMs}ms)`,
          ),
        );
      }
    }, timeoutMs);

    // Không ngăn Node.js event loop thoát nếu chỉ còn timer này
    timer.unref();

    const cleanup = () => {
      clearTimeout(timer);
    };

    res.once("finish", cleanup);
    res.once("close", cleanup);

    next();
  };
}

/**
 * Phân tích và kiểm tra an toàn giá trị REQUEST_TIMEOUT_MS từ biến môi trường
 */
const parsedTimeout = process.env.REQUEST_TIMEOUT_MS
  ? Number(process.env.REQUEST_TIMEOUT_MS)
  : NaN;

/**
 * Middleware mặc định áp dụng giới hạn 15 giây cho request.
 */
export const timeoutMiddleware = createTimeoutMiddleware(
  !isNaN(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : DEFAULT_REQUEST_TIMEOUT_MS,
);

/**
 * Bọc một Promise trong cơ chế Timeout bảo vệ.
 * Nếu Promise không giải quyết xong trong `timeoutMs`, ném ra `TimeoutError`.
 *
 * @param promise Tác vụ bất đồng bộ cần kiểm soát
 * @param timeoutMs Thời gian timeout tối đa tính bằng ms
 * @param operationName Tên thao tác để ghi log chi tiết
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string = "AsyncOperation",
): Promise<T> {
  let timer: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new TimeoutError(
          `Thao tác [${operationName}] đã quá hạn thời gian (${timeoutMs}ms)`,
        ),
      );
    }, timeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
