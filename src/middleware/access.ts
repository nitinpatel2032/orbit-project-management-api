import { prisma } from "../config/prisma.js";
export async function requireProjectMember(projectId: string, userId: string) {
  const member = await prisma.projectMember.findFirst({ where: { projectId, userId, leftAt: null } });
  if (!member) throw Object.assign(new Error("Project access required"), { status: 403 });
  return member;
}
export async function requireProjectEditor(projectId: string, userId: string) {
  const member = await requireProjectMember(projectId, userId);
  if (member.role === "VIEWER") throw Object.assign(new Error("Edit access required"), { status: 403 });
  return member;
}
