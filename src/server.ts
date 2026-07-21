import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { createSocketServer } from "./socket/index.js";

await mkdir(env.UPLOAD_DIR, { recursive: true });
const server = createServer(app);
const io = createSocketServer(server);
app.set("io", io);
server.listen(env.PORT, "0.0.0.0", () => console.log(`Orbit API listening on ${env.PORT}`));
const shutdown = async () => { io.close(); await prisma.$disconnect(); server.close(() => process.exit(0)); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
