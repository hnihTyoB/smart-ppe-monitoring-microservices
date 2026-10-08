import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Load .env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const secret = process.env.GATEWAY_INTERNAL_SECRET;
if (!secret || secret.length < 32) {
  console.error(
    "[Traefik Config Sync] FATAL: GATEWAY_INTERNAL_SECRET is not set or too short (minimum 32 characters).",
  );
  console.error(
    "[Traefik Config Sync] Set the variable in your .env file or CI/CD environment before running this script.",
  );
  process.exit(1);
}
const dynamicYmlPath = path.resolve(process.cwd(), "traefik/dynamic.yml");

if (fs.existsSync(dynamicYmlPath)) {
  let content = fs.readFileSync(dynamicYmlPath, "utf8");

  // Update X-Gateway-Secret
  content = content.replace(
    /X-Gateway-Secret:\s*".*"/g,
    `X-Gateway-Secret: "${secret}"`,
  );

  // Fix X-Request-Id stripping: Traefik setting customRequestHeaders X-Request-Id: "" strips client trace IDs!
  // Instead, allow request ID to pass through and add custom response header X-Gateway: "Traefik-v3"
  content = content.replace(
    /customRequestHeaders:\s*\r?\n\s*X-Request-Id:\s*""/g,
    `customResponseHeaders:\n          X-Gateway: "Traefik-v3"`,
  );

  fs.writeFileSync(dynamicYmlPath, content, "utf8");
  console.log(`[Traefik Config Sync] Successfully synchronized dynamic.yml (secret length: ${secret.length})`);
} else {
  console.error(`[Traefik Config Sync] ${dynamicYmlPath} not found`);
  process.exit(1);
}
