import "dotenv/config";
import { z } from "zod";

export const env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(10000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  FRONTEND_URL: z.string().url(),
  UPLOAD_DIR: z.string().default("uploads")
}).parse(process.env);
