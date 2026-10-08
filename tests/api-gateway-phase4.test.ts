/**
 * Phase 4: API Gateway & Reverse Proxy — Test Suite
 *
 * Bao phủ:
 *   1. Gateway constants — cấu trúc và tính đúng đắn
 *   2. UUIDv7 format validation trong Request ID
 *   3. isTrustedGatewayRequest — pure function, testable
 *   4. requestIdMiddleware — sinh UUIDv7, set headers
 *   5. createRequestIdMiddleware factory — gateway trust logic
 *   6. createRequireGatewayOrigin factory — block/allow logic
 *   7. env.config.ts — gateway.internalSecret
 *   8. Traefik config files — file structure
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GATEWAY_HEADERS,
  GATEWAY_ROUTES,
} from "../src/common/constants/gateway.constant";
import { uuidv7 } from "../src/common/helpers/uuid.helper";
import { envConfig } from "../src/config/env.config";
import {
  REQUEST_ID_HEADER,
  isTrustedGatewayRequest,
  requestIdMiddleware,
  createRequestIdMiddleware,
  createRequireGatewayOrigin,
  isValidRequestId,
} from "../src/middlewares/request-id.middleware";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers để mock Express Request/Response
// ─────────────────────────────────────────────────────────────────────────────
type MockReq = {
  headers: Record<string, string>;
  id?: string;
  socket: { remoteAddress: string };
  ip?: string;
};

type MockRes = {
  headers: Record<string, string>;
  statusCode?: number;
  body?: unknown;
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
};

function makeReq(headers: Record<string, string> = {}): MockReq {
  return {
    headers: { ...headers },
    socket: { remoteAddress: "127.0.0.1" },
  };
}

function makeRes(): MockRes {
  const res: MockRes = {
    headers: {},
    statusCode: undefined,
    body: undefined,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return {
        json(body: unknown) {
          res.body = body;
        },
      };
    },
  };
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Gateway Constants
// ─────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — 1. Gateway Constants", () => {
  it("1.1 GATEWAY_HEADERS phải có đủ các header cần thiết", () => {
    assert.strictEqual(GATEWAY_HEADERS.REQUEST_ID, "x-request-id");
    assert.strictEqual(GATEWAY_HEADERS.INTERNAL_SECRET, "x-gateway-secret");
    assert.strictEqual(GATEWAY_HEADERS.REAL_IP, "x-real-ip");
    assert.strictEqual(GATEWAY_HEADERS.FORWARDED_PROTO, "x-forwarded-proto");
    assert.strictEqual(GATEWAY_HEADERS.FORWARDED_HOST, "x-forwarded-host");
    assert.strictEqual(
      GATEWAY_HEADERS.FORWARDED_SERVICE,
      "x-forwarded-service",
    );
  });

  it("1.2 GATEWAY_HEADERS phải là lowercase (HTTP header convention)", () => {
    for (const [key, value] of Object.entries(GATEWAY_HEADERS)) {
      assert.strictEqual(
        value,
        value.toLowerCase(),
        `GATEWAY_HEADERS.${key} = "${value}" phải lowercase`,
      );
    }
  });

  it("1.3 GATEWAY_ROUTES phải có tất cả routes cần thiết và đều /api/v1 prefix", () => {
    const routes = Object.values(GATEWAY_ROUTES);
    for (const route of routes) {
      assert.ok(
        route.startsWith("/api/v1"),
        `Route "${route}" phải bắt đầu bằng /api/v1`,
      );
    }
    assert.ok(routes.includes("/api/v1/auth"));
    assert.ok(routes.includes("/api/v1/health"));
    assert.ok(routes.includes("/api/v1/users"));
    assert.ok(routes.includes("/api/v1/notifications"));
  });

  it("1.4 REQUEST_ID_HEADER phải khớp GATEWAY_HEADERS.REQUEST_ID", () => {
    assert.strictEqual(REQUEST_ID_HEADER, GATEWAY_HEADERS.REQUEST_ID);
    assert.strictEqual(REQUEST_ID_HEADER, "x-request-id");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. UUIDv7 Format & Time-Ordering
// ─────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — 2. UUIDv7 Format cho Request IDs", () => {
  const UUID_V7_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("2.1 uuidv7() phải sinh UUIDv7 hợp lệ theo regex", () => {
    for (let i = 0; i < 20; i++) {
      const id = uuidv7();
      assert.ok(
        UUID_V7_REGEX.test(id),
        `uuidv7() "${id}" phải match UUIDv7 regex`,
      );
    }
  });

  it("2.2 Version bit phải là 7", () => {
    for (let i = 0; i < 5; i++) {
      const id = uuidv7();
      const versionChar = id.split("-")[2]![0];
      assert.strictEqual(
        versionChar,
        "7",
        `Version char phải là '7', UUID: ${id}`,
      );
    }
  });

  it("2.3 Variant bits phải đúng chuẩn RFC 9562 (chars [89ab])", () => {
    for (let i = 0; i < 10; i++) {
      const id = uuidv7();
      const variantChar = id.split("-")[3]![0].toLowerCase();
      assert.ok(
        ["8", "9", "a", "b"].includes(variantChar),
        `Variant char '${variantChar}' phải là [89ab], UUID: ${id}`,
      );
    }
  });

  it("2.4 Timestamp trong UUIDv7 phải nằm trong khoảng ±500ms từ hiện tại", () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();

    const hex = id.replace(/-/g, "").slice(0, 12); // 48-bit Unix ms timestamp
    const ts = parseInt(hex, 16);

    assert.ok(ts >= before - 500, `Timestamp ${ts} phải >= before-500ms`);
    assert.ok(ts <= after + 500, `Timestamp ${ts} phải <= after+500ms`);
  });

  it("2.5 100 UUIDv7 liên tiếp phải đều duy nhất", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(uuidv7());
    assert.strictEqual(ids.size, 100, "Phải sinh 100 UUID duy nhất");
  });

  it("2.6 UUIDv7 phải có thứ tự lexicographic tăng dần (time-ordered)", () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(uuidv7());
    for (let i = 1; i < ids.length; i++) {
      assert.ok(ids[i]! >= ids[i - 1]!, `UUID[${i}] phải >= UUID[${i - 1}]`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. isTrustedGatewayRequest — Pure function tests
// ─────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — 3. isTrustedGatewayRequest (pure function)", () => {
  it("3.1 Phải trả về false khi secret rỗng (monolith mode)", () => {
    const req = makeReq({ "x-gateway-secret": "anything" });
    assert.strictEqual(isTrustedGatewayRequest(req as any, ""), false);
  });

  it("3.2 Phải trả về false khi header x-gateway-secret không có", () => {
    const req = makeReq({}); // Không có x-gateway-secret
    assert.strictEqual(isTrustedGatewayRequest(req as any, "my-secret"), false);
  });

  it("3.3 Phải trả về false khi secret không khớp", () => {
    const req = makeReq({ "x-gateway-secret": "wrong-secret" });
    assert.strictEqual(
      isTrustedGatewayRequest(req as any, "correct-secret"),
      false,
    );
  });

  it("3.4 Phải trả về true khi secret khớp chính xác", () => {
    const secret = "my-shared-gateway-secret-32chars!";
    const req = makeReq({ "x-gateway-secret": secret });
    assert.strictEqual(isTrustedGatewayRequest(req as any, secret), true);
  });

  it("3.5 Phải trả về false khi header là chuỗi rỗng dù secret có giá trị", () => {
    const req = makeReq({ "x-gateway-secret": "" });
    assert.strictEqual(
      isTrustedGatewayRequest(req as any, "real-secret"),
      false,
    );
  });

  it("3.6 Phải phân biệt chữ hoa/thường (case-sensitive)", () => {
    const req = makeReq({ "x-gateway-secret": "Secret" });
    assert.strictEqual(isTrustedGatewayRequest(req as any, "secret"), false);
    assert.strictEqual(isTrustedGatewayRequest(req as any, "Secret"), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. requestIdMiddleware — Header & UUIDv7
// ─────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — 4. requestIdMiddleware", () => {
  const UUID_V7_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("4.1 Phải sinh UUIDv7 mới khi không có x-request-id header", () => {
    const req = makeReq();
    const res = makeRes();
    let called = false;
    requestIdMiddleware(req as any, res as any, () => {
      called = true;
    });

    assert.ok(called, "next() phải được gọi");
    assert.ok(req.id, "req.id phải được set");
    assert.ok(UUID_V7_REGEX.test(req.id!), `req.id "${req.id}" phải là UUIDv7`);
    assert.strictEqual(res.headers["x-request-id"], req.id);
  });

  it("4.2 Phải set X-Request-Id trong response header", () => {
    const req = makeReq();
    const res = makeRes();
    requestIdMiddleware(req as any, res as any, () => {});
    assert.ok("x-request-id" in res.headers);
    assert.ok(res.headers["x-request-id"].length > 0);
  });

  it("4.3 Phải update req.headers[x-request-id] với ID được chọn", () => {
    const req = makeReq();
    const res = makeRes();
    requestIdMiddleware(req as any, res as any, () => {});
    assert.ok("x-request-id" in req.headers);
    assert.strictEqual(req.headers["x-request-id"], req.id);
  });

  it("4.4 Hai request liên tiếp phải nhận ID khác nhau", () => {
    const req1 = makeReq();
    const req2 = makeReq();
    requestIdMiddleware(req1 as any, makeRes() as any, () => {});
    requestIdMiddleware(req2 as any, makeRes() as any, () => {});
    assert.notStrictEqual(req1.id, req2.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. createRequestIdMiddleware factory — Gateway Trust Logic
// ─────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — 5. createRequestIdMiddleware (Gateway Trust Logic)", () => {
  const UUID_V7_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("5.1 Khi secret rỗng: phải nhận x-request-id từ bất kỳ nguồn nào (monolith mode)", () => {
    const middleware = createRequestIdMiddleware(""); // Không có secret
    const gatewayId = "01932c3e-7d8f-7b1a-a3f2-4e5c6d7e8f9a";
    const req = makeReq({ "x-request-id": gatewayId });
    const res = makeRes();
    middleware(req as any, res as any, () => {});
    assert.strictEqual(
      req.id,
      gatewayId,
      "Phải giữ x-request-id khi secret rỗng",
    );
  });

  it("5.2 Khi có secret, không có x-gateway-secret: phải sinh mới", () => {
    const secret = "real-gateway-secret-32chars-long!!";
    const middleware = createRequestIdMiddleware(secret);
    const gatewayId = "01932c3e-7d8f-7b1a-a3f2-4e5c6d7e8f9a";
    const req = makeReq({ "x-request-id": gatewayId }); // Thiếu x-gateway-secret
    const res = makeRes();
    middleware(req as any, res as any, () => {});
    assert.notStrictEqual(
      req.id,
      gatewayId,
      "Phải sinh ID mới khi thiếu gateway secret",
    );
    assert.ok(UUID_V7_REGEX.test(req.id!), `req.id "${req.id}" phải là UUIDv7`);
  });

  it("5.3 Khi có secret, x-gateway-secret sai: phải sinh mới", () => {
    const secret = "real-gateway-secret-32chars-long!!";
    const middleware = createRequestIdMiddleware(secret);
    const gatewayId = "01932c3e-7d8f-7b1a-a3f2-4e5c6d7e8f9a";
    const req = makeReq({
      "x-request-id": gatewayId,
      "x-gateway-secret": "wrong-secret",
    });
    const res = makeRes();
    middleware(req as any, res as any, () => {});
    assert.notStrictEqual(req.id, gatewayId, "Phải sinh mới khi secret sai");
    assert.ok(UUID_V7_REGEX.test(req.id!));
  });

  it("5.4 Khi có secret và x-gateway-secret đúng: phải nhận x-request-id từ gateway", () => {
    const secret = "real-gateway-secret-32chars-long!!";
    const middleware = createRequestIdMiddleware(secret);
    const gatewayId = "01932c3e-7d8f-7b1a-a3f2-4e5c6d7e8f9a";
    const req = makeReq({
      "x-request-id": gatewayId,
      "x-gateway-secret": secret,
    });
    const res = makeRes();
    middleware(req as any, res as any, () => {});
    assert.strictEqual(
      req.id,
      gatewayId,
      "Phải giữ gateway ID khi secret khớp",
    );
    assert.strictEqual(res.headers["x-request-id"], gatewayId);
  });

  it("5.5 Khi không có x-request-id header: phải sinh mới dù secret đúng", () => {
    const secret = "real-gateway-secret-32chars-long!!";
    const middleware = createRequestIdMiddleware(secret);
    const req = makeReq({ "x-gateway-secret": secret }); // Không có x-request-id
    const res = makeRes();
    middleware(req as any, res as any, () => {});
    assert.ok(req.id, "req.id phải được set");
    assert.ok(UUID_V7_REGEX.test(req.id!), `req.id "${req.id}" phải là UUIDv7`);
  });

  it("5.6 Khi x-request-id chứa ký tự CRLF hoặc độc hại: phải từ chối và sinh mới UUIDv7", () => {
    const middleware = createRequestIdMiddleware("");
    const maliciousId = "attack-id\r\nSet-Cookie: evil=true";
    const req = makeReq({ "x-request-id": maliciousId });
    const res = makeRes();
    middleware(req as any, res as any, () => {});
    assert.notStrictEqual(req.id, maliciousId);
    assert.ok(
      UUID_V7_REGEX.test(req.id!),
      `req.id "${req.id}" phải fallback về UUIDv7 an toàn`,
    );
  });

  it("5.7 Khi x-request-id dài vượt quá 128 ký tự: phải từ chối và sinh mới UUIDv7", () => {
    const middleware = createRequestIdMiddleware("");
    const overlyLongId = "a".repeat(200);
    const req = makeReq({ "x-request-id": overlyLongId });
    const res = makeRes();
    middleware(req as any, res as any, () => {});
    assert.notStrictEqual(req.id, overlyLongId);
    assert.ok(UUID_V7_REGEX.test(req.id!));
  });

  it("5.8 isValidRequestId phải trả về true cho ID hợp lệ và false cho ký tự không an toàn", () => {
    assert.strictEqual(
      isValidRequestId("01932c3e-7d8f-7b1a-a3f2-4e5c6d7e8f9a"),
      true,
    );
    assert.strictEqual(isValidRequestId("valid_request-id_123"), true);
    assert.strictEqual(isValidRequestId("bad id with spaces"), false);
    assert.strictEqual(isValidRequestId("<script>"), false);
    assert.strictEqual(isValidRequestId(null), false);
    assert.strictEqual(isValidRequestId(""), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. createRequireGatewayOrigin factory — Block/Allow Logic
// ─────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — 6. createRequireGatewayOrigin", () => {
  it("6.1 Phải cho phép request khi secret rỗng (monolith dev mode)", () => {
    const middleware = createRequireGatewayOrigin("");
    const req = makeReq(); // Không có x-gateway-secret
    const res = makeRes();
    let passedErr: any = "NOT_CALLED";
    middleware(req as any, res as any, (err?: any) => {
      passedErr = err;
    });
    assert.strictEqual(
      passedErr,
      undefined,
      "next() phải được gọi không có lỗi",
    );
  });

  it("6.2 Phải block (403) và truyền AppError khi secret được cấu hình nhưng request thiếu header", () => {
    const middleware = createRequireGatewayOrigin(
      "configured-secret-32chars-long!!",
    );
    const req = makeReq(); // Thiếu x-gateway-secret
    const res = makeRes();
    let passedErr: any = null;
    middleware(req as any, res as any, (err?: any) => {
      passedErr = err;
    });

    assert.ok(passedErr instanceof AppError, "next() phải nhận AppError");
    assert.strictEqual(passedErr.statusCode, 403, "Phải có statusCode 403");
    assert.strictEqual(passedErr.code, ERROR_CODE.GATEWAY_REQUIRED);
  });

  it("6.3 Phải block (403) khi secret sai", () => {
    const correctSecret = "correct-secret-32-chars-minimum-ok!";
    const middleware = createRequireGatewayOrigin(correctSecret);
    const req = makeReq({ "x-gateway-secret": "wrong-secret" });
    const res = makeRes();
    let passedErr: any = null;
    middleware(req as any, res as any, (err?: any) => {
      passedErr = err;
    });

    assert.ok(passedErr instanceof AppError);
    assert.strictEqual(passedErr.statusCode, 403);
    assert.strictEqual(passedErr.code, ERROR_CODE.GATEWAY_REQUIRED);
  });

  it("6.4 Phải cho phép request khi secret đúng", () => {
    const secret = "correct-secret-32-chars-minimum-ok!";
    const middleware = createRequireGatewayOrigin(secret);
    const req = makeReq({ "x-gateway-secret": secret });
    const res = makeRes();
    let passedErr: any = "NOT_CALLED";
    middleware(req as any, res as any, (err?: any) => {
      passedErr = err;
    });

    assert.strictEqual(
      passedErr,
      undefined,
      "next() phải được gọi không có lỗi khi secret khớp",
    );
  });

  it("6.5 Phải block khi x-gateway-secret là chuỗi rỗng dù secret được cấu hình", () => {
    const middleware = createRequireGatewayOrigin(
      "real-secret-min-32-chars-minimum!!",
    );
    const req = makeReq({ "x-gateway-secret": "" });
    const res = makeRes();
    let passedErr: any = null;
    middleware(req as any, res as any, (err?: any) => {
      passedErr = err;
    });

    assert.ok(passedErr instanceof AppError);
    assert.strictEqual(passedErr.statusCode, 403);
    assert.strictEqual(passedErr.code, ERROR_CODE.GATEWAY_REQUIRED);
  });

  it("6.6 AppError phải có message rõ ràng và code GATEWAY_REQUIRED", () => {
    const middleware = createRequireGatewayOrigin(
      "some-secret-32-characters-long!!!",
    );
    const req = makeReq({ "x-gateway-secret": "bad" });
    const res = makeRes();
    let passedErr: any = null;
    middleware(req as any, res as any, (err?: any) => {
      passedErr = err;
    });

    assert.ok(passedErr instanceof AppError);
    assert.strictEqual(passedErr.statusCode, 403);
    assert.strictEqual(passedErr.code, ERROR_CODE.GATEWAY_REQUIRED);
    assert.ok(passedErr.message.includes("API gateway"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Env Config — gateway section
// ─────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — 7. Env Config gateway section", () => {
  it("7.1 envConfig phải có trường gateway", () => {
    assert.ok("gateway" in envConfig);
  });

  it("7.2 envConfig.gateway.internalSecret phải là string", () => {
    assert.strictEqual(typeof envConfig.gateway.internalSecret, "string");
  });

  it('7.3 internalSecret mặc định là "" khi GATEWAY_INTERNAL_SECRET không set', () => {
    if (!process.env.GATEWAY_INTERNAL_SECRET) {
      assert.strictEqual(envConfig.gateway.internalSecret, "");
    }
  });

  it("7.4 envConfig phải có đủ các trường cốt lõi", () => {
    assert.ok("nodeEnv" in envConfig);
    assert.ok("port" in envConfig);
    assert.ok("jwt" in envConfig);
    assert.ok("redis" in envConfig);
    assert.ok("rateLimit" in envConfig);
    assert.ok("gateway" in envConfig);
    assert.ok("cors" in envConfig);
    assert.ok("encryption" in envConfig);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Traefik Config Files — File Structure
// ─────────────────────────────────────────────────────────────────────────────
describe("Phase 4 — 8. Traefik Config Files & Infrastructure", () => {
  it("8.1 traefik/traefik.yml phải tồn tại", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    assert.ok(existsSync(join(process.cwd(), "traefik", "traefik.yml")));
  });

  it("8.2 traefik/dynamic.yml phải tồn tại", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    assert.ok(existsSync(join(process.cwd(), "traefik", "dynamic.yml")));
  });

  it("8.3 traefik/traefik.dev.yml phải tồn tại", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    assert.ok(existsSync(join(process.cwd(), "traefik", "traefik.dev.yml")));
  });

  it("8.4 docker-compose.yml phải chứa service traefik và network isolation", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const content = readFileSync(
      join(process.cwd(), "docker-compose.yml"),
      "utf8",
    );
    assert.ok(content.includes("traefik"), "Phải có service traefik");
    assert.ok(content.includes("internal_net"), "Phải có internal_net");
    assert.ok(content.includes("gateway_net"), "Phải có gateway_net");
    assert.ok(
      content.includes("GATEWAY_INTERNAL_SECRET"),
      "Phải truyền GATEWAY_INTERNAL_SECRET",
    );
  });

  it("8.5 dynamic.yml phải chứa đủ các middlewares cần thiết", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const content = readFileSync(
      join(process.cwd(), "traefik", "dynamic.yml"),
      "utf8",
    );
    assert.ok(
      content.includes("security-headers"),
      "Phải có middleware security-headers",
    );
    assert.ok(
      content.includes("global-ratelimit"),
      "Phải có middleware global-ratelimit",
    );
    assert.ok(content.includes("request-id"), "Phải có middleware request-id");
    assert.ok(
      content.includes("inject-gateway-secret"),
      "Phải có middleware inject-gateway-secret",
    );
  });

  it("8.6 .env.example phải chứa GATEWAY_INTERNAL_SECRET với comment giải thích", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const content = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    assert.ok(
      content.includes("GATEWAY_INTERNAL_SECRET"),
      "Phải có GATEWAY_INTERNAL_SECRET",
    );
    assert.ok(content.includes("API GATEWAY"), "Phải có section API GATEWAY");
  });

  it("8.7 docker-compose.dev.yml phải tồn tại cho development override", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    assert.ok(existsSync(join(process.cwd(), "docker-compose.dev.yml")));
  });
});
