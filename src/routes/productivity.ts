import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requireProjectEditor, requireProjectMember } from "../middleware/access.js";
import type { AuthRequest } from "../types.js";

export const productivityRouter = Router();
productivityRouter.use(requireAuth);
const text = z.string().trim().min(1).max(200);

productivityRouter.get("/project/:projectId", async (req: AuthRequest, res) => {
  const projectId = String(req.params.projectId);
  await requireProjectMember(projectId, req.user!.id);
  const [templates, fields, taskValues, timeEntries, milestones, milestoneTasks, preferences, filters] = await Promise.all([
    prisma.taskTemplate.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.projectField.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
    prisma.taskCustomValue.findMany({ where: { taskId: { in: (await prisma.task.findMany({ where: { projectId, deletedAt: null }, select: { id: true } })).map(task => task.id) } } }),
    prisma.timeEntry.findMany({ where: { projectId, userId: req.user!.id }, orderBy: { startedAt: "desc" }, take: 100 }),
    prisma.milestone.findMany({ where: { projectId }, orderBy: { dueDate: "asc" } }),
    prisma.milestoneTask.findMany({ where: { milestoneId: { in: (await prisma.milestone.findMany({ where: { projectId }, select: { id: true } })).map(milestone => milestone.id) } } }),
    prisma.notificationPreference.findUnique({ where: { userId: req.user!.id } }),
    prisma.savedFilter.findMany({ where: { projectId, userId: req.user!.id }, orderBy: { createdAt: "desc" } }),
  ]);
  res.json({ templates, fields, taskValues, timeEntries, milestones, milestoneTasks, preferences, filters });
});

productivityRouter.post("/templates", async (req: AuthRequest, res) => {
  const input = z.object({ projectId: z.string(), name: text, title: text, description: z.string().max(5000).default(""), recurrence: z.enum(["daily","weekly","monthly"]).nullable().optional().or(z.literal("")) }).parse(req.body);
  await requireProjectEditor(input.projectId, req.user!.id);
  const template = await prisma.taskTemplate.create({ data: { ...input, recurrence: input.recurrence || null } });
  res.status(201).json({ template });
});
productivityRouter.post("/templates/:id/use", async (req: AuthRequest, res) => {
  const template = await prisma.taskTemplate.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  await requireProjectEditor(template.projectId, req.user!.id);
  const task = await prisma.$transaction(async tx => {
    const project = await tx.project.update({ where: { id: template.projectId }, data: { nextTaskNumber: { increment: 1 } } });
    const number = project.nextTaskNumber;
    return tx.task.create({ data: { projectId: template.projectId, number, key: `${project.key || "ORB"}-${String(number).padStart(6,"0")}`, title: template.title, description: template.description, priority: template.priority, createdById: req.user!.id, updatedById: req.user!.id } });
  });
  if (template.recurrence) { const days = template.recurrence === "daily" ? 1 : template.recurrence === "weekly" ? 7 : 30; await prisma.taskTemplate.update({ where: { id: template.id }, data: { nextRunAt: new Date(Date.now()+days*86400000) } }); }
  req.app.get("io").to(`project:${template.projectId}`).emit("task:created", task);
  res.status(201).json({ task });
});

productivityRouter.post("/fields", async (req: AuthRequest, res) => {
  const input = z.object({ projectId:z.string(), name:text, type:z.enum(["text","number","date","select"]).or(z.string()), options:z.string().optional() }).parse(req.body);
  await requireProjectEditor(input.projectId, req.user!.id);
  const field = await prisma.projectField.create({ data:{ projectId:input.projectId,name:input.name,type:input.type,options:(input.options||"").split(",").map(x=>x.trim()).filter(Boolean) } });
  res.status(201).json({ field });
});
productivityRouter.post("/fields/value", async (req: AuthRequest, res) => {
  const input = z.object({ taskId:z.string(), fieldId:z.string(), value:z.any() }).parse(req.body);
  const [task, field] = await Promise.all([prisma.task.findUniqueOrThrow({where:{id:input.taskId}}), prisma.projectField.findUniqueOrThrow({where:{id:input.fieldId}})]);
  if (task.projectId !== field.projectId) return res.status(400).json({error:"Field does not belong to this task's project"});
  await requireProjectEditor(task.projectId, req.user!.id);
  const customValue = await prisma.taskCustomValue.upsert({where:{taskId_fieldId:{taskId:task.id,fieldId:field.id}},create:input,update:{value:input.value}});
  req.app.get("io").to(`project:${task.projectId}`).emit("task:custom-field",{taskId:task.id,fieldId:field.id,value:input.value});
  res.json({customValue});
});

productivityRouter.post("/time/start", async (req: AuthRequest, res) => {
  const input=z.object({projectId:z.string(),taskId:z.string(),note:z.string().max(500).optional()}).parse(req.body); await requireProjectEditor(input.projectId,req.user!.id);
  await prisma.timeEntry.updateMany({where:{userId:req.user!.id,endedAt:null},data:{endedAt:new Date()}});
  const entry=await prisma.timeEntry.create({data:{...input,userId:req.user!.id}}); res.status(201).json({entry});
});
productivityRouter.post("/time/:id/stop", async (req: AuthRequest, res) => {
  const entry=await prisma.timeEntry.findUniqueOrThrow({where:{id:String(req.params.id)}}); if(entry.userId!==req.user!.id)return res.status(403).json({error:"Only the timer owner can stop it"});
  const endedAt=new Date(),minutes=Math.max(1,Math.round((endedAt.getTime()-entry.startedAt.getTime())/60000)); const updated=await prisma.timeEntry.update({where:{id:entry.id},data:{endedAt,minutes}}); res.json({entry:updated});
});

productivityRouter.post("/milestones", async (req: AuthRequest, res) => { const input=z.object({projectId:z.string(),name:text,dueDate:z.coerce.date()}).parse(req.body); await requireProjectEditor(input.projectId,req.user!.id); const milestone=await prisma.milestone.create({data:input}); res.status(201).json({milestone}); });
productivityRouter.post("/milestones/assign", async (req: AuthRequest, res) => { const input=z.object({projectId:z.string(),taskId:z.string(),milestoneId:z.string().nullable()}).parse(req.body); await requireProjectEditor(input.projectId,req.user!.id); const task=await prisma.task.findUniqueOrThrow({where:{id:input.taskId}}); if(task.projectId!==input.projectId)return res.status(400).json({error:"Task does not belong to this project"}); await prisma.milestoneTask.deleteMany({where:{taskId:input.taskId}}); if(input.milestoneId){const milestone=await prisma.milestone.findUniqueOrThrow({where:{id:input.milestoneId}});if(milestone.projectId!==input.projectId)return res.status(400).json({error:"Milestone does not belong to this project"});await prisma.milestoneTask.create({data:{taskId:input.taskId,milestoneId:input.milestoneId}});} req.app.get("io").to(`project:${input.projectId}`).emit("task:milestone",input); res.json({ok:true}); });
productivityRouter.post("/preferences", async (req: AuthRequest, res) => { const input=z.object({email:z.boolean(),inApp:z.boolean(),assigned:z.boolean(),comments:z.boolean(),mentions:z.boolean(),digest:z.boolean()}).parse(req.body); const preferences=await prisma.notificationPreference.upsert({where:{userId:req.user!.id},create:{userId:req.user!.id,...input},update:input}); res.json({preferences}); });
productivityRouter.post("/filters", async (req: AuthRequest, res) => { const input=z.object({projectId:z.string(),name:text,filters:z.record(z.string(),z.any())}).parse(req.body); await requireProjectMember(input.projectId,req.user!.id); const filter=await prisma.savedFilter.create({data:{...input,userId:req.user!.id}}); res.status(201).json({filter}); });
productivityRouter.post("/bulk", async (req: AuthRequest, res) => { const input=z.object({projectId:z.string(),taskIds:z.array(z.string()).min(1).max(200),status:z.string().optional(),priority:z.string().optional()}).parse(req.body); await requireProjectEditor(input.projectId,req.user!.id); const data:any={updatedById:req.user!.id}; if(input.status)data.status=input.status.toUpperCase().replaceAll(" ","_"); if(input.priority)data.priority=input.priority.toUpperCase(); const result=await prisma.task.updateMany({where:{projectId:input.projectId,id:{in:input.taskIds}},data}); req.app.get("io").to(`project:${input.projectId}`).emit("tasks:bulk-updated",{taskIds:input.taskIds}); res.json({updated:result.count}); });
