import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractTokenFromRequest,
  authMiddleware,
} from "../src/middlewares/auth.middleware";
import { apiKeyAuthMiddleware } from "../src/middlewares/api-key.middleware";
import { IntegrationRepository } from "../src/modules/integration/integration.repository";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { AppError } from "../src/common/errors/app-error";

describe("Production Hardening & Security Middleware", () => {
  describe("1. Chống rò rỉ JWT qua Query String", () => {
    it("should NOT extract JWT from query string on standard endpoints", () => {
      const mockReq = {
        path: "/api/v1/users",
        query: { token: "secret-token-query" },
        headers: {},
        cookies: {},
      } as any;

      const extracted = extractTokenFromRequest(mockReq);
      assert.equal(extracted, undefined);
    });

    it("should allow query token on /stream (SSE) endpoints", () => {
      const mockReq = {
        path: "/api/v1/notifications/stream",
        query: { token: "sse-stream-token" },
        headers: {},
        cookies: {},
      } as any;

      const extracted = extractTokenFromRequest(mockReq);
      assert.equal(extracted, "sse-stream-token");
    });

    it("should allow query token on /download endpoints", () => {
      const mockReq = {
        path: "/api/v1/reports/export/download",
        query: { token: "direct-download-token" },
        headers: {},
        cookies: {},
      } as any;

      const extracted = extractTokenFromRequest(mockReq);
      assert.equal(extracted, "direct-download-token");
    });

    it("authMiddleware should strictly reject ?token= on standard endpoints with 400 Bad Request", async () => {
      const mockReq = {
        path: "/api/v1/users",
        query: { token: "leaked-in-query" },
        headers: {},
        cookies: {},
      } as any;
      const mockRes = {} as any;

      let caughtError: any = null;
      await authMiddleware(mockReq, mockRes, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError instanceof AppError);
      assert.equal(caughtError.statusCode, 400);
      assert.equal(caughtError.code, ERROR_CODE.VALIDATION_ERROR);
    });
  });

  describe("2. Chống IP Whitelist Spoofing trong API Key Middleware", () => {
    it("should reject with 403 when forged x-forwarded-for matches whitelist but real IP does not", async () => {
      const origFindApiKey =
        IntegrationRepository.prototype.findApiKeyByKeyHash;
      try {
        IntegrationRepository.prototype.findApiKeyByKeyHash = (async () => ({
          id: "key-uuid-1",
          name: "Whitelisted Key",
          prefix: "ak_test",
          isActive: true,
          expiresAt: null,
          user: {
            id: "user-uuid-1",
            email: "partner@example.com",
            isActive: true,
            deletedAt: null,
            role: { name: "USER" },
            roleId: "role-uuid-1",
          },
          permissions: ["INTEGRATION_READ"],
          ipWhitelist: ["192.168.1.100"],
        })) as any;

        const mockReq = {
          headers: {
            "x-api-key": "ak_test_valid_key",
            "x-forwarded-for": "192.168.1.100", // Forged spoofed IP
          },
          ip: "203.0.113.195", // True client IP
          socket: { remoteAddress: "::ffff:203.0.113.195" },
        } as any;
        const mockRes = {} as any;

        let caughtError: any = null;
        await apiKeyAuthMiddleware(mockReq, mockRes, (err?: any) => {
          caughtError = err;
        });

        assert.ok(caughtError instanceof AppError);
        assert.equal(caughtError.statusCode, 403);
        assert.equal(caughtError.code, ERROR_CODE.FORBIDDEN);
      } finally {
        IntegrationRepository.prototype.findApiKeyByKeyHash = origFindApiKey;
      }
    });

    it("should allow request when real IP matches whitelist (even with IPv4-mapped IPv6 ::ffff: prefix)", async () => {
      const origFindApiKey =
        IntegrationRepository.prototype.findApiKeyByKeyHash;
      const origUpdateLastUsed =
        IntegrationRepository.prototype.updateApiKeyLastUsed;
      try {
        IntegrationRepository.prototype.findApiKeyByKeyHash = (async () => ({
          id: "key-uuid-2",
          name: "Whitelisted Key 2",
          prefix: "ak_test",
          isActive: true,
          expiresAt: null,
          user: {
            id: "user-uuid-1",
            email: "partner@example.com",
            isActive: true,
            deletedAt: null,
            role: { name: "USER" },
            roleId: "role-uuid-1",
          },
          permissions: ["INTEGRATION_READ"],
          ipWhitelist: ["192.168.1.100"],
        })) as any;
        IntegrationRepository.prototype.updateApiKeyLastUsed = async () =>
          ({}) as any;

        const mockReq = {
          headers: {
            "x-api-key": "ak_test_valid_key",
          },
          ip: "::ffff:192.168.1.100",
          socket: { remoteAddress: "::ffff:192.168.1.100" },
        } as any;
        const mockRes = {} as any;

        let calledNext = false;
        let caughtError: any = null;
        await apiKeyAuthMiddleware(mockReq, mockRes, (err?: any) => {
          calledNext = true;
          caughtError = err;
        });

        assert.equal(calledNext, true);
        assert.equal(caughtError, undefined);
        assert.ok(mockReq.user);
        assert.equal(mockReq.user.id, "user-uuid-1");
      } finally {
        IntegrationRepository.prototype.findApiKeyByKeyHash = origFindApiKey;
        IntegrationRepository.prototype.updateApiKeyLastUsed =
          origUpdateLastUsed;
      }
    });
  });
});
