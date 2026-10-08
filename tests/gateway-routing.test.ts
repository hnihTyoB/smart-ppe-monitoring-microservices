/**
 * Gateway Dynamic Routing & Request Correlation Test Suite (Mục 2 & 4)
 *
 * Kiểm thử toàn diện kiến trúc Traefik v3 API Gateway và định tuyến 6 Microservices:
 *   1. Gateway Raw Data & Router Registration (Traefik Dashboard :8080)
 *   2. Request Correlation & Distributed Tracing (X-Request-Id propagation & UUIDv7 fallback)
 *   3. Security Headers Enforcement (X-Content-Type-Options, X-Frame-Options, Permissions-Policy)
 *   4. Auth Propagation qua Gateway (Login -> Bearer Token Forwarding -> User Me)
 *   5. Dual-Route Microservices Routing:
 *      - Notification Service (:8889)
 *      - Media Service (:8890)
 *      - Identity / Core API (:9999)
 *   6. Dynamic Routing Verification cho các Microservices mở rộng (Sites, Cameras, Incidents, Reporting)
 *      - Khớp rule độ ưu tiên cao (priority 100)
 *      - Trả về 502 Bad Gateway từ Traefik thay vì 404 Not Found từ App-API khi service chưa online
 *   7. Catch-All Routing & 404 Handling cho Unknown Routes
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost";
const TRAEFIK_DASHBOARD_URL = process.env.TRAEFIK_DASHBOARD_URL ?? "http://localhost:8080";

const ADMIN_EMAIL = "admin@template.local";
const ADMIN_PASSWORD = "Admin@123456";

describe("Traefik API Gateway — Dynamic Routing & Request Correlation (Mục 2 & 4)", () => {
  // ── 1. Gateway Dashboard & Router Registration ─────────────────────────────
  describe("1. Traefik Router & Service Registration", () => {
    it("1.1 Phải đăng ký đầy đủ 7 microservices routers trên Traefik", async () => {
      const res = await fetch(`${TRAEFIK_DASHBOARD_URL}/api/rawdata`);
      assert.strictEqual(res.status, 200, "Traefik rawdata API phải trả về 200 OK");

      const data = await res.json();
      const routers = Object.keys(data.routers || {});

      assert.ok(routers.includes("app-api@file"), "Phải có router app-api@file");
      assert.ok(routers.includes("sites@file"), "Phải có router sites@file");
      assert.ok(routers.includes("cameras@file"), "Phải có router cameras@file");
      assert.ok(routers.includes("incidents@file"), "Phải có router incidents@file");
      assert.ok(routers.includes("notifications@file"), "Phải có router notifications@file");
      assert.ok(routers.includes("reporting@file"), "Phải có router reporting@file");
      assert.ok(routers.includes("media@file"), "Phải có router media@file");
    });

    it("1.2 Phải đăng ký đầy đủ 7 microservices services trên Traefik", async () => {
      const res = await fetch(`${TRAEFIK_DASHBOARD_URL}/api/rawdata`);
      const data = await res.json();
      const services = Object.keys(data.services || {});

      assert.ok(services.includes("app-api@file"), "Phải có service app-api@file");
      assert.ok(services.includes("site-service@file"), "Phải có service site-service@file");
      assert.ok(services.includes("camera-service@file"), "Phải có service camera-service@file");
      assert.ok(services.includes("incident-service@file"), "Phải có service incident-service@file");
      assert.ok(services.includes("notification-service@file"), "Phải có service notification-service@file");
      assert.ok(services.includes("reporting-service@file"), "Phải có service reporting-service@file");
      assert.ok(services.includes("media-service@file"), "Phải có service media-service@file");
    });
  });

  // ── 2. Request Correlation & Distributed Tracing ───────────────────────────
  describe("2. Request Correlation & Tracing", () => {
    it("2.1 Phải giữ nguyên X-Request-Id khi client chủ động truyền vào (Correlation)", async () => {
      const customTraceId = "trace-ppe-monitor-test-99999";
      const res = await fetch(`${GATEWAY_URL}/api/v1/health`, {
        headers: { "x-request-id": customTraceId },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(
        res.headers.get("x-request-id"),
        customTraceId,
        "Gateway & service phải trả về đúng X-Request-Id mà client đã gửi",
      );
    });

    it("2.2 Phải tự sinh UUIDv7 khi client không truyền X-Request-Id", async () => {
      const res = await fetch(`${GATEWAY_URL}/api/v1/health`);
      assert.strictEqual(res.status, 200);

      const returnedId = res.headers.get("x-request-id");
      assert.ok(returnedId, "Response phải có header x-request-id");
      // UUIDv7 regex format
      const uuidv7Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      assert.ok(uuidv7Regex.test(returnedId), `ID "${returnedId}" phải là UUIDv7`);
    });
  });

  // ── 3. Security Headers Enforcement ────────────────────────────────────────
  describe("3. Gateway Security Headers Enforcement", () => {
    it("3.1 Gateway phải inject đầy đủ các security headers theo tiêu chuẩn", async () => {
      const res = await fetch(`${GATEWAY_URL}/api/v1/health`);
      assert.strictEqual(res.status, 200);

      assert.strictEqual(
        res.headers.get("x-content-type-options"),
        "nosniff",
        "Phải có X-Content-Type-Options: nosniff",
      );
      assert.strictEqual(
        res.headers.get("x-frame-options"),
        "DENY",
        "Phải có X-Frame-Options: DENY",
      );
      assert.ok(
        res.headers.get("permissions-policy")?.includes("camera=()"),
        "Phải có Permissions-Policy",
      );
      assert.strictEqual(
        res.headers.get("referrer-policy"),
        "strict-origin-when-cross-origin",
        "Phải có Referrer-Policy",
      );
    });
  });

  // ── 4. Auth Propagation qua Gateway ────────────────────────────────────────
  describe("4. Auth Propagation qua Gateway", () => {
    let authToken = "";

    it("4.1 Đăng nhập qua Gateway (/api/v1/auth/login) nhận Bearer Token", async () => {
      const res = await fetch(`${GATEWAY_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
        }),
      });

      assert.strictEqual(res.status, 200, "Đăng nhập admin phải trả về 200");
      const data = await res.json();
      assert.ok(data.data?.accessToken, "Phải nhận được accessToken");
      authToken = data.data.accessToken;
    });

    it("4.2 Gateway forward Bearer Token tới Identity Service (/api/v1/auth/me) thành công", async () => {
      assert.ok(authToken, "Cần có token từ bước trước");
      const res = await fetch(`${GATEWAY_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      assert.strictEqual(res.status, 200, "GET /auth/me phải trả về 200 với token hợp lệ");
      const data = await res.json();
      assert.strictEqual(data.data?.email, ADMIN_EMAIL);
    });

    it("4.3 Gateway forward Bearer Token tới Notification Service (/api/v1/notifications) thành công", async () => {
      assert.ok(authToken, "Cần có token từ bước trước");
      const res = await fetch(`${GATEWAY_URL}/api/v1/notifications`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      assert.strictEqual(
        res.status,
        200,
        "Notification service phải chấp nhận token được Gateway chuyển tiếp",
      );
      const data = await res.json();
      assert.strictEqual(data.success, true);
    });
  });

  // ── 5. Dynamic Routing tới các Microservices chuyên biệt ───────────────────
  describe("5. Dynamic Routing tới 6 Microservices Domain", () => {
    it("5.1 /api/v1/sites phải khớp router sites@file (ưu tiên 100, đích :8891)", async () => {
      const res = await fetch(`${GATEWAY_URL}/api/v1/sites`);
      // Khi site-service (:8891) chưa chạy, Traefik trả về 502 Bad Gateway
      // Nếu không khớp router này, request sẽ rơi xuống app-api (catch-all priority 1) và trả 404
      assert.strictEqual(
        res.status,
        502,
        "/api/v1/sites phải trúng router sites@file và trả về 502 từ Traefik",
      );
    });

    it("5.2 /api/v1/cameras phải khớp router cameras@file (ưu tiên 100, đích :8892)", async () => {
      const res = await fetch(`${GATEWAY_URL}/api/v1/cameras`);
      assert.strictEqual(
        res.status,
        502,
        "/api/v1/cameras phải trúng router cameras@file và trả về 502 từ Traefik",
      );
    });

    it("5.3 /api/v1/incidents phải khớp router incidents@file (ưu tiên 100, đích :8893)", async () => {
      const res = await fetch(`${GATEWAY_URL}/api/v1/incidents`);
      assert.strictEqual(
        res.status,
        502,
        "/api/v1/incidents phải trúng router incidents@file và trả về 502 từ Traefik",
      );
    });

    it("5.4 /api/v1/reports phải khớp router reporting@file (ưu tiên 100, đích :8894)", async () => {
      const res = await fetch(`${GATEWAY_URL}/api/v1/reports`);
      assert.strictEqual(
        res.status,
        502,
        "/api/v1/reports phải trúng router reporting@file và trả về 502 từ Traefik",
      );
    });

    it("5.5 /api/v1/non-existent-route phải rơi vào app-api catch-all và trả về 404 từ App API", async () => {
      const res = await fetch(`${GATEWAY_URL}/api/v1/non-existent-route-9999`);
      assert.strictEqual(
        res.status,
        404,
        "Unknown route phải rơi vào app-api catch-all và trả về 404",
      );
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.code, "NOT_FOUND");
    });
  });
});
