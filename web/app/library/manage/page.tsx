"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import SavedScanCard from "../../components/SavedScanCard";
import { loadScans, removeScan, updateScan, type Scan } from "../../lib/scans";

export default function ScannedLibrary() {
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [action, setAction] = useState<{ kind: "edit" | "remove"; scan: Scan } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setScans(loadScans());
  }, []);

  useEffect(() => {
    if (!action || !dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    if (action.kind === "edit") titleInput.current?.focus();
    else cancelButton.current?.focus();
  }, [action]);

  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (scans ?? []).filter(({ title, artist, album, year }) => {
    const text = `${title} ${artist} ${album} ${year ?? ""}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  if (sort === "title") matches.sort((a, b) => a.title.localeCompare(b.title));

  function openAction(kind: "edit" | "remove", scan: Scan) {
    setFeedback("");
    setError("");
    setAction({ kind, scan });
  }

  function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    const { kind, scan } = action;
    try {
      if (kind === "edit") {
        const form = new FormData(event.currentTarget);
        const title = String(form.get("title") ?? "").trim();
        if (!title) {
          setError("Enter a title for this scan.");
          titleInput.current?.focus();
          return;
        }
        const year = String(form.get("year") ?? "").trim();
        if (year && !/^[1-9][0-9]{3}$/.test(year)) {
          setError("Enter a four-digit release year.");
          const yearInput = event.currentTarget.elements.namedItem("year");
          if (yearInput instanceof HTMLInputElement) yearInput.focus();
          return;
        }
        setScans(updateScan(scan, {
          title,
          artist: String(form.get("artist") ?? "").trim(),
          album: String(form.get("album") ?? "").trim(),
          year,
        }));
        setFeedback(`Saved changes to “${title}”.`);
      } else {
        setScans(removeScan(scan));
        setFeedback(`Removed “${scan.title}” from this device.`);
      }
      dialog.current?.close();
      search.current?.focus();
    } catch {
      setError(kind === "edit" ? "Could not save these changes. Reopen the scanned library and try again."
        : "Could not remove the scan from this device.");
    }
  }

  return (
    <>
      <Link className="settings-back" href="/library"><span aria-hidden="true">‹</span> Library</Link>
      <h1 className="sec"><span className="dia" aria-hidden="true">◆</span> Scanned library</h1>
      <div className="scan-tools">
        <div>
          <label htmlFor="scan-query">Search saved scans</label>
          <div className="search-row">
            <input
              ref={search}
              id="scan-query"
              type="search"
              placeholder="Title, artist, album, or year"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <label>
          Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recent">Newest first</option>
            <option value="title">Title A–Z</option>
          </select>
        </label>
      </div>

      {feedback && <p className="status" role="status">{feedback}</p>}
      {scans === null ? (
        <p className="status">Loading saved scans…</p>
      ) : scans.length === 0 ? (
        <p className="status">No scans saved on this device. <Link href="/">Scan music on Home</Link>.</p>
      ) : (
        <p className="status" role="status">
          {terms.length ? `${matches.length} of ${scans.length} scans` : `${scans.length} saved scan${scans.length === 1 ? "" : "s"}`}
        </p>
      )}
      {scans && scans.length > 0 && matches.length === 0 && <p className="empty">No scans match your search.</p>}
      <ul className="scan-list">
        {matches.map((scan, index) => (
          <li className="saved-scan-row" key={`${scan.ts}-${index}`}>
            <SavedScanCard scan={scan} />
            <div className="scan-actions">
              <button type="button" aria-label={`Edit details for ${scan.title}`} onClick={() => openAction("edit", scan)}>
                Edit
              </button>
              <button type="button" className="scan-remove" aria-label={`Remove ${scan.title} from library`} onClick={() => openAction("remove", scan)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <dialog ref={dialog} className="scan-dialog card" aria-labelledby="scan-dialog-title" onClose={() => setAction(null)}>
        {action && (
          <form onSubmit={submitAction}>
            <h2 id="scan-dialog-title" className="t">{action.kind === "edit" ? "Edit scan details" : "Remove saved scan?"}</h2>
            {action.kind === "edit" ? (
              <>
                <p className="a">Changes apply to the scan saved on this device.</p>
                <fieldset className="grid">
                  <label>Title<input ref={titleInput} name="title" defaultValue={action.scan.title} required /></label>
                  <label>Artist<input name="artist" defaultValue={action.scan.artist} /></label>
                  <label>Album<input name="album" defaultValue={action.scan.album} /></label>
                  <label>Release year<input name="year" defaultValue={action.scan.year} inputMode="numeric" placeholder="YYYY" /></label>
                </fieldset>
              </>
            ) : (
              <p>Remove “{action.scan.title}” from this device’s scanned library?</p>
            )}
            {error && <p className="err" role="alert">{error}</p>}
            <div className="scan-dialog-actions">
              <button ref={cancelButton} type="button" className="secondary" onClick={() => dialog.current?.close()}>Cancel</button>
              <button type="submit" className="secondary scan-confirm">{action.kind === "edit" ? "Save changes" : "Remove scan"}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
