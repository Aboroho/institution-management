import { prisma } from "@/lib/db/prisma";
import { notFound, forbidden } from "@/lib/errors/errors";

export async function listMyNotifications(userId: string, opts: { unreadOnly?: boolean; page: number; limit: number }) {
  const where: Record<string, unknown> = { recipientId: userId };
  if (opts.unreadOnly) where.isRead = false;
  const [total, items, unreadCount] = await prisma.$transaction([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: { deliveries: true },
    }),
    prisma.notification.count({ where: { recipientId: userId, isRead: false } }),
  ]);
  return { items, total, unreadCount };
}

export async function markRead(userId: string, id: string) {
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n) throw notFound("Notification not found");
  if (n.recipientId !== userId) throw forbidden();
  return prisma.notification.update({ where: { id }, data: { isRead: true } });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { recipientId: userId, isRead: false }, data: { isRead: true } });
  return { ok: true };
}
