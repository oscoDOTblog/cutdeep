import { redirect } from "next/navigation";
import { requireAdminPage } from "../../lib/admin-auth";

export default async function ScansRedirect() {
  await requireAdminPage("/settings/scans");
  redirect("/library/manage");
}
