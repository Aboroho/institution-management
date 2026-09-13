import { prisma } from "@/lib/db/prisma";

interface AuditInput {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export async function audit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValues: (input.oldValues as object) ?? undefined,
        newValues: (input.newValues as object) ?? undefined,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (e) {
    // Audit must never break the main flow; log only.
    console.error(JSON.stringify({ level: "error", message: "audit write failed", error: String(e) }));
  }
}
