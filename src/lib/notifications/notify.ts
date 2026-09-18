import { prisma } from "@/lib/db/prisma";
import type { NotificationChannel, NotificationType, Prisma } from "@prisma/client";
import { enqueue } from "./queue";
import { sendEmail } from "./email";
import { sendSms } from "./sms";
import { logger } from "@/lib/logging/logger";
import { uniqueRecipientIds } from "./recipient-utils";

export interface NotifyInput {
  recipientIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  /** Stable relation used by notice lifecycle and notification navigation. */
  noticeId?: string;
  channels?: NotificationChannel[]; // default IN_APP only; EMAIL/SMS async
}

/**
 * Send an in-app (and optionally email/SMS) notification to every active admin.
 * Approval requests are institution-wide, so the caller should not have to
 * know which admin accounts exist.
 */
export async function notifyAdmins(input: Omit<NotifyInput, "recipientIds">) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });

  if (admins.length === 0) {
    logger.warn("no active admins available for notification", { type: input.type });
    return;
  }

  await notify({ ...input, recipientIds: admins.map((admin) => admin.id) });
}

/**
 * Create notice notifications inside an existing Prisma transaction. Notice
 * creation/update uses this path so recipients, notice targets and in-app
 * delivery rows commit or roll back together. Notice notifications are in-app
 * by design; optional email/SMS delivery remains the responsibility of the
 * existing asynchronous `notify` path.
 */
export async function notifyInTransaction(tx: Prisma.TransactionClient, input: NotifyInput) {
  const recipientIds = uniqueRecipientIds(input.recipientIds);
  if (recipientIds.length === 0) return;

  const existing = input.noticeId
    ? await tx.notification.findMany({
        where: { noticeId: input.noticeId, recipientId: { in: recipientIds } },
        select: { recipientId: true },
      })
    : [];
  const alreadyCreated = new Set(existing.map((notification) => notification.recipientId));
  const pending = recipientIds.filter((recipientId) => !alreadyCreated.has(recipientId));

  for (const recipientId of pending) {
    const notification = await tx.notification.create({
      data: {
        recipientId,
        noticeId: input.noticeId,
        type: input.type,
        title: input.title,
        message: input.message,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
    });
    await tx.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel: "IN_APP",
        status: "SENT",
        attempts: 1,
        lastAttemptAt: new Date(),
      },
    });
  }
}

export async function notify(input: NotifyInput) {
  const channels = input.channels ?? ["IN_APP"];
  const recipientIds = uniqueRecipientIds(input.recipientIds);

  // A notice can be edited and synced more than once. Avoid creating another
  // notification for a recipient that already has the same notice relation.
  const existingNoticeRecipients = input.noticeId
    ? await prisma.notification.findMany({
        where: { noticeId: input.noticeId, recipientId: { in: recipientIds } },
        select: { recipientId: true },
      })
    : [];
  const existingSet = new Set(existingNoticeRecipients.map((notification) => notification.recipientId));
  const pendingRecipientIds = input.noticeId
    ? recipientIds.filter((recipientId) => !existingSet.has(recipientId))
    : recipientIds;

  for (const recipientId of pendingRecipientIds) {
    const n = await prisma.notification.create({
      data: {
        recipientId,
        noticeId: input.noticeId,
        type: input.type,
        title: input.title,
        message: input.message,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
    });
    for (const channel of channels) {
      if (channel === "IN_APP") {
        await prisma.notificationDelivery.create({
          data: { notificationId: n.id, channel, status: "SENT", attempts: 1, lastAttemptAt: new Date() },
        });
        continue;
      }
      const delivery = await prisma.notificationDelivery.create({
        data: { notificationId: n.id, channel, status: "PENDING", attempts: 0 },
      });
      enqueue(`notify:${channel}:${delivery.id}`, async () => {
        await prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { attempts: { increment: 1 }, status: "RETRYING", lastAttemptAt: new Date() },
        });
        try {
          const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
          if (channel === "EMAIL" && recipient) {
            await sendEmail({ to: recipient.email, subject: input.title, text: input.message });
          } else if (channel === "SMS" && recipient) {
            await sendSms({ to: recipient.email, text: `${input.title}: ${input.message}` });
          }
          await prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: "SENT", providerResponse: "ok", lastAttemptAt: new Date() },
          });
        } catch (err) {
          await prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: "FAILED", providerResponse: String(err), lastAttemptAt: new Date() },
          });
          throw err;
        }
      });
    }
  }
  logger.info("notifications queued", { count: pendingRecipientIds.length, type: input.type });
}
