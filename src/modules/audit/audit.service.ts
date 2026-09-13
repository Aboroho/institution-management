import { prisma } from "@/lib/db/prisma";

export async function listAuditLogs(opts: {
  actor?: string; action?: string; entityType?: string; from?: Date; to?: Date;
  page: number; limit: number;
}) {
  const where: Record<string, unknown> = {};
  if (opts.action) where.action = opts.action;
  if (opts.entityType) where.entityType = opts.entityType;
  if (opts.actor) {
    where.actor = { OR: [
      { name: { contains: opts.actor, mode: "insensitive" } },
      { email: { contains: opts.actor, mode: "insensitive" } },
    ]};
  }
  if (opts.from || opts.to) {
    where.createdAt = {
      ...(opts.from ? { gte: opts.from } : {}),
      ...(opts.to ? { lte: opts.to } : {}),
    };
  }
  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (opts.page - 1) * opts.limit, take: opts.limit,
      include: { actor: { select: { name: true, email: true } } },
    }),
  ]);
  return { items, total };
}
