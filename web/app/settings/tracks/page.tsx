import Link from "next/link";
import CatalogBrowser from "../../components/CatalogBrowser";

export default function UploadedTracks() {
  return (
    <>
      <Link className="settings-back" href="/settings"><span aria-hidden="true">‹</span> Settings</Link>
      <h1 className="sec"><span className="dia" aria-hidden="true">◆</span> Uploaded tracks</h1>
      <CatalogBrowser manage />
    </>
  );
}
