import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Prevent unhandled 'error' events from crashing the process when the pool
// drops an idle connection — the pool will reconnect automatically.
pool.on('error', (err) => {
  console.error('[db] Idle pool client error (non-fatal):', err.message);
});
export const db = drizzle(pool, { schema });
