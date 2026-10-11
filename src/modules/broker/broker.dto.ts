import type {
  PPEViolationDetectedPayload,
  PPEViolationDetectedKafkaEvent,
} from "../../common/types/kafka-event.type";
import type { EventEnvelope } from "../../common/types/event.type";
import type {
  BrokerStatus,
  DlqRecordStatus,
} from "../../common/constants/broker.constant";
import type {
  PaginatedResult,
  PaginationMeta,
} from "../../common/types/pagination.type";

export type { PaginationMeta };
export type PaginatedResultDto<T> = PaginatedResult<T>;

/**
 * DTO tiếp nhận sự kiện vi phạm gửi từ AI Inference Engine (Python - SV2)
 */
export type PublishViolationPayloadDto = PPEViolationDetectedPayload;

export type PublishViolationEnvelopeDto = PPEViolationDetectedKafkaEvent;

export interface PublishViolationResponseDto {
  success: boolean;
  eventId: string;
  traceId: string;
  topic: string;
  status: "PUBLISHED" | "DUPLICATE_SKIPPED";
  duplicate?: boolean;
  timestamp: number;
}

/**
 * DTO trả về trạng thái sức khỏe của Message Broker
 */
export interface BrokerHealthResponseDto {
  status: BrokerStatus;
  redisConnected: boolean;
  activeSubscribers: number;
  dlqCount: number;
  processedCacheCount: number;
  timestamp: number;
}

/**
 * DTO biểu diễn bản ghi Dead-Letter Queue
 */
export interface DlqRecordItemDto {
  id: string;
  topic: string;
  eventId: string;
  traceId?: string;
  envelope: EventEnvelope;
  error: string;
  failedAt: number;
  attempts: number;
  status?: DlqRecordStatus;
  reprocessedAt?: number;
}

/**
 * DTO bộ lọc tìm kiếm trong Dead-Letter Queue
 */
export interface DlqQueryDto {
  page?: number;
  limit?: number;
  topic?: string;
  search?: string;
}

/**
 * DTO phản hồi khi reprocess một thông điệp từ DLQ
 */
export interface ReprocessDlqResponseDto {
  success: boolean;
  eventId: string;
  reprocessed: boolean;
  message: string;
}
