import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
const owner = await prisma.user.upsert({ where: { email: "owner@orbit.local" }, update: {}, create: { email: "owner@orbit.local", username: "orbit-owner", displayName: "Orbit Owner", passwordHash } });
await prisma.project.create({ data: { name: "Welcome to Orbit", description: "A seeded project for verifying projects, tasks, nesting, comments, activity, and realtime updates.", color: "#5B5CE2", members: { create: { userId: owner.id, role: "OWNER" } }, tasks: { create: { title: "Connect the frontend", description: "Set VITE_API_URL and VITE_SOCKET_URL to the Render service URL.", priority: "HIGH", createdById: owner.id, updatedById: owner.id, assigneeId: owner.id } } } });
console.log("Seed complete. Demo login: owner@orbit.local / ChangeMe123! (change immediately)");
await prisma.$disconnect();
