import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../types.js";
import { verifyToken } from "../utils/jwt.js";
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try { req.user = verifyToken(token); next(); } catch { return res.status(401).json({ error: "Invalid or expired token" }); }
}
