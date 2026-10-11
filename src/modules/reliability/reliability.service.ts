import {
  RETRY_POLICY,
  RELIABILITY_LIMITS,
  IDEMPOTENCY_REASON,
  ERROR_CATEGORY,
  IdempotencyReason,
  IdempotencyStatus,
  TRACE_STAGE,
  TRACE_STAGE_STATUS,
} from "../../common/constants/reliability.constant";
import {
  IdempotencyCheckResultDto,
  IdempotencyKeyQueryDto,
  ReliabilityMetricsResponseDto,
  PurgeIdempotencyKeysDto,
  PaginatedResultDto,
  IdempotencyKeyItemDto,
  RetryOptions,
  ClassifiedError,
  TraceTimelineDto,
  TraceStageDto,
} from "./reliability.dto";
import { getTraceId } from "../../common/context/trace-context";
import {
  ReliabilityRepository,
  reliabilityRepository,
} from "./reliability.repository";
import { auditService, AuditService } from "../audit/audit.service";
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../../common/constants/audit-log.constant";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODE } from "../../common/errors/error-code";
import type { PPEViolationDetectedPayload } from "../../common/types/kafka-event.type";
import { formatPaginationMeta } from "../../common/helpers/pagination.helper";

import {
  eventBus,
  EventBusService,
  DlqRecord,
} from "../../common/services/event-bus.service";

export class ReliabilityService {
  private readonly repo: ReliabilityRepository;
  private readonly audit: AuditService;
  private readonly bus: EventBusService;

  // Telemetry Counters
  private totalEventsReceived = 0;
  private totalDeduplicated = 0;
  private exactEventIdDeduplicated = 0;
  private exactViolationIdDeduplicated = 0;
  private businessCooldownDeduplicated = 0;
  private inFlightConcurrencyBlocked = 0;

  private totalRetries = 0;
  private retrySuccesses = 0;
  private retriesExhausted = 0;
  private activeRetries = 0;

  private totalDlqPoisonPills = 0;
  private totalDlqTransientExhausted = 0;

  constructor(
    repo?: ReliabilityRepository,
    audit?: AuditService,
    bus?: EventBusService,
  ) {
    this.repo = repo || reliabilityRepository;
    this.audit = audit || auditService;
    this.bus = bus || eventBus;
  }

  /**
   * Tính toán Business Deduplication Fingerprint từ Payload vi phạm của AI Vision
   * Dùng để chống hiện tượng AI frame jitter (phát hiện liên tiếp 15-30 frames/giây cho cùng 1 người)
   */
  public computeBusinessDedupKey(payload: PPEViolationDetectedPayload): string {
    const siteId = payload.site?.id || "unknown-site";
    const cameraId = payload.camera?.id || "unknown-cam";
    const primaryViolation = payload.violations?.[0];
    const violationType = primaryViolation?.violationType || "PPE_VIOLATION";

    // Tìm trackId từ detections hoặc workerId
    const matchedDetection = payload.detections?.find(
      (d) => d.trackId !== undefined,
    );
    const trackId =
      matchedDetection?.trackId ?? primaryViolation?.workerId ?? "untracked";

    return `biz:${siteId}:${cameraId}:${trackId}:${violationType}`;
  }

  /**
   * Kiểm tra và cấp khóa Idempotency nguyên tử (Atomic Check & Acquire)
   */
  public checkAndAcquireIdempotency(
    key: string,
    reason: IdempotencyReason = IDEMPOTENCY_REASON.EXACT_VIOLATION_ID,
    ttlMs: number = RETRY_POLICY.IDEMPOTENCY_TTL_MS,
    lockDurationMs: number = RETRY_POLICY.LOCK_TIMEOUT_MS,
  ): IdempotencyCheckResultDto {
    this.totalEventsReceived++;
    const { acquired, record } = this.repo.atomicAcquire(
      key,
      reason,
      lockDurationMs,
      ttlMs,
    );

    if (!acquired) {
      this.totalDeduplicated++;
      if (reason === IDEMPOTENCY_REASON.EXACT_EVENT_ID) {
        this.exactEventIdDeduplicated++;
      } else if (reason === IDEMPOTENCY_REASON.EXACT_VIOLATION_ID) {
        this.exactViolationIdDeduplicated++;
      } else if (reason === IDEMPOTENCY_REASON.BUSINESS_FINGERPRINT_COOLDOWN) {
        this.businessCooldownDeduplicated++;
      } else {
        this.inFlightConcurrencyBlocked++;
      }

      return {
        isDuplicate: true,
        key,
        status: record.status,
        reason: record.reason || reason,
        existingResult: record.result,
        lockedUntil: record.lockedUntil,
      };
    }

    return {
      isDuplicate: false,
      key,
      status: record.status,
      reason,
      lockedUntil: record.lockedUntil,
    };
  }

  /**
   * Đánh dấu hoàn tất xử lý sự kiện
   */
  public completeIdempotency(
    key: string,
    result?: Record<string, unknown> | null,
    metadata?: Record<string, unknown>,
    ttlMs: number = RETRY_POLICY.IDEMPOTENCY_TTL_MS,
  ): void {
    this.repo.completeKey(key, result, metadata, ttlMs);
  }

  /**
   * Giải phóng hoặc đánh dấu lỗi cho khóa Idempotency
   */
  public releaseOrFailIdempotency(key: string, error?: string): void {
    if (error) {
      this.repo.failKey(key, error);
    } else {
      this.repo.releaseKey(key);
    }
  }

  /**
   * Phân loại lỗi: Transient (Retryable) vs Permanent (Non-retryable / Poison pill)
   */
  public classifyError(error: unknown): ClassifiedError {
    const message =
      error instanceof Error ? error.message : String(error || "Unknown error");

    // 1. Kiểm tra nếu là AppError
    if (error instanceof AppError) {
      // 4xx là lỗi client/nghiệp vụ vĩnh viễn (Poison pill) -> không nên retry
      if (error.statusCode < 500) {
        return {
          category: ERROR_CATEGORY.PERMANENT,
          message,
          originalError: error,
          isRetryable: false,
        };
      }
    }

    // 2. Kiểm tra lỗi validation Zod hoặc JSON SyntaxError
    if (
      message.includes("Zod") ||
      message.includes("validation") ||
      message.includes("Invalid uuid") ||
      error instanceof SyntaxError
    ) {
      return {
        category: ERROR_CATEGORY.PERMANENT,
        message,
        originalError: error,
        isRetryable: false,
      };
    }

    // 3. Các lỗi Transient điển hình trong PostgreSQL & Node.js
    const lowerMsg = message.toLowerCase();
    const isTransient =
      lowerMsg.includes("timeout") ||
      lowerMsg.includes("etimedout") ||
      lowerMsg.includes("econnreset") ||
      lowerMsg.includes("econnrefused") ||
      lowerMsg.includes("deadlock") || // PostgreSQL 40P01
      lowerMsg.includes("40p01") ||
      lowerMsg.includes("pool") ||
      lowerMsg.includes("p2024") || // Prisma connection pool timeout
      lowerMsg.includes("p1001") || // Prisma can't reach database
      lowerMsg.includes("too many requests") ||
      lowerMsg.includes("rate limit") ||
      lowerMsg.includes("503");

    if (isTransient) {
      return {
        category: ERROR_CATEGORY.TRANSIENT,
        message,
        originalError: error,
        isRetryable: true,
      };
    }

    // Mặc định các lỗi không rõ là Transient để thử lại với giới hạn max attempts
    return {
      category: ERROR_CATEGORY.TRANSIENT,
      message,
      originalError: error,
      isRetryable: true,
    };
  }

  /**
   * Bộ thực thi tác vụ bất đồng bộ với cơ chế Exponential Backoff & Full Jitter
   */
  public async executeWithRetry<T>(
    taskName: string,
    fn: (attempt: number) => Promise<T>,
    options?: RetryOptions,
  ): Promise<T> {
    const maxAttempts =
      options?.maxAttempts ?? RETRY_POLICY.DEFAULT_MAX_ATTEMPTS;
    const initialBackoff =
      options?.initialBackoffMs ?? RETRY_POLICY.INITIAL_BACKOFF_MS;
    const backoffMultiplier =
      options?.backoffMultiplier ?? RETRY_POLICY.BACKOFF_MULTIPLIER;
    const maxBackoff = options?.maxBackoffMs ?? RETRY_POLICY.MAX_BACKOFF_MS;
    const jitterFactor = options?.jitterFactor ?? RETRY_POLICY.JITTER_FACTOR;

    let attempt = 0;
    this.activeRetries++;

    try {
      while (attempt < maxAttempts) {
        attempt++;
        try {
          const result = await fn(attempt);
          if (attempt > 1) {
            this.retrySuccesses++;
          }
          return result;
        } catch (err: unknown) {
          const classified = this.classifyError(err);

          // Nếu là lỗi vĩnh viễn (Poison Pill), dừng ngay lập tức và ghi nhận DLQ Poison Pill
          if (!classified.isRetryable) {
            this.totalDlqPoisonPills++;
            console.warn(
              `[ReliabilityService] ☠️ Poison Pill detected for [${taskName}]: ${classified.message}. Halting retry.`,
            );
            throw err;
          }

          this.totalRetries++;

          // Nếu đã đạt số lần thử tối đa
          if (attempt >= maxAttempts) {
            this.retriesExhausted++;
            this.totalDlqTransientExhausted++;
            console.error(
              `[ReliabilityService] ❌ Retries exhausted (${maxAttempts}/${maxAttempts}) for [${taskName}]: ${classified.message}`,
            );
            throw new AppError(
              `Đã vượt quá số lần thử lại tối đa (${maxAttempts}) cho tác vụ [${taskName}]: ${classified.message}`,
              500,
              ERROR_CODE.RETRY_EXHAUSTED,
            );
          }

          // Tính toán khoảng thời gian chờ Exponential Backoff kèm Full Jitter
          const rawDelay = Math.min(
            initialBackoff * Math.pow(backoffMultiplier, attempt - 1),
            maxBackoff,
          );
          // Jitter ngẫu nhiên giữa [-jitterFactor * rawDelay, +jitterFactor * rawDelay]
          const jitter = rawDelay * jitterFactor * (Math.random() * 2 - 1);
          const actualDelay = Math.max(10, Math.floor(rawDelay + jitter));

          const currentTraceId = getTraceId();
          const traceTag = currentTraceId ? `[Trace: ${currentTraceId}] ` : "";

          console.warn(
            `[ReliabilityService] ${traceTag}🔄 Retry attempt ${attempt}/${maxAttempts} for [${taskName}] after ${actualDelay}ms. Reason: ${classified.message}`,
          );

          await new Promise((resolve) => setTimeout(resolve, actualDelay));
        }
      }

      throw new AppError(
        `Không thể hoàn tất tác vụ [${taskName}] sau ${maxAttempts} lần thử`,
        500,
        ERROR_CODE.RETRY_EXHAUSTED,
      );
    } finally {
      this.activeRetries = Math.max(0, this.activeRetries - 1);
    }
  }

  /**
   * Tra cứu danh sách các khóa Idempotency có phân trang
   */
  public listIdempotencyKeys(
    query?: IdempotencyKeyQueryDto,
  ): PaginatedResultDto<IdempotencyKeyItemDto> {
    const page = query?.page || 1;
    const limit = query?.limit || RELIABILITY_LIMITS.DEFAULT_PAGE_SIZE;
    const { data, total } = this.repo.listKeys(query);

    return {
      data,
      meta: formatPaginationMeta(page, limit, total),
    };
  }

  /**
   * Xóa toàn bộ hoặc dọn dẹp các khóa Idempotency
   */
  public purgeKeys(
    status?: IdempotencyStatus,
    actorId?: string,
  ): PurgeIdempotencyKeysDto {
    const purgedCount = this.repo.purgeKeys(status);

    this.audit
      .recordLog({
        actorId: actorId || "SYSTEM",
        action: AUDIT_ACTION.PURGE_IDEMPOTENCY_KEYS,
        targetType: AUDIT_TARGET_TYPE.PPE_RELIABILITY,
        targetId: status || "ALL_KEYS",
        details: { purgedCount, status: status || "ALL" },
      })
      .catch((err) =>
        console.warn("[AuditLog] Failed to record event:", err?.message || err),
      );

    return {
      success: true,
      keysPurged: purgedCount,
      message: `Đã dọn dẹp thành công ${purgedCount} khóa Idempotency`,
    };
  }

  /**
   * Tổng hợp các chỉ số độ tin cậy và hiệu năng Idempotency/Retry thời gian thực
   */
  public getReliabilityMetrics(): ReliabilityMetricsResponseDto {
    const rate =
      this.totalEventsReceived > 0
        ? parseFloat(
            (
              (this.totalDeduplicated / this.totalEventsReceived) *
              100
            ).toFixed(2),
          )
        : 0;

    return {
      totalEventsReceived: this.totalEventsReceived,
      totalDeduplicated: this.totalDeduplicated,
      deduplicationRatePercent: rate,
      deduplicationBreakdown: {
        exactEventId: this.exactEventIdDeduplicated,
        exactViolationId: this.exactViolationIdDeduplicated,
        businessCooldown: this.businessCooldownDeduplicated,
        inFlightConcurrency: this.inFlightConcurrencyBlocked,
      },
      retryMetrics: {
        totalRetries: this.totalRetries,
        retrySuccesses: this.retrySuccesses,
        retriesExhausted: this.retriesExhausted,
        activeRetries: this.activeRetries,
      },
      dlqMetrics: {
        totalDlqPoisonPills: this.totalDlqPoisonPills,
        totalDlqTransientExhausted: this.totalDlqTransientExhausted,
        currentDlqSize:
          this.totalDlqPoisonPills + this.totalDlqTransientExhausted,
      },
      cacheMetrics: this.repo.getCacheMetrics(),
      timestamp: Date.now(),
    };
  }

  /**
   * Tra cứu hành trình E2E Timeline của một traceId (Acceptance Criteria BE-14)
   */
  public async getTraceTimeline(traceId: string): Promise<TraceTimelineDto> {
    const stages: TraceStageDto[] = [];

    // 1. Kiểm tra các sự kiện Dead-Letter Queue (DLQ)
    const dlqRecords = this.bus
      .getDlqEvents()
      .filter(
        (r: DlqRecord) =>
          r.envelope.traceId === traceId || r.envelope.id === traceId,
      );
    for (const r of dlqRecords) {
      stages.push({
        stage: TRACE_STAGE.DEAD_LETTER_QUEUE,
        status: (r.status as string) || TRACE_STAGE_STATUS.PENDING,
        timestamp: r.failedAt,
        details: {
          topic: r.envelope.name,
          error: r.error,
          attempts: r.attempts,
          reprocessedAt: r.reprocessedAt,
        },
      });
    }

    // 2. Kiểm tra Idempotency Keys liên quan
    const relatedKeys = this.repo.findKeysByPattern(traceId);
    for (const k of relatedKeys) {
      stages.push({
        stage: TRACE_STAGE.IDEMPOTENCY_MUTEX,
        status: k.status,
        timestamp: k.createdAt,
        details: {
          key: k.key,
          reason: k.reason,
          attempts: k.attempts,
          lastError: k.lastError,
        },
      });
    }

    // 3. Kiểm tra Audit Logs
    const auditLogs = await this.repo.findAuditLogsByTraceId(traceId);
    for (const a of auditLogs) {
      // Sanitize details: loại bỏ các thông tin nhạy cảm (token, mật khẩu, authorization header)
      let sanitizedDetails: Record<string, unknown> | undefined;
      if (a.details && typeof a.details === "object") {
        const raw = a.details as Record<string, unknown>;
        const {
          password,
          token,
          secret,
          authorization,
          refreshToken,
          accessToken,
          apiKey,
          ...safeDetails
        } = raw;
        sanitizedDetails = safeDetails;
      }

      stages.push({
        stage: TRACE_STAGE.AUDIT_LOG,
        status: TRACE_STAGE_STATUS.RECORDED,
        timestamp: new Date(a.createdAt).getTime(),
        details: {
          action: a.action,
          targetType: a.targetType,
          targetId: a.targetId,
          actorId: a.actorId,
          details: sanitizedDetails,
        },
      });
    }

    // Sắp xếp các chặng theo mốc thời gian tăng dần
    stages.sort((a, b) => a.timestamp - b.timestamp);

    return {
      traceId,
      timestamp: Date.now(),
      eventsCount: stages.length,
      stages,
    };
  }

  /**
   * Xóa toàn bộ bộ đếm phục vụ kiểm thử
   */
  public resetMetrics(): void {
    this.totalEventsReceived = 0;
    this.totalDeduplicated = 0;
    this.exactEventIdDeduplicated = 0;
    this.exactViolationIdDeduplicated = 0;
    this.businessCooldownDeduplicated = 0;
    this.inFlightConcurrencyBlocked = 0;
    this.totalRetries = 0;
    this.retrySuccesses = 0;
    this.retriesExhausted = 0;
    this.activeRetries = 0;
    this.totalDlqPoisonPills = 0;
    this.totalDlqTransientExhausted = 0;
    this.repo.purgeKeys();
  }
}

export const reliabilityService = new ReliabilityService();
