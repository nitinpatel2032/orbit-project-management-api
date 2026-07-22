import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { signToken } from "../utils/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthRequest } from "../types.js";

export const authRouter = Router();
const registerSchema = z.object({ email: z.email(), username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9._-]+$/), displayName: z.string().min(2).max(80), password: z.string().min(8).max(128) });
authRouter.post("/register", async (req, res) => {
  const input = registerSchema.parse(req.body);
  const exists = await prisma.user.findFirst({ where: { OR: [{ email: input.email.toLowerCase() }, { username: input.username.toLowerCase() }] } });
  if (exists) return res.status(409).json({ error: "Email or username already exists" });
  const user = await prisma.user.create({ data: { email: input.email.toLowerCase(), username: input.username.toLowerCase(), displayName: input.displayName, passwordHash: await bcrypt.hash(input.password, 12) } });
  const identity = { id: user.id, email: user.email, username: user.username, displayName: user.displayName };
  res.status(201).json({ token: signToken(identity), user: identity });
});
authRouter.post("/login", async (req, res) => {
  const input = z.object({ email: z.email(), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || !await bcrypt.compare(input.password, user.passwordHash)) return res.status(401).json({ error: "Invalid email or password" });
  const identity = { id: user.id, email: user.email, username: user.username, displayName: user.displayName };
  res.json({ token: signToken(identity), user: identity });
});
authRouter.get("/me", requireAuth, (req: AuthRequest, res) => res.json({ user: req.user }));

const profileSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, underscores, or hyphens"),
});
authRouter.patch("/profile", requireAuth, async (req: AuthRequest, res) => {
  const input = profileSchema.parse(req.body);
  const username = input.username.toLowerCase();
  const exists = await prisma.user.findFirst({ where: { username, id: { not: req.user!.id } }, select: { id: true } });
  if (exists) return res.status(409).json({ error: "Username is already taken" });
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: { username } });
  const identity = { id: user.id, email: user.email, username: user.username, displayName: user.displayName };
  res.json({ token: signToken(identity), user: identity });
});
