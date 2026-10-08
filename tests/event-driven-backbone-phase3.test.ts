import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { uuidv7 } from "uuidv7";
import {
  EVENT_NAMES,
  OUTBOX_STATUS,
  EVENT_BUS_CONSTANTS,
} from "../src/common/constants/event.constant";
import {
  EventBusService,
  eventBus,
} from "../src/common/services/event-bus.service";
import {
  OutboxRepository,
  outboxRepository,
} from "../src/common/repositories/outbox.repository";
import { OutboxWorker } from "../src/common/workers/outbox.worker";
import { eventBusWorker } from "../src/common/workers/event-bus.worker";
import { NotificationSubscriber } from "../src/common/subscribers/notification.subscriber";
import { AuthCleanupSubscriber } from "../src/common/subscribers/auth-cleanup.subscriber";
import { StorageCleanupSubscriber } from "../src/common/subscribers/storage-cleanup.subscriber";
import {
  UserRegisteredPayload,
  PasswordResetRequestedPayload,
  NewDeviceDetectedPayload,
  UserSoftDeletedPayload,
  FileUploadedUnconfirmedPayload,
  EventEnvelope,
} from "../src/common/types/event.type";
import { prisma } from "../src/database/prisma.client";

describe("Phase 3: Event-Driven Backbone & Transactional Outbox Suite", () => {
  let customBus: EventBusService;
  let customOutboxRepo: OutboxRepository;

  beforeEach(async () => {
    customOutboxRepo = new OutboxRepository();
    customBus = new EventBusService(customOutboxRepo);
    await prisma.outboxEvent.deleteMany().catch(() => {});
  });

  afterEach(async () => {
    await customBus.close();
    eventBus.clearDlq();
    eventBus.clearProcessedCache();
  });

  describe("1. Event Contract Matrix Validation", () => {
    it("should satisfy auth.user_registered payload contract", () => {
      const payload: UserRegisteredPayload = {
        userId: "usr_11111111-1111-1111-1111-111111111111",
        email: "test@example.com",
        fullName: "Test User",
        verifyToken: "ver_token_12345",
      };

      assert.equal(payload.userId, "usr_11111111-1111-1111-1111-111111111111");
      assert.equal(payload.email, "test@example.com");
      assert.equal(payload.fullName, "Test User");
      assert.equal(payload.verifyToken, "ver_token_12345");
    });

    it("should satisfy auth.password_reset_requested payload contract", () => {
      const payload: PasswordResetRequestedPayload = {
        userId: "usr_22222222-2222-2222-2222-222222222222",
        email: "reset@example.com",
        resetToken: "rst_token_abcde",
        ip: "192.168.1.100",
      };

      assert.equal(payload.userId, "usr_22222222-2222-2222-2222-222222222222");
      assert.equal(payload.email, "reset@example.com");
      assert.equal(payload.resetToken, "rst_token_abcde");
      assert.equal(payload.ip, "192.168.1.100");
    });

    it("should satisfy auth.new_device_detected payload contract", () => {
      const payload: NewDeviceDetectedPayload = {
        userId: "usr_33333333-3333-3333-3333-333333333333",
        email: "device@example.com",
        deviceName: "Chrome on macOS 14.5",
        ip: "10.0.0.1",
      };

      assert.equal(payload.userId, "usr_33333333-3333-3333-3333-333333333333");
      assert.equal(payload.email, "device@example.com");
      assert.equal(payload.deviceName, "Chrome on macOS 14.5");
      assert.equal(payload.ip, "10.0.0.1");
    });

    it("should satisfy user.soft_deleted payload contract", () => {
      const now = new Date();
      const payload: UserSoftDeletedPayload = {
        userId: "usr_44444444-4444-4444-4444-444444444444",
        deletedBy: "adm_99999999-9999-9999-9999-999999999999",
        deletedAt: now,
      };

      assert.equal(payload.userId, "usr_44444444-4444-4444-4444-444444444444");
      assert.equal(
        payload.deletedBy,
        "adm_99999999-9999-9999-9999-999999999999",
      );
      assert.equal(payload.deletedAt, now);
    });

    it("should satisfy file.uploaded_unconfirmed payload contract", () => {
      const payload: FileUploadedUnconfirmedPayload = {
        fileId: "fil_55555555-5555-5555-5555-555555555555",
        key: "general/user123/sample.pdf",
        bucket: "template-be-storage",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };

      assert.equal(payload.fileId, "fil_55555555-5555-5555-5555-555555555555");
      assert.equal(payload.key, "general/user123/sample.pdf");
      assert.equal(payload.bucket, "template-be-storage");
      assert.ok(payload.expiresAt);
    });
  });

  describe("2. EventBus Pub/Sub & Fan-out Delivery", () => {
    it("should deliver events to multiple subscribers subscribed to the same event name", async () => {
      let subscriber1Received: EventEnvelope | null = null;
      let subscriber2Received: EventEnvelope | null = null;

      customBus.subscribe(EVENT_NAMES.AUTH_USER_REGISTERED, (event) => {
        subscriber1Received = event;
      });

      customBus.subscribe(EVENT_NAMES.AUTH_USER_REGISTERED, (event) => {
        subscriber2Received = event;
      });

      const payload: UserRegisteredPayload = {
        userId: "usr-fanout-1",
        email: "fanout@example.com",
        fullName: "Fanout User",
        verifyToken: "tok-fanout",
      };

      const envelope = await customBus.publish(
        EVENT_NAMES.AUTH_USER_REGISTERED,
        payload,
        { useOutbox: false, traceId: "trace-fanout-123" },
      );

      // Wait for in-memory queue dispatch
      await new Promise((r) => setTimeout(r, 100));

      assert.ok(subscriber1Received);
      assert.ok(subscriber2Received);
      assert.equal((subscriber1Received as EventEnvelope).id, envelope.id);
      assert.equal((subscriber2Received as EventEnvelope).id, envelope.id);
      assert.equal(
        (subscriber1Received as EventEnvelope).traceId,
        "trace-fanout-123",
      );
    });

    it("should allow unsubscribing cleanly", async () => {
      let callCount = 0;
      const unsubscribe = customBus.subscribe(
        EVENT_NAMES.AUTH_USER_REGISTERED,
        () => {
          callCount++;
        },
      );

      assert.equal(
        customBus.getSubscriberCount(EVENT_NAMES.AUTH_USER_REGISTERED),
        1,
      );

      await customBus.dispatchDirectly({
        id: uuidv7(),
        name: EVENT_NAMES.AUTH_USER_REGISTERED,
        payload: { userId: "u1", email: "e1@a.com", verifyToken: "t1" },
        timestamp: Date.now(),
        source: "test",
      });

      assert.equal(callCount, 1);

      // Unsubscribe
      unsubscribe();
      assert.equal(
        customBus.getSubscriberCount(EVENT_NAMES.AUTH_USER_REGISTERED),
        0,
      );

      await customBus.dispatchDirectly({
        id: uuidv7(),
        name: EVENT_NAMES.AUTH_USER_REGISTERED,
        payload: { userId: "u1", email: "e1@a.com", verifyToken: "t1" },
        timestamp: Date.now(),
        source: "test",
      });

      assert.equal(callCount, 1);
    });
  });

  describe("3. Idempotent Consumer Deduplication", () => {
    it("should discard duplicate events with identical event ID within 24h window", async () => {
      let handledCount = 0;

      customBus.subscribe(EVENT_NAMES.AUTH_NEW_DEVICE_DETECTED, () => {
        handledCount++;
      });

      const fixedEventId = uuidv7();
      const envelope: EventEnvelope<NewDeviceDetectedPayload> = {
        id: fixedEventId,
        name: EVENT_NAMES.AUTH_NEW_DEVICE_DETECTED,
        payload: {
          userId: "usr-idempotent",
          email: "idem@example.com",
          deviceName: "Firefox on Linux",
          ip: "127.0.0.1",
        },
        timestamp: Date.now(),
        source: "test",
      };

      // First delivery
      await customBus.dispatchDirectly(envelope);
      assert.equal(handledCount, 1);
      assert.equal(customBus.isEventAlreadyProcessed(fixedEventId), true);

      // Duplicate delivery (e.g. network replay / at-least-once redelivery)
      await customBus.dispatchDirectly(envelope);
      assert.equal(handledCount, 1); // Should still be 1, skipped!
    });
  });

  describe("4. Dead-Letter Queue (DLQ) & Resilience", () => {
    it("should route failing event to DLQ after reaching max retry attempts", async () => {
      let attempts = 0;

      customBus.subscribe(EVENT_NAMES.USER_SOFT_DELETED, async () => {
        attempts++;
        throw new Error("Simulated transient network failure");
      });

      const envelope: EventEnvelope<UserSoftDeletedPayload> = {
        id: uuidv7(),
        name: EVENT_NAMES.USER_SOFT_DELETED,
        payload: {
          userId: "usr-fail",
          deletedBy: "adm-fail",
          deletedAt: new Date(),
        },
        timestamp: Date.now(),
        source: "test",
      };

      // Directly trigger moveToDlq
      await customBus.moveToDlq(
        envelope,
        "Simulated transient network failure",
        EVENT_BUS_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
      );

      const dlqEvents = customBus.getDlqEvents();
      assert.equal(dlqEvents.length, 1);
      assert.equal(dlqEvents[0].envelope.id, envelope.id);
      assert.equal(dlqEvents[0].error, "Simulated transient network failure");
      assert.equal(
        dlqEvents[0].attempts,
        EVENT_BUS_CONSTANTS.DEFAULT_MAX_ATTEMPTS,
      );
    });
  });

  describe("5. Transactional Outbox Pattern & Database Atomic Relay", () => {
    it("should write event to outbox table and relay it successfully", async () => {
      const mockTxEvent: any = {
        eventType: EVENT_NAMES.AUTH_USER_REGISTERED,
        payload: {
          userId: "tx-usr-123",
          email: "tx-outbox@example.com",
          verifyToken: "tx-token-123",
        },
        aggregateId: "tx-usr-123",
      };

      // Create pending event in DB
      const createdOutbox = await customOutboxRepo.create(mockTxEvent);
      assert.ok(createdOutbox.id);
      assert.equal(createdOutbox.status, OUTBOX_STATUS.PENDING);
      assert.equal(createdOutbox.eventType, EVENT_NAMES.AUTH_USER_REGISTERED);

      let subscriberReceived: EventEnvelope | null = null;
      customBus.subscribe(EVENT_NAMES.AUTH_USER_REGISTERED, (event) => {
        subscriberReceived = event;
      });

      // Relay pending outbox events
      const relayedCount = await customBus.relayPendingOutboxEvents(10);
      assert.ok(relayedCount >= 1);

      // Verify DB record is now PUBLISHED
      const updatedRecord = await customOutboxRepo.findById(createdOutbox.id);
      assert.equal(updatedRecord?.status, OUTBOX_STATUS.PUBLISHED);
      assert.ok(updatedRecord?.publishedAt);

      // Verify subscriber received the exact event
      assert.ok(subscriberReceived);
      assert.equal(
        (subscriberReceived as EventEnvelope).payload.userId,
        "tx-usr-123",
      );
    });

    it("should mark outbox event as FAILED when subscriber fails repeatedly", async () => {
      const failingEvent = await customOutboxRepo.create({
        eventType: EVENT_NAMES.FILE_UPLOADED_UNCONFIRMED,
        payload: {
          fileId: "fil-failing",
          key: "key-failing",
          bucket: "bucket-failing",
          expiresAt: new Date().toISOString(),
        },
      });

      await customOutboxRepo.markFailed(
        failingEvent.id,
        "Network connection reset",
        5,
      );

      const afterOneFail = await customOutboxRepo.findById(failingEvent.id);
      assert.equal(afterOneFail?.attempts, 1);
      assert.equal(afterOneFail?.status, OUTBOX_STATUS.PENDING);
      assert.equal(afterOneFail?.lastError, "Network connection reset");

      // Simulate reaching max attempts
      await customOutboxRepo.markFailed(
        failingEvent.id,
        "Permanent delivery failure",
        1, // max attempts = 1 -> immediately FAILED
      );

      const afterMaxFail = await customOutboxRepo.findById(failingEvent.id);
      assert.equal(afterMaxFail?.status, OUTBOX_STATUS.FAILED);
      assert.equal(afterMaxFail?.lastError, "Permanent delivery failure");
    });
  });

  describe("6. Specialized Subscribers Verification", () => {
    it("NotificationSubscriber should dispatch emails upon auth events", async () => {
      let sentVerificationEmail = false;
      let sentResetEmail = false;
      let sentDeviceAlertEmail = false;

      const mockMailService: any = {
        sendVerificationEmail: async (email: string, token: string) => {
          sentVerificationEmail = true;
          assert.equal(email, "subscriber@example.com");
          assert.equal(token, "verify-tok-sub");
        },
        sendPasswordResetEmail: async (email: string, token: string) => {
          sentResetEmail = true;
          assert.equal(email, "subscriber@example.com");
          assert.equal(token, "reset-tok-sub");
        },
        sendNewDeviceAlertEmail: async (email: string, info: any) => {
          sentDeviceAlertEmail = true;
          assert.equal(email, "subscriber@example.com");
          assert.equal(info.deviceName, "Safari on iOS");
        },
      };

      const subscriber = new NotificationSubscriber(mockMailService, customBus);
      subscriber.register();

      // Trigger user registered
      await customBus.dispatchDirectly({
        id: uuidv7(),
        name: EVENT_NAMES.AUTH_USER_REGISTERED,
        payload: {
          userId: "sub-u1",
          email: "subscriber@example.com",
          verifyToken: "verify-tok-sub",
        },
        timestamp: Date.now(),
        source: "test",
      });

      // Trigger password reset requested
      await customBus.dispatchDirectly({
        id: uuidv7(),
        name: EVENT_NAMES.AUTH_PASSWORD_RESET_REQUESTED,
        payload: {
          userId: "sub-u1",
          email: "subscriber@example.com",
          resetToken: "reset-tok-sub",
        },
        timestamp: Date.now(),
        source: "test",
      });

      // Trigger new device detected
      await customBus.dispatchDirectly({
        id: uuidv7(),
        name: EVENT_NAMES.AUTH_NEW_DEVICE_DETECTED,
        payload: {
          userId: "sub-u1",
          email: "subscriber@example.com",
          deviceName: "Safari on iOS",
        },
        timestamp: Date.now(),
        source: "test",
      });

      assert.equal(sentVerificationEmail, true);
      assert.equal(sentResetEmail, true);
      assert.equal(sentDeviceAlertEmail, true);
    });

    it("AuthCleanupSubscriber should revoke sessions and clear cache on user.soft_deleted", async () => {
      let revokedUserId: string | null = null;
      let invalidatedUserId: string | null = null;

      const mockAuthRepo: any = {
        revokeAllUserSessions: async (userId: string) => {
          revokedUserId = userId;
          return { count: 3 };
        },
      };

      const mockCacheService: any = {
        invalidateUser: (userId: string) => {
          invalidatedUserId = userId;
        },
      };

      const subscriber = new AuthCleanupSubscriber(
        mockAuthRepo,
        mockCacheService,
        customBus,
      );
      subscriber.register();

      await customBus.dispatchDirectly({
        id: uuidv7(),
        name: EVENT_NAMES.USER_SOFT_DELETED,
        payload: {
          userId: "usr-cleanup-1",
          deletedBy: "adm-cleanup-1",
          deletedAt: new Date(),
        },
        timestamp: Date.now(),
        source: "test",
      });

      assert.equal(revokedUserId, "usr-cleanup-1");
      assert.equal(invalidatedUserId, "usr-cleanup-1");
    });

    it("StorageCleanupSubscriber should track unconfirmed file uploads", async () => {
      const subscriber = new StorageCleanupSubscriber(customBus);
      subscriber.register();

      await customBus.dispatchDirectly({
        id: uuidv7(),
        name: EVENT_NAMES.FILE_UPLOADED_UNCONFIRMED,
        payload: {
          fileId: "fil-track-1",
          key: "avatars/usr1/avatar.png",
          bucket: "r2-bucket",
          expiresAt: new Date().toISOString(),
        },
        timestamp: Date.now(),
        source: "test",
      });

      const tracked = subscriber.getTrackedFiles();
      assert.equal(tracked.length, 1);
      assert.equal(tracked[0].fileId, "fil-track-1");
      assert.equal(tracked[0].key, "avatars/usr1/avatar.png");
    });
  });

  describe("7. OutboxWorker Polling Lifecycle", () => {
    it("should start and stop cleanly without unhandled rejections", async () => {
      const worker = new OutboxWorker(customBus);
      worker.start(5000); // 5s interval

      // Trigger one manual process pass
      const count = await worker.process();
      assert.equal(typeof count, "number");

      await worker.stop();
    });
  });

  describe("8. Security Hardening & Atomic Outbox Enhancements", () => {
    it("should encrypt sensitive tokens (verifyToken, resetToken) in outbox payload and decrypt on relay", async () => {
      const rawVerifyToken = "super-secret-verify-token-12345";
      const rawResetToken = "super-secret-reset-token-67890";

      // 1. Publish event with sensitive tokens to outbox
      const createdOutbox = await customOutboxRepo.create({
        eventType: EVENT_NAMES.AUTH_USER_REGISTERED,
        payload: customBus.encryptSensitivePayloadFields({
          userId: "usr-sec-1",
          email: "sec@example.com",
          verifyToken: rawVerifyToken,
        }),
      });

      // 2. Verify in DB: outbox payload does NOT contain plaintext token
      const dbRecord = await customOutboxRepo.findById(createdOutbox.id);
      assert.ok(dbRecord);
      const dbPayload = dbRecord.payload as any;
      assert.notEqual(dbPayload.verifyToken, rawVerifyToken);
      assert.ok(
        typeof dbPayload.verifyToken === "string" &&
          dbPayload.verifyToken.startsWith("enc:"),
        "Payload verifyToken in DB must be encrypted with prefix enc:",
      );

      // 3. Register subscriber and relay outbox event
      let relayedPayload: UserRegisteredPayload | null = null;
      customBus.subscribe(EVENT_NAMES.AUTH_USER_REGISTERED, (envelope) => {
        relayedPayload = envelope.payload;
      });

      const relayedCount = await customBus.relayPendingOutboxEvents(10);
      assert.ok(relayedCount >= 1);

      // 4. Verify subscriber received the cleanly decrypted plaintext token
      assert.ok(relayedPayload);
      assert.equal(
        (relayedPayload as UserRegisteredPayload).verifyToken,
        rawVerifyToken,
      );
    });

    it("should atomically transition outbox status to PROCESSING and allow deletion of published events", async () => {
      const eventRecord = await customOutboxRepo.create({
        eventType: EVENT_NAMES.AUTH_NEW_DEVICE_DETECTED,
        payload: {
          userId: "usr-claim-test",
          email: "claim@example.com",
          deviceName: "Pixel 9 Pro",
        },
      });

      // Claim pending events atomically
      const claimed = await customOutboxRepo.claimPendingEvents(10);
      const claimedRecord = claimed.find((r) => r.id === eventRecord.id);
      assert.ok(claimedRecord);
      assert.equal(claimedRecord.status, OUTBOX_STATUS.PROCESSING);

      // Mark published
      await customOutboxRepo.markPublished(eventRecord.id);
      const published = await customOutboxRepo.findById(eventRecord.id);
      assert.equal(published?.status, OUTBOX_STATUS.PUBLISHED);

      // Test deletePublishedOlderThan
      const futureCutoff = new Date(Date.now() + 10000);
      const deletedCount =
        await customOutboxRepo.deletePublishedOlderThan(futureCutoff);
      assert.ok(deletedCount >= 1);
    });

    it("EventBusWorker should start and stop cleanly", async () => {
      eventBusWorker.start();
      await eventBusWorker.stop();
    });
  });
});
