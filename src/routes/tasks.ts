import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectEditor, requireProjectMember } from "../middleware/access.js";
import { logActivity } from "../services/activity.js";
import type { AuthRequest } from "../types.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

const taskInput = z.object({
  projectId: z.string(),
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(10000).default(""),
  status: z.enum(["TODO","IN_PROGRESS","BLOCKED","REVIEW","TESTING","DONE","CLOSED","CANCELLED"]).default("TODO"),
  priority: z.enum(["URGENT","HIGH","MEDIUM","LOW"]).default("MEDIUM"),
  assigneeId: z.string().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  position: z.number().default(0),
});
const taskInclude = { assignee: { select: { id: true, displayName: true, username: true } }, _count: { select: { comments: true, children: true, attachments: true } } } as const;
const projectKeyCandidate = () => `ORB-${randomBytes(5).toString("base64url").replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase().padEnd(6, "0")}`;
const encodeTaskNumber = (number: number) => {
  const encoded = number.toString(36).toUpperCase();
  if (encoded.length > 6) throw new Error("Project task key capacity exceeded");
  return encoded.padStart(6, "0");
};
const ensureProjectKey = async (projectId: string) => {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { key: true } });
  if (project.key) return project.key;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const key = projectKeyCandidate();
    if (!await prisma.project.findUnique({ where: { key }, select: { id: true } })) {
      await prisma.project.update({ where: { id: projectId }, data: { key } });
      return key;
    }
  }
  throw new Error("Could not allocate a project key");
};
const hydrateTaskKeys = async (projectId: string, projectKey: string) => {
  const existing = await prisma.task.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  const missing = existing.filter(task => task.number === null || task.key === null);
  if (missing.length) {
    let next = Math.max(0, ...existing.map(task => task.number || 0)) + 1;
    await prisma.$transaction(async tx => {
      for (const task of missing) {
        const number = next++;
        await tx.task.update({ where: { id: task.id }, data: { number, key: `${projectKey}-${encodeTaskNumber(number)}` } });
      }
      await tx.project.update({ where: { id: projectId }, data: { nextTaskNumber: next } });
    });
  }
  return prisma.task.findMany({
    where: { projectId, deletedAt: null },
    include: taskInclude,
    orderBy: [{ parentId: "asc" }, { position: "asc" }, { createdAt: "desc" }],
  });
};

tasksRouter.get("/project/:projectId", async (req: AuthRequest, res) => {
  await requireProjectMember(req.params.projectId, req.user!.id);
  const projectKey = await ensureProjectKey(req.params.projectId);
  res.json({ tasks: await hydrateTaskKeys(req.params.projectId, projectKey) });
});

tasksRouter.post("/", async (req: AuthRequest, res) => {
  const input = taskInput.parse(req.body);
  await requireProjectEditor(input.projectId, req.user!.id);
  if (input.assigneeId) {
    const member = await prisma.projectMember.findFirst({ where: { projectId: input.projectId, userId: input.assigneeId, leftAt: null } });
    if (!member) return res.status(400).json({ error: "Assignee must be an active project member" });
  }
  const projectKey = await ensureProjectKey(input.projectId);
  const task = await prisma.$transaction(async tx => {
    const highest = await tx.task.aggregate({ where: { projectId: input.projectId }, _max: { number: true } });
    const project = await tx.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { nextTaskNumber: true } });
    const number = Math.max(project.nextTaskNumber, (highest._max.number || 0) + 1);
    await tx.project.update({ where: { id: input.projectId }, data: { nextTaskNumber: number + 1 } });
    return tx.task.create({ data: { ...input, number, key: `${projectKey}-${encodeTaskNumber(number)}`, createdById: req.user!.id, updatedById: req.user!.id } });
  });
  await logActivity({ projectId: input.projectId, taskId: task.id, userId: req.user!.id, action: input.parentId ? "SUBTASK_CREATED" : "TASK_CREATED", newValue: { key: task.key, title: task.title } });
  req.app.get("io").to(`project:${input.projectId}`).emit("task:created", task);
  res.status(201).json({ task });
});

tasksRouter.patch("/:taskId", async (req: AuthRequest, res) => {
  const existing = await prisma.task.findUniqueOrThrow({ where: { id: req.params.taskId } });
  await requireProjectEditor(existing.projectId, req.user!.id);
  const patch = taskInput.omit({ projectId: true }).partial().parse(req.body);
  if (patch.assigneeId) {
    const member = await prisma.projectMember.findFirst({ where: { projectId: existing.projectId, userId: patch.assigneeId, leftAt: null } });
    if (!member) return res.status(400).json({ error: "Assignee must be an active project member" });
  }
  const task = await prisma.task.update({ where: { id: existing.id }, data: { ...patch, updatedById: req.user!.id } });
  await logActivity({ projectId: existing.projectId, taskId: task.id, userId: req.user!.id, action: "TASK_UPDATED", oldValue: existing, newValue: task });
  req.app.get("io").to(`project:${existing.projectId}`).emit("task:updated", task);
  res.json({ task });
});

tasksRouter.delete("/:taskId", async (req: AuthRequest, res) => {
  const existing = await prisma.task.findUniqueOrThrow({ where: { id: req.params.taskId } });
  await requireProjectEditor(existing.projectId, req.user!.id);
  const task = await prisma.task.update({ where: { id: existing.id }, data: { deletedAt: new Date(), updatedById: req.user!.id } });
  await logActivity({ projectId: existing.projectId, taskId: task.id, userId: req.user!.id, action: "TASK_DELETED" });
  req.app.get("io").to(`project:${existing.projectId}`).emit("task:deleted", { taskId: task.id });
  res.json({ ok: true });
});

tasksRouter.post("/:taskId/restore", async (req: AuthRequest, res) => {
  const existing = await prisma.task.findUniqueOrThrow({ where: { id: req.params.taskId } });
  await requireProjectEditor(existing.projectId, req.user!.id);
  const task = await prisma.task.update({ where: { id: existing.id }, data: { deletedAt: null, updatedById: req.user!.id } });
  await logActivity({ projectId: existing.projectId, taskId: task.id, userId: req.user!.id, action: "TASK_RESTORED" });
  req.app.get("io").to(`project:${existing.projectId}`).emit("task:restored", task);
  res.json({ task });
});
