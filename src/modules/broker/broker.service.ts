import { uuidv7 } from "uuidv7";
import { eventBus, EventBusService, DlqRecord } from "../../common/services/event-bus.service";
import { auditService, AuditService } from "../audit/audit.service";
import {
  KAFKA_TOPICS,
  PPE_SEVERITY,
} from "../../common/constants/kafka.constant";
import { EVENT_NAMES } from "../../common/constants/event.constant";
import {
  BROKER_STATUS,
  BROKER_LIMITS,
  DLQ_RECORD_STATUS,
  DlqRecordStatus,
} from "../../common/constants/broker.constant";
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../../common/constants/audit-log.constant";
import {
  PublishViolationResponseDto,
  BrokerHealthResponseDto,
  DlqRecordItemDto,
  DlqQueryDto,
  ReprocessDlqResponseDto,
  PaginatedResultDto,
} from "./broker.dto";
import {
  PublishViolationEventInput,
} from "./broker.validation";
import {
  ppeViolationDetectedPayloadSchema,
  ppeViolationDetectedKafkaEventSchema,
  validateKafkaEvent,
} from "../../common/validations/kafka-event.schema";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODE } from "../../common/errors/error-code";
import type { PPEViolationDetectedPayload } from "../../common/types/kafka-event.type";
import {
  calculatePaginationSkip,
  formatPaginationMeta,
} from "../../common/helpers/pagination.helper";
import {
  reliabilityService,
  ReliabilityService,
} from "../reliability/reliability.service";
import {
  IDEMPOTENCY_REASON,
  RETRY_POLICY,
} from "../../common/constants/reliability.constant";

import { getTraceId } from "../../common/context/trace-context";

export class BrokerService {
  private readonly bus: EventBusService;
  private readonly audit: AuditService;
  private readonly reliability: ReliabilityService;

  constructor(
    bus?: EventBusService,
    audit?: AuditService,
    reliability?: ReliabilityService,
  ) {
    this.bus = bus || eventBus;
    this.audit = audit || auditService;
    this.reliability =
      reliability || (bus ? new ReliabilityService() : reliabilityService);
  }

  /**
   * Tiếp nhận và xuất bản sự kiện vi phạm PPE từ AI Inference Engine (Python - SV2)
   */
  async publishViolationEvent(
    input: PublishViolationEventInput,
    incomingTraceId?: string,
    actorId?: string,
  ): Promise<PublishViolationResponseDto> {
    const effectiveIncomingTraceId = incomingTraceId || getTraceId();
    let eventId: string;
    let traceId: string;
    let payload: PPEViolationDetectedPayload;

    // 1. Phân giải định dạng đầu vào (Full Kafka Envelope hoặc Raw Payload)
    if ("topic" in input && "payload" in input) {
      // Đầu vào là Full Envelope
      const validation = validateKafkaEvent(
        ppeViolationDetectedKafkaEventSchema,
        input,
      );

      if (!validation.success) {
        const errorDetail = validation.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");

        // Di chuyển tin nhắn sai định dạng vào DLQ
        await this.bus.moveToDlq(
          {
            id: (input as any).eventId || uuidv7(),
            name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
            payload: input,
            aggregateId: (input as any).payload?.site?.id || null,
            timestamp: Date.now(),
            traceId: (input as any).traceId || effectiveIncomingTraceId,
            source: "broker-ingestion-bridge",
          },
          `Zod Schema Validation Failed: ${errorDetail}`,
          1,
        );

        throw new AppError(
          `Dữ liệu sự kiện vi phạm không đúng định dạng Kafka envelope: ${errorDetail}`,
          400,
          ERROR_CODE.VALIDATION_ERROR,
        );
      }

      eventId = validation.data.eventId;
      traceId = validation.data.traceId || effectiveIncomingTraceId || uuidv7();
      payload = {
        ...validation.data.payload,
        detections: validation.data.payload.detections ?? [],
      };
    } else {
      // Đầu vào là Raw Payload vi phạm thuần túy
      const validation = validateKafkaEvent(
        ppeViolationDetectedPayloadSchema,
        input,
      );

      if (!validation.success) {
        const errorDetail = validation.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");

        await this.bus.moveToDlq(
          {
            id: (input as any).violationId || uuidv7(),
            name: EVENT_NAMES.PPE_VIOLATION_DETECTED,
            payload: input,
            aggregateId: (input as any).site?.id || null,
            timestamp: Date.now(),
            traceId: effectiveIncomingTraceId,
            source: "broker-ingestion-bridge",
          },
          `Zod Schema Validation Failed: ${errorDetail}`,
          1,
        );

        throw new AppError(
          `Dữ liệu payload vi phạm không hợp lệ: ${errorDetail}`,
          400,
          ERROR_CODE.VALIDATION_ERROR,
        );
      }

      eventId = uuidv7();
      traceId = effectiveIncomingTraceId || uuidv7();
      payload = {
        ...validation.data,
        detections: validation.data.detections ?? [],
      };
    }

    // 2. Khử trùng lặp đa tầng (Multi-Layer Idempotency Defense - Task BE-13):
    // 2.1. Kiểm tra Exact eventId
    const eventIdCheck = this.reliability.checkAndAcquireIdempotency(
      eventId,
      IDEMPOTENCY_REASON.EXACT_EVENT_ID,
    );

    // 2.2. Kiểm tra Exact violationId (nếu có)
    const violationIdCheck = payload.violationId
      ? this.reliability.checkAndAcquireIdempotency(
          payload.violationId,
          IDEMPOTENCY_REASON.EXACT_VIOLATION_ID,
        )
      : { isDuplicate: false };

    // 2.3. Nếu không có violationId, sử dụng Business Fingerprint Cooldown (chống AI frame jitter)
    let bizCheck = { isDuplicate: false };
    const bizKey = this.reliability.computeBusinessDedupKey(payload);
    if (!payload.violationId) {
      bizCheck = this.reliability.checkAndAcquireIdempotency(
        bizKey,
        IDEMPOTENCY_REASON.BUSINESS_FINGERPRINT_COOLDOWN,
        RETRY_POLICY.DEFAULT_COOLDOWN_WINDOW_MS,
      );
    }

    // 2.4. Kết hợp kiểm tra bộ nhớ đệm EventBus
    const isBusDuplicate =
      this.bus.isEventAlreadyProcessed(eventId) ||
      (payload.violationId &&
        this.bus.isEventAlreadyProcessed(payload.violationId));

    const isDuplicate =
      eventIdCheck.isDuplicate ||
      violationIdCheck.isDuplicate ||
      bizCheck.isDuplicate ||
      Boolean(isBusDuplicate);

    if (isDuplicate) {
      return {
        success: true,
        eventId,
        traceId,
        topic: KAFKA_TOPICS.PPE_VIOLATION_DETECTED,
        status: "DUPLICATE_SKIPPED",
        duplicate: true,
        timestamp: Date.now(),
      };
    }

    // 3. Xuất bản sự kiện vào EventBus Backbone (BullMQ / In-Memory Queue)
    await this.bus.publish(
      EVENT_NAMES.PPE_VIOLATION_DETECTED,
      payload,
      {
        aggregateId: payload.site.id,
        traceId,
      },
    );

    // Đánh dấu hoàn tất Idempotency trong ReliabilityService và EventBus
    this.reliability.completeIdempotency(eventId);
    this.bus.markEventProcessed(eventId);

    if (payload.violationId) {
      this.reliability.completeIdempotency(payload.violationId);
      this.bus.markEventProcessed(payload.violationId);
    }
    if (!payload.violationId) {
      this.reliability.completeIdempotency(
        bizKey,
        null,
        undefined,
        RETRY_POLICY.DEFAULT_COOLDOWN_WINDOW_MS,
      );
    }

    // 4. Ghi nhận dấu vết kiểm toán (Non-blocking)
    this.audit
      .recordLog({
        actorId: actorId || "ai-inference-engine",
        action: AUDIT_ACTION.PUBLISH_BROKER_MESSAGE,
        targetType: AUDIT_TARGET_TYPE.PPE_BROKER,
        targetId: eventId,
        details: {
          traceId,
          violationId: payload.violationId,
          siteId: payload.site.id,
          siteCode: payload.site.code,
          cameraId: payload.camera.id,
          violationCount: payload.violations.length,
          highestSeverity: payload.summary.highestSeverity,
        },
      })
      .catch(() => {});

    return {
      success: true,
      eventId,
      traceId,
      topic: KAFKA_TOPICS.PPE_VIOLATION_DETECTED,
      status: "PUBLISHED",
      duplicate: false,
      timestamp: Date.now(),
    };
  }

  /**
   * Kiểm tra tình trạng hoạt động của Broker, Subscribers và Dead-Letter Queue
   */
  async getBrokerHealth(): Promise<BrokerHealthResponseDto> {
    const activeSubscribers = this.bus.getSubscriberCount(
      EVENT_NAMES.PPE_VIOLATION_DETECTED,
    );
    const dlqEvents = this.bus.getDlqEvents();

    return {
      status: BROKER_STATUS.HEALTHY,
      redisConnected: this.bus.isConnected,
      activeSubscribers,
      dlqCount: dlqEvents.length,
      processedCacheCount: this.bus.processedCacheSize,
      timestamp: Date.now(),
    };
  }

  /**
   * Tra cứu danh sách các thông điệp bị lỗi trong Dead-Letter Queue (DLQ)
   */
  getDlqRecords(query?: DlqQueryDto): PaginatedResultDto<DlqRecordItemDto> {
    const rawEvents = this.bus.getDlqEvents();
    const page = query?.page || 1;
    const limit = Math.min(
      query?.limit || BROKER_LIMITS.DEFAULT_PAGE_SIZE,
      BROKER_LIMITS.MAX_PAGE_SIZE,
    );

    let filtered: DlqRecordItemDto[] = rawEvents.map((r: DlqRecord) => ({
      id: r.envelope.id,
      topic: r.envelope.name,
      eventId: r.envelope.id,
      traceId: r.envelope.traceId,
      envelope: r.envelope,
      error: r.error,
      failedAt: r.failedAt,
      attempts: r.attempts,
      status: (r.status as DlqRecordStatus) || DLQ_RECORD_STATUS.PENDING,
      reprocessedAt: r.reprocessedAt,
    }));

    if (query?.topic) {
      filtered = filtered.filter((r) =>
        r.topic.toLowerCase().includes(query.topic!.toLowerCase()),
      );
    }

    if (query?.search) {
      const s = query.search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.eventId.toLowerCase().includes(s) ||
          r.error.toLowerCase().includes(s),
      );
    }

    // Sắp xếp thời gian lỗi mới nhất lên đầu
    filtered.sort((a, b) => b.failedAt - a.failedAt);

    const total = filtered.length;
    const { skip, take } = calculatePaginationSkip(page, limit);
    const items = filtered.slice(skip, skip + take);

    return {
      data: items,
      meta: formatPaginationMeta(page, limit, total),
    };
  }

  /**
   * Tái xử lý (Reprocess) một thông điệp Poison Pill từ Dead-Letter Queue
   */
  async reprocessDlqRecord(
    eventId: string,
    actorId?: string,
  ): Promise<ReprocessDlqResponseDto> {
    const dlqEvents = this.bus.getDlqEvents();
    const targetRecord = dlqEvents.find((r) => r.envelope.id === eventId);

    if (!targetRecord) {
      throw new AppError(
        `Không tìm thấy sự kiện lỗi với ID ${eventId} trong Dead-Letter Queue`,
        404,
        ERROR_CODE.NOT_FOUND,
      );
    }

    // Thử dispatch lại trực tiếp qua pipeline consumers
    await this.bus.dispatchDirectly(targetRecord.envelope);

    // Đánh dấu bản ghi đã được tái xử lý thành công trong hàng đợi DLQ
    this.bus.markDlqReprocessed(eventId);

    // Ghi nhận Audit Log
    this.audit
      .recordLog({
        actorId: actorId || "SYSTEM",
        action: AUDIT_ACTION.REPROCESS_DLQ_MESSAGE,
        targetType: AUDIT_TARGET_TYPE.PPE_BROKER,
        targetId: eventId,
        details: {
          topic: targetRecord.envelope.name,
          previousError: targetRecord.error,
          reprocessedAt: new Date().toISOString(),
        },
      })
      .catch(() => {});

    return {
      success: true,
      eventId,
      reprocessed: true,
      message: "Thông điệp đã được tái xử lý thành công qua consumers",
    };
  }

  /**
   * Xóa toàn bộ hoặc dọn dẹp các bản ghi trong Dead-Letter Queue
   */
  purgeDlq(actorId?: string): { success: boolean; purgedCount: number } {
    const count = this.bus.getDlqEvents().length;
    this.bus.clearDlq();

    if (count > 0) {
      this.audit
        .recordLog({
          actorId: actorId || "SYSTEM",
          action: AUDIT_ACTION.PURGE_DLQ_MESSAGES,
          targetType: AUDIT_TARGET_TYPE.PPE_BROKER,
          targetId: "DLQ_QUEUE",
          details: { purgedCount: count },
        })
        .catch(() => {});
    }

    return { success: true, purgedCount: count };
  }
}

export const brokerService = new BrokerService();
