import { existsSync } from "node:fs";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";
import type { Db } from "./pg-repo";

neonConfig.webSocketConstructor = ws;

let db: Db | null = null;

/** Neon Postgres over WebSockets (Pool supports transactions). */
export function getDb(): Db {
  if (db) return db;
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  db = drizzle(new Pool({ connectionString: url }), { schema }) as unknown as Db;
  return db;
}
