import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import { schema } from "./schema";

const runtimeEnv = env as typeof env & { DB: D1Database };

export function createDb(database: D1Database = runtimeEnv.DB) {
  return drizzle(database, { schema });
}

export type AppDb = ReturnType<typeof createDb>;
