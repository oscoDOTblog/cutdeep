"use client";

import { useActionState } from "react";
import { unlock } from "./actions";

export default function PasswordForm({ destination }: { destination: string }) {
  const [message, action, pending] = useActionState(unlock, "");

  return (
    <form action={action} className="unlock-form">
      <input type="hidden" name="next" value={destination} />
      <label htmlFor="admin-password">Password</label>
      <input id="admin-password" name="password" type="password" autoComplete="current-password"
        required aria-invalid={Boolean(message)} aria-describedby={message ? "unlock-error" : undefined} />
      {message && <p id="unlock-error" className="err" role="alert">{message}</p>}
      <button className="btn-amber" type="submit" disabled={pending}>
        {pending ? "Unlocking…" : "Unlock"}
      </button>
    </form>
  );
}
