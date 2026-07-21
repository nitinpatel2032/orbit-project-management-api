import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { verifyToken } from "../utils/jwt.js";

export function createSocketServer(server: HttpServer) {
  const io = new Server(server, { cors: { origin: env.FRONTEND_URL, credentials: true }, transports: ["websocket", "polling"] });
  io.use((socket, next) => { try { socket.data.user = verifyToken(String(socket.handshake.auth.token || "")); next(); } catch { next(new Error("Unauthorized")); } });
  io.on("connection", socket => {
    socket.join(`user:${socket.data.user.id}`);
    socket.on("project:join", async (projectId: string, acknowledge?: (result: object) => void) => {
      const member = await prisma.projectMember.findFirst({ where: { projectId, userId: socket.data.user.id, leftAt: null } });
      if (!member) return acknowledge?.({ ok: false, error: "Forbidden" });
      await socket.join(`project:${projectId}`); acknowledge?.({ ok: true });
    });
    socket.on("project:leave-room", (projectId: string) => socket.leave(`project:${projectId}`));
  });
  return io;
}
