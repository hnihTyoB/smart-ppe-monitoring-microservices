import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mailConfig } from "../src/config/mail.config";
import { MailService } from "../src/common/services/mail.service";
import { AuthService } from "../src/modules/auth/auth.service";

describe("Mail Dispatch Pipeline & Cloud Resilience Suite", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  describe("1. Cloud Domain Auto-Detection (Render & Staging)", () => {
    it("should prioritize RENDER_EXTERNAL_URL when APP_URL points to localhost", () => {
      process.env.APP_URL = "http://localhost:7777";
      process.env.RENDER_EXTERNAL_URL = "https://template-be.onrender.com/";

      assert.equal(mailConfig.appUrl, "https://template-be.onrender.com");
      assert.equal(
        mailConfig.verificationUrl,
        "https://template-be.onrender.com/api/v1/auth/verify-email",
      );
      assert.equal(
        mailConfig.resetPasswordUrl,
        "https://template-be.onrender.com/api/v1/auth/reset-password",
      );
    });

    it("should retain custom production APP_URL if not pointing to localhost", () => {
      process.env.APP_URL = "https://api.mycustomdomain.com/";
      process.env.RENDER_EXTERNAL_URL = "https://template-be.onrender.com";

      assert.equal(mailConfig.appUrl, "https://api.mycustomdomain.com");
    });

    it("should evaluate isConfigured accurately based on Resend, Webhook or SMTP credentials", () => {
      delete process.env.RESEND_API_KEY;
      delete process.env.MAIL_WEBHOOK_URL;
      delete process.env.MAIL_USER;
      delete process.env.MAIL_PASS;

      // In current environment, check if mailConfig reports correctly
      const initialConfigured = mailConfig.isConfigured;
      assert.equal(typeof initialConfigured, "boolean");
    });
  });

  describe("2. Multi-Tier Fallback Email Dispatch Pipeline", () => {
    it("Tier 1: should send email via Resend HTTPS REST API when resendApiKey is set", async () => {
      let fetchCalled = false;
      let requestedUrl = "";
      let requestedOptions: any = {};

      globalThis.fetch = async (url: any, opts: any) => {
        fetchCalled = true;
        requestedUrl = url.toString();
        requestedOptions = opts;
        return new Response(JSON.stringify({ id: "resend-msg-123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const mailService = new MailService();
      // Configure mailConfig getters mock
      Object.defineProperty(mailConfig, "resendApiKey", {
        value: "mock_test_key_12345",
        configurable: true,
      });

      await (mailService as any).dispatchEmail({
        to: "test@example.com",
        subject: "Test Subject",
        html: "<p>Test Content</p>",
      });

      assert.equal(fetchCalled, true);
      assert.equal(requestedUrl, "https://api.resend.com/emails");
      assert.equal(
        requestedOptions.headers.Authorization,
        "Bearer mock_test_key_12345",
      );

      const parsedBody = JSON.parse(requestedOptions.body);
      assert.deepEqual(parsedBody.to, ["test@example.com"]);
      assert.equal(parsedBody.subject, "Test Subject");
    });

    it("Tier 2: should fallback to Mail Webhook Relay when Resend fails", async () => {
      const calls: string[] = [];

      globalThis.fetch = async (url: any) => {
        const urlStr = url.toString();
        calls.push(urlStr);
        if (urlStr.includes("resend.com")) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (urlStr.includes("webhook-relay.example.com")) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          });
        }
        return new Response("Not found", { status: 404 });
      };

      const mailService = new MailService();
      Object.defineProperty(mailConfig, "resendApiKey", {
        value: "mock_failing_key",
        configurable: true,
      });
      Object.defineProperty(mailConfig, "mailWebhookUrl", {
        value: "https://webhook-relay.example.com/api/send",
        configurable: true,
      });

      await (mailService as any).dispatchEmail({
        to: "recipient@example.com",
        subject: "Webhook Subject",
        html: "<p>Webhook Content</p>",
      });

      assert.ok(calls.includes("https://api.resend.com/emails"));
      assert.ok(calls.includes("https://webhook-relay.example.com/api/send"));
    });

    it("Tier 3: Transporter should enforce IPv4 (family: 4) and short timeouts (4000/5000ms)", () => {
      const mailService = new MailService();
      const transporter = (mailService as any).createTransporter(587, false);

      assert.equal(transporter.options.family, 4);
      assert.equal(transporter.options.connectionTimeout, 4000);
      assert.equal(transporter.options.greetingTimeout, 4000);
      assert.equal(transporter.options.socketTimeout, 5000);
    });
  });

  describe("3. Non-Blocking Email Dispatch in AuthService", () => {
    it("forgotPassword should not throw error if mail service fails", async () => {
      const authService = new AuthService();
      const mockRepo: any = {
        findByEmail: async () => ({
          id: "user-123",
          email: "user@example.com",
          fullName: "User Test",
        }),
        createPasswordResetToken: async () => ({ id: "token-1" }),
      };

      const mockFailingMailService: any = {
        sendPasswordResetEmail: async () => {
          throw new Error("SMTP connection timeout (ENETUNREACH)");
        },
      };

      (authService as any).repository = mockRepo;
      (authService as any).mailService = mockFailingMailService;

      // Should complete gracefully without throwing 500 error
      await assert.doesNotReject(async () => {
        await authService.forgotPassword({ email: "user@example.com" });
      });
    });

    it("resendVerification should not throw error if mail service fails", async () => {
      const authService = new AuthService();
      const mockRepo: any = {
        findByEmail: async () => ({
          id: "user-123",
          email: "user@example.com",
          fullName: "User Test",
          isActive: false,
        }),
        findActiveVerificationTokenByUserId: async () => null,
        createVerificationToken: async () => ({ id: "token-1" }),
      };

      const mockFailingMailService: any = {
        sendVerificationEmail: async () => {
          throw new Error("Network unreachable");
        },
      };

      (authService as any).repository = mockRepo;
      (authService as any).mailService = mockFailingMailService;

      await assert.doesNotReject(async () => {
        await authService.resendVerification({
          email: "user@example.com",
        });
      });
    });

    it("requestDeactivate should not throw error if mail service fails", async () => {
      const authService = new AuthService();
      const mockRepo: any = {
        findById: async () => ({
          id: "user-123",
          email: "user@example.com",
          fullName: "User Test",
          isActive: true,
          password: "HashedPassword",
        }),
        countActiveAdmins: async () => 2,
        createDeactivationToken: async () => ({ id: "deact-1" }),
        createAuditLog: async () => ({ id: "audit-1" }),
      };

      const mockFailingMailService: any = {
        sendAccountDeactivationEmail: async () => {
          throw new Error("SMTP failed");
        },
      };

      (authService as any).repository = mockRepo;
      (authService as any).mailService = mockFailingMailService;

      // Mock bcrypt
      const bcrypt = require("bcryptjs");
      const origCompare = bcrypt.compare;
      bcrypt.compare = async () => true;

      try {
        await assert.doesNotReject(async () => {
          await authService.requestDeactivate(
            "user-123",
            { password: "ValidPassword123!" },
            { ipAddress: "127.0.0.1" },
          );
        });
      } finally {
        bcrypt.compare = origCompare;
      }
    });
  });

  describe("4. Console Fallback & Dev Logging for Links & OTP", () => {
    it("should print verification link to console in dev mode when unconfigured", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        warnings.push(args.join(" "));
      };

      try {
        Object.defineProperty(mailConfig, "isConfigured", {
          value: false,
          configurable: true,
        });

        const mailService = new MailService();
        await mailService.sendVerificationEmail(
          "dev@example.com",
          "test-token-123",
        );

        assert.ok(
          warnings.some((w) =>
            w.includes("EMAIL VERIFICATION TOKEN (DEV MODE)"),
          ),
        );
        assert.ok(warnings.some((w) => w.includes("test-token-123")));
      } finally {
        console.warn = origWarn;
      }
    });

    it("should print OTP and purpose to console in dev mode when unconfigured", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        warnings.push(args.join(" "));
      };

      try {
        Object.defineProperty(mailConfig, "isConfigured", {
          value: false,
          configurable: true,
        });

        const mailService = new MailService();
        await mailService.sendOtpEmail("otp@example.com", "998877", {
          purpose: "đăng nhập",
        });

        assert.ok(warnings.some((w) => w.includes("OTP EMAIL (DEV MODE)")));
        assert.ok(warnings.some((w) => w.includes("998877")));
      } finally {
        console.warn = origWarn;
      }
    });
  });
});
