import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export const db = drizzle(postgres(env.DATABASE_URL), { schema });
export type DB = typeof db;
