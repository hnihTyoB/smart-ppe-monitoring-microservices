import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z, ZodError } from "zod";
import { errorMiddleware } from "../src/middlewares/error.middleware";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { AppError } from "../src/common/errors/app-error";
import {
  uuidSchema,
  routeKeySchema,
  createUuidParamSchema,
  createRouteKeyParamSchema,
  standardIdParamSchema,
  standardKeyParamSchema,
} from "../src/common/validations/common.validation";
import { configKeyParamSchema } from "../src/modules/system-config/system-config.validation";
import {
  calculatePaginationSkip,
  formatPaginationMeta,
} from "../src/common/helpers/pagination.helper";

describe("Validation & API Error Handling & Pagination Standardization", () => {
  describe("1. Bắt ZodError tập trung (RFC 7807 / 422)", () => {
    it("should format native ZodError into RFC 7807 / 422 schema", () => {
      const dummySchema = z.object({
        email: z.string().email("Invalid email format"),
        age: z.number().min(18, "Must be at least 18 years old"),
      });

      let caughtZodError: ZodError | null = null;
      try {
        dummySchema.parse({ email: "not-an-email", age: 12 });
      } catch (err) {
        if (err instanceof ZodError) {
          caughtZodError = err;
        }
      }

      assert.ok(caughtZodError instanceof ZodError);

      let statusCode = 0;
      let jsonPayload: any = null;

      const mockReq = { headers: {} } as any;
      const mockRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          jsonPayload = data;
          return this;
        },
      } as any;

      errorMiddleware(caughtZodError, mockReq, mockRes, () => {});

      assert.equal(statusCode, 422);
      assert.equal(jsonPayload.success, false);
      assert.equal(jsonPayload.message, "Validation failed");
      assert.equal(jsonPayload.code, ERROR_CODE.VALIDATION_ERROR);
      assert.ok(Array.isArray(jsonPayload.errors));
      assert.equal(jsonPayload.errors.length, 2);
      assert.equal(jsonPayload.errors[0].field, "email");
      assert.equal(jsonPayload.errors[0].message, "Invalid email format");
      assert.equal(jsonPayload.errors[1].field, "age");
      assert.equal(
        jsonPayload.errors[1].message,
        "Must be at least 18 years old",
      );
    });

    it("should format AppError with VALIDATION_ERROR into HTTP 422 with errors array", () => {
      const formattedErrors = [
        { field: "username", message: "Username is required" },
      ];
      const appError = new AppError(
        "Validation failed",
        422,
        ERROR_CODE.VALIDATION_ERROR,
        formattedErrors,
      );

      let statusCode = 0;
      let jsonPayload: any = null;

      const mockReq = { headers: {} } as any;
      const mockRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          jsonPayload = data;
          return this;
        },
      } as any;

      errorMiddleware(appError, mockReq, mockRes, () => {});

      assert.equal(statusCode, 422);
      assert.equal(jsonPayload.success, false);
      assert.equal(jsonPayload.message, "Validation failed");
      assert.equal(jsonPayload.code, ERROR_CODE.VALIDATION_ERROR);
      assert.deepEqual(jsonPayload.errors, formattedErrors);
    });
  });

  describe("2. Bổ sung Param Schemas (UUID & Route Key)", () => {
    it("uuidSchema should validate valid UUID and reject invalid string", () => {
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";
      assert.equal(uuidSchema.safeParse(validUuid).success, true);

      assert.equal(uuidSchema.safeParse("not-a-uuid").success, false);
      assert.equal(uuidSchema.safeParse("12345").success, false);
      assert.equal(uuidSchema.safeParse("").success, false);
    });

    it("standardIdParamSchema should validate route param :id", () => {
      const validParams = { id: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d" };
      assert.equal(standardIdParamSchema.safeParse(validParams).success, true);

      const invalidParams = { id: "invalid-id" };
      assert.equal(
        standardIdParamSchema.safeParse(invalidParams).success,
        false,
      );
    });

    it("routeKeySchema should validate valid route keys and reject invalid formats", () => {
      const validKeys = [
        "feature_2fa_enabled",
        "auth.max_attempts",
        "email-smtp.host",
        "system_config_v2",
      ];
      for (const k of validKeys) {
        assert.equal(
          routeKeySchema.safeParse(k).success,
          true,
          `Key ${k} should be valid`,
        );
      }

      const invalidKeys = [
        "a", // too short (< 2)
        "key with spaces",
        "key$with#special",
        "key/with/slashes",
        "",
      ];
      for (const k of invalidKeys) {
        assert.equal(
          routeKeySchema.safeParse(k).success,
          false,
          `Key ${k} should be invalid`,
        );
      }
    });

    it("configKeyParamSchema should validate system config param :key", () => {
      assert.equal(
        configKeyParamSchema.safeParse({ key: "feature.dark_mode" }).success,
        true,
      );
      assert.equal(
        configKeyParamSchema.safeParse({ key: "invalid key" }).success,
        false,
      );
    });
  });

  describe("3. Chuẩn hóa Pagination Helper & Repository Contract", () => {
    it("calculatePaginationSkip should enforce 1-indexed page and clamp limit between 1 and 100", () => {
      // Normal values
      const res1 = calculatePaginationSkip(1, 20);
      assert.equal(res1.page, 1);
      assert.equal(res1.limit, 20);
      assert.equal(res1.skip, 0);
      assert.equal(res1.take, 20);

      // Page 2
      const res2 = calculatePaginationSkip(2, 20);
      assert.equal(res2.page, 2);
      assert.equal(res2.skip, 20);

      // Zero or negative page should default to 1 (1-indexed)
      const res3 = calculatePaginationSkip(-5, 10);
      assert.equal(res3.page, 1);
      assert.equal(res3.skip, 0);

      const res4 = calculatePaginationSkip(0, 10);
      assert.equal(res4.page, 1);
      assert.equal(res4.skip, 0);

      // Excessive limit should be clamped to max 100
      const res5 = calculatePaginationSkip(1, 500);
      assert.equal(res5.limit, 100);
      assert.equal(res5.take, 100);

      // Non-positive limit should default to minimum 1
      const res6 = calculatePaginationSkip(1, 0);
      assert.equal(res6.limit, 20); // defaults to defaultLimit (20)
    });

    it("formatPaginationMeta should calculate totalPages accurately", () => {
      const meta1 = formatPaginationMeta(1, 20, 45);
      assert.deepEqual(meta1, {
        page: 1,
        limit: 20,
        total: 45,
        totalPages: 3,
      });

      const meta2 = formatPaginationMeta(2, 20, 40);
      assert.deepEqual(meta2, {
        page: 2,
        limit: 20,
        total: 40,
        totalPages: 2,
      });

      const meta3 = formatPaginationMeta(1, 20, 0);
      assert.deepEqual(meta3, {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });
  });
});
