import { requireAdminPage } from "../lib/admin-auth";
import UploadForm from "./UploadForm";

export default async function UploadPage() {
  await requireAdminPage("/upload");
  return <UploadForm />;
}
