import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectEditor, requireProjectMember } from "../middleware/access.js";
import type { AuthRequest } from "../types.js";
const allowed = new Set(["image/jpeg","image/png","image/webp","application/pdf","application/zip","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","video/mp4"]);
const upload = multer({ storage: multer.diskStorage({ destination: env.UPLOAD_DIR, filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`) }), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, allowed.has(file.mimetype)) });
export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);
const attachmentInclude = { uploadedBy: { select: { id: true, displayName: true, username: true } } } as const;
uploadsRouter.post("/", upload.single("file"), async (req: AuthRequest, res) => {
  const { projectId, taskId, commentId } = req.body;
  if (!req.file || !projectId) return res.status(400).json({ error: "File and project are required" });
  await requireProjectEditor(projectId, req.user!.id);
  const tags = String(req.body.tags || "").split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean).slice(0, 10);
  const attachment = await prisma.attachment.create({ data: { projectId, taskId: taskId || null, commentId: commentId || null, uploadedById: req.user!.id, filename: req.file.originalname, storageKey: req.file.filename, mimeType: req.file.mimetype, size: req.file.size, tags }, include: attachmentInclude });
  req.app.get("io").to(`project:${projectId}`).emit("attachment:created", attachment);
  res.status(201).json({ attachment });
});
uploadsRouter.get("/task/:taskId", async (req: AuthRequest, res) => {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: String(req.params.taskId) } });
  await requireProjectMember(task.projectId, req.user!.id);
  const attachments = await prisma.attachment.findMany({ where: { taskId: task.id }, include: attachmentInclude, orderBy: { createdAt: "desc" } });
  res.json({ attachments });
});
uploadsRouter.get("/:attachmentId/download", async (req: AuthRequest, res) => {
  const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: String(req.params.attachmentId) } });
  await requireProjectMember(attachment.projectId, req.user!.id);
  res.download(path.join(env.UPLOAD_DIR, attachment.storageKey), attachment.filename);
});
uploadsRouter.get("/:attachmentId/view", async (req: AuthRequest, res) => {
  const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: String(req.params.attachmentId) } });
  await requireProjectMember(attachment.projectId, req.user!.id);
  res.type(attachment.mimeType).setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
  res.sendFile(path.resolve(env.UPLOAD_DIR, attachment.storageKey));
});
uploadsRouter.delete("/:attachmentId", async (req: AuthRequest, res) => {
  const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: String(req.params.attachmentId) } });
  const member = await requireProjectMember(attachment.projectId, req.user!.id);
  if (attachment.uploadedById !== req.user!.id && member.role !== "OWNER") return res.status(403).json({ error: "Only the uploader or project owner can delete this file" });
  await prisma.attachment.delete({ where: { id: attachment.id } });
  fs.unlink(path.resolve(env.UPLOAD_DIR, attachment.storageKey), () => undefined);
  req.app.get("io").to(`project:${attachment.projectId}`).emit("attachment:deleted", { attachmentId: attachment.id, taskId: attachment.taskId });
  res.json({ ok: true });
});
