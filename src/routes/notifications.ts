import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../types.js";
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.get("/", async (req: AuthRequest, res) => { const notifications = await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" }, take: 100 }); res.json({ notifications }); });
notificationsRouter.patch("/:id/read", async (req: AuthRequest, res) => { await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: { readAt: new Date() } }); res.json({ ok: true }); });
notificationsRouter.post("/read-all", async (req: AuthRequest, res) => { await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } }); res.json({ ok: true }); });
