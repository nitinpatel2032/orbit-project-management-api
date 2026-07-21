# Orbit Project Management API

Production-oriented Node.js/Express backend for Orbit, using PostgreSQL, Prisma, JWT and Socket.IO. It is configured for a Render Free Web Service with Neon Free PostgreSQL.

## Included

- JWT register/login/profile endpoints with bcrypt hashing
- Project membership and roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`)
- Nested tasks through `parentId`
- Complete task status and priority enums
- Comments and threaded replies
- Immutable activity log records
- Notifications schema and endpoints
- Attachment upload endpoint with type and 25 MB limits
- Socket.IO project rooms and task/comment/member/attachment events
- Zod validation, Helmet, CORS and rate limiting
- Soft task deletion and restoration
- Dashboard aggregate API
- Render Blueprint and health check

## 1. Create Neon PostgreSQL

1. Create a free project at https://console.neon.tech.
2. Copy the **pooled** connection string.
3. Keep it private. Add it to Render as `DATABASE_URL`.

## 2. Push this folder to GitHub

Extract the ZIP, open a terminal in this folder, then run:

```bash
git init
git branch -M main
git remote add origin https://github.com/nitinpatel2032/orbit-project-management-api.git
git add .
git commit -m "Add Render Neon realtime backend"
git push -u origin main
```

If the repository already contains a commit, clone it first and copy these files into the clone.

## 3. Deploy on Render

1. In Render, choose **New → Blueprint**.
2. Connect `nitinpatel2032/orbit-project-management-api`.
3. Render detects `render.yaml`.
4. Enter the Neon pooled connection string for `DATABASE_URL`.
5. Let Render generate `JWT_SECRET`.
6. Deploy and wait for `/health` to return `{ "ok": true }`.

Free Render services sleep after 15 minutes without inbound traffic. Socket.IO automatically reconnects, but the first connection after sleep can take about a minute.

## 4. Optional seed

From the Render Shell or locally:

```bash
npm run db:seed
```

The sample credentials are printed by the seed command. Change them immediately.

## 5. Connect the frontend

Set these production frontend environment variables to the Render service URL:

```env
VITE_API_URL=https://YOUR-SERVICE.onrender.com
VITE_SOCKET_URL=https://YOUR-SERVICE.onrender.com
```

Install the client:

```bash
npm install socket.io-client
```

Connect with the JWT:

```ts
import { io } from "socket.io-client";

export const socket = io(import.meta.env.VITE_SOCKET_URL, {
  auth: { token: localStorage.getItem("orbit_token") },
  transports: ["websocket", "polling"],
  reconnection: true,
});

socket.emit("project:join", projectId);
socket.on("task:created", refreshProject);
socket.on("task:updated", refreshProject);
socket.on("task:deleted", refreshProject);
socket.on("comment:created", refreshTask);
```

## Local development

```bash
cp .env.example .env
npm install
npx prisma db push
npm run dev
```

## Important upload note

Render Free has an ephemeral filesystem. The included upload route works for integration testing, but production attachments should use S3, Cloudflare R2, or another object store. The database stores attachment metadata separately so storage can be replaced without redesigning the task model.

## Primary REST endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Receive JWT |
| GET | `/api/auth/me` | Current profile |
| GET/POST | `/api/projects` | List/create projects |
| GET | `/api/projects/:projectId` | Project and members |
| POST | `/api/projects/:projectId/leave` | Leave project |
| GET | `/api/tasks/project/:projectId` | Project tasks |
| POST | `/api/tasks` | Create task or subtask |
| PATCH/DELETE | `/api/tasks/:taskId` | Update/soft-delete task |
| POST | `/api/tasks/:taskId/restore` | Restore task |
| GET | `/api/comments/task/:taskId` | Task discussion |
| POST | `/api/comments` | Comment or reply |
| GET | `/api/dashboard` | Dashboard metrics |
| GET | `/api/notifications` | Notifications |
| POST | `/api/uploads` | Attachment upload |

## Next integration step

After Render provides the service URL, update the Sites frontend to call this API and use Socket.IO instead of the current D1 endpoint. Do not remove the current frontend API until the Render health check, auth flow, project list, and socket connection are verified.
