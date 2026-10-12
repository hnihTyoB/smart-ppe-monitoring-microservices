import assert from "node:assert";
import test from "node:test";

const BASE_URL = process.env.TEST_API_URL || "http://localhost:9999/api/v1";
const ADMIN_EMAIL = "admin@template.local";
const ADMIN_PASSWORD = "Admin@123456";
const TURNSTILE_BYPASS = "1x0000000000000000000000000000000AA";

let token = "";

async function api(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

test("Live Real-Data E2E Verification Across Microservices Domains", async (t) => {
  await t.test("1. Auth Login as Admin to acquire RS256 JWT Token", async () => {
    const res = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        turnstileToken: TURNSTILE_BYPASS,
      }),
    });
    assert.strictEqual(res.status, 200, `Login failed: ${JSON.stringify(res.data)}`);
    assert.ok(res.data.data?.accessToken, "Missing accessToken");
    token = res.data.data.accessToken;
    console.log("   [Auth] Logged in successfully, token acquired.");
  });

  await t.test("2. Sites Domain (/sites)", async () => {
    const res = await api("/sites");
    assert.strictEqual(res.status, 200, `GET /sites failed: ${JSON.stringify(res.data)}`);
    console.log("   [Sites] GET /sites returned 200 OK. Total sites:", res.data.data?.length ?? res.data.length ?? 0);
  });

  await t.test("3. Zones Domain (/zones)", async () => {
    const res = await api("/zones");
    assert.strictEqual(res.status, 200, `GET /zones failed: ${JSON.stringify(res.data)}`);
    console.log("   [Zones] GET /zones returned 200 OK.");
  });

  await t.test("4. Restricted Areas Domain (/restricted-areas)", async () => {
    const res = await api("/restricted-areas");
    assert.strictEqual(res.status, 200, `GET /restricted-areas failed: ${JSON.stringify(res.data)}`);
    console.log("   [Restricted Areas] GET /restricted-areas returned 200 OK.");
  });

  await t.test("5. Cameras Domain (/cameras)", async () => {
    const res = await api("/cameras");
    assert.strictEqual(res.status, 200, `GET /cameras failed: ${JSON.stringify(res.data)}`);
    console.log("   [Cameras] GET /cameras returned 200 OK. Total cameras:", res.data.data?.length ?? res.data.length ?? 0);
  });

  await t.test("6. Incidents Domain (/incidents)", async () => {
    const res = await api("/incidents");
    assert.strictEqual(res.status, 200, `GET /incidents failed: ${JSON.stringify(res.data)}`);
    console.log("   [Incidents] GET /incidents returned 200 OK. Total incidents:", res.data.data?.length ?? res.data.length ?? 0);
  });

  await t.test("7. Safety Rules Domain (/safety-rules/system-default)", async () => {
    const res = await api("/safety-rules/system-default");
    assert.strictEqual(res.status, 200, `GET /safety-rules/system-default failed: ${JSON.stringify(res.data)}`);
    console.log("   [Safety Rules] GET /safety-rules/system-default returned 200 OK.");
  });

  await t.test("8. Statistics Domain (/statistics/summary)", async () => {
    const res = await api("/statistics/summary");
    assert.strictEqual(res.status, 200, `GET /statistics/summary failed: ${JSON.stringify(res.data)}`);
    console.log("   [Statistics] GET /statistics/summary returned 200 OK.");
  });

  await t.test("9. Reports Domain (/reports/templates)", async () => {
    const res = await api("/reports/templates");
    assert.strictEqual(res.status, 200, `GET /reports/templates failed: ${JSON.stringify(res.data)}`);
    console.log("   [Reports] GET /reports/templates returned 200 OK.");
  });

  await t.test("10. AI Models Domain (/ai-models)", async () => {
    const res = await api("/ai-models");
    assert.strictEqual(res.status, 200, `GET /ai-models failed: ${JSON.stringify(res.data)}`);
    console.log("   [AI Models] GET /ai-models returned 200 OK.");
  });

  await t.test("11. Audit Logs Domain (/audit-logs)", async () => {
    const res = await api("/audit-logs");
    assert.strictEqual(res.status, 200, `GET /audit-logs failed: ${JSON.stringify(res.data)}`);
    console.log("   [Audit Logs] GET /audit-logs returned 200 OK.");
  });

  await t.test("12. Notification Preferences Domain (/notifications/preferences)", async () => {
    const res = await api("/notifications/preferences");
    assert.strictEqual(res.status, 200, `GET /notifications/preferences failed: ${JSON.stringify(res.data)}`);
    console.log("   [Notifications] GET /notifications/preferences returned 200 OK.");
  });

  let createdSiteId = "";
  let createdZoneId = "";
  let createdCameraId = "";
  const randomSuffix = Math.floor(Math.random() * 9000 + 1000);

  await t.test("13. Create Site on Real Database (POST /sites)", async () => {
    const res = await api("/sites", {
      method: "POST",
      body: JSON.stringify({
        name: `Công trường Landmark Real ${randomSuffix}`,
        code: `SITE_REAL_${randomSuffix}`,
        address: "123 Đường Nam Kỳ Khởi Nghĩa, Quận 1, TP.HCM",
        status: "ACTIVE",
      }),
    });
    assert.strictEqual(res.status, 201, `POST /sites failed: ${JSON.stringify(res.data)}`);
    createdSiteId = res.data.data.id;
    assert.ok(createdSiteId, "Missing created site ID");
    console.log("   [Sites] POST /sites created site successfully:", createdSiteId);
  });

  await t.test("14. Create Zone on Real Database (POST /zones)", async () => {
    const res = await api("/zones", {
      method: "POST",
      body: JSON.stringify({
        siteId: createdSiteId,
        name: `Khu vực Thi công Tầng 5 - ${randomSuffix}`,
        code: `ZONE_REAL_${randomSuffix}`,
        status: "ACTIVE",
      }),
    });
    assert.strictEqual(res.status, 201, `POST /zones failed: ${JSON.stringify(res.data)}`);
    createdZoneId = res.data.data.id;
    assert.ok(createdZoneId, "Missing created zone ID");
    console.log("   [Zones] POST /zones created zone successfully:", createdZoneId);
  });

  await t.test("15. Create Camera on Real Database (POST /cameras)", async () => {
    const res = await api("/cameras", {
      method: "POST",
      body: JSON.stringify({
        siteId: createdSiteId,
        zoneId: createdZoneId,
        name: `AI Camera Cổng A - ${randomSuffix}`,
        code: `CAM_REAL_${randomSuffix}`,
        sourceType: "RTSP",
        streamUrl: "rtsp://192.168.1.100:554/live/ch0",
      }),
    });
    assert.strictEqual(res.status, 201, `POST /cameras failed: ${JSON.stringify(res.data)}`);
    createdCameraId = res.data.data.id;
    assert.ok(createdCameraId, "Missing created camera ID");
    console.log("   [Cameras] POST /cameras created camera successfully:", createdCameraId);
  });

  await t.test("16. AI Vision Ingestion Bridge (POST /broker/publish?sync=true)", async () => {
    const violationId = "01a12fb8-7000-7000-8000-" + String(randomSuffix).padStart(12, "0");
    const payload = {
      violationId,
      timestamp: new Date().toISOString(),
      site: {
        id: createdSiteId,
        code: `SITE_REAL_${randomSuffix}`,
        name: `Công trường Landmark Real ${randomSuffix}`,
      },
      camera: {
        id: createdCameraId,
        code: `CAM_REAL_${randomSuffix}`,
        name: `AI Camera Cổng A - ${randomSuffix}`,
        zone: `Khu vực Thi công Tầng 5 - ${randomSuffix}`,
      },
      evidence: {
        snapshotUrl: "https://pub-f4b620dfba0446a4a0ea185d294d5eb9.r2.dev/evidences/sample.jpg",
        frameResolution: { width: 1920, height: 1080 },
      },
      violations: [
        {
          violationType: "NO_HELMET",
          severity: "HIGH",
          description: "Phát hiện công nhân không đội mũ bảo hộ tại khu vực thi công",
          confidence: 0.94,
        },
      ],
      summary: {
        totalPersons: 1,
        totalViolations: 1,
        highestSeverity: "HIGH",
      },
    };

    const res = await api("/broker/publish?sync=true", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assert.ok(
      res.status === 202 || res.status === 200,
      `POST /broker/publish failed: expected 202 or 200, got ${res.status} - ${JSON.stringify(res.data)}`,
    );
    console.log("   [Broker] AI Ingestion event ingested successfully via sync mode (HTTP " + res.status + ").");
  });

  await t.test("17. Verify Incident created in Incidents Service (GET /incidents)", async () => {
    // Outbox relay polls every 5s; poll up to 10s to verify event-driven processing
    let foundIncident = false;
    let incidentId = "";
    for (let i = 0; i < 12; i++) {
      const res = await api(`/incidents?siteId=${createdSiteId}`);
      if (res.status === 200 && res.data.data?.length >= 1) {
        foundIncident = true;
        incidentId = res.data.data[0].id;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(foundIncident, "Expected at least 1 incident to be processed and found for site");
    console.log("   [Incidents] Confirmed incident created in DB with ID:", incidentId);
  });

  let createdTemplateId = "";
  await t.test("18. Create Report Template in Reporting Service (POST /reports/templates)", async () => {
    const res = await api("/reports/templates", {
      method: "POST",
      body: JSON.stringify({
        name: `Mẫu Báo Cáo Tuần ${randomSuffix}`,
        code: `RPT_TMPL_${randomSuffix}`,
        description: "Template báo cáo vi phạm an toàn hàng ngày",
        fileType: "PDF",
        version: "1.0.0",
      }),
    });
    assert.strictEqual(res.status, 201, `POST /reports/templates failed: ${JSON.stringify(res.data)}`);
    createdTemplateId = res.data.data.id;
    assert.ok(createdTemplateId, "Missing created template ID");
    console.log("   [Reports] Created report template:", createdTemplateId);
  });

  await t.test("19. Generate Report in Reporting Service (POST /reports/generate)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const res = await api("/reports/generate", {
      method: "POST",
      body: JSON.stringify({
        templateId: createdTemplateId,
        siteId: createdSiteId,
        reportType: "DAILY",
        periodStart: yesterday,
        periodEnd: today,
      }),
    });
    assert.strictEqual(res.status, 201, `POST /reports/generate failed: ${JSON.stringify(res.data)}`);
    console.log("   [Reports] Generated report successfully. ID:", res.data.data.id);
  });

  await t.test("20. List Report History (GET /reports/history)", async () => {
    const res = await api("/reports/history");
    assert.strictEqual(res.status, 200, `GET /reports/history failed: ${JSON.stringify(res.data)}`);
    assert.ok(res.data.data.length >= 1, "Expected at least 1 report generation in history");
    console.log("   [Reports] Total reports in history:", res.data.data.length);
  });
});

