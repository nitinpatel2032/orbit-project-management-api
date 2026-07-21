import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectMember } from "../middleware/access.js";
import { logActivity } from "../services/activity.js";
import type { AuthRequest } from "../types.js";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);
projectsRouter.get("/", async (req: AuthRequest, res) => {
  const projects = await prisma.project.findMany({ where: { deletedAt: null, members: { some: { userId: req.user!.id, leftAt: null } } }, include: { members: { where: { leftAt: null }, include: { user: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true } } } }, _count: { select: { tasks: true } } }, orderBy: { updatedAt: "desc" } });
  res.json({ projects });
});
projectsRouter.post("/", async (req: AuthRequest, res) => {
  const input = z.object({ name: z.string().min(2).max(100), description: z.string().max(1000).default(""), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#5B5CE2"), privacy: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE") }).parse(req.body);
  const project = await prisma.project.create({ data: { ...input, members: { create: { userId: req.user!.id, role: "OWNER" } } } });
  await logActivity({ projectId: project.id, userId: req.user!.id, action: "PROJECT_CREATED", newValue: { name: project.name } });
  req.app.get("io").to(`user:${req.user!.id}`).emit("project:created", project);
  res.status(201).json({ project });
});
projectsRouter.get("/:projectId", async (req: AuthRequest, res) => { await requireProjectMember(req.params.projectId, req.user!.id); const project = await prisma.project.findUnique({ where: { id: req.params.projectId }, include: { members: { where: { leftAt: null }, include: { user: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true } } } } } }); res.json({ project }); });
projectsRouter.post("/:projectId/leave", async (req: AuthRequest, res) => { const member = await requireProjectMember(req.params.projectId, req.user!.id); if (member.role === "OWNER") return res.status(400).json({ error: "Transfer ownership before leaving" }); await prisma.projectMember.update({ where: { projectId_userId: { projectId: req.params.projectId, userId: req.user!.id } }, data: { leftAt: new Date() } }); await logActivity({ projectId: req.params.projectId, userId: req.user!.id, action: "MEMBER_LEFT" }); req.app.get("io").to(`project:${req.params.projectId}`).emit("member:left", { userId: req.user!.id }); res.json({ ok: true }); });
