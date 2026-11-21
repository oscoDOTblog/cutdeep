import Link from "next/link";
import { adminPasswordConfigured, requireAdminPage } from "../lib/admin-auth";
import { logout } from "../unlock/actions";

export default async function Settings() {
  await requireAdminPage("/settings");

  return (
    <>
      <h1 className="sec"><span className="dia" aria-hidden="true">◆</span> Settings</h1>
      <Link className="card settings-item" href="/settings/tracks">
        <div className="rowbody">
          <div className="t"><span className="dia" aria-hidden="true">◆</span> Uploaded tracks</div>
          <div className="a">Edit track details or remove tracks from the matching catalog.</div>
        </div>
        <span className="settings-arrow" aria-hidden="true">›</span>
      </Link>
      {adminPasswordConfigured() && (
        <form className="settings-logout" action={logout}>
          <button className="secondary" type="submit">Log out</button>
        </form>
      )}
    </>
  );
}
