import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// Lazy: the connection (and the env read it needs) is created on first use, not
// at import time. This keeps `next build` from requiring DATABASE_URL just to
// evaluate route modules while collecting page data. At runtime the first query
// builds and caches the real client.
let instance: DrizzleDb | undefined;
function getDb(): DrizzleDb {
  return (instance ??= drizzle(postgres(env.DATABASE_URL), { schema }));
}

export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get: (_target, prop) => {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type DB = DrizzleDb;
