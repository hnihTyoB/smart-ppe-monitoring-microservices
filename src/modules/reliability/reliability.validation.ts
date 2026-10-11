import { z } from "zod";
import { IDEMPOTENCY_STATUS, RELIABILITY_LIMITS } from "../../common/constants/reliability.constant";

export const idempotencyKeyQuerySchema = z.object({
  page: z.coerce
    .number({
      invalid_type_error: "Trang hiện tại (page) phải là một số hợp lệ",
    })
    .int("Trang hiện tại (page) phải là số nguyên")
    .min(1, "Trang hiện tại (page) phải là số nguyên dương lớn hơn hoặc bằng 1")
    .default(1),
  limit: z.coerce
    .number({
      invalid_type_error: "Kích thước trang (limit) phải là một số hợp lệ",
    })
    .int("Kích thước trang (limit) phải là số nguyên")
    .min(1, "Kích thước trang (limit) phải từ 1 đến " + RELIABILITY_LIMITS.MAX_PAGE_SIZE)
    .max(
      RELIABILITY_LIMITS.MAX_PAGE_SIZE,
      `Kích thước trang (limit) phải từ 1 đến ${RELIABILITY_LIMITS.MAX_PAGE_SIZE}`,
    )
    .default(RELIABILITY_LIMITS.DEFAULT_PAGE_SIZE),
  status: z.nativeEnum(IDEMPOTENCY_STATUS).optional(),
  search: z.string().trim().optional(),
});

export type IdempotencyKeyQueryInput = z.infer<typeof idempotencyKeyQuerySchema>;

export const purgeIdempotencyKeysSchema = z.object({
  confirm: z.boolean().default(true),
  status: z.nativeEnum(IDEMPOTENCY_STATUS).optional(),
});

export type PurgeIdempotencyKeysInput = z.infer<typeof purgeIdempotencyKeysSchema>;

export const traceParamSchema = z.object({
  traceId: z
    .string({ required_error: "Mã traceId là bắt buộc" })
    .trim()
    .min(1, "Mã traceId không được để trống")
    .max(128, "Mã traceId tối đa 128 ký tự")
    .regex(/^[a-zA-Z0-9_-]{1,128}$/, "Định dạng traceId không hợp lệ"),
});

export type TraceParamInput = z.infer<typeof traceParamSchema>;
