import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  RETELL_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  JEV_API_KEY: z.string().min(1).optional(),
  JUDGE_PROVIDER: z.enum(["jev", "claude"]).default("jev"),
  APP_URL: z.string().url(),
  RETELL_AGENT_ID: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;
export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return schema.parse(raw);
}
// Lazy: importing this module must never throw. Validation happens on first
// property access at runtime, once real env vars are guaranteed to exist.
let cached: Env | undefined;
const resolve = (): Env => (cached ??= parseEnv(process.env));
export const env: Env = new Proxy({} as Env, {
  get: (_t, prop: string) => resolve()[prop as keyof Env],
});
