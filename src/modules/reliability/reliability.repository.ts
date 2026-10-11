import {
  IDEMPOTENCY_STATUS,
  IDEMPOTENCY_REASON,
  RETRY_POLICY,
  RELIABILITY_LIMITS,
  IdempotencyStatus,
  IdempotencyReason,
} from "../../common/constants/reliability.constant";
import {
  IdempotencyKeyItemDto,
  IdempotencyKeyQueryDto,
  CacheMetricsDto,
} from "./reliability.dto";
import {
  calculatePaginationSkip,
} from "../../common/helpers/pagination.helper";
import {
  AuditRepository,
  auditRepository,
} from "../audit/audit.repository";
import { AuditLogItemDto } from "../audit/audit.dto";

export interface IdempotencyRecord {
  key: string;
  status: IdempotencyStatus;
  reason?: IdempotencyReason;
  createdAt: number;
  expiresAt: number;
  lockedUntil?: number;
  attempts: number;
  lastError?: string;
  result?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export class ReliabilityRepository {
  private readonly store = new Map<string, IdempotencyRecord>();
  private readonly maxCapacity = RELIABILITY_LIMITS.MAX_STORED_KEYS;
  private readonly auditRepo: AuditRepository;

  constructor(auditRepo?: AuditRepository) {
    this.auditRepo = auditRepo || auditRepository;
  }

  /**
   * Tra cứu bản ghi Idempotency theo khóa
   */
  public findKey(key: string): IdempotencyRecord | undefined {
    const record = this.store.get(key);
    if (!record) return undefined;

    const now = Date.now();
    // Nếu bản ghi đã quá thời hạn TTL thì tự động xóa
    if (now > record.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return record;
  }

  /**
   * Cấp khóa nguyên tử (Atomic Check & Acquire Mutex Lock)
   *
   * Quy tắc xử lý:
   * 1. Chưa tồn tại: Cấp lock thành công, chuyển sang PROCESSING.
   * 2. Đã COMPLETED: Trả về acquired = false (Chống duplicate).
   * 3. Đang PROCESSING và chưa hết hạn lock: Trả về acquired = false (Chống Race Condition In-Flight).
   * 4. Đang PROCESSING nhưng lock đã timeout (worker crash/treo): Cấp lại lock cho worker mới.
   * 5. Đang FAILED: Cho phép thử lại và cấp lock mới.
   */
  public atomicAcquire(
    key: string,
    reason: IdempotencyReason = IDEMPOTENCY_REASON.EXACT_VIOLATION_ID,
    lockDurationMs: number = RETRY_POLICY.LOCK_TIMEOUT_MS,
    ttlMs: number = RETRY_POLICY.IDEMPOTENCY_TTL_MS,
  ): { acquired: boolean; record: IdempotencyRecord } {
    this.evictIfCapacityExceeded();
    const now = Date.now();
    const existing = this.findKey(key);

    if (!existing) {
      const newRecord: IdempotencyRecord = {
        key,
        status: IDEMPOTENCY_STATUS.PROCESSING,
        reason,
        createdAt: now,
        expiresAt: now + ttlMs,
        lockedUntil: now + lockDurationMs,
        attempts: 1,
      };
      this.store.set(key, newRecord);
      return { acquired: true, record: newRecord };
    }

    // 1. Đã hoàn thành hoặc bị từ chối trước đó -> Duplicate phát hiện
    if (
      existing.status === IDEMPOTENCY_STATUS.COMPLETED ||
      existing.status === IDEMPOTENCY_STATUS.DUPLICATE_REJECTED
    ) {
      return { acquired: false, record: existing };
    }

    // 2. Đang được xử lý bởi một luồng khác và lock còn hiệu lực -> Chặn Race Condition
    if (
      existing.status === IDEMPOTENCY_STATUS.PROCESSING &&
      existing.lockedUntil &&
      now < existing.lockedUntil
    ) {
      return { acquired: false, record: existing };
    }

    // 3. Khóa đã bị treo quá timeout (Stale Lock) hoặc trạng thái FAILED -> Tái chiếm quyền xử lý
    existing.status = IDEMPOTENCY_STATUS.PROCESSING;
    existing.reason = reason;
    existing.lockedUntil = now + lockDurationMs;
    existing.expiresAt = now + ttlMs;
    existing.attempts += 1;
    this.store.set(key, existing);

    return { acquired: true, record: existing };
  }

  /**
   * Đánh dấu hoàn tất xử lý thành công
   */
  public completeKey(
    key: string,
    result?: Record<string, unknown> | null,
    metadata?: Record<string, unknown>,
    ttlMs: number = RETRY_POLICY.IDEMPOTENCY_TTL_MS,
  ): void {
    const record = this.findKey(key);
    const now = Date.now();

    if (record) {
      record.status = IDEMPOTENCY_STATUS.COMPLETED;
      record.lockedUntil = undefined;
      record.expiresAt = now + ttlMs;
      record.result = result || null;
      if (metadata) {
        record.metadata = { ...(record.metadata || {}), ...metadata };
      }
      this.store.set(key, record);
    } else {
      this.store.set(key, {
        key,
        status: IDEMPOTENCY_STATUS.COMPLETED,
        createdAt: now,
        expiresAt: now + ttlMs,
        attempts: 1,
        result: result || null,
        metadata,
      });
    }
  }

  /**
   * Đánh dấu xử lý thất bại
   */
  public failKey(
    key: string,
    error?: string,
    ttlMs: number = RETRY_POLICY.IDEMPOTENCY_TTL_MS,
  ): void {
    const record = this.findKey(key);
    const now = Date.now();
    if (record) {
      record.status = IDEMPOTENCY_STATUS.FAILED;
      record.lockedUntil = undefined;
      record.lastError = error;
      this.store.set(key, record);
    } else {
      this.store.set(key, {
        key,
        status: IDEMPOTENCY_STATUS.FAILED,
        createdAt: now,
        expiresAt: now + ttlMs,
        attempts: 1,
        lastError: error,
      });
    }
  }

  /**
   * Giải phóng khóa để các lượt khác có thể tiếp nhận
   */
  public releaseKey(key: string): void {
    const record = this.store.get(key);
    if (record && record.status === IDEMPOTENCY_STATUS.PROCESSING) {
      record.lockedUntil = undefined;
    }
  }

  /**
   * Xóa một khóa cụ thể
   */
  public deleteKey(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Tra cứu danh sách các khóa đã lưu có phân trang
   */
  public listKeys(
    query?: IdempotencyKeyQueryDto,
  ): { data: IdempotencyKeyItemDto[]; total: number } {
    this.cleanupExpired();
    let records = Array.from(this.store.values());

    if (query?.status) {
      records = records.filter((r) => r.status === query.status);
    }

    if (query?.search) {
      const s = query.search.toLowerCase();
      records = records.filter(
        (r) =>
          r.key.toLowerCase().includes(s) ||
          r.lastError?.toLowerCase().includes(s),
      );
    }

    // Sắp xếp thời gian tạo mới nhất lên đầu
    records.sort((a, b) => b.createdAt - a.createdAt);

    const total = records.length;
    const page = query?.page || 1;
    const limit = Math.min(
      query?.limit || RELIABILITY_LIMITS.DEFAULT_PAGE_SIZE,
      RELIABILITY_LIMITS.MAX_PAGE_SIZE,
    );

    const { skip, take } = calculatePaginationSkip(page, limit);
    const paginated = records.slice(skip, skip + take);

    const dtos: IdempotencyKeyItemDto[] = paginated.map((r) => ({
      key: r.key,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      lockedUntil: r.lockedUntil,
      attempts: r.attempts,
      lastError: r.lastError,
      metadata: r.metadata,
    }));

    return { data: dtos, total };
  }

  /**
   * Xóa toàn bộ hoặc theo trạng thái
   */
  public purgeKeys(status?: IdempotencyStatus): number {
    if (!status) {
      const count = this.store.size;
      this.store.clear();
      return count;
    }

    let purged = 0;
    for (const [key, record] of this.store.entries()) {
      if (record.status === status) {
        this.store.delete(key);
        purged++;
      }
    }
    return purged;
  }

  /**
   * Thu dọn các bản ghi đã quá hạn TTL
   */
  public cleanupExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Thống kê kích thước bộ nhớ đệm
   */
  public getCacheMetrics(): CacheMetricsDto {
    const now = Date.now();
    let activeLocks = 0;

    for (const record of this.store.values()) {
      if (
        record.status === IDEMPOTENCY_STATUS.PROCESSING &&
        record.lockedUntil &&
        record.lockedUntil > now
      ) {
        activeLocks++;
      }
    }

    return {
      storedKeysCount: this.store.size,
      maxCapacity: this.maxCapacity,
      activeLocksCount: activeLocks,
    };
  }

  /**
   * Giải phóng bộ nhớ nếu vượt quá dung lượng tối đa (LRU-like eviction)
   */
  private evictIfCapacityExceeded(): void {
    if (this.store.size >= this.maxCapacity) {
      this.cleanupExpired();
      if (this.store.size >= this.maxCapacity) {
        // Xóa 10% các khóa cũ nhất
        const toDeleteCount = Math.floor(this.maxCapacity * 0.1);
        const keys = Array.from(this.store.keys()).slice(0, toDeleteCount);
        for (const k of keys) {
          this.store.delete(k);
        }
      }
    }
  }

  /**
   * Tìm các khóa idempotency theo từ khóa/pattern
   */
  public findKeysByPattern(pattern: string): IdempotencyRecord[] {
    const results: IdempotencyRecord[] = [];
    for (const [k, v] of this.store.entries()) {
      if (k.includes(pattern)) {
        results.push(v);
      }
    }
    return results;
  }

  /**
   * Tra cứu các bản ghi AuditLog liên kết với traceId (Ủy quyền cho AuditRepository)
   */
  public async findAuditLogsByTraceId(
    traceId: string,
  ): Promise<AuditLogItemDto[]> {
    return this.auditRepo.findByTraceId(traceId);
  }
}

export const reliabilityRepository = new ReliabilityRepository();
