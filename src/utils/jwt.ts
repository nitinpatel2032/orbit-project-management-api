import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthUser } from "../types.js";
export const signToken = (user: AuthUser) => jwt.sign(user, env.JWT_SECRET, { expiresIn: "7d", issuer: "orbit-api" });
export const verifyToken = (token: string) => jwt.verify(token, env.JWT_SECRET, { issuer: "orbit-api" }) as AuthUser;
