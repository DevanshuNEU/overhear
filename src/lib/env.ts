import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  RETELL_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  JEV_API_KEY: z.string().min(1).optional(),
  JUDGE_PROVIDER: z.enum(["jev", "claude"]).default("jev"),
  APP_URL: z.string().url(),
});

export type Env = z.infer<typeof schema>;
export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return schema.parse(raw);
}
export const env: Env = parseEnv(process.env);
