// `/test-call` is the test call screen. Local mode only: a hosted copy has no product, no key and no agents, so it answers 404.
// With no key saved it goes back to `/`, where the connect screen is. Rendered per request, so `next build` cannot bake in
// either answer.
import { notFound, redirect } from "next/navigation";
import { hasKey } from "@/pull/key-store";
import { isLocalMode } from "@/pull/local";
import { TestCallScreen } from "../TestCallScreen";

export const dynamic = "force-dynamic";

export const metadata = { title: "Test call - Overhear" };

/** The preview states for screenshots (a scripted client in place of the SDK's) are for development only. */
const stubbable = () => process.env.OVERHEAR_DEMO_STATES === "1" && process.env.NODE_ENV !== "production";

export default async function TestCallPage() {
  if (!isLocalMode()) notFound();
  let stored = false;
  try {
    stored = await hasKey();
  } catch {
    // A key store that will not open is explained on `/`.
  }
  if (!stored) redirect("/");
  return <TestCallScreen stubbable={stubbable()} />;
}
