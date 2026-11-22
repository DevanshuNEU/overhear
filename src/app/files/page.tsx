// `/files` is the call list for session report files the person opened. Local mode only: a hosted copy answers 404.
// With nothing open (a restart, or Clear) it goes back to `/`, where the connect screen or the Retell list is. Rendered
// per request, because what the server holds changes.
import { notFound, redirect } from "next/navigation";
import { listFiles } from "@/files/store";
import { isLocalMode } from "@/pull/local";
import { PAGE_NAME } from "@/report/labels";
import { FilesListScreen } from "../FilesListScreen";
import { navView } from "../navView";

export const dynamic = "force-dynamic";

export const metadata = { title: `Calls from files - ${PAGE_NAME}` };

export default async function FilesPage() {
  if (!isLocalMode()) notFound();
  const { rows, problems } = listFiles();
  if (rows.length === 0 && problems.length === 0) redirect("/");
  const view = await navView();
  return <FilesListScreen rows={rows} problems={problems} view={view === "both" ? "both" : "files"} />;
}
