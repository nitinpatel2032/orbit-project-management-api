import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectMember } from "../middleware/access.js";
import { logActivity } from "../services/activity.js";
import { signInviteToken, verifyInviteToken } from "../utils/jwt.js";
import type { AuthRequest } from "../types.js";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const memberInclude = { where: { leftAt: null }, include: { user: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true } } } } as const;
const canManage = (role: string) => role === "OWNER" || role === "ADMIN";

projectsRouter.get("/", async (req: AuthRequest, res) => {
  const projects = await prisma.project.findMany({
    where: { deletedAt: null, members: { some: { userId: req.user!.id, leftAt: null } } },
    include: { members: memberInclude, _count: { select: { tasks: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ projects });
});

projectsRouter.post("/", async (req: AuthRequest, res) => {
  const input = z.object({ name: z.string().min(2).max(100), description: z.string().max(1000).default(""), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#5B5CE2"), privacy: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE") }).parse(req.body);
  const project = await prisma.project.create({ data: { ...input, members: { create: { userId: req.user!.id, role: "OWNER" } } }, include: { members: memberInclude } });
  await logActivity({ projectId: project.id, userId: req.user!.id, action: "PROJECT_CREATED", newValue: { name: project.name } });
  req.app.get("io").to(`user:${req.user!.id}`).emit("project:created", project);
  res.status(201).json({ project });
});

projectsRouter.post("/join", async (req: AuthRequest, res) => {
  const { invite } = z.object({ invite: z.string().min(20) }).parse(req.body);
  const payload = verifyInviteToken(invite);
  if (payload.type !== "project-invite") return res.status(400).json({ error: "Invalid invitation" });
  const project = await prisma.project.findFirst({ where: { id: payload.projectId, deletedAt: null } });
  if (!project) return res.status(404).json({ error: "Project not found" });
  const membership = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: req.user!.id } },
    create: { projectId: project.id, userId: req.user!.id, role: "MEMBER" },
    update: { leftAt: null },
  });
  await logActivity({ projectId: project.id, userId: req.user!.id, action: "MEMBER_JOINED" });
  req.app.get("io").to(`project:${project.id}`).emit("member:joined", { userId: req.user!.id });
  res.json({ project, membership });
});

projectsRouter.get("/:projectId", async (req: AuthRequest, res) => {
  const projectId = String(req.params.projectId);
  const membership = await requireProjectMember(projectId, req.user!.id);
  const project = await prisma.project.findUnique({ where: { id: projectId }, include: { members: memberInclude } });
  res.json({ project, membership });
});

projectsRouter.patch("/:projectId", async (req: AuthRequest, res) => {
  const projectId = String(req.params.projectId);
  const membership = await requireProjectMember(projectId, req.user!.id);
  if (!canManage(membership.role)) return res.status(403).json({ error: "Admin access required" });
  const input = z.object({ name: z.string().min(2).max(100).optional(), description: z.string().max(1000).optional(), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), privacy: z.enum(["PRIVATE", "PUBLIC"]).optional(), archived: z.boolean().optional() }).parse(req.body);
  const { archived, ...values } = input;
  const project = await prisma.project.update({ where: { id: projectId }, data: { ...values, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) } });
  await logActivity({ projectId, userId: req.user!.id, action: "PROJECT_UPDATED", newValue: input });
  req.app.get("io").to(`project:${projectId}`).emit("project:updated", project);
  res.json({ project });
});

projectsRouter.post("/:projectId/invite", async (req: AuthRequest, res) => {
  const projectId = String(req.params.projectId);
  const membership = await requireProjectMember(projectId, req.user!.id);
  if (!canManage(membership.role)) return res.status(403).json({ error: "Admin access required" });
  const invite = signInviteToken(projectId, req.user!.id);
  await logActivity({ projectId, userId: req.user!.id, action: "INVITE_LINK_CREATED" });
  res.json({ invite, expiresIn: "7d" });
});

projectsRouter.get("/:projectId/activity", async (req: AuthRequest, res) => {
  const projectId = String(req.params.projectId);
  await requireProjectMember(projectId, req.user!.id);
  const activities = await prisma.activityLog.findMany({ where: { projectId }, include: { user: { select: { id: true, displayName: true, username: true, avatarUrl: true } } }, orderBy: { createdAt: "desc" }, take: 250 });
  res.json({ activities });
});

projectsRouter.post("/:projectId/leave", async (req: AuthRequest, res) => {
  const projectId = String(req.params.projectId);
  const member = await requireProjectMember(projectId, req.user!.id);
  if (member.role === "OWNER") {
    const successor = await prisma.projectMember.findFirst({ where: { projectId, userId: { not: req.user!.id }, leftAt: null }, orderBy: [{ role: "asc" }, { joinedAt: "asc" }] });
    if (!successor) return res.status(400).json({ error: "Add another member before leaving an owned project" });
    await prisma.$transaction([
      prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: successor.userId } }, data: { role: "OWNER" } }),
      prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: req.user!.id } }, data: { leftAt: new Date() } }),
    ]);
  } else {
    await prisma.projectMember.update({ where: { projectId_userId: { projectId, userId: req.user!.id } }, data: { leftAt: new Date() } });
  }
  await logActivity({ projectId, userId: req.user!.id, action: "MEMBER_LEFT" });
  req.app.get("io").to(`project:${projectId}`).emit("member:left", { userId: req.user!.id });
  res.json({ ok: true });
});

projectsRouter.delete("/:projectId", async (req: AuthRequest, res) => {
  const projectId = String(req.params.projectId);
  const membership = await requireProjectMember(projectId, req.user!.id);
  if (membership.role !== "OWNER") return res.status(403).json({ error: "Owner access required" });
  await prisma.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
  await logActivity({ projectId, userId: req.user!.id, action: "PROJECT_DELETED" });
  req.app.get("io").to(`project:${projectId}`).emit("project:deleted", { projectId });
  res.json({ ok: true });
});
