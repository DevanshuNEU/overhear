import { Retell } from "retell-sdk";
import { env } from "@/lib/env";

// `Retell.verify` resolves a `Promise<boolean>` (it uses WebCrypto's async
// `subtle.verify` under the hood), not a plain `boolean` — so this must be
// async too. Await works fine whether verify (real or mocked) returns a
// Promise or a plain boolean.
export async function verifyRetellSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  try {
    return await Retell.verify(rawBody, env.RETELL_API_KEY, signature);
  } catch {
    return false;
  }
}
