import {
  type PrismaClient as NotificationPrismaClient,
  Prisma as NotificationPrisma,
} from "@prisma/client-notification";
import { Prisma as IdentityPrisma } from "@prisma/client";
import {
  notificationPrisma,
  DEFAULT_NOTIFICATION_TRANSACTION_OPTIONS,
} from "../../database/notification.client";
import {
  prisma as identityPrisma,
  DEFAULT_TRANSACTION_OPTIONS as DEFAULT_IDENTITY_TRANSACTION_OPTIONS,
} from "../../database/prisma.client";
import {
  NOTIFICATION_TYPE,
  NOTIFICATION_STATUS,
  NOTIFICATION_SEVERITY,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_TEMPLATE_STATUS,
  EMAIL_STATUS,
  EMAIL_MAX_ATTEMPTS,
} from "../../common/constants/notification.constant";
import {
  calculatePaginationSkip,
  formatPaginationMeta,
} from "../../common/helpers/pagination.helper";
import { isUuid } from "../../common/helpers/uuid.helper";
import { buildTsQuery } from "../../common/helpers/fts.helper";
import {
  ListNotificationsDto,
  ListEmailsDto,
  ListNotificationTemplatesDto,
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
  NotificationItemDto,
} from "./notification.dto";

export interface ClaimedEmailRecord {
  id: string;
  userId: string | null;
  toEmail: string;
  subject: string;
  templateKey: string;
  templateData: unknown;
  status: string;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class NotificationRepository {
  private readonly db: NotificationPrismaClient;

  constructor(dbClient?: NotificationPrismaClient) {
    this.db = dbClient || (notificationPrisma as unknown as NotificationPrismaClient);
  }

  // ─────────────────────────────────────────────
  // User Notifications Inbox (ppe_notification_db)
  // ─────────────────────────────────────────────

  async findMany(userId: string, dto: ListNotificationsDto) {
    const { isRead, status, severity, channel, incidentId, fromDate, toDate } = dto;
    const { skip, take, page, limit } = calculatePaginationSkip(dto.page, dto.limit);

    const where: NotificationPrisma.NotificationWhereInput = {
      userId,
    };

    if (isRead !== undefined) {
      if (isRead) {
        where.status = NOTIFICATION_STATUS.READ;
      } else {
        where.status = { not: NOTIFICATION_STATUS.READ };
      }
    }

    if (status) {
      where.status = status;
    }

    if (severity) {
      where.severity = severity;
    }

    if (channel) {
      where.channel = channel;
    }

    if (incidentId) {
      where.incidentId = incidentId;
    }

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) {
        where.createdAt.gte = new Date(fromDate);
      }
      if (toDate) {
        where.createdAt.lte = new Date(toDate);
      }
    }

    const [items, total] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          template: {
            select: { id: true, code: true, name: true },
          },
        },
      }),
      this.db.notification.count({ where }),
    ]);

    const formattedItems: NotificationItemDto[] = items.map((item) => ({
      id: item.id,
      userId: item.userId,
      incidentId: item.incidentId,
      templateId: item.templateId,
      channel: item.channel,
      title: item.title,
      content: item.content,
      severity: item.severity,
      status: item.status,
      sentAt: item.sentAt,
      readAt: item.readAt,
      createdAt: item.createdAt,
      isRead: item.status === NOTIFICATION_STATUS.READ || Boolean(item.readAt),
      priority: item.severity,
      type:
        item.severity === NOTIFICATION_SEVERITY.CRITICAL
          ? NOTIFICATION_TYPE.ALERT
          : NOTIFICATION_TYPE.INFO,
    }));

    return [formattedItems, total, formatPaginationMeta(page, limit, total)] as const;
  }

  /**
   * Tìm kiếm thông báo người dùng bằng PostgreSQL Full-Text Search (tsvector, tsquery & GIN index)
   * Tự động xếp hạng độ tương đồng bằng hàm ts_rank trên trường title và content
   */
  async searchFts(userId: string, dto: ListNotificationsDto) {
    const search = dto.search?.trim();
    if (!search) {
      return this.findMany(userId, dto);
    }

    const tsQuery = buildTsQuery(search, "prefix");
    if (!tsQuery) {
      return this.findMany(userId, dto);
    }

    const { isRead, status, severity, channel, incidentId, fromDate, toDate } = dto;
    const { skip, take, page, limit } = calculatePaginationSkip(dto.page, dto.limit);

    const whereConditions: NotificationPrisma.Sql[] = [
      NotificationPrisma.sql`n.user_id = ${userId}::uuid`,
      NotificationPrisma.sql`to_tsvector('simple', coalesce(n.title, '') || ' ' || coalesce(n.content, '')) @@ to_tsquery('simple', ${tsQuery})`,
    ];

    if (isRead !== undefined) {
      if (isRead) {
        whereConditions.push(NotificationPrisma.sql`n.status = ${NOTIFICATION_STATUS.READ}`);
      } else {
        whereConditions.push(NotificationPrisma.sql`n.status != ${NOTIFICATION_STATUS.READ}`);
      }
    }

    if (status) {
      whereConditions.push(NotificationPrisma.sql`n.status = ${status}`);
    }

    if (severity) {
      whereConditions.push(NotificationPrisma.sql`n.severity = ${severity}`);
    }

    if (channel) {
      whereConditions.push(NotificationPrisma.sql`n.channel = ${channel}`);
    }

    if (incidentId) {
      whereConditions.push(NotificationPrisma.sql`n.incident_id = ${incidentId}::uuid`);
    }

    if (fromDate) {
      whereConditions.push(NotificationPrisma.sql`n.created_at >= ${new Date(fromDate)}`);
    }

    if (toDate) {
      whereConditions.push(NotificationPrisma.sql`n.created_at <= ${new Date(toDate)}`);
    }

    const whereClause = NotificationPrisma.sql`WHERE ${NotificationPrisma.join(whereConditions, " AND ")}`;

    const [rankedRows, countResult] = await Promise.all([
      this.db.$queryRaw<Array<{ id: string; rank: number }>>`
        SELECT
          n.id,
          ts_rank(to_tsvector('simple', coalesce(n.title, '') || ' ' || coalesce(n.content, '')), to_tsquery('simple', ${tsQuery})) as rank
        FROM notifications n
        ${whereClause}
        ORDER BY rank DESC, n.created_at DESC
        OFFSET ${skip}
        LIMIT ${take}
      `,
      this.db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint as count
        FROM notifications n
        ${whereClause}
      `,
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const ids = rankedRows.map((r: { id: string; rank: number }) => r.id);

    if (ids.length === 0) {
      const emptyItems: NotificationItemDto[] = [];
      return [emptyItems, total, formatPaginationMeta(page, limit, total)] as const;
    }

    const items = await this.db.notification.findMany({
      where: { id: { in: ids } },
      include: {
        template: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    const itemMap = new Map(items.map((item) => [item.id, item]));
    const orderedItems = ids
      .map((id: string) => itemMap.get(id))
      .filter((item): item is (typeof items)[number] => Boolean(item));

    const formattedItems: NotificationItemDto[] = orderedItems.map((item) => ({
      id: item.id,
      userId: item.userId,
      incidentId: item.incidentId,
      templateId: item.templateId,
      channel: item.channel,
      title: item.title,
      content: item.content,
      severity: item.severity,
      status: item.status,
      sentAt: item.sentAt,
      readAt: item.readAt,
      createdAt: item.createdAt,
      isRead: item.status === NOTIFICATION_STATUS.READ || Boolean(item.readAt),
      priority: item.severity,
      type:
        item.severity === NOTIFICATION_SEVERITY.CRITICAL
          ? NOTIFICATION_TYPE.ALERT
          : NOTIFICATION_TYPE.INFO,
    }));

    return [formattedItems, total, formatPaginationMeta(page, limit, total)] as const;
  }

  async countUnread(userId: string): Promise<number> {
    return this.db.notification.count({
      where: {
        userId,
        status: { not: NOTIFICATION_STATUS.READ },
      },
    });
  }

  async findOne(id: string, userId?: string) {
    const where: NotificationPrisma.NotificationWhereInput = { id };
    if (userId) {
      where.userId = userId;
    }
    return this.db.notification.findFirst({
      where,
      include: {
        template: true,
        logs: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.db.notification.updateMany({
      where: {
        id,
        userId,
        status: { not: NOTIFICATION_STATUS.READ },
      },
      data: {
        status: NOTIFICATION_STATUS.READ,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string) {
    return this.db.notification.updateMany({
      where: {
        userId,
        status: { not: NOTIFICATION_STATUS.READ },
      },
      data: {
        status: NOTIFICATION_STATUS.READ,
        readAt: new Date(),
      },
    });
  }

  async delete(id: string, userId: string) {
    return this.db.notification.deleteMany({
      where: { id, userId },
    });
  }

  async createSingleNotification(data: {
    userId: string;
    incidentId?: string | null;
    templateId?: string | null;
    channel?: string;
    title: string;
    content: string;
    severity?: string;
    status?: string;
    sentAt?: Date | null;
  }) {
    if (!data.userId || !isUuid(data.userId)) {
      return null;
    }

    return this.db.notification.create({
      data: {
        userId: data.userId,
        incidentId: data.incidentId || null,
        templateId: data.templateId || null,
        channel: data.channel || NOTIFICATION_CHANNEL.IN_APP,
        title: data.title,
        content: data.content,
        severity: data.severity || NOTIFICATION_SEVERITY.NORMAL,
        status: data.status || NOTIFICATION_STATUS.SENT,
        sentAt: data.sentAt || new Date(),
      },
    });
  }

  async createManyNotifications(
    dataList: Array<{
      userId: string;
      incidentId?: string | null;
      templateId?: string | null;
      channel: string;
      title: string;
      content: string;
      severity?: string;
      status?: string;
      sentAt?: Date | null;
    }>,
  ) {
    const validData = dataList
      .filter((d) => d.userId && isUuid(d.userId))
      .map((d) => ({
        userId: d.userId,
        incidentId: d.incidentId || null,
        templateId: d.templateId || null,
        channel: d.channel || NOTIFICATION_CHANNEL.IN_APP,
        title: d.title,
        content: d.content,
        severity: d.severity || NOTIFICATION_SEVERITY.NORMAL,
        status: d.status || NOTIFICATION_STATUS.SENT,
        sentAt: d.sentAt || new Date(),
      }));

    if (validData.length === 0) return { count: 0 };

    return this.db.notification.createMany({
      data: validData,
    });
  }

  // ─────────────────────────────────────────────
  // User Notification Preferences
  // ─────────────────────────────────────────────

  async findUserPreferences(userId: string) {
    return this.db.notificationPreference.findMany({
      where: { userId },
    });
  }

  async findPreferencesByUserIds(userIds: string[]) {
    if (userIds.length === 0) return [];
    return this.db.notificationPreference.findMany({
      where: { userId: { in: userIds } },
    });
  }

  async findUserPreferenceForChannel(userId: string, channel: string) {
    return this.db.notificationPreference.findUnique({
      where: {
        userId_channel: {
          userId,
          channel,
        },
      },
    });
  }

  async upsertPreference(
    userId: string,
    channel: string,
    enabled: boolean,
    severityThreshold: string = NOTIFICATION_SEVERITY.LOW,
  ) {
    return this.db.notificationPreference.upsert({
      where: {
        userId_channel: {
          userId,
          channel,
        },
      },
      create: {
        userId,
        channel,
        enabled,
        severityThreshold,
      },
      update: {
        enabled,
        severityThreshold,
      },
    });
  }

  // ─────────────────────────────────────────────
  // Notification Templates (ppe_notification_db)
  // ─────────────────────────────────────────────

  async findTemplateByCode(code: string) {
    return this.db.notificationTemplate.findUnique({
      where: { code },
    });
  }

  async findTemplateById(id: string) {
    return this.db.notificationTemplate.findUnique({
      where: { id },
    });
  }

  async findTemplates(dto: ListNotificationTemplatesDto) {
    const { skip, take, page, limit } = calculatePaginationSkip(dto.page, dto.limit);
    const where: NotificationPrisma.NotificationTemplateWhereInput = {};

    if (dto.channel) {
      where.channel = dto.channel;
    }
    if (dto.status) {
      where.status = dto.status;
    }
    if (dto.search) {
      where.OR = [
        { code: { contains: dto.search, mode: "insensitive" } },
        { name: { contains: dto.search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      this.db.notificationTemplate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      this.db.notificationTemplate.count({ where }),
    ]);

    return {
      data: items,
      meta: formatPaginationMeta(page, limit, total),
    };
  }

  async createTemplate(data: CreateNotificationTemplateDto) {
    return this.db.notificationTemplate.create({
      data: {
        code: data.code,
        name: data.name,
        channel: data.channel || (data.channels?.[0] as string) || NOTIFICATION_CHANNEL.IN_APP,
        subjectTemplate: data.subjectTemplate || data.subject || null,
        contentTemplate: data.contentTemplate || data.content || "",
        status:
          data.status ||
          (data.isActive === false
            ? NOTIFICATION_TEMPLATE_STATUS.INACTIVE
            : NOTIFICATION_TEMPLATE_STATUS.ACTIVE),
      },
    });
  }

  async updateTemplate(id: string, data: UpdateNotificationTemplateDto) {
    return this.db.notificationTemplate.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.channel && { channel: data.channel }),
        ...(data.subjectTemplate !== undefined && {
          subjectTemplate: data.subjectTemplate,
        }),
        ...(data.contentTemplate && { contentTemplate: data.contentTemplate }),
        ...(data.status && { status: data.status }),
      },
    });
  }

  async deleteTemplate(id: string) {
    return this.db.notificationTemplate.delete({
      where: { id },
    });
  }

  // ─────────────────────────────────────────────
  // Notification Logs
  // ─────────────────────────────────────────────

  async logNotificationAttempt(
    notificationId: string,
    status: string,
    attempt: number = 1,
    errorMessage?: string | null,
  ) {
    return this.db.notificationLog.create({
      data: {
        notificationId,
        status,
        attempt,
        errorMessage: errorMessage || null,
        sentAt: status === NOTIFICATION_STATUS.SENT ? new Date() : null,
      },
    });
  }

  // ─────────────────────────────────────────────
  // Email Worker Legacy Support (identityPrisma)
  // ─────────────────────────────────────────────

  async claimPendingEmails(batchSize = 20): Promise<ClaimedEmailRecord[]> {
    return identityPrisma.$queryRaw<ClaimedEmailRecord[]>`
      UPDATE email_notifications
      SET status = ${EMAIL_STATUS.PROCESSING}, updated_at = NOW()
      WHERE id IN (
        SELECT id FROM email_notifications
        WHERE (
          status = ${EMAIL_STATUS.PENDING}
          OR (status = ${EMAIL_STATUS.PROCESSING} AND updated_at < NOW() - INTERVAL '15 minutes')
        )
        AND attempts < ${EMAIL_MAX_ATTEMPTS}
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        user_id AS "userId",
        to_email AS "toEmail",
        subject,
        template_key AS "templateKey",
        template_data AS "templateData",
        status,
        attempts,
        last_error AS "lastError",
        sent_at AS "sentAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;
  }

  async updateEmailStatus(
    id: string,
    data: {
      status: string;
      attempts?: number;
      lastError?: string | null;
      sentAt?: Date | null;
    },
  ) {
    return identityPrisma.emailNotification.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.attempts !== undefined && { attempts: data.attempts }),
        ...(data.lastError !== undefined && { lastError: data.lastError }),
        ...(data.sentAt !== undefined && { sentAt: data.sentAt }),
      },
    });
  }

  async findEmailById(id: string) {
    return identityPrisma.emailNotification.findUnique({
      where: { id },
    });
  }

  async findEmails(dto: ListEmailsDto) {
    const { skip, take, page, limit } = calculatePaginationSkip(dto.page, dto.limit);
    const where: IdentityPrisma.EmailNotificationWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.toEmail) where.toEmail = { contains: dto.toEmail, mode: "insensitive" };

    const [items, total] = await Promise.all([
      identityPrisma.emailNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      identityPrisma.emailNotification.count({ where }),
    ]);

    return {
      data: items as ClaimedEmailRecord[],
      meta: formatPaginationMeta(page, limit, total),
    };
  }

  async resetEmailForRetry(id: string) {
    return identityPrisma.emailNotification.update({
      where: { id },
      data: {
        status: EMAIL_STATUS.PENDING,
        attempts: 0,
        lastError: null,
      },
    });
  }

  async createAuditLog(params: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    if (!params.actorId || !isUuid(params.actorId)) return null;
    try {
      return await identityPrisma.auditLog.create({
        data: {
          actorId: params.actorId,
          action: params.action,
          targetType: params.targetType,
          targetId: params.targetId || "",
          details: (params.details as any) || undefined,
          ipAddress: params.ipAddress || null,
          userAgent: params.userAgent || null,
        },
      });
    } catch (err: any) {
      console.warn("[AuditLog] Failed to record event:", err?.message || err);
      return null;
    }
  }
}

export const notificationRepository = new NotificationRepository();
