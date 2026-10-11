import {
  IdempotencyStatus,
  IdempotencyReason,
  ErrorCategory,
} from "../../common/constants/reliability.constant";

export interface IdempotencyCheckResultDto {
  isDuplicate: boolean;
  key: string;
  status: IdempotencyStatus;
  reason?: IdempotencyReason;
  existingResult?: Record<string, unknown> | null;
  lockedUntil?: number;
}

export interface IdempotencyKeyItemDto {
  key: string;
  status: IdempotencyStatus;
  reason?: IdempotencyReason;
  createdAt: number;
  expiresAt: number;
  lockedUntil?: number;
  attempts: number;
  lastError?: string;
  metadata?: Record<string, unknown>;
}

export interface IdempotencyKeyQueryDto {
  page?: number;
  limit?: number;
  status?: IdempotencyStatus;
  search?: string;
}

export interface DeduplicationBreakdownDto {
  exactEventId: number;
  exactViolationId: number;
  businessCooldown: number;
  inFlightConcurrency: number;
}

export interface RetryMetricsDto {
  totalRetries: number;
  retrySuccesses: number;
  retriesExhausted: number;
  activeRetries: number;
}

export interface DlqMetricsDto {
  totalDlqPoisonPills: number;
  totalDlqTransientExhausted: number;
  currentDlqSize: number;
}

export interface CacheMetricsDto {
  storedKeysCount: number;
  maxCapacity: number;
  activeLocksCount: number;
}

export interface ReliabilityMetricsResponseDto {
  totalEventsReceived: number;
  totalDeduplicated: number;
  deduplicationRatePercent: number;
  deduplicationBreakdown: DeduplicationBreakdownDto;
  retryMetrics: RetryMetricsDto;
  dlqMetrics: DlqMetricsDto;
  cacheMetrics: CacheMetricsDto;
  timestamp: number;
}

export interface PurgeIdempotencyKeysDto {
  success: boolean;
  keysPurged: number;
  message: string;
}

import { PaginationMeta } from "../../common/types/pagination.type";

export interface PaginatedResultDto<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface RetryOptions {
  maxAttempts?: number;
  initialBackoffMs?: number;
  backoffMultiplier?: number;
  maxBackoffMs?: number;
  jitterFactor?: number;
}

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  originalError: unknown;
  isRetryable: boolean;
}

export interface TraceStageDto {
  stage: string;
  status: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface TraceTimelineDto {
  traceId: string;
  timestamp: number;
  eventsCount: number;
  stages: TraceStageDto[];
}
