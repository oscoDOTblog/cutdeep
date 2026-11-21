import { redirect } from "next/navigation";
import { adminDestination, adminUnlocked } from "../lib/admin-auth";
import PasswordForm from "./PasswordForm";

export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const destination = adminDestination((await searchParams).next);
  if (await adminUnlocked()) redirect(destination);

  return (
    <section className="card unlock-card" aria-labelledby="unlock-title">
      <h1 id="unlock-title" className="t">
        <span className="dia" aria-hidden="true">◆</span> Unlock {destination === "/upload" ? "Upload" : "Settings"}
      </h1>
      <PasswordForm destination={destination} />
    </section>
  );
}
