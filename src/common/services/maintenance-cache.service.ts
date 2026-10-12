import { MaintenanceConfig } from "@prisma/client";
import IORedis from "ioredis";
import { envConfig } from "../../config/env.config";
import {
  MAINTENANCE_PUBSUB_CHANNEL,
  MAINTENANCE_STATUS,
  DEFAULT_MAINTENANCE_CONFIG,
} from "../constants/maintenance.constant";
import { PERMISSIONS } from "../constants/permission.constant";
import { ROLES } from "../constants/role.constant";
import { maintenanceRepository } from "../../modules/maintenance/maintenance.repository";

interface CacheEntry {
  config: MaintenanceConfig;
  expiresAt: number;
}

const isTestEnv =
  process.env.NODE_ENV === "test" ||
  process.argv.some((arg) => arg.includes("test")) ||
  process.env.npm_lifecycle_event === "test";

export class MaintenanceCacheService {
  private cache: CacheEntry | null = null;
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
  private redisPublisher?: IORedis;
  private redisSubscriber?: IORedis;
  private isRedisAvailable = false;

  constructor() {
    if (!isTestEnv && envConfig.redis.enabled) {
      this.initRedisPubSub();
    }
  }

  private initRedisPubSub(): void {
    try {
      const redisOptions = {
        host: envConfig.redis.host,
        port: envConfig.redis.port,
        password: envConfig.redis.password,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          if (times > 2) {
            this.isRedisAvailable = false;
            return null; // Stop retrying after 2 failed attempts
          }
          return Math.min(times * 200, 500);
        },
      };

      this.redisPublisher = new IORedis(redisOptions);
      this.redisSubscriber = new IORedis(redisOptions);

      this.redisSubscriber.on("connect", () => {
        this.isRedisAvailable = true;
        this.redisSubscriber?.subscribe(MAINTENANCE_PUBSUB_CHANNEL, (err) => {
          if (err) {
            console.error(
              "[MaintenanceCacheService] Redis subscribe error:",
              err.message,
            );
          }
        });
      });

      this.redisSubscriber.on("message", (channel, message) => {
        if (channel === MAINTENANCE_PUBSUB_CHANNEL) {
          try {
            const data = JSON.parse(message);
            if (data?.action === "INVALIDATE") {
              this.cache = null;
            }
          } catch {
            this.cache = null;
          }
        }
      });

      this.redisPublisher.on("error", () => {
        this.isRedisAvailable = false;
      });

      this.redisSubscriber.on("error", () => {
        this.isRedisAvailable = false;
      });

      this.redisSubscriber.connect().catch(() => {
        this.isRedisAvailable = false;
      });
      this.redisPublisher.connect().catch(() => {
        this.isRedisAvailable = false;
      });
    } catch {
      this.isRedisAvailable = false;
    }
  }

  async getConfig(key = "DEFAULT"): Promise<MaintenanceConfig> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) {
      return this.cache.config;
    }

    try {
      const config = await maintenanceRepository.getOrCreateDefaultConfig(key);

      this.cache = {
        config,
        expiresAt: now + this.TTL_MS,
      };

      return config;
    } catch (err: unknown) {
      console.warn(
        `[MaintenanceCacheService] Failed to fetch maintenance config from DB: ${(err as Error)?.message || err}. Fallback to default in-memory config.`,
      );
      const fallbackConfig: MaintenanceConfig = {
        id: "default-memory",
        key,
        enabled: DEFAULT_MAINTENANCE_CONFIG.enabled,
        status: MAINTENANCE_STATUS.ONLINE,
        title: DEFAULT_MAINTENANCE_CONFIG.title,
        message: DEFAULT_MAINTENANCE_CONFIG.message,
        bypassPermissions: [
          PERMISSIONS.MAINTENANCE_MANAGE,
          PERMISSIONS.MAINTENANCE_BYPASS,
        ],
        bypassRoles: [ROLES.ADMIN],
        bypassIps: [],
        metadata: null,
        startAt: null,
        estimatedEndAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.cache = {
        config: fallbackConfig,
        expiresAt: now + 30 * 1000, // Retry sau 30 giây
      };

      return fallbackConfig;
    }
  }

  set(config: MaintenanceConfig): void {
    this.cache = {
      config,
      expiresAt: Date.now() + this.TTL_MS,
    };
  }

  invalidate(): void {
    this.cache = null;

    // Broadcast invalidation message to other cluster workers / pods via Redis Pub/Sub
    if (this.isRedisAvailable && this.redisPublisher) {
      this.redisPublisher
        .publish(
          MAINTENANCE_PUBSUB_CHANNEL,
          JSON.stringify({ action: "INVALIDATE", timestamp: Date.now() }),
        )
        .catch(() => {
          // Ignore publish errors gracefully
        });
    }
  }

  clear(): void {
    this.cache = null;
  }

  async close(): Promise<void> {
    this.cache = null;
    if (this.redisSubscriber) {
      this.redisSubscriber.disconnect();
      this.redisSubscriber = undefined;
    }
    if (this.redisPublisher) {
      this.redisPublisher.disconnect();
      this.redisPublisher = undefined;
    }
  }
}

export const maintenanceCacheService = new MaintenanceCacheService();
