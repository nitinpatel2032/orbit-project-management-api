import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../types.js";
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.get("/", async (req: AuthRequest, res) => {
  const projectIds = (await prisma.projectMember.findMany({ where: { userId: req.user!.id, leftAt: null }, select: { projectId: true } })).map(value => value.projectId);
  const now = new Date();
  const [total, completed, inProgress, overdue, byStatus, byPriority] = await Promise.all([
    prisma.task.count({ where: { projectId: { in: projectIds }, deletedAt: null } }),
    prisma.task.count({ where: { projectId: { in: projectIds }, status: { in: ["DONE", "CLOSED"] }, deletedAt: null } }),
    prisma.task.count({ where: { projectId: { in: projectIds }, status: "IN_PROGRESS", deletedAt: null } }),
    prisma.task.count({ where: { projectId: { in: projectIds }, dueDate: { lt: now }, status: { notIn: ["DONE", "CLOSED", "CANCELLED"] }, deletedAt: null } }),
    prisma.task.groupBy({ by: ["status"], where: { projectId: { in: projectIds }, deletedAt: null }, _count: true }),
    prisma.task.groupBy({ by: ["priority"], where: { projectId: { in: projectIds }, deletedAt: null }, _count: true })
  ]);
  res.json({ totalProjects: projectIds.length, totalTasks: total, completed, inProgress, overdue, byStatus, byPriority });
});
