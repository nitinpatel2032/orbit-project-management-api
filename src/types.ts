import type { Request } from "express";
export type AuthUser = { id: string; email: string; username: string; displayName: string };
export type AuthRequest = Request & { user?: AuthUser };
