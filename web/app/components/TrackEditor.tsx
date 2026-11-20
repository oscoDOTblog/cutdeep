"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiError, readJson } from "../lib/api";
import type { Candidate } from "../lib/scans";

type Props = {
  track: Candidate;
  kind: "edit" | "remove";
  onClose: () => void;
  onChanged: (message: string) => void;
};

export default function TrackEditor({ track, kind, onClose, onChanged }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const initialFocus = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = kind === "edit";

  useEffect(() => {
    dialog.current?.showModal();
    (initialFocus.current ?? cancel.current)?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/tracks/${track.track_id}`, editing ? {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      } : { method: "DELETE" });
      const { ok, data } = await readJson(response);
      if (!ok) throw new Error(apiError(data, "Could not update this track."));
      dialog.current?.close();
      onChanged(editing ? `Saved changes to “${data.title}”.` : `Removed “${track.title}” from the catalog.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this track.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="scan-dialog card"
      aria-labelledby="track-editor-title"
      onClose={onClose}
      onCancel={(event) => { if (busy) event.preventDefault(); }}
    >
      <form onSubmit={submit}>
        <h2 id="track-editor-title" className="t">{editing ? "Edit track details" : "Remove catalog track?"}</h2>
        {editing ? (
          <fieldset className="grid" disabled={busy}>
            <label>Title<input ref={initialFocus} name="title" defaultValue={track.title} required /></label>
            <label>Artist<input name="artist" defaultValue={track.artist} /></label>
            <label>Album<input name="album" defaultValue={track.album} /></label>
            <label>Release year<input name="year" defaultValue={track.year} inputMode="numeric" placeholder="YYYY" /></label>
          </fieldset>
        ) : (
          <p>Remove “{track.title}” from future matches? Its saved scans will stay in Library.</p>
        )}
        {error && <p className="err" role="alert">{error}</p>}
        <div className="scan-dialog-actions">
          <button ref={cancel} type="button" className="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" className="secondary scan-confirm" disabled={busy}>
            {busy ? (editing ? "Saving…" : "Removing…") : (editing ? "Save changes" : "Remove track")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
