import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { uuidv7, generateId } from "../src/common/helpers/uuid.helper";
import { DEFAULT_TRANSACTION_OPTIONS } from "../src/database/prisma.client";

describe("UUIDv7 & Database Optimization Helpers", () => {
  const UUID_V7_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("should generate a valid UUIDv7 string adhering to RFC 9562", () => {
    const id = uuidv7();
    assert.equal(typeof id, "string");
    assert.equal(id.length, 36);
    assert.match(id, UUID_V7_REGEX);

    // Character at index 14 (0-based) must be '7' for version 7
    assert.equal(id.charAt(14), "7");
    // Character at index 19 (0-based) must be 8, 9, a, or b (variant 1)
    assert.match(id.charAt(19), /^[89ab]$/i);
  });

  it("should provide generateId as a drop-in alias for uuidv7", () => {
    const id = generateId();
    assert.equal(typeof id, "string");
    assert.match(id, UUID_V7_REGEX);
  });

  it("should generate monotonically sortable identifiers over time", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(uuidv7());
      if (i % 5 === 0) {
        // Sleep 2ms to ensure timestamp ticks
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    }

    const sorted = [...ids].sort();
    assert.deepEqual(
      ids,
      sorted,
      "UUIDv7 tokens must sort naturally in chronological order",
    );
  });

  it("should verify DEFAULT_TRANSACTION_OPTIONS configuration", () => {
    assert.equal(DEFAULT_TRANSACTION_OPTIONS.maxWait, 10000);
    assert.equal(DEFAULT_TRANSACTION_OPTIONS.timeout, 15000);
  });
});
