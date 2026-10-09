import { Prisma } from "@prisma/client";
import {
  prisma,
  DEFAULT_TRANSACTION_OPTIONS,
} from "../../database/prisma.client";
import { SYSTEM_TARGET_ID } from "../../common/constants/audit-log.constant";
import {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_STATUS,
  NOTIFICATION_PRIORITY,
} from "../../common/constants/notification.constant";
import {
  calculatePaginationSkip,
  formatPaginationMeta,
} from "../../common/helpers/pagination.helper";
import { isUuid } from "../../common/helpers/uuid.helper";
import {
  ListNotificationsDto,
  ListEmailsDto,
  ListNotificationTemplatesDto,
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
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
  async findMany(userId: string, dto: ListNotificationsDto) {
    const { isRead, type } = dto;
    const { skip, take } = calculatePaginationSkip(dto.page, dto.limit);

    const where = {
      userId,
      ...(isRead !== undefined && { isRead }),
      ...(type && { type }),
    };

    return prisma.$transaction([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          type: true,
          priority: true,
          title: true,
          content: true,
          actionUrl: true,
          metadata: true,
          isRead: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({ where }),
    ]);
  }

  countUnread(userId: string) {
    return prisma.notification.count({ where: { userId, isRead: false } });
  }

  findOne(id: string, userId: string) {
    return prisma.notification.findFirst({ where: { id, userId } });
  }

  markAsRead(id: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  delete(id: string, userId: string) {
    return prisma.notification.deleteMany({ where: { id, userId } });
  }

  createSingleNotification(data: {
    userId: string;
    type: string;
    priority?: string;
    title: string;
    content: string;
    actionUrl?: string | null;
    metadata?: any;
  }) {
    if (!data.userId || !isUuid(data.userId)) {
      return Promise.resolve(null as any);
    }
    return prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        priority: data.priority ?? NOTIFICATION_PRIORITY.NORMAL,
        title: data.title,
        content: data.content,
        actionUrl: data.actionUrl ?? null,
        metadata: data.metadata ?? null,
      },
    });
  }

  createSingleEmailNotification(data: {
    userId?: string | null;
    toEmail: string;
    subject: string;
    templateKey: string;
    templateData: any;
    status?: string;
  }) {
    const validUserId = data.userId && isUuid(data.userId) ? data.userId : null;
    return prisma.emailNotification.create({
      data: {
        userId: validUserId,
        toEmail: data.toEmail,
        subject: data.subject,
        templateKey: data.templateKey,
        templateData: data.templateData,
        status: data.status ?? EMAIL_STATUS.PENDING,
      },
    });
  }

  createManyNotifications(
    data: Array<{
      userId: string;
      type: string;
      priority: string;
      title: string;
      content: string;
      actionUrl?: string | null;
      metadata?: any;
    }>,
  ) {
    return prisma.notification.createMany({ data });
  }

  createManyEmailNotifications(
    data: Array<{
      userId?: string | null;
      toEmail: string;
      subject: string;
      templateKey: string;
      templateData: any;
      status: string;
    }>,
  ) {
    const formattedData = data.map((d) => ({
      ...d,
      userId: d.userId && isUuid(d.userId) ? d.userId : null,
    }));
    return prisma.emailNotification.createMany({ data: formattedData });
  }

  createMultiChannelNotifications(
    webData: Array<{
      userId: string;
      type: string;
      priority: string;
      title: string;
      content: string;
      actionUrl?: string | null;
      metadata?: any;
    }>,
    emailData: Array<{
      userId?: string | null;
      toEmail: string;
      subject: string;
      templateKey: string;
      templateData: any;
      status: string;
    }>,
  ) {
    const formattedEmailData = emailData.map((d) => ({
      ...d,
      userId: d.userId && isUuid(d.userId) ? d.userId : null,
    }));
    return prisma.$transaction(async (tx) => {
      if (webData.length > 0) {
        await tx.notification.createMany({ data: webData });
      }
      if (formattedEmailData.length > 0) {
        await tx.emailNotification.createMany({ data: formattedEmailData });
      }
    }, DEFAULT_TRANSACTION_OPTIONS);
  }

  async claimPendingEmails(batchSize = 20): Promise<ClaimedEmailRecord[]> {
    return prisma.$queryRaw<ClaimedEmailRecord[]>`
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

  updateEmailStatus(
    id: string,
    data: {
      status: string;
      attempts?: number;
      lastError?: string | null;
      sentAt?: Date | null;
    },
  ) {
    return prisma.emailNotification.update({
      where: { id },
      data,
    });
  }

  async findEmails(dto: ListEmailsDto) {
    const { status, toEmail } = dto;
    const { skip, take, page: safePage, limit: safeLimit } =
      calculatePaginationSkip(dto.page, dto.limit);

    const where = {
      ...(status && { status }),
      ...(toEmail && {
        toEmail: { contains: toEmail, mode: "insensitive" as const },
      }),
    };

    const [items, total] = await prisma.$transaction([
      prisma.emailNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.emailNotification.count({ where }),
    ]);

    return {
      data: items,
      meta: formatPaginationMeta(safePage, safeLimit, total),
    };
  }

  findEmailById(id: string) {
    return prisma.emailNotification.findUnique({ where: { id } });
  }

  resetEmailForRetry(id: string) {
    return prisma.emailNotification.update({
      where: { id },
      data: {
        status: EMAIL_STATUS.PENDING,
        attempts: 0,
        lastError: null,
      },
    });
  }

  // ─────────────────────────────────────────────
  // Template Repository Methods
  // ─────────────────────────────────────────────

  async findTemplates(dto: ListNotificationTemplatesDto) {
    const { isActive, search, channel } = dto;
    const { skip, take, page: safePage, limit: safeLimit } =
      calculatePaginationSkip(dto.page, dto.limit);

    const where: Prisma.NotificationTemplateWhereInput = {
      ...(isActive !== undefined && { isActive }),
      ...(channel && { channels: { array_contains: channel } }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [data, total] = await prisma.$transaction([
      prisma.notificationTemplate.findMany({
        where,
        orderBy: [{ isSystem: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
      prisma.notificationTemplate.count({ where }),
    ]);

    return {
      data,
      meta: formatPaginationMeta(safePage, safeLimit, total),
    };
  }

  findTemplateByCode(code: string) {
    return prisma.notificationTemplate.findUnique({ where: { code } });
  }

  findTemplateById(id: string) {
    return prisma.notificationTemplate.findUnique({ where: { id } });
  }

  createTemplate(data: CreateNotificationTemplateDto) {
    return prisma.notificationTemplate.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description,
        channels: data.channels as any,
        subject: data.subject,
        title: data.title,
        content: data.content,
        variables: data.variables as any,
        isSystem: false,
        isActive: data.isActive ?? true,
      },
    });
  }

  updateTemplate(id: string, data: UpdateNotificationTemplateDto) {
    return prisma.notificationTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.channels !== undefined && { channels: data.channels as any }),
        ...(data.subject !== undefined && { subject: data.subject }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.variables !== undefined && {
          variables: data.variables as any,
        }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  deleteTemplate(id: string) {
    return prisma.notificationTemplate.delete({ where: { id } });
  }

  createAuditLog(data: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    details?: Record<string, unknown> | null;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return prisma.auditLog.create({
      data: {
        actorId: data.actorId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId || SYSTEM_TARGET_ID,
        details: (data.details as any) || null,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  }
}

export const notificationRepository = new NotificationRepository();
