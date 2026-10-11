import { z } from "zod";
import {
  ppeViolationDetectedPayloadSchema,
  ppeViolationDetectedKafkaEventSchema,
} from "../../common/validations/kafka-event.schema";
import { uuidSchema } from "../../common/validations/common.validation";

/**
 * Zod Schema tiếp nhận sự kiện vi phạm ở biên HTTP
 * Chấp nhận cả định dạng Kafka Event Envelope hoàn chỉnh hoặc Payload vi phạm thuần túy
 */
export const publishViolationEventSchema = z.union([
  ppeViolationDetectedKafkaEventSchema,
  ppeViolationDetectedPayloadSchema,
]);

export type PublishViolationEventInput = z.infer<
  typeof publishViolationEventSchema
>;

/**
 * Zod Schema cho bộ lọc tra cứu danh sách Dead-Letter Queue
 */
export const dlqQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  topic: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

export type DlqQueryInput = z.infer<typeof dlqQuerySchema>;

/**
 * Zod Schema cho tham số reprocess thông điệp trong DLQ
 */
export const reprocessDlqParamsSchema = z.object({
  id: uuidSchema,
});

export type ReprocessDlqParamsInput = z.infer<typeof reprocessDlqParamsSchema>;
