// `/` belongs to the product. A hosted copy has no product, so it sends visitors to the demo at /demo, as the
// Railway URL always showed the demo. In local mode (`OVERHEAR_LOCAL=1`) this is a placeholder shell until the
// product screens land. Rendered per request (see `dynamic`), so `next build` cannot bake in either branch.
import { redirect } from "next/navigation";
import { DEMO_HOME } from "@/lib/demo-paths";
import { isLocalMode } from "@/pull/local";

export const dynamic = "force-dynamic";

export default function Home() {
  if (!isLocalMode()) redirect(DEMO_HOME);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col px-6 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Overhear</h1>
    </main>
  );
}
