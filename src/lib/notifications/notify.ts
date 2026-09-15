import { prisma } from "@/lib/db/prisma";
import type { NotificationChannel, NotificationType } from "@prisma/client";
import { enqueue } from "./queue";
import { sendEmail } from "./email";
import { sendSms } from "./sms";
import { logger } from "@/lib/logging/logger";

export interface NotifyInput {
  recipientIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
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

  await notify({ ...input, recipientIds: admins.map((admin: any) => admin.id) });
}

export async function notify(input: NotifyInput) {
  const channels = input.channels ?? ["IN_APP"];
  for (const recipientId of input.recipientIds) {
    const n = await prisma.notification.create({
      data: {
        recipientId,
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
  logger.info("notifications queued", { count: input.recipientIds.length, type: input.type });
}
