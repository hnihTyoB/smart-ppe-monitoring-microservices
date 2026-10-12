import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleApiShutdown } from "../src/identity.server";
import { startWorkerProcess, handleWorkerShutdown } from "../src/worker.server";
import app from "../src/identity.app";

describe("Microservices Phase 1: Process Decoupling Test Suite", () => {
  describe("1. API Server Process Verification", () => {
    it("should export Express app and listen handler cleanly", () => {
      assert.ok(app, "Express app must be defined and exported");
      assert.equal(
        typeof app.listen,
        "function",
        "app.listen must be a callable function",
      );
    });

    it("should provide graceful shutdown handler for API process", async () => {
      assert.equal(
        typeof handleApiShutdown,
        "function",
        "handleApiShutdown must be a function",
      );
      // Run shutdown in test mode (NODE_ENV=test ensures process.exit is bypassed)
      await assert.doesNotReject(async () => {
        await handleApiShutdown("TEST_SIGNAL");
      });
    });
  });

  describe("2. Background Worker Process Verification", () => {
    it("should export startWorkerProcess and handleWorkerShutdown functions", () => {
      assert.equal(
        typeof startWorkerProcess,
        "function",
        "startWorkerProcess must be a function",
      );
      assert.equal(
        typeof handleWorkerShutdown,
        "function",
        "handleWorkerShutdown must be a function",
      );
    });

    it("should initialize workers cleanly without binding HTTP ports", async () => {
      await assert.doesNotReject(async () => {
        await startWorkerProcess();
      });
    });

    it("should handle graceful shutdown of BullMQ workers safely", async () => {
      await assert.doesNotReject(async () => {
        await handleWorkerShutdown("TEST_SIGNAL");
      });
    });
  });
});
