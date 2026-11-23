// Runs once when a Next.js server starts. On a hosted copy, it starts the demo clinic's hourly request-log purge.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startRetention } = await import("./demo/retention");
  startRetention();
}
