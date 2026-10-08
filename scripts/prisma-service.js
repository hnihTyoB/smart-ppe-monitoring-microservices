const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

try {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
} catch {
  // Fallback: parse .env thủ công nếu dotenv không được cài
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const idx = trimmed.indexOf("=");
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed
            .slice(idx + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

const serviceConfigs = {
  identity: {
    schema: "prisma/identity/schema.prisma",
    envVar: "IDENTITY_DATABASE_URL",
    defaultDb: "ppe_identity_db",
    defaultUser: "ppe_identity_user",
  },
  site: {
    schema: "prisma/site/schema.prisma",
    envVar: "SITE_DATABASE_URL",
    defaultDb: "ppe_site_db",
    defaultUser: "ppe_site_user",
  },
  camera: {
    schema: "prisma/camera/schema.prisma",
    envVar: "CAMERA_DATABASE_URL",
    defaultDb: "ppe_camera_db",
    defaultUser: "ppe_camera_user",
  },
  incident: {
    schema: "prisma/incident/schema.prisma",
    envVar: "INCIDENT_DATABASE_URL",
    defaultDb: "ppe_incident_db",
    defaultUser: "ppe_incident_user",
  },
  notification: {
    schema: "prisma/notification/schema.prisma",
    envVar: "NOTIFICATION_DATABASE_URL",
    defaultDb: "ppe_notification_db",
    defaultUser: "ppe_notification_user",
  },
  reporting: {
    schema: "prisma/reporting/schema.prisma",
    envVar: "REPORTING_DATABASE_URL",
    defaultDb: "ppe_reporting_db",
    defaultUser: "ppe_reporting_user",
  },
};

const serviceName = (process.argv[2] || "").toLowerCase();
if (!serviceName || !serviceConfigs[serviceName]) {
  console.error(
    `[prisma-service] Lỗi: Vui lòng chỉ định service hợp lệ: ${Object.keys(serviceConfigs).join(", ")}`
  );
  console.error(`Ví dụ: node scripts/prisma-service.js site migrate dev --name init_site`);
  process.exit(1);
}

const config = serviceConfigs[serviceName];
const schemaPath = path.resolve(__dirname, "..", config.schema);

if (!fs.existsSync(schemaPath)) {
  console.error(`[prisma-service] Lỗi: Không tìm thấy schema tại: ${schemaPath}`);
  process.exit(1);
}

// Đảm bảo env variable kết nối DB cho service đã được thiết lập
if (!process.env[config.envVar]) {
  const password = encodeURIComponent(process.env.DB_PASSWORD || "postgres");
  const user = encodeURIComponent(config.defaultUser);
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5433";
  process.env[config.envVar] = `postgresql://${user}:${password}@${host}:${port}/${config.defaultDb}?schema=public`;
}

// Gán biến DIRECT_URL và DATABASE_URL tương ứng để Prisma không báo thiếu
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = process.env[config.envVar];
}
process.env.DATABASE_URL = process.env[config.envVar];

const rawArgs = process.argv.slice(3);
const hasSchemaFlag = rawArgs.includes("--schema");
const args = hasSchemaFlag ? rawArgs : [...rawArgs, `--schema=${config.schema}`];

let prismaBin;
try {
  prismaBin = require.resolve("prisma/build/index.js");
} catch {
  const pnpmPath = path.resolve(__dirname, "../node_modules/.pnpm");
  if (fs.existsSync(pnpmPath)) {
    const entries = fs
      .readdirSync(pnpmPath)
      .filter((e) => e.startsWith("prisma@"));
    if (entries.length > 0) {
      prismaBin = path.resolve(
        pnpmPath,
        entries[0],
        "node_modules/prisma/build/index.js"
      );
    }
  }
}

if (!prismaBin) {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(cmd, ["prisma", ...args], {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  const child = spawn(process.execPath, [prismaBin, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}
