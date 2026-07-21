import { prisma } from "../config/prisma.js";
export async function logActivity(input: { projectId: string; taskId?: string; userId: string; action: string; field?: string; oldValue?: unknown; newValue?: unknown; metadata?: unknown }) {
  return prisma.activityLog.create({ data: { ...input, oldValue: input.oldValue as never, newValue: input.newValue as never, metadata: input.metadata as never } });
}
